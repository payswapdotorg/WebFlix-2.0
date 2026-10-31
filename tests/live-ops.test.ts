/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the operations telemetry pins
 * (ADR-0009, frozen contracts §7).
 *
 * Pins: the ops-gate matrix (anonymous 401, unconfigured 503 with the env
 * name, non-admin 403 case-insensitively, declared admin 200), the beacon
 * intake law (server kinds NEVER client-claimable 422, unknown kind 422,
 * roomId required 422, unknown room 404, foreign session 422, valid beacon
 * 200 with the shadow-stamped row), the clamps (code 80 / valueMs 0..1h /
 * oversized meta dropped not truncated), the rate-limit capture law (a
 * denial IS an observation — surface only, never the key; the beacon route
 * itself captures its 429s), and THE DERIVATION PINS (nearest-rank
 * percentiles exact, top lists exact, per-room volume exact, honest-
 * unavailable blocks present with their reasons, the window clamp).
 *
 * Rows are seeded directly via the db — no provider calls, no client-
 * supplied numbers anywhere (the observation law, pinned).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  OTHER_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  endSessionFixture,
  hostCookie,
  otherCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { GET as getOverview } from "@/app/api/live/ops/overview/route";
import { POST as postBeacon } from "@/app/api/live/ops/beacon/route";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import {
  clampOpsWindowMs,
  deriveOpsOverview,
  isOpsBeaconKind,
  opsRateLimit,
  recordOpsEvent,
} from "@/lib/live/ops";

setupLiveDb();
afterAll(() => {
  clearRateLimits();
  delete process.env.WEBFLIX_OPS_ADMIN_EMAILS;
});

let HOST = "";
let VIEWER = "";
let OTHER = "";
let hostShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  OTHER = await otherCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
});

// ── helpers ────────────────────────────────────────────────────────────

const OVERVIEW_URL = "http://localhost/api/live/ops/overview";
const BEACON_URL = "http://localhost/api/live/ops/beacon";

async function getOverviewAs(cookie: string | null, windowMs?: string) {
  const url = windowMs ? `${OVERVIEW_URL}?windowMs=${windowMs}` : OVERVIEW_URL;
  const req = cookie ? reqWithCookie(url, cookie) : new Request(url);
  const res = await getOverview(req);
  return { status: res.status, body: (await res.json()) as any };
}

async function postBeaconAs(
  cookie: string | null,
  body: Record<string, unknown>,
) {
  const req = cookie
    ? reqWithCookie(BEACON_URL, cookie, { method: "POST", body })
    : new Request(BEACON_URL, { method: "POST", body: JSON.stringify(body) });
  const res = await postBeacon(req);
  return { status: res.status, body: (await res.json()) as any };
}

// ── the ops-gate matrix (fail-closed, per request) ─────────────────────

describe("ops overview gate", () => {
  test("anonymous → 401 even before the allowlist is considered", async () => {
    delete process.env.WEBFLIX_OPS_ADMIN_EMAILS;
    const { status } = await getOverviewAs(null);
    expect(status).toBe(401);
  });

  test("signed in + env unset → 503 ops-admin-not-configured with the env name", async () => {
    delete process.env.WEBFLIX_OPS_ADMIN_EMAILS;
    const { status, body } = await getOverviewAs(HOST);
    expect(status).toBe(503);
    expect(body.error).toBe("ops-admin-not-configured");
    expect(body.message).toContain("WEBFLIX_OPS_ADMIN_EMAILS");
  });

  test("signed in + on the list → 200 (case-insensitive email match)", async () => {
    process.env.WEBFLIX_OPS_ADMIN_EMAILS = " LIVE-HOST@WEBFLIX.TEST , someone-else@webflix.test ";
    const { status, body } = await getOverviewAs(HOST);
    expect(status).toBe(200);
    expect(typeof body.windowMs).toBe("number");
    expect(typeof body.generatedAt).toBe("string");
    expect(body.transport.tailFlushMs).toBe(900);
  });

  test("signed in + NOT on the list → 403", async () => {
    process.env.WEBFLIX_OPS_ADMIN_EMAILS = "someone-else@webflix.test";
    const { status } = await getOverviewAs(HOST);
    expect(status).toBe(403);
    const other = await getOverviewAs(OTHER);
    expect(other.status).toBe(403);
  });

  test("the window clamp: 1h floor, 30d ceiling, default 24h", async () => {
    expect(clampOpsWindowMs(null)).toBe(24 * 3_600_000);
    expect(clampOpsWindowMs("1000")).toBe(3_600_000);
    expect(clampOpsWindowMs("99999999999999")).toBe(30 * 24 * 3_600_000);
    expect(clampOpsWindowMs("not-a-number")).toBe(24 * 3_600_000);
    process.env.WEBFLIX_OPS_ADMIN_EMAILS = "live-host@webflix.test";
    const { body } = await getOverviewAs(HOST, "99999999999999");
    expect(body.windowMs).toBe(30 * 24 * 3_600_000);
  });
});

// ── the beacon intake law ──────────────────────────────────────────────

describe("ops beacon intake", () => {
  let roomId = "";
  let otherRoomId = "";
  let sessionId = "";

  beforeAll(async () => {
    const room = await createRoomFixture(sessionUserOf(HOST_CLAIMS));
    roomId = room.roomId;
    const other = await createRoomFixture(sessionUserOf(VIEWER_CLAIMS));
    otherRoomId = other.roomId;
    sessionId = (await startSessionFixture(roomId)).sessionId;
  });

  test("anonymous → 401", async () => {
    const { status } = await postBeaconAs(null, { kind: "ttff", roomId });
    expect(status).toBe(401);
  });

  test("the SERVER kinds are never client-claimable (422)", async () => {
    for (const kind of ["rate_limit", "provider_error", "end_reconcile"]) {
      const { status } = await postBeaconAs(HOST, { kind, roomId });
      expect(status).toBe(422);
    }
  });

  test("unknown kind / missing roomId → 422; unknown room → 404", async () => {
    expect((await postBeaconAs(HOST, { kind: "screenshots", roomId })).status).toBe(422);
    expect((await postBeaconAs(HOST, { kind: "ttff" })).status).toBe(422);
    expect((await postBeaconAs(HOST, { kind: "ttff", roomId: "does-not-exist" })).status).toBe(404);
  });

  test("a session from ANOTHER room → 422", async () => {
    const { status } = await postBeaconAs(HOST, {
      kind: "ttff",
      roomId: otherRoomId,
      sessionId,
    });
    expect(status).toBe(422);
  });

  test("valid beacon → 200, shadow-stamped row with the supplied session", async () => {
    const { status, body } = await postBeaconAs(VIEWER, {
      kind: "ttff",
      roomId,
      sessionId,
      valueMs: 123,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const row = await db.liveOpsEvent.findFirst({
      where: { kind: "ttff", roomId, sessionId, surface: "beacon" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row?.valueMs).toBe(123);
    expect(row?.actorId).not.toBeNull();
    expect(row?.actorId).not.toBe("");
  });

  test("the clamps: code 80 chars, valueMs 0..1h, oversized meta dropped (never truncated)", async () => {
    await recordOpsEvent({
      kind: "media_error",
      roomId,
      code: "x".repeat(200),
      valueMs: -5,
    });
    await recordOpsEvent({
      kind: "media_error",
      roomId,
      code: "clamp-max",
      valueMs: 9 * 3_600_000,
    });
    await recordOpsEvent({
      kind: "media_error",
      roomId,
      code: "meta-drop",
      meta: { blob: "y".repeat(600) },
    });
    const clamped = await db.liveOpsEvent.findFirst({
      where: { kind: "media_error", roomId, code: "x".repeat(80) },
      orderBy: { createdAt: "desc" },
    });
    expect(clamped).not.toBeNull();
    expect(clamped?.valueMs).toBe(0);
    const maxed = await db.liveOpsEvent.findFirst({
      where: { kind: "media_error", roomId, code: "clamp-max" },
      orderBy: { createdAt: "desc" },
    });
    expect(maxed?.valueMs).toBe(3_600_000);
    const dropped = await db.liveOpsEvent.findFirst({
      where: { kind: "media_error", roomId, code: "meta-drop" },
      orderBy: { createdAt: "desc" },
    });
    expect(dropped).not.toBeNull();
    expect(dropped?.meta).toBeNull();
  });

  test("a denied beacon IS a rate_limit observation (surface only, never the key)", async () => {
    // In test mode the app limiter is a no-op unless a REST fake is
    // injected — inject a FRESH one so the 30/60s window starts clean.
    const store = new Map<string, string>();
    const impl: UpstashRest = async (cmds) =>
      cmds.map((cmd) => {
        if (cmd[0] === "INCR") {
          const value = Number(store.get(cmd[1]) ?? "0") + 1;
          store.set(cmd[1], String(value));
          return value;
        }
        return 1;
      });
    setUpstashRest(impl);
    try {
      const before = await db.liveOpsEvent.count({ where: { kind: "rate_limit", surface: "beacon" } });
      const denied = [];
      for (let i = 0; i < 32; i += 1) {
        denied.push(await postBeaconAs(VIEWER, { kind: "chat_latency", roomId, valueMs: i }));
      }
      const allowed = denied.filter((r) => r.status === 200).length;
      const limited = denied.filter((r) => r.status === 429).length;
      expect(allowed).toBe(30);
      expect(limited).toBe(2);
      // The capture is fire-and-forget by law — flush BEFORE counting.
      await new Promise((r) => setTimeout(r, 25));
      const after = await db.liveOpsEvent.count({ where: { kind: "rate_limit", surface: "beacon" } });
      expect(after - before).toBe(limited);
      // No identity in telemetry: no beacon key fragment ever lands in a row.
      const rows = await db.liveOpsEvent.findMany({
        where: { kind: "rate_limit", surface: "beacon" },
      });
      for (const row of rows) {
        expect(row.meta).toBeNull();
        expect(row.code).toBeNull();
      }
    } finally {
      setUpstashRest(null);
      clearRateLimits();
    }
  });

  test("opsRateLimit captures directly (unit pin, unique surface)", async () => {
    const store = new Map<string, string>();
    const impl: UpstashRest = async (cmds) =>
      cmds.map((cmd) => {
        if (cmd[0] === "INCR") {
          const value = Number(store.get(cmd[1]) ?? "0") + 1;
          store.set(cmd[1], String(value));
          return value;
        }
        return 1;
      });
    setUpstashRest(impl);
    try {
      const surface = `unit-${crypto.randomUUID().slice(0, 8)}`;
      const key = `unit:${crypto.randomUUID()}`;
      expect(await opsRateLimit(surface, key, { limit: 1, windowMs: 60_000 })).toBe(true);
      expect(await opsRateLimit(surface, key, { limit: 1, windowMs: 60_000 })).toBe(false);
      // The capture is fire-and-forget by law — flush before reading.
      await new Promise((r) => setTimeout(r, 25));
      const row = await db.liveOpsEvent.findFirst({ where: { kind: "rate_limit", surface } });
      expect(row).not.toBeNull();
      expect(row?.meta).toBeNull();
      expect(row?.code).toBeNull();
    } finally {
      setUpstashRest(null);
      clearRateLimits();
    }
  });

  test("isOpsBeaconKind accepts exactly the five client kinds", () => {
    expect(isOpsBeaconKind("ttff")).toBe(true);
    expect(isOpsBeaconKind("reconnect")).toBe(true);
    expect(isOpsBeaconKind("join_error")).toBe(true);
    expect(isOpsBeaconKind("media_error")).toBe(true);
    expect(isOpsBeaconKind("chat_latency")).toBe(true);
    expect(isOpsBeaconKind("rate_limit")).toBe(false);
    expect(isOpsBeaconKind("end_reconcile")).toBe(false);
    expect(isOpsBeaconKind(undefined)).toBe(false);
    expect(isOpsBeaconKind(42)).toBe(false);
  });
});

// ── THE DERIVATION PINS ────────────────────────────────────────────────

describe("deriveOpsOverview derivation", () => {
  let roomId = "";
  let sessionId = "";

  beforeAll(async () => {
    // LiveOpsEvent rows are THIS lane's exclusive table (no other test file
    // writes them) — clearing them makes every percentile/count pin exact
    // even though the shared live-test db persists across runs. Interaction
    // rows (chat/reactions/rooms) are never touched (the battery law).
    await db.liveOpsEvent.deleteMany({});
    const room = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `Ops volume room ${crypto.randomUUID().slice(0, 8)}`,
    );
    roomId = room.roomId;
    sessionId = (await startSessionFixture(roomId)).sessionId;

    // The percentile sample — exact nearest-rank pins below. Only THIS file
    // writes valueMs rows, so the percentile math is exact even on the
    // shared live-test database.
    const ttff = [400, 100, 300, 200]; // sorted → 100,200,300,400
    for (const [i, ms] of ttff.entries()) {
      await recordOpsEvent({ kind: "ttff", roomId, sessionId, valueMs: ms, actorId: `p${i}` });
    }
    for (const ms of [1000, 2000, 3000]) {
      await recordOpsEvent({ kind: "chat_latency", roomId, valueMs: ms });
    }
    await recordOpsEvent({ kind: "reconnect", roomId, sessionId, valueMs: 1500 });
    await recordOpsEvent({ kind: "join_error", roomId, code: `pin-join-${sessionId}` });
    await recordOpsEvent({ kind: "provider_error", roomId, surface: "start-session", code: "live-provider-not-configured" });
    await recordOpsEvent({ kind: "rate_limit", surface: "pin-surface" });
    await recordOpsEvent({ kind: "rate_limit", surface: "pin-surface" });

    // Per-room interaction volume (exact for THIS room): 2 chat + 1 batch
    // (5 hearts) + 1 gift + 1 match.
    const identity = await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS));
    await db.liveRoomMessage.create({
      data: {
        roomId,
        sessionId,
        senderId: identity.id,
        body: "ops pin one",
        clientMessageId: crypto.randomUUID(),
      },
    });
    await db.liveRoomMessage.create({
      data: {
        roomId,
        sessionId,
        senderId: identity.id,
        body: "ops pin two",
        clientMessageId: crypto.randomUUID(),
      },
    });
    await db.liveReactionBatch.create({
      data: { roomId, sessionId, senderId: identity.id, clientBatchId: crypto.randomUUID(), count: 5 },
    });
    await db.giftEvent.create({
      data: {
        roomId,
        sessionId,
        intentId: `pin-${crypto.randomUUID()}`,
        senderId: identity.id,
        recipientId: hostShadowId,
        giftItemId: "pin-gift",
        giftName: "Pin Gift",
        quantity: 1,
        totalCredits: 10,
      },
    });
    await db.liveMatch.create({
      data: {
        roomId,
        sessionId,
        createdById: hostShadowId,
        durationSeconds: 60,
        endsAt: new Date(Date.now() + 60_000),
      },
    });
    await db.liveSession.update({
      where: { id: sessionId },
      data: { peakViewers: 9 },
    });
    await endSessionFixture(roomId);
    // The end-reconcile fact (as the real hook would record it).
    await recordOpsEvent({ kind: "end_reconcile", roomId, sessionId, valueMs: 60_000 });
    // One replay asset row (storage fact).
    await db.liveReplayAsset.create({
      data: {
        roomId,
        sessionId,
        requestedById: hostShadowId,
        status: "ready",
        sizeBytes: 123_456,
        readyAt: new Date(),
      },
    });
  });

  test("nearest-rank percentiles are EXACT over the sampled observations", async () => {
    const overview = await deriveOpsOverview(null);
    // ttff sorted [100,200,300,400]: p50 = ceil(0.5*4)-1 → idx 1 = 200;
    // p95 = ceil(0.95*4)-1 → idx 3 = 400 (the wipe guarantees these are
    // the only ttff rows).
    expect(overview.media.ttff.count).toBe(4);
    expect(overview.media.ttff.p50Ms).toBe(200);
    expect(overview.media.ttff.p95Ms).toBe(400);
    // chat_latency: only [1000,2000,3000] exist → p50 = 2000, p95 = 3000.
    expect(overview.chatLatency.count).toBe(3);
    expect(overview.chatLatency.p50Ms).toBe(2000);
    expect(overview.chatLatency.p95Ms).toBe(3000);
  });

  test("reconnects / reconciles count exactly; top lists carry the seeded keys", async () => {
    const overview = await deriveOpsOverview(null);
    expect(overview.media.reconnects).toBe(1);
    expect(overview.reconciles.endReconciles).toBe(1);
    const joinTop = overview.media.joinErrors.top.find(
      (t) => t.key === `pin-join-${sessionId}`,
    );
    expect(joinTop?.count).toBe(1);
    const providerTop = overview.provider.errors.top.find(
      (t) => t.key === "live-provider-not-configured",
    );
    expect(providerTop?.count).toBe(1);
    const surfaceTop = overview.rateLimits.top.find((t) => t.key === "pin-surface");
    expect(surfaceTop?.count).toBe(2);
    expect(overview.rateLimits.count).toBe(2);
  });

  test("the seeded room appears in the volume ranking with ITS exact numbers", async () => {
    const overview = await deriveOpsOverview(null);
    const row = overview.volume.rooms.find((r) => r.roomId === roomId);
    expect(row).toBeDefined();
    expect(row?.sessions).toBe(1);
    expect(row?.chatMessages).toBe(2);
    expect(row?.reactionHearts).toBe(5);
    expect(row?.giftEvents).toBe(1);
    expect(row?.matches).toBe(1);
    expect(row?.peakViewers).toBe(9);
    expect(row?.status).toBe("ended");
    expect(row?.lastActivityAt).not.toBeNull();
    // Ranked by interaction volume: 2+1+1+1 = 5 — a room with zero
    // interactions can never outrank it.
    const rank = overview.volume.rooms.findIndex((r) => r.roomId === roomId);
    const below = overview.volume.rooms.slice(rank + 1);
    for (const other of below) {
      const total =
        other.chatMessages + other.giftEvents + other.matches + (other.reactionHearts > 0 ? 1 : 0);
      expect(total).toBeLessThanOrEqual(5);
    }
  });

  test("the honest-unavailable blocks are present with their reasons", async () => {
    const previousEgress = process.env.LIVEKIT_EGRESS_ENABLED;
    delete process.env.LIVEKIT_EGRESS_ENABLED;
    try {
      const overview = await deriveOpsOverview(null);
      expect(overview.provider.costs).toEqual({
        status: "unavailable",
        reason: "provider-billing-api-not-connected",
        detail: expect.any(String),
      });
      expect(overview.provider.egress.reason).toBe("egress-not-configured");
      expect(overview.transport.outbox).toEqual({
        status: "not-applicable",
        reason: "adr-0006-has-no-outbox",
        detail: expect.any(String),
      });
      expect(overview.transport.tailFlushMs).toBe(900);
      expect(overview.transport.attachedStreamsThisInstance).toBeGreaterThanOrEqual(0);
      // Storage: the seeded asset is part of the stored-volume fact.
      expect(overview.storage.replayAssets).toBeGreaterThanOrEqual(1);
      expect(overview.storage.replayBytes).toBeGreaterThanOrEqual(123_456);
    } finally {
      if (previousEgress !== undefined) process.env.LIVEKIT_EGRESS_ENABLED = previousEgress;
    }
  });

  test("the egress reason flips when the operator declares egress", async () => {
    const previous = process.env.LIVEKIT_EGRESS_ENABLED;
    process.env.LIVEKIT_EGRESS_ENABLED = "true";
    try {
      const overview = await deriveOpsOverview(null);
      expect(overview.provider.egress.reason).toBe("egress-metering-not-instrumented");
    } finally {
      if (previous === undefined) delete process.env.LIVEKIT_EGRESS_ENABLED;
      else process.env.LIVEKIT_EGRESS_ENABLED = previous;
    }
  });

  test("the room lifecycle counts see the seeded session (ended, host reason)", async () => {
    const overview = await deriveOpsOverview(null);
    expect(overview.rooms.endedInWindow).toBeGreaterThanOrEqual(1);
    const hostReason = overview.rooms.endReasons.find((r) => r.key === "host");
    expect(hostReason).toBeDefined();
    expect(hostReason!.count).toBeGreaterThanOrEqual(1);
  });
});
