"use client";

/**
 * WFX2-A-S — YouTube-style collapsible live chat panel for the watch page.
 * Collapsed: slim vertical tab (rotated "Live chat" label + chevron).
 * Expanded: header (title, participants, replay badge, timestamp toggle,
 * collapse), "Top chat | Live chat" segmented control, newest-at-bottom
 * message list (auto-scroll only when pinned near the bottom, floating
 * "Jump to latest" pill otherwise), and a permanently disabled input
 * (posting ships with the sign-in broker lane).
 *
 * All data via useLiveChat → /api/videos/[id]/livechat. The panel
 * self-hides (renders null) when the video has no chat. currentTimeSec is
 * the player playhead in seconds — the hook fetches replay frames as it
 * advances; in replay mode only messages at/below the playhead are shown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { compactCount } from "@/lib/watch/format";
import { useLiveChat } from "@/hooks/use-live-chat";
import { LiveChatMessage } from "./live-chat-message";

/** Near-bottom threshold (px) that keeps auto-scroll pinned on. */
const BOTTOM_EPS_PX = 80;

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

          {!showSkeletons && !showErrorCard && shown.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {isReplay
                ? "Chat replay appears as the video plays."
                : messages.length === 0
                  ? "No messages yet — say hi when chat warms up."
                  : "Top chat is hiding everything right now."}
            </p>
          )}

          {shown.map((m) => (
            <LiveChatMessage key={m.id} message={m} showTimestamps={showTimestamps} />
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

      {/* input — posting ships with the sign-in broker lane (always off) */}
      <div className="border-t border-border p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Input
                disabled
                placeholder="Say something…"
                aria-label="Chat message (sign-in required)"
                className="h-9 flex-1 rounded-full bg-background text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled
                aria-label="Send message (sign-in required)"
                className="size-9 shrink-0 rounded-full"
              >
                <Send className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">Sign-in actions arrive with the broker lane</TooltipContent>
        </Tooltip>
      </div>
    </section>
  );
}

export default LiveChatPanel;
