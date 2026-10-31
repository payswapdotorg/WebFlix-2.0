/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — the in-process room event hub (ADR-0006
 * fast path).
 *
 * A dependency-free, server-only EventEmitter keyed by room id. The write
 * routes (chat/reactions/presence/polls/questions/moderation) call
 * `publishLiveEvent()` right after a successful mutation and every attached
 * SSE stream on THIS instance flushes immediately. The ~900ms DB tail in the
 * stream route is the correctness floor for multi-instance topologies (the
 * hub is deliberately per-instance, never a durability layer — nothing
 * durable ever lives only here).
 *
 * Stored on globalThis so Next.js dev hot-reload and the bun test runner
 * share ONE hub per process (same seam as the Prisma client singleton).
 */
import { EventEmitter } from "node:events";
import type { LiveStreamEvent } from "./types";

const HUB_CHANNEL_PREFIX = "wf:live:hub:";

/**
 * Every attached SSE stream is one listener on its room channel. The Node
 * default cap (10) would false-positive at the 11th viewer of one room, so
 * the cap is raised well past any realistic same-instance room population
 * while still catching genuine listener leaks.
 */
const MAX_LISTENERS_PER_ROOM = 1000;

const globalForHub = globalThis as unknown as { __wfx2LiveHub?: EventEmitter };

const hub: EventEmitter =
  globalForHub.__wfx2LiveHub ??
  (() => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(MAX_LISTENERS_PER_ROOM);
    return emitter;
  })();
globalForHub.__wfx2LiveHub = hub;

function roomChannel(roomId: string): string {
  return `${HUB_CHANNEL_PREFIX}${roomId}`;
}

/**
 * Fan a room event out to every same-instance subscriber. Fire-and-forget:
 * publishing never throws, never blocks the write route, and a room with no
 * attached streams is a no-op.
 */
export function publishLiveEvent(roomId: string, event: LiveStreamEvent): void {
  try {
    hub.emit(roomChannel(roomId), event);
  } catch {
    // A listener throw must never take a write route down — the DB tail in
    // the stream route re-derives every event from durable state anyway.
  }
}

/**
 * Subscribe to a room's live events. Returns the unsubscribe function —
 * stream routes MUST call it on close/abort/lifetime-cap.
 */
export function subscribeLiveRoom(
  roomId: string,
  handler: (event: LiveStreamEvent) => void,
): () => void {
  const channel = roomChannel(roomId);
  hub.on(channel, handler);
  return () => {
    hub.off(channel, handler);
  };
}

/**
 * Phase 4-OPS (§4H): the number of SSE streams attached to THIS instance
 * right now. An INSTANCE-LOCAL fact by design (ADR-0006: the hub is
 * deliberately per-instance, never a durability or fleet layer) — the ops
 * dashboard labels it as such and never presents it as fleet-wide.
 */
export function attachedStreamCount(): number {
  return hub.eventNames().reduce((sum, name) => sum + hub.listenerCount(name), 0);
}
