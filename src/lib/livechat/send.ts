/**
 * WFX2-P36 — the live-chat send client + the optimistic-echo state, on the
 * HONEST UNSUPPORTED lane.
 *
 * THE P36 LAW (docs/work-items/P36-ACTION-PERSISTENCE.md): production
 * mutations must never depend on one deployment-wide operator cookie
 * (YT_COOKIES) or one shared logged-in broker tab. Posting to a live chat
 * has NO official end-user YouTube API — the pre-P36 path typed the message
 * into the REAL composer on youtube.com through the broker, which required
 * BROKER_SECRET in the BROWSER bundle (it could never legitimately live
 * client-side, which is why the path always failed "offline"). This module
 * imports NEITHER @/lib/broker nor anything server-secret: sendLiveChatMessage
 * answers the honest typed unsupported result — the panel clears the pending
 * echo, restores the draft, and shows the handoff copy (chat on youtube.com),
 * never a fake "sent".
 *
 * The optimistic-echo helpers (buildLiveChatEcho / reconcileEchoes) keep
 * their contracts: the echo is still appended optimistically and reconciled
 * against the polled stream, so a message that somehow arrives in the READ
 * stream is never duplicated. A send now always fails honestly, so a pending
 * echo is removed again on the verdict — the same reconcile path.
 */

import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

/** The honest send-failure states the panel renders. */
export type LiveChatSendErrorState =
  | { kind: "members-only"; copy: string }
  | { kind: "slow-mode"; copy: string }
  | { kind: "chat-disabled"; copy: string }
  | { kind: "unsupported"; copy: string }
  | { kind: "offline"; copy: string }
  | { kind: "failed"; copy: string };

export type LiveChatSendResult =
  | {
      ok: true;
      /** the effect was re-read from the chat stream (never claimed here) */
      verified?: boolean;
      /** the youtube.com chat message id, when verification saw the row */
      messageId: string | null;
      note?: string;
    }
  | { ok: false; error: LiveChatSendErrorState };

/** The honest unsupported verdict (the one answer the P36 lane gives). */
const UNSUPPORTED: LiveChatSendErrorState = {
  kind: "unsupported",
  copy: "Live chat posting isn't supported through the official API — chat on youtube.com",
};

/**
 * Send one live-chat message — the HONEST UNSUPPORTED lane: no official API,
 * no operator-session replay, never a fake "sent". Never throws.
 */
export async function sendLiveChatMessage(
  videoId: string,
  message: string
): Promise<LiveChatSendResult> {
  void videoId;
  void message;
  return { ok: false, error: UNSUPPORTED };
}

/* ------------------------------------------------------------------ */
/* @deprecated WFX2-P36 compat seams (the broker lane is retired) —     */
/* kept ONLY so the lane's pending test re-point type-checks; the       */
/* module itself never calls the broker.                               */
/* ------------------------------------------------------------------ */

/** @deprecated — the pre-P36 broker error copy, kept for the test re-point. */
export const LIVE_CHAT_ERROR_COPY = {
  membersOnly: "Chat is available to members only",
  slowMode: "Slow mode is on — you can send messages again in a few seconds",
  chatDisabled: "Chat is disabled for this live stream",
} as const;

/** @deprecated — the pre-P36 classifier, kept for the test re-point (its
 * parameter is the BrokerError's structural shape — no broker import). */
export function classifyLiveChatSendError(err: {
  kind?: string;
  message?: string;
}): LiveChatSendErrorState {
  if (err.kind === "offline") {
    return { kind: "offline", copy: "action backend offline — the lead's broker must be running" };
  }
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
 * now arrived in the streamed messages is dropped — the real youtube.com row
 * replaces the local placeholder (the stream row carries the real author +
 * id). PENDING echoes always stay (the verdict has not landed yet); sent
 * echoes whose body has not streamed yet stay too (render lag).
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
