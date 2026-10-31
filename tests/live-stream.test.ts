/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 lane 2-a — the SSE stream pins (ADR-0006).
 *
 * The stream route is called DIRECTLY and the SSE body is consumed with a
 * reader + timeout races. Pins: first event is `kind:"room"`; a chat POST
 * through the chat route fans out through the in-process hub (same process,
 * deterministic — publish happens before the POST resolves); cursor replay
 * emits only messages strictly after the seq; anonymous reads are allowed
 * and a missing room is an honest 404. Kept well under 10s (timers are
 * unref'd and every stream is cancelled).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  HOST_CLAIMS,
  VIEWER_CLAIMS,
  createRoomFixture,
  hostCookie,
  reqWithCookie,
  sessionUserOf,
  setupLiveDb,
  startSessionFixture,
  viewerCookie,
} from "./live-helpers";
import { GET as getStream } from "@/app/api/live-rooms/[id]/stream/route";
import { POST as postChat } from "@/app/api/live-rooms/[id]/chat/route";
import { subscribeLiveRoom } from "@/lib/live/hub";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { clearRateLimits } from "@/lib/youtube/cache";
import type { LiveStreamEvent } from "@/lib/live/types";

setupLiveDb();
afterAll(() => clearRateLimits());

let HOST = "";
let VIEWER = "";
let viewerShadowId = "";
let hostShadowId = "";

beforeAll(async () => {
  HOST = await hostCookie();
  VIEWER = await viewerCookie();
  hostShadowId = (await ensureShadowUser(sessionUserOf(HOST_CLAIMS))).id;
  viewerShadowId = (await ensureShadowUser(sessionUserOf(VIEWER_CLAIMS))).id;
});

function streamUrl(roomId: string, query = ""): string {
  return `http://localhost/api/live-rooms/${roomId}/stream${query}`;
}

function chatUrl(roomId: string): string {
  return `http://localhost/api/live-rooms/${roomId}/chat`;
}

/** Race any promise against a (unref'd) timeout so a stalled stream fails fast. */
function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sse timeout: ${label}`)), ms);
  });
  timer?.unref?.();
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Buffered SSE frame reader: next() resolves with the next `data:` event. */
class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  readonly res: Response;

  constructor(res: Response) {
    this.res = res;
    this.reader = res.body!.getReader();
  }

  async next(timeoutMs = 2500): Promise<LiveStreamEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.buffer.indexOf("\n\n");
      if (idx !== -1) {
        const frame = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (line.startsWith("data: ")) {
            return JSON.parse(line.slice("data: ".length)) as LiveStreamEvent;
          }
        }
        continue; // comment-only frame (e.g. `: ping`)
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("sse: read timed out");
      const { value, done } = await raceTimeout(this.reader.read(), left, "read");
      if (done) throw new Error("sse: stream ended unexpectedly");
      this.buffer += new TextDecoder().decode(value);
    }
  }

  async drainUntil(kind: LiveStreamEvent["kind"], timeoutMs = 2500): Promise<LiveStreamEvent> {
    for (let i = 0; i < 12; i++) {
      const ev = await this.next(timeoutMs);
      if (ev.kind === kind) return ev;
    }
    throw new Error(`sse: never saw a ${kind} event`);
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => {});
  }
}

async function openStream(
  cookie: string | null,
  roomId: string,
  query = "",
): Promise<SseReader> {
  const req =
    cookie === null
      ? new Request(streamUrl(roomId, query))
      : reqWithCookie(streamUrl(roomId, query), cookie);
  const res = await getStream(req, { params: Promise.resolve({ id: roomId }) });
  if (res.status !== 200) {
    throw new Error(`stream opened with ${res.status}: ${JSON.stringify(await res.json())}`);
  }
  return new SseReader(res);
}

async function liveRoom(): Promise<{ roomId: string; sessionId: string }> {
  const { roomId } = await createRoomFixture(
    sessionUserOf(HOST_CLAIMS),
    `2a-stream-${crypto.randomUUID().slice(0, 8)}`,
  );
  const { sessionId } = await startSessionFixture(roomId);
  return { roomId, sessionId };
}

async function sendChatAs(
  cookie: string,
  roomId: string,
  body: string,
  clientMessageId: string,
): Promise<{ id: string; seq: number }> {
  const res = await postChat(reqWithCookie(chatUrl(roomId), cookie, {
    method: "POST",
    body: { body, clientMessageId },
  }), { params: Promise.resolve({ id: roomId }) });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { message: { id: string; seq: number } };
  return json.message;
}

describe("live stream — SSE contract", () => {
  test("first event is room; chat POST fans out via the hub; cursor replays strictly-after", async () => {
    const { roomId } = await liveRoom();
    const s1 = await openStream(HOST, roomId);
    try {
      expect(s1.res.headers.get("content-type")).toContain("text/event-stream");
      expect(s1.res.headers.get("cache-control")).toContain("no-cache");
      expect(s1.res.headers.get("x-accel-buffering")).toBe("no");

      const first = await s1.next(2500);
      expect(first.kind).toBe("room");
      if (first.kind !== "room") return;
      expect(first.room.id).toBe(roomId);
      expect(first.eventId).toBeTruthy();
      expect(first.at).toBeTruthy();

      // Hub fast path, pinned directly: the chat route's publish law is
      // synchronous — by the time the POST resolves, subscribers saw it.
      const hubEvents: LiveStreamEvent[] = [];
      const unsubscribe = subscribeLiveRoom(roomId, (ev) => hubEvents.push(ev));
      const posted = await sendChatAs(HOST, roomId, "hello stream", "streammsg1");
      unsubscribe();
      expect(hubEvents.some((e) => e.kind === "chat" && e.message.id === posted.id)).toBe(true);

      // End-to-end: the SSE body carries the same chat event (fast path or
      // tail floor — both arrive well inside the timeout window).
      const chatEvent = await s1.drainUntil("chat", 2000);
      if (chatEvent.kind !== "chat") return;
      expect(chatEvent.message.id).toBe(posted.id);
      expect(chatEvent.message.body).toBe("hello stream");

      // Cursor replay: a fresh stream resuming AFTER the first message only
      // receives messages strictly past that seq.
      const second = await sendChatAs(VIEWER, roomId, "second msg", "streammsg2");
      expect(second.seq).toBeGreaterThan(posted.seq);
      const s2 = await openStream(HOST, roomId, `?chatCursor=${posted.seq}`);
      try {
        const room2 = await s2.next(2500);
        expect(room2.kind).toBe("room");
        const replayed = await s2.drainUntil("chat", 2500);
        if (replayed.kind !== "chat") return;
        expect(replayed.message.id).toBe(second.id);
        expect(replayed.message.seq).toBeGreaterThan(posted.seq);
        // No older message leaks through the cursor.
        const older = await s2.drainUntil("chat", 700).catch(() => null);
        if (older && older.kind === "chat") {
          expect(older.message.seq).toBeGreaterThan(posted.seq);
        }
      } finally {
        await s2.cancel();
      }
    } finally {
      await s1.cancel();
    }
  }, 9000);

  test("anonymous reads are allowed; a missing room is an honest 404", async () => {
    const { roomId } = await liveRoom();
    const anon = await openStream(null, roomId);
    try {
      const first = await anon.next(2500);
      expect(first.kind).toBe("room");
    } finally {
      await anon.cancel();
    }

    const missing = await getStream(new Request(streamUrl("room-does-not-exist")), {
      params: Promise.resolve({ id: "room-does-not-exist" }),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error?: string }).error).toBe("not-found");
  }, 6000);
});
