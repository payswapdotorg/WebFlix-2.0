/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 lane 4-a — the replay pins.
 *
 * Pins: the host-only authorization matrix (viewer 403 / anon 401 / ghost
 * room 404), the not-live gate, the one-asset law (recording conflicts,
 * failed is replaceable), the honest egress gate (undeclared capability →
 * 409 egress-not-configured, capability off by default in the sandbox),
 * the upload guards (MIME / empty / duration — rejected, NEVER clamped),
 * the ready finalize (sizeBytes + retention stamp + storageKey NEVER in a
 * DTO or URL), the visibility law (public room serves anonymous; hidden is
 * host-only), the stream route (full 200 + HTTP Range 206 slices), the
 * idempotent-failed law (finalizeRecordingOnEnd → failed with
 * "stream-ended-before-stop", the failed row is replaceable), the
 * discovery shelf (public ready replays only, hidden excluded) and the
 * lazy retention sweep (expired → status flipped, stream honestly 404s).
 *
 * Routes are tested by calling their handlers directly with Requests that
 * carry a real minted session cookie — no network, no LiveKit calls (the
 * fixtures start sessions directly; egress is off because the sandbox
 * never sets LIVEKIT_EGRESS_ENABLED).
 *
 * Run: DATABASE_URL=file:../db/live-replay-test.db bun test --isolate tests/live-replays.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  endSessionFixture,
  hostCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { POST as postStartRoute } from "@/app/api/live-rooms/[id]/replay/start/route";
import { POST as postStopRoute } from "@/app/api/live-rooms/[id]/replay/stop/route";
import {
  GET as getReplayRoute,
  PATCH as patchReplayRoute,
} from "@/app/api/live-rooms/[id]/replay/route";
import { GET as getStreamRoute } from "@/app/api/live-rooms/[id]/replay/stream/route";
import { GET as getShelfRoute } from "@/app/api/live/replays/route";
import { db } from "@/lib/db";
import { clearRateLimits } from "@/lib/youtube/cache";
import { finalizeRecordingOnEnd } from "@/lib/live/replays";
import { REPLAY_DURATION_MAX_MS, REPLAY_LIST_MAX } from "@/lib/live/permissions";
import type { LiveReplayAssetDto, LiveReplaySummaryDto } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

const ANON = "next-auth.session-token=none";

let HOST = "";
let VIEWER = "";
/** Rooms created by THIS run — fresh readyAt guarantees shelf-window membership. */
const laneRoomIds = new Set<string>();

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
});

// ── call helpers (route handlers directly — no network) ──
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function replayUrl(roomId: string, suffix = ""): string {
  return `http://localhost/api/live-rooms/${roomId}/replay${suffix}`;
}

function zeros(n: number): ArrayBuffer {
  return new Uint8Array(n).buffer;
}

async function startAs(
  cookie: string,
  roomId: string,
  body: unknown = {},
): Promise<{ status: number; body: any }> {
  const res = await postStartRoute(
    reqWithCookie(replayUrl(roomId, "/start"), cookie, { method: "POST", body }),
    ctx(roomId),
  );
  return { status: res.status, body: await res.json() };
}

/** The stop route is NOT JSON — raw body + content-type + ?durationMs=. */
async function stopAs(
  cookie: string,
  roomId: string,
  init: {
    body?: ArrayBuffer;
    contentType?: string | null;
    durationMs?: number | string | null;
  },
): Promise<{ status: number; body: any }> {
  const url = new URL(replayUrl(roomId, "/stop"));
  if (init.durationMs !== undefined && init.durationMs !== null) {
    url.searchParams.set("durationMs", String(init.durationMs));
  }
  const headers: Record<string, string> = { cookie };
  if (init.contentType !== undefined && init.contentType !== null) {
    headers["content-type"] = init.contentType;
  }
  const res = await postStopRoute(
    new Request(url.toString(), {
      method: "POST",
      headers,
      body: init.body ?? zeros(64),
    }),
    ctx(roomId),
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getReplayAs(
  cookie: string | null,
  roomId: string,
): Promise<{ status: number; body: any }> {
  const res = await getReplayRoute(
    new Request(replayUrl(roomId), { headers: cookie ? { cookie } : {} }),
    ctx(roomId),
  );
  return { status: res.status, body: await res.json() };
}

async function patchVisibilityAs(
  cookie: string,
  roomId: string,
  visibility: unknown,
): Promise<{ status: number; body: any }> {
  const res = await patchReplayRoute(
    reqWithCookie(replayUrl(roomId), cookie, { method: "PATCH", body: { visibility } }),
    ctx(roomId),
  );
  return { status: res.status, body: await res.json() };
}

async function streamAs(
  roomId: string,
  opts: { cookie?: string | null; range?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.range) headers.range = opts.range;
  return getStreamRoute(
    new Request(replayUrl(roomId, "/stream"), { headers }),
    ctx(roomId),
  );
}

async function shelf(): Promise<{ status: number; body: any }> {
  const res = await getShelfRoute();
  return { status: res.status, body: await res.json() };
}

/** A live room owned by the HOST identity (unique title per room). */
async function liveRoom(): Promise<{ roomId: string; sessionId: string; title: string }> {
  const title = `4a-replay-${crypto.randomUUID().slice(0, 8)}`;
  const { roomId } = await createRoomFixture(sessionUserOf(HOST_CLAIMS), title);
  laneRoomIds.add(roomId);
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId, title };
}

// ─────────────────────────────────────────────────────────────────────
describe("live replays — authorization matrix", () => {
  test("viewer replays cannot start (403); anonymous is 401; non-existent room is 404", async () => {
    const { roomId } = await liveRoom();

    const viewer = await startAs(VIEWER, roomId);
    expect(viewer.status).toBe(403);
    expect(viewer.body.error).toBe("forbidden");

    const anon = await startAs(ANON, roomId);
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("unauthenticated");

    const ghost = await startAs(HOST, "room-does-not-exist");
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe("not-found");
  });

  test("start without a live session is 403 forbidden with message 'not-live'", async () => {
    const idle = await createRoomFixture(
      sessionUserOf(HOST_CLAIMS),
      `4a-replay-idle-${crypto.randomUUID().slice(0, 8)}`,
    );
    const res = await startAs(HOST, idle.roomId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(res.body.message).toBe("not-live");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — start + the one-asset law", () => {
  test("host start on a live session → recording; second start → 409 replay-active; undeclared egress → 409 egress-not-configured", async () => {
    const { roomId } = await liveRoom();

    const first = await startAs(HOST, roomId);
    expect(first.status).toBe(200);
    const asset = first.body.asset as LiveReplayAssetDto;
    expect(asset.status).toBe("recording");
    expect(asset.sink).toBe("host-capture");
    expect(asset.sessionId).toBeTruthy();
    expect(asset.recordingStartedAt).toBeTruthy();
    // THE LEAK LAW: no storageKey field exists on the DTO, in any state.
    expect("storageKey" in first.body.asset).toBe(false);

    const second = await startAs(HOST, roomId);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("conflict");
    expect(second.body.message).toBe("replay-active");

    // New session after the old one ended; the provider-egress sink is
    // feature-checked against adapter().recording — the sandbox declares
    // no egress, so the honest 409 answers (never a guessed attempt).
    await endSessionFixture(roomId);
    await startSessionFixture(roomId);
    const egress = await startAs(HOST, roomId, { sink: "provider-egress" });
    expect(egress.status).toBe(409);
    expect(egress.body.error).toBe("conflict");
    expect(egress.body.message).toBe("egress-not-configured");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — the stop upload guards + finalize", () => {
  test("wrong MIME → 400; empty body → 400; valid webm → ready (sizeBytes 1024, retention stamped); repeat stop → 409 replay-not-recording", async () => {
    const { roomId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);

    const wrongMime = await stopAs(HOST, roomId, {
      contentType: "text/plain",
      body: zeros(64),
      durationMs: 1000,
    });
    expect(wrongMime.status).toBe(400);
    expect(wrongMime.body.error).toBe("invalid");
    expect(wrongMime.body.message).toBe("unsupported-media-type");

    const empty = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: new ArrayBuffer(0),
      durationMs: 1000,
    });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("empty-recording");

    const ok = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: zeros(1024),
      durationMs: 5000,
    });
    expect(ok.status).toBe(200);
    const asset = ok.body.asset as LiveReplayAssetDto;
    expect(asset.status).toBe("ready");
    expect(asset.sizeBytes).toBe(1024);
    expect(asset.durationMs).toBe(5000);
    expect(asset.mimeType).toBe("video/webm");
    expect(asset.readyAt).toBeTruthy();
    expect(asset.stoppedAt).toBeTruthy();
    expect(asset.retentionExpiresAt).toBeTruthy();
    expect("storageKey" in ok.body.asset).toBe(false);

    const repeat = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: zeros(1024),
      durationMs: 5000,
    });
    expect(repeat.status).toBe(409);
    expect(repeat.body.message).toBe("replay-not-recording");
  });

  test("durationMs > REPLAY_DURATION_MAX_MS is 400 invalid-duration — the no-clamp law", async () => {
    const { roomId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);
    const res = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: zeros(1024),
      durationMs: REPLAY_DURATION_MAX_MS + 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid");
    expect(res.body.message).toBe("invalid-duration");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — GET + the visibility law", () => {
  test("ready + public room serves anonymous; playbackUrl carries no key; hidden is host-only", async () => {
    const { roomId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);
    expect(
      (await stopAs(HOST, roomId, { contentType: "video/webm", body: zeros(512), durationMs: 2500 }))
        .status,
    ).toBe(200);

    const hostGet = await getReplayAs(HOST, roomId);
    expect(hostGet.status).toBe(200);
    expect(hostGet.body.asset.status).toBe("ready");
    expect(hostGet.body.playbackUrl).toBe(`/api/live-rooms/${roomId}/replay/stream`);
    expect(hostGet.body.playbackUrl).not.toContain("replay_");
    expect("storageKey" in hostGet.body.asset).toBe(false);

    // Ready replay on a public room is public — anonymous link-holders read it.
    const anonGet = await getReplayAs(null, roomId);
    expect(anonGet.status).toBe(200);
    expect(anonGet.body.asset.status).toBe("ready");

    // Host-only control: a non-host PATCH is 403; the host hides it.
    const viewerPatch = await patchVisibilityAs(VIEWER, roomId, "hidden");
    expect(viewerPatch.status).toBe(403);
    const patched = await patchVisibilityAs(HOST, roomId, "hidden");
    expect(patched.status).toBe(200);
    expect(patched.body.asset.visibility).toBe("hidden");

    const anonAfter = await getReplayAs(null, roomId);
    expect(anonAfter.status).toBe(404);
    // The host still sees their own hidden replay.
    expect((await getReplayAs(HOST, roomId)).status).toBe(200);
    // And the stream answers 404 to the denied caller too.
    expect((await streamAs(roomId)).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — the stream route (Range law)", () => {
  test("no-Range GET → 200 video/webm full body; bytes=0-99 → 206 'bytes 0-99/1024'; open-ended range clamps", async () => {
    const { roomId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);
    expect(
      (await stopAs(HOST, roomId, { contentType: "video/webm", body: zeros(1024), durationMs: 1000 }))
        .status,
    ).toBe(200);

    const full = await streamAs(roomId);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/webm");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await full.arrayBuffer()).length).toBe(1024);

    const ranged = await streamAs(roomId, { range: "bytes=0-99" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-99/1024");
    expect(new Uint8Array(await ranged.arrayBuffer()).length).toBe(100);

    const openEnded = await streamAs(roomId, { range: "bytes=100-" });
    expect(openEnded.status).toBe(206);
    expect(openEnded.headers.get("content-range")).toBe("bytes 100-1023/1024");
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — the idempotent-failed law", () => {
  test("a lost take finalizes honestly failed; the failed row is replaceable; the next stop readies it", async () => {
    const { roomId, sessionId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);

    // The TL's end-hook path, simulated directly: the stream ended before
    // the host could stop — the take never arrived.
    await finalizeRecordingOnEnd(sessionId, roomId);
    const row = await db.liveReplayAsset.findUnique({ where: { sessionId } });
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("stream-ended-before-stop");

    // finalize is idempotent (a repeated end-hook must not throw or flip)
    await finalizeRecordingOnEnd(sessionId, roomId);
    expect((await db.liveReplayAsset.findUnique({ where: { sessionId } }))?.error).toBe(
      "stream-ended-before-stop",
    );

    // failed is REPLACEABLE — the restart reuses the session slot.
    const again = await startAs(HOST, roomId);
    expect(again.status).toBe(200);
    expect(again.body.asset.status).toBe("recording");
    expect(again.body.asset.id).toBe(row?.id);

    const done = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: zeros(256),
      durationMs: 900,
    });
    expect(done.status).toBe(200);
    expect(done.body.asset.status).toBe("ready");
    expect(done.body.asset.sizeBytes).toBe(256);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — the discovery shelf", () => {
  test("public ready replays are listed with resolved handles; hidden replays are excluded", async () => {
    const res = await shelf();
    expect(res.status).toBe(200);
    const replays = res.body.replays as LiveReplaySummaryDto[];

    // The shelf law IS the visibility law: a ready asset is listed iff its
    // room is public AND the asset visibility is public/inherit. Positive
    // membership is pinned for THIS run's rooms only (fresh readyAt →
    // inside the newest-12 window even on a reused lane db); the negative
    // law holds for every durable row regardless of history.
    const ready = await db.liveReplayAsset.findMany({
      where: { status: "ready" },
      select: { roomId: true, visibility: true },
    });
    expect(ready.length).toBeGreaterThanOrEqual(3);
    const rooms = await db.liveRoom.findMany({
      where: { id: { in: [...new Set(ready.map((r) => r.roomId))] } },
      select: { id: true, title: true, visibility: true },
    });
    const byRoom = new Map(rooms.map((r) => [r.id, r]));
    const titles = replays.map((r) => r.title);
    for (const asset of ready) {
      const room = byRoom.get(asset.roomId);
      if (!room) continue;
      const listable =
        room.visibility === "public" &&
        (asset.visibility === "public" || asset.visibility === "inherit");
      if (!listable) {
        expect(titles).not.toContain(room.title);
      } else if (laneRoomIds.has(room.id)) {
        expect(titles).toContain(room.title);
      }
    }
    expect(replays.length).toBeLessThanOrEqual(REPLAY_LIST_MAX);
    for (const r of replays) {
      expect(r.roomId).toBeTruthy();
      expect(r.sessionId).toBeTruthy();
      expect(r.hostHandle).not.toBe("");
      expect(r.hostName).toBe("Live Host");
      expect(r.readyAt).toBeTruthy();
      expect("storageKey" in r).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
describe("live replays — the lazy retention sweep", () => {
  test("an expired ready replay flips to expired on read and the stream honestly 404s", async () => {
    const { roomId } = await liveRoom();
    expect((await startAs(HOST, roomId)).status).toBe(200);
    const stop = await stopAs(HOST, roomId, {
      contentType: "video/webm",
      body: zeros(128),
      durationMs: 700,
    });
    expect(stop.status).toBe(200);
    const assetId = stop.body.asset.id as string;

    // Age the retention stamp into the past (durable-row manipulation,
    // same law as the moderation fixtures).
    await db.liveReplayAsset.update({
      where: { id: assetId },
      data: { retentionExpiresAt: new Date(Date.now() - 1000) },
    });

    const got = await getReplayAs(HOST, roomId);
    expect(got.status).toBe(200);
    expect(got.body.asset.status).toBe("expired");
    expect(got.body.asset.retentionExpiresAt).toBeTruthy();

    expect((await streamAs(roomId)).status).toBe(404);
  });
});
