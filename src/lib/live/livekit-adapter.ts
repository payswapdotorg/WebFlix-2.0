/**
 * WFX2-LIVE-PLATFORM-1 — the LiveKit implementation of the media adapter
 * boundary (ADR-0005 candidate; the interactive-stage provider spike).
 *
 * SERVER-ONLY: this module touches LIVEKIT_API_SECRET. It must never be
 * imported by client code — the build's import graph + review law enforce
 * that; the renderer receives only the minted short-lived plan.
 *
 * Webhook verification: LiveKit signs POST bodies in the `Authorization`
 * header (SHA-256 HMAC over the raw body with the API secret). The
 * WebhookReceiver from livekit-server-sdk validates and decodes; ANY
 * failure yields null so routes answer 401 and never reconcile.
 */
import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  WebhookReceiver,
  type WebhookEvent,
} from "livekit-server-sdk";
import { liveProviderConfig } from "./config";
import {
  grantsForRole,
  type LiveProviderAdapter,
  type LiveRecordingCapability,
  type MintTokenOptions,
} from "./provider";
import type { LivePlaybackPlan, LiveWebhookEvent } from "./types";

function roomService(): RoomServiceClient {
  const cfg = liveProviderConfig();
  if (!cfg.url || !cfg.apiKey || !cfg.apiSecret) {
    throw new Error("live-provider-not-configured");
  }
  return new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret);
}

/**
 * Phase 4 recording capability (ADR-0008): provider-side composite egress.
 * The operator must DECLARE egress availability (LIVEKIT_EGRESS_ENABLED
 * === "true"); the storage destination itself is configured on the egress
 * deployment (or per-request via the EncodedFileOutput output oneof). An
 * undeclared/unconfigured egress is an honest "not configured" state, never
 * a guessed attempt (work order §3.8). The egress API endpoint derives from
 * LIVEKIT_URL (wss://host → https://host).
 */
const livekitRecording: LiveRecordingCapability = {
  get egressConfigured(): boolean {
    const cfg = liveProviderConfig();
    return cfg.configured && process.env.LIVEKIT_EGRESS_ENABLED === "true";
  },

  async startRoomEgress(roomName: string) {
    if (!this.egressConfigured) throw new Error("live-egress-not-configured");
    const cfg = liveProviderConfig();
    if (!cfg.url || !cfg.apiKey || !cfg.apiSecret) {
      throw new Error("live-provider-not-configured");
    }
    const httpUrl = cfg.url.replace(/^ws(s?):\/\//, "http$1://");
    const client = new EgressClient(httpUrl, cfg.apiKey, cfg.apiSecret);
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath:
        process.env.LIVEKIT_EGRESS_FILEPATH ?? "wfl-replay/{room_name}-{time}",
    });
    const egress = await client.startRoomCompositeEgress(roomName, fileOutput);
    return { egressId: egress.egressId };
  },

  async stopRoomEgress(egressId: string) {
    if (!this.egressConfigured) return; // idempotent no-op by law
    const cfg = liveProviderConfig();
    if (!cfg.url || !cfg.apiKey || !cfg.apiSecret) return;
    const httpUrl = cfg.url.replace(/^ws(s?):\/\//, "http$1://");
    const client = new EgressClient(httpUrl, cfg.apiKey, cfg.apiSecret);
    try {
      await client.stopEgress(egressId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|does not exist/i.test(msg)) return;
      throw err;
    }
  },
};

let webhookReceiver: WebhookReceiver | null = null;
function receiver(): WebhookReceiver {
  const cfg = liveProviderConfig();
  if (!cfg.url || !cfg.apiKey || !cfg.apiSecret) {
    throw new Error("live-provider-not-configured");
  }
  webhookReceiver ??= new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  return webhookReceiver;
}

function mapWebhookEvent(ev: WebhookEvent): LiveWebhookEvent {
  // LiveKit event shape: { event: string, room?: { name }, participant?: {...} }
  const kindRaw = typeof ev.event === "string" ? ev.event : "unknown";
  const knownKinds = [
    "room_started",
    "room_finished",
    "participant_joined",
    "participant_left",
  ] as const;
  const kind = (knownKinds as readonly string[]).includes(kindRaw)
    ? (kindRaw as LiveWebhookEvent["kind"])
    : "unknown";
  return {
    // LiveKit webhook payloads carry id; fall back to a stable composite so
    // replays of the same delivery still dedupe by (event, room, participant, time).
    eventId:
      typeof ev.id === "string" && ev.id
        ? ev.id
        : `${kindRaw}:${ev.room?.name ?? ""}:${ev.participant?.identity ?? ""}:${ev.createdAt ?? ""}`,
    kind,
    provider: "livekit",
    roomName: ev.room?.name ?? "",
    participantIdentity: ev.participant?.identity ?? null,
    at: new Date().toISOString(),
  };
}

export const livekitAdapter: LiveProviderAdapter = {
  provider: "livekit",

  recording: livekitRecording,

  isConfigured(): boolean {
    return liveProviderConfig().configured;
  },

  async mintToken(opts: MintTokenOptions): Promise<LivePlaybackPlan> {
    const cfg = liveProviderConfig();
    if (!cfg.url || !cfg.apiKey || !cfg.apiSecret) {
      throw new Error("live-provider-not-configured");
    }
    const grants = grantsForRole(opts.role);
    const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
      identity: opts.identity,
      ttl: opts.ttlSeconds,
    });
    at.addGrant({
      room: opts.roomName,
      roomJoin: true,
      ...grants,
    });
    return {
      provider: "livekit",
      url: cfg.url,
      roomName: opts.roomName,
      token: await at.toJwt(),
      identity: opts.identity,
      role: opts.role,
      expiresAt: Math.floor(Date.now() / 1000) + opts.ttlSeconds,
    };
  },

  async destroyRoom(roomName: string): Promise<void> {
    const svc = roomService();
    // Idempotent by law: deleting a room the provider no longer knows is a
    // successful no-op (the goal state is "room gone", which already holds).
    // LiveKit words that condition BOTH ways ("not found" on some versions,
    // "requested room does not exist" on others — and self-hosted servers
    // auto-finish empty rooms, so the host-path teardown can legitimately
    // arrive after the room is already gone; proven by Phase 4 acceptance).
    try {
      await svc.deleteRoom(roomName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|does not exist/i.test(msg)) return;
      throw err;
    }
  },

  async roomExists(roomName: string): Promise<boolean> {
    const svc = roomService();
    const rooms = await svc.listRooms([roomName]);
    return rooms.some((r) => r.name === roomName);
  },

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    const svc = roomService();
    // Idempotent by law: an unknown room/identity is already "gone".
    try {
      await svc.removeParticipant(roomName, identity);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|does not exist/i.test(msg)) return;
      throw err;
    }
  },

  async parseWebhook(body: string, authHeader: string | null): Promise<LiveWebhookEvent | null> {
    if (!authHeader) return null;
    try {
      const ev = await receiver().receive(body, authHeader);
      return mapWebhookEvent(ev as WebhookEvent);
    } catch {
      return null;
    }
  },
};
