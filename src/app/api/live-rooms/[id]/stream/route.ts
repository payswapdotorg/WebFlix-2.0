import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRoom } from "@/lib/live/rooms";
import { listChat } from "@/lib/live/chat";
import { reactionTotal } from "@/lib/live/reactions";
import { connectedViewerCount } from "@/lib/live/presence";
import { subscribeLiveRoom } from "@/lib/live/hub";
import { db } from "@/lib/db";
import type {
  LiveChatMessageDto,
  LivePresenceDto,
  LiveReactionTotalDto,
  LiveRoomDto,
  LiveStreamEvent,
} from "@/lib/live/types";

export const dynamic = "force-dynamic";

// ── ADR-0006 stream tuning (the honest, stated cadence) ──
const TAIL_INTERVAL_MS = 900; // correctness floor: durable-store cadence
const PING_INTERVAL_MS = 15_000; // SSE comment heartbeat (`: ping`)
const PRESENCE_EMIT_MIN_MS = 10_000; // tail presence events at most every ~10s
const LIFETIME_MS = 240_000; // capped connection; client reconnects with cursor
const BACKFILL_PAGE = 100;
const HEART_REACTION: "heart" = "heart";

function newEventId(): string {
  return crypto.randomUUID();
}

/** The room fingerprint the tail watches (status + client-visible policy). */
function roomStamp(room: {
  status: string;
  title: string;
  chatEnabled: boolean;
  reactionsEnabled: boolean;
  slowModeSeconds: number;
}): string {
  return `${room.status}|${room.title}|${room.chatEnabled}|${room.reactionsEnabled}|${room.slowModeSeconds}`;
}

function reactionKey(total: LiveReactionTotalDto): string {
  return `${total.total}|${total.lastBatchAt ?? ""}`;
}

/**
 * GET /api/live-rooms/[id]/stream — the SSE room channel (ADR-0006).
 *
 * Dual-speed delivery:
 *  - fast path: a publish from any write route on THIS instance flushes
 *    immediately via the in-process hub;
 *  - correctness floor: a ~900ms DB tail re-derives chat (by seq cursor),
 *    the reaction total, presence and room policy from durable state, so
 *    multi-instance deployments degrade to ≤ ~1s fan-out, never data loss.
 *
 * At-least-once + resume: events carry eventId (clients dedupe); the
 * connection is capped (~4 min) and the client reconnects with its max chat
 * seq — the backfill replays strictly after that cursor. Anonymous callers
 * are allowed (read-only surface; unlisted rooms stay reachable by id —
 * link-share semantics).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sessionUser = await getSessionUser(req);

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get("chatCursor");
  const cursorParsed = cursorRaw === null ? NaN : Number.parseInt(cursorRaw, 10);
  const chatCursor = Number.isInteger(cursorParsed) && cursorParsed >= 0 ? cursorParsed : 0;
  const backfillParam = url.searchParams.get("backfill");
  const backfill = backfillParam !== "false" && backfillParam !== "0";

  // The pre-stream read doubles as the honest 404 for a missing room.
  const initialRoom: LiveRoomDto | null = await getRoom(id, sessionUser);
  if (!initialRoom) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  // The policy fingerprint comes straight from the row (the LiveRoomDto does
  // not carry the policy columns) so the first tail tick cannot re-emit the
  // room snapshot it was seeded with.
  const initialStampRow = await db.liveRoom.findUnique({
    where: { id },
    select: {
      status: true,
      title: true,
      chatEnabled: true,
      reactionsEnabled: true,
      slowModeSeconds: true,
    },
  });
  const initialRoomStamp: string | null = initialStampRow ? roomStamp(initialStampRow) : null;

  const encoder = new TextEncoder();
  // Assigned by start() once the connection's cleanup closure exists; the
  // stream-level cancel() calls it so client disconnects release everything.
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cleaned = false;
      let cursor = chatCursor;
      let lastReactionKey = "";
      let lastPresenceCount = -1;
      let lastPresenceAt = 0;
      let lastRoomStamp = initialRoomStamp;
      const seenHubEvents = new Set<string>();

      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // consumer vanished; the cleanup path takes over
        }
      };
      const send = (event: LiveStreamEvent): void => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const sendChatDto = (message: LiveChatMessageDto): void => {
        if (message.seq <= cursor) return; // already flushed (hub/tail dedupe)
        cursor = message.seq;
        send({ kind: "chat", eventId: newEventId(), at: message.createdAt, message });
      };
      const sendTotal = (total: LiveReactionTotalDto): void => {
        const key = reactionKey(total);
        if (key === lastReactionKey) return;
        lastReactionKey = key;
        send({ kind: "reaction", eventId: newEventId(), at: new Date().toISOString(), total });
      };
      const sendPresence = (presence: LivePresenceDto, force = false): void => {
        const now = Date.now();
        if (!force && presence.viewerCount === lastPresenceCount) return;
        if (!force && now - lastPresenceAt < PRESENCE_EMIT_MIN_MS) return;
        lastPresenceCount = presence.viewerCount;
        lastPresenceAt = now;
        send({ kind: "presence", eventId: newEventId(), at: new Date().toISOString(), presence });
      };

      function cleanup(): void {
        if (cleaned) return;
        cleaned = true;
        clearInterval(tailTimer);
        clearInterval(pingTimer);
        clearTimeout(lifetimeTimer);
        unsubscribe();
        req.signal.removeEventListener("abort", onAbort);
      }

      const finish = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed — a clean no-op
        }
      };

      const onAbort = (): void => finish();
      req.signal.addEventListener("abort", onAbort);

      const unsubscribe = subscribeLiveRoom(id, (event) => {
        try {
          if (closed) return;
          if (seenHubEvents.has(event.eventId)) return; // dedupe double publishes
          seenHubEvents.add(event.eventId);
          if (seenHubEvents.size > 1000) seenHubEvents.clear();
          switch (event.kind) {
            case "chat":
              sendChatDto(event.message);
              break;
            case "reaction":
              sendTotal(event.total);
              break;
            case "presence":
              // Hub presence events are real heartbeats — instant flush.
              sendPresence(event.presence, true);
              break;
            default:
              // poll/question/moderation/room pass through untouched — their
              // producing lanes own the shape; the envelope is frozen.
              send(event);
              break;
          }
        } catch {
          finish(); // a broken listener ends the stream, never the process
        }
      });

      const tailTimer = setInterval(() => {
        void tail().catch(finish);
      }, TAIL_INTERVAL_MS);
      const pingTimer = setInterval(() => write(": ping\n\n"), PING_INTERVAL_MS);
      const lifetimeTimer = setTimeout(finish, LIFETIME_MS);
      // The response itself keeps the runtime alive while a client reads;
      // unref keeps the bun test runner (and idle runtimes) from hanging.
      tailTimer.unref?.();
      pingTimer.unref?.();
      lifetimeTimer.unref?.();

      teardown = cleanup;

      const activeSessionId = async (): Promise<string | null> => {
        const session = await db.liveSession.findFirst({
          where: { roomId: id, status: { not: "ended" } },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        return session?.id ?? null;
      };

      const drainChat = async (): Promise<void> => {
        for (;;) {
          const batch = await listChat(id, { after: cursor, limit: BACKFILL_PAGE });
          if (batch.length === 0) break;
          for (const message of batch) sendChatDto(message);
          if (batch.length < BACKFILL_PAGE) break;
        }
      };

      const tail = async (): Promise<void> => {
        if (closed) return;
        await drainChat();
        const sessionId = await activeSessionId();
        if (sessionId) {
          sendTotal(await reactionTotal(sessionId, HEART_REACTION));
          sendPresence({
            sessionId,
            viewerCount: await connectedViewerCount(sessionId),
          });
        }
        const roomRow = await db.liveRoom.findUnique({
          where: { id },
          select: {
            status: true,
            title: true,
            chatEnabled: true,
            reactionsEnabled: true,
            slowModeSeconds: true,
          },
        });
        if (roomRow && roomStamp(roomRow) !== lastRoomStamp) {
          lastRoomStamp = roomStamp(roomRow);
          const fresh = await getRoom(id, sessionUser);
          if (fresh) {
            send({
              kind: "room",
              eventId: newEventId(),
              at: new Date().toISOString(),
              room: fresh,
            });
          }
        }
      };

      const initialFlush = async (): Promise<void> => {
        // 1. the room snapshot the client renders first
        send({
          kind: "room",
          eventId: newEventId(),
          at: new Date().toISOString(),
          room: initialRoom,
        });
        // 2. durable chat replay strictly after the caller's cursor
        if (backfill) await drainChat();
        // 3. reaction total + presence baselines (no active session → none)
        const sessionId = await activeSessionId();
        if (sessionId) {
          sendTotal(await reactionTotal(sessionId, HEART_REACTION));
          sendPresence(
            { sessionId, viewerCount: await connectedViewerCount(sessionId) },
            true,
          );
        }
      };

      void initialFlush().catch(finish);
    },
    cancel() {
      // Consumer went away (client disconnect / test cancel) — release the
      // hub subscription and every timer; nothing leaks.
      teardown?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
