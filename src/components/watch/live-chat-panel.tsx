"use client";

/**
 * WFX2-A-S — YouTube-style collapsible live chat panel for the watch page.
 * Collapsed: slim vertical tab (rotated "Live chat" label + chevron).
 * Expanded: header (title, participants, replay badge, timestamp toggle,
 * collapse), "Top chat | Live chat" segmented control, newest-at-bottom
 * message list (auto-scroll only when pinned near the bottom, floating
 * "Jump to latest" pill otherwise), and — WFX2-P3-LC — the real send flow.
 *
 * All read data via useLiveChat → /api/videos/[id]/livechat. The panel
 * self-hides (renders null) when the video has no chat. currentTimeSec is
 * the player playhead in seconds — the hook fetches replay frames as it
 * advances; in replay mode only messages at/below the playhead are shown.
 *
 * WFX2-P3-LC — the send flow (posting to live chat ships):
 *  - REPLAY: the input area is hidden entirely (posting to a replayed chat
 *    is not a thing on youtube.com — chat is live-only);
 *  - GUEST (no WebFlix account — the P2-AU signed-out law): the input area
 *    becomes the "Sign in to chat" gate (the comment composer's "Sign in to
 *    comment" pattern — red Sign in affordance, redirect back to this watch
 *    page);
 *  - SIGNED-IN: a live input + send button + Enter. The message echoes
 *    optimistically (marked pending), reconciled by the broker result:
 *    success flips the echo to "sent" (and the polled stream later replaces
 *    it with the real row); failure clears the echo, restores the draft and
 *    shows the honest error copy (members-only / slow mode / chat disabled —
 *    youtube.com's own states).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  MessagesSquare,
  Send,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { compactCount } from "@/lib/watch/format";
import { useLiveChat } from "@/hooks/use-live-chat";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref } from "@/lib/auth/client";
import {
  buildLiveChatEcho,
  reconcileEchoes,
  sendLiveChatMessage,
  type LiveChatEcho,
  type LiveChatSendErrorState,
} from "@/lib/livechat/send";
import { LiveChatMessage } from "./live-chat-message";

/** Near-bottom threshold (px) that keeps auto-scroll pinned on. */
const BOTTOM_EPS_PX = 80;

/** youtube.com's live-chat message length limit. */
export const LIVE_CHAT_MAX_LENGTH = 200;

/** Cap on optimistic echoes kept in the panel state (oldest drop first). */
const MAX_ECHOES = 20;

/** WFX2-C-S: strict H:MM:SS for the replay offset chip (hours always shown). */
export function formatOffsetChip(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const iconButton =
  "flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function LiveChatPanel({
  videoId,
  currentTimeSec,
  premiereStartsAt,
}: {
  videoId: string;
  currentTimeSec?: number;
  /**
   * P21-LIVE-PREMIERES — the scheduled start (ISO) of an upcoming premiere.
   * While it is in the future the panel renders YouTube's pre-premiere
   * chat state ("Chat is disabled until the premiere starts") instead of
   * the live/replay machinery: the real pre-premiere chat stream is
   * YouTube's (no session, no continuation — honest disclosure on the
   * panel itself). Once the start passes, the caller drops the prop and
   * the normal live-chat bootstrap takes over.
   */
  premiereStartsAt?: string | null;
}) {
  // P21: the pre-premiere state — decided BEFORE any chat machinery runs
  // (this outer arm carries no hooks, so the branch is legal).
  if (premiereStartsAt && Date.parse(premiereStartsAt) > Date.now()) {
    return <PrePremiereChat />;
  }
  return <LiveChatPanelInner videoId={videoId} currentTimeSec={currentTimeSec} />;
}

/** P21-LIVE-PREMIERES — YouTube's pre-premiere chat state, honestly. */
function PrePremiereChat() {
  return (
    <section
      aria-label="Live chat"
      data-premiere-chat
      className="mb-6 flex h-in(560px,70vh)] w-full max-w-in(420px,100%)] flex-col overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">Live chat</h2>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <MessagesSquare className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          Chat is disabled until the premiere starts
        </p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          The pre-premiere chat stream is YouTube’s — it plays on youtube.com
          only. WebFlix joins the live chat once the premiere begins.
        </p>
      </div>
    </section>
  );
}

function LiveChatPanelInner({
  videoId,
  currentTimeSec,
}: {
  videoId: string;
  currentTimeSec?: number;
}) {
  const {
    state,
    messages,
    visibleMessages,
    participants,
    error,
    topChat,
    setTopChat,
    refresh,
    seeking,
  } = useLiveChat(videoId, { currentTimeSec });

  const [collapsed, setCollapsed] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [newCount, setNewCount] = useState(0);

  // ---- WFX2-P3-LC: the send flow state -----------------------------------
  const session = useWebFlixSession();
  /** the AU signed-out law: guest = no WebFlix account session */
  const guest = session.status === "unauthenticated";
  const [draft, setDraft] = useState("");
  const [echoes, setEchoes] = useState<LiveChatEcho[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<LiveChatSendErrorState | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const hoverRef = useRef(false);
  const prevShownRef = useRef(0);

  const isReplay = state === "replay";
  // WFX2-C-S: a seek re-anchor / leap-walk is in flight → header chip + list
  // shimmer (loading state for the seek transition; the kept messages stay
  // visible under a subtle pulse — no layout shift).
  const showSeekShimmer = isReplay && seeking;

  // replay: only reveal messages at/below the playhead (messages appear
  // as currentTimeSec advances; the hook fetches the frames)
  const shown = useMemo(() => {
    if (!isReplay || currentTimeSec === undefined) return visibleMessages;
    const edgeMsec = currentTimeSec * 1000 + 250; // small reveal lookahead
    return visibleMessages.filter(
      (m) => m.offsetMsec === null || m.offsetMsec === undefined || m.offsetMsec <= edgeMsec,
    );
  }, [visibleMessages, isReplay, currentTimeSec]);

  // WFX2-P3-LC: reconcile the echoes against the polled stream — a sent
  // echo whose body has streamed is dropped (the real youtube.com row takes
  // its place); pending echoes always stay. Pure derivation, no effect.
  const shownEchoes = useMemo(
    () => reconcileEchoes(echoes, messages),
    [echoes, messages],
  );

  // newest-at-bottom: stick when the user is within BOTTOM_EPS_PX of the
  // bottom (and not hovering); otherwise count new messages for the
  // "Jump to latest" pill.
  useEffect(() => {
    const delta = shown.length - prevShownRef.current;
    prevShownRef.current = shown.length;
    if (delta === 0) return;
    if (atBottomRef.current && !hoverRef.current) {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
      setNewCount(0);
    } else if (delta > 0) {
      setNewCount((n) => n + delta);
    }
  }, [shown]);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    atBottomRef.current = distance <= BOTTOM_EPS_PX;
    if (atBottomRef.current) setNewCount(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setNewCount(0);
  }, []);

  // ---- WFX2-P3-LC: send ----------------------------------------------------
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const echo = buildLiveChatEcho(text);
    setEchoes((prev) => [...prev.slice(-(MAX_ECHOES - 1)), echo]);
    setDraft("");
    // the echo is the newest row — pin it into view like a streamed message
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    const result = await sendLiveChatMessage(videoId, text);
    setSending(false);
    if (result.ok) {
      setEchoes((prev) =>
        prev.map((e) => (e.id === echo.id ? { ...e, status: "sent" } : e)),
      );
    } else {
      // honest failure: clear the pending mark (echo out), restore the draft
      // for retry (youtube.com keeps the text), show the platform's copy
      setEchoes((prev) => prev.filter((e) => e.id !== echo.id));
      setSendError(result.error);
      setDraft(text);
    }
  }, [draft, sending, videoId]);

  // self-hide: no chat for this video (after the hooks above have run)
  if (state === "unavailable") return null;

  // ---- collapsed: slim vertical tab (YouTube pattern) --------------------
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={isReplay ? "Show chat replay" : "Show live chat"}
        aria-expanded="false"
        className="mb-6 flex h-44 w-12 shrink-0 flex-col items-center justify-between gap-2 self-start rounded-lg border border-border bg-card/40 px-1 py-3 transition hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex flex-1 items-center justify-center rotate-180 text-sm font-medium text-foreground/80 [writing-mode:vertical-rl]">
          {isReplay ? "Chat replay" : "Live chat"}
        </span>
        {participants !== null ? (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <Users className="size-3" aria-hidden="true" />
            {compactCount(participants)}
            <span className="sr-only">watching</span>
          </span>
        ) : (
          <span className="size-3" aria-hidden="true" />
        )}
      </button>
    );
  }

  // ---- expanded -----------------------------------------------------------
  const showSkeletons =
    (state === "boot" || state === "loading") && messages.length === 0;
  const showErrorCard = state === "error" && messages.length === 0;

  // WFX2-P3-LC: the composer exists only on a LIVE stream — replay hides the
  // input entirely (posting to a replayed chat is not a thing), and the
  // boot/error states carry no composer until the stream confirms live.
  const canPost = state === "live" && !isReplay;
  const echoName = session.user?.displayName?.trim() || "You";

  return (
    <section
      aria-label={isReplay ? "Chat replay" : "Live chat"}
      className="mb-6 flex h-[min(560px,70vh)] w-full max-w-[min(420px,100%)] flex-col overflow-hidden rounded-xl border border-border bg-card/40"
    >
      {/* header */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">{isReplay ? "Chat replay" : "Live chat"}</h2>
        {isReplay && (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
            <History className="size-3" aria-hidden="true" />
            Chat replay
          </span>
        )}
        {participants !== null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden="true" />
            <span className="tabular-nums">{compactCount(participants)}</span>
            <span className="sr-only">{participants.toLocaleString()} participants</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isReplay && currentTimeSec !== undefined && (
            <span
              aria-label={`Replay offset ${formatOffsetChip(currentTimeSec)}`}
              title="Chat replay position"
              className={cn(
                "mr-1 hidden items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium tabular-nums text-secondary-foreground transition-opacity duration-200 sm:inline-flex",
                showSeekShimmer && "animate-pulse",
              )}
            >
              <Clock className="size-3 text-muted-foreground" aria-hidden="true" />
              {formatOffsetChip(currentTimeSec)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTimestamps((v) => !v)}
            aria-pressed={showTimestamps}
            aria-label="Toggle message timestamps"
            title={showTimestamps ? "Hide timestamps" : "Show timestamps"}
            className={cn(iconButton, showTimestamps && "bg-accent text-foreground")}
          >
            <Clock className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Hide chat"
            aria-expanded="true"
            className={iconButton}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Top chat | Live chat segmented toggle */}
      <div
        className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5"
        role="group"
        aria-label="Chat view mode"
      >
        <div className="flex rounded-full border border-border p-0.5">
          <button
            type="button"
            onClick={() => setTopChat(true)}
            aria-pressed={topChat}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium transition",
              topChat
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Top chat
          </button>
          <button
            type="button"
            onClick={() => setTopChat(false)}
            aria-pressed={!topChat}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium transition",
              !topChat
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Live chat
          </button>
        </div>
        {error && messages.length > 0 && (
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 text-xs text-yt-red transition hover:underline"
          >
            Reconnecting — retry
          </button>
        )}
      </div>

      {/* message list (newest at the bottom) */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleScroll}
          onPointerEnter={() => {
            hoverRef.current = true;
          }}
          onPointerLeave={() => {
            hoverRef.current = false;
          }}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={isReplay ? "Chat replay messages" : "Live chat messages"}
          className="slim-scrollbar absolute inset-0 overscroll-contain overflow-y-auto px-2 py-2"
        >
          {showSkeletons && (
            <div className="space-y-3 px-1 py-1" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-start gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {showErrorCard && (
            <div
              className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center"
              role="alert"
            >
              <p className="text-sm text-muted-foreground">
                {error ?? "Live chat failed to load."}
              </p>
              <p className="text-xs text-muted-foreground/70">Retrying automatically…</p>
              <Button type="button" variant="outline" size="sm" onClick={refresh}>
                Retry now
              </Button>
            </div>
          )}

          {!showSkeletons && !showErrorCard && shown.length === 0 && shownEchoes.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {isReplay
                ? "Chat replay appears as the video plays."
                : messages.length === 0
                  ? "No messages yet — say hi when chat warms up."
                  : "Top chat is hiding everything right now."}
            </p>
          )}

          {shown.map((m) => (
            <LiveChatMessage key={m.id} message={m} showTimestamps={showTimestamps} videoId={videoId} />
          ))}

          {/* WFX2-P3-LC: the optimistic echoes — your messages, marked
              pending until the broker verdict lands, then "sent" until the
              polled stream delivers the real row (reconcileEchoes) */}
          {shownEchoes.map((e) => (
            <div
              key={e.id}
              data-testid="chat-echo"
              data-status={e.status}
              aria-label={`Your message${e.status === "pending" ? " (sending)" : " (sent)"}`}
              className={cn(
                "flex items-start gap-2 px-1 py-1 transition-opacity",
                e.status === "pending" && "opacity-70",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
              >
                {echoName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-1">
                  <span className="truncate text-xs font-medium text-foreground">
                    {echoName}
                  </span>
                  <span
                    className="ml-auto shrink-0 pl-1 text-[10px] font-medium text-muted-foreground"
                    aria-hidden="true"
                  >
                    {e.status === "pending" ? "Sending…" : "Sent"}
                  </span>
                  <span className="sr-only">
                    {e.status === "pending" ? "Sending" : "Sent"}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-sm leading-snug">{e.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* floating "Jump to latest" pill (auto-scroll paused) */}
        {newCount > 0 && !showSkeletons && !showErrorCard && (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label={`Jump to latest, ${newCount} new ${newCount === 1 ? "message" : "messages"}`}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium shadow-lg transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <MessagesSquare className="size-3.5" aria-hidden="true" />
            <span>Jump to latest</span>
            <span
              className="rounded-full bg-yt-red px-1.5 py-px text-[10px] font-semibold tabular-nums text-white"
              aria-hidden="true"
            >
              {compactCount(newCount)}
            </span>
            <span className="sr-only">{newCount} new messages</span>
          </button>
        )}

        {/* WFX2-C-S: seek shimmer — translucent pulse while the chat
            re-anchors after a seek (loading variant for the seek state;
            kept messages stay visible underneath — no layout shift) */}
        {showSeekShimmer && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 animate-pulse bg-gradient-to-b from-secondary/60 to-transparent"
            aria-hidden="true"
          />
        )}
      </div>

      {/* WFX2-P3-LC — the input area.
          Replay: nothing (posting to replayed chat is not a thing on
          youtube.com). Guest: the AU signed-out law ("Sign in to chat" —
          the comment composer's "Sign in to comment" pattern). Signed-in on
          a live stream: the composer + send button + Enter. */}
      {canPost && guest && (
        <div className="border-t border-border p-3">
          <div className="flex h-10 items-center justify-between gap-3 rounded-xl border border-border px-4">
            <span className="truncate text-sm text-muted-foreground">Sign in to chat</span>
            <Link
              href={signInHref(`/watch/${videoId}`)}
              className="shrink-0 text-sm font-medium text-yt-red hover:underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
      {canPost && !guest && (
        <div className="border-t border-border p-3">
          {sendError && (
            <p
              role="alert"
              data-testid="chat-send-error"
              className="mb-2 rounded-lg bg-secondary/70 px-3 py-2 text-xs leading-snug text-foreground"
            >
              {sendError.copy}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Say something…"
              aria-label="Chat message"
              maxLength={LIVE_CHAT_MAX_LENGTH}
              className="h-9 flex-1 rounded-full bg-background text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className="size-9 shrink-0 rounded-full"
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default LiveChatPanel;
