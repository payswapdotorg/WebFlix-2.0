/**
 * WFX2-P3-LC — the live-chat send client + the optimistic-echo state.
 *
 * The panel's WRITE path: sendLiveChatMessage() calls the app-side broker
 * client (brokerLiveChatSend — the one additive helper in src/lib/broker.ts)
 * which POSTs the `live-chat-send` action to the Session Broker; the broker
 * types the message into the REAL live-chat composer on youtube.com (see
 * mini-services/youtube-broker/kinds/livechat.ts), presses Enter, and
 * verifies the message landed in the chat stream.
 *
 * Optimistic echo (youtube.com parity): the caller appends the message to
 * the panel immediately (buildLiveChatEcho — marked "pending"), then
 * reconciles with the broker verdict:
 *   - ok        → the echo flips to "sent" (the pending mark clears);
 *   - failure   → the echo is removed and the honest error state carries
 *                 youtube.com's own chat copy (members-only / slow mode /
 *                 chat disabled) — never an invented message.
 * A "sent" echo whose body has since arrived in the polled stream is DROPPED
 * (reconcileEchoes) — the real youtube.com message (posted by the operator
 * session the broker drives) replaces the local placeholder. Never a fake
 * write, never a duplicate.
 */

import {
  BROKER_OFFLINE_MESSAGE,
  BrokerError,
  brokerLiveChatSend,
} from "@/lib/broker";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

/** youtube.com's own chat-state copy (the honest states, verbatim family). */
export const LIVE_CHAT_ERROR_COPY = {
  membersOnly: "Chat is available to members only",
  slowMode: "Slow mode is on — you can send messages again in a few seconds",
  chatDisabled: "Chat is disabled for this live stream",
} as const;

/** The honest send-failure states the panel renders. */
export type LiveChatSendErrorState =
  | { kind: "members-only"; copy: string }
  | { kind: "slow-mode"; copy: string }
  | { kind: "chat-disabled"; copy: string }
  | { kind: "offline"; copy: string }
  | { kind: "failed"; copy: string };

export type LiveChatSendResult =
  | {
      ok: true;
      /** the effect was re-read from the chat stream by the broker */
      verified?: boolean;
      /** the youtube.com chat message id, when verification saw the row */
      messageId: string | null;
      note?: string;
    }
  | { ok: false; error: LiveChatSendErrorState };

/**
 * Map the broker's honest error strings onto the UI's honest states.
 * The executor's error taxonomy (kinds/livechat.ts): chat-members-only,
 * chat-slow-mode, chat-disabled, live-chat-composer-not-found,
 * live-chat-send-button-not-found, live-chat-typing-failed,
 * live-chat-send-failed — unknown strings surface verbatim (honest detail,
 * never swallowed).
 */
export function classifyLiveChatSendError(err: BrokerError): LiveChatSendErrorState {
  if (err.kind === "offline") return { kind: "offline", copy: BROKER_OFFLINE_MESSAGE };
  const raw = err.message ?? "";
  if (raw.includes("chat-members-only")) {
    return { kind: "members-only", copy: LIVE_CHAT_ERROR_COPY.membersOnly };
  }
  if (raw.includes("chat-slow-mode")) {
    return { kind: "slow-mode", copy: LIVE_CHAT_ERROR_COPY.slowMode };
  }
  if (raw.includes("chat-disabled")) {
    return { kind: "chat-disabled", copy: LIVE_CHAT_ERROR_COPY.chatDisabled };
  }
  return { kind: "failed", copy: `Message not sent (${raw})` };
}

/**
 * Send one live-chat message through the broker (the real composer path on
 * youtube.com). Never throws — failures come back as the honest error state.
 */
export async function sendLiveChatMessage(
  videoId: string,
  message: string
): Promise<LiveChatSendResult> {
  const result = await brokerLiveChatSend(videoId, message);
  if (result instanceof BrokerError) {
    return { ok: false, error: classifyLiveChatSendError(result) };
  }
  const detail = (result.detail ?? {}) as { messageId?: unknown; note?: unknown };
  return {
    ok: true,
    verified: result.verified,
    messageId:
      typeof detail.messageId === "string" && detail.messageId ? detail.messageId : null,
    note: typeof detail.note === "string" ? detail.note : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* the optimistic echo (your message, immediately, marked pending)     */
/* ------------------------------------------------------------------ */

export interface LiveChatEcho {
  /** local id (wfx2-echo-*) — never a YouTube message id */
  id: string;
  body: string;
  createdAtMs: number;
  status: "pending" | "sent";
}

/** Build the pending echo for a message the caller is about to send. */
export function buildLiveChatEcho(body: string): LiveChatEcho {
  return {
    id: `wfx2-echo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    body,
    createdAtMs: Date.now(),
    status: "pending",
  };
}

/**
 * Reconcile the echoes against the polled stream: a SENT echo whose body has
 * now arrived in the streamed messages is dropped — the real youtube.com
 * message replaces the local placeholder (the stream row carries the real
 * author + id). PENDING echoes always stay (the broker verdict has not
 * landed yet); sent echoes whose body has not streamed yet stay too (render
 * lag — the broker verified the send).
 */
export function reconcileEchoes(
  echoes: readonly LiveChatEcho[],
  streamed: readonly Pick<LiveChatMessageDTO, "body">[]
): LiveChatEcho[] {
  if (echoes.length === 0) return [];
  return echoes.filter(
    (e) => e.status === "pending" || !streamed.some((m) => m.body === e.body)
  );
}
