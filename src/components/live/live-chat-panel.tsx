"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — Worker 2-d (UI lane): the live chat panel.
 *
 * Honest-state law (work order principle #8), applied to every control:
 * - the composer explains itself: anonymous → "Sign in to chat" link;
 *   banned / muted / chat-disabled / session-ended render the REAL reason
 *   (policy is caller-scoped server truth, never guessed client-side);
 * - a sent message is NOT appended from the POST response — it arrives
 *   via the SSE stream (seq-ordered, deduped) like everyone else's;
 * - slow-mode is a real countdown that only starts when the SERVER says
 *   so (403 "slow-mode"), ticking from policy.slowModeSeconds;
 * - tombstones render "Message removed by a moderator" with no body —
 *   deletion hides, it never rewrites history;
 * - moderation/report actions surface the server's real answer as
 *   success or error toasts, never a fake success.
 *
 * Phase 5 (ADR-0010): the sender's fan-club badge (senderClubBadge) is
 * server-derived at read — it renders as a neutral zinc pill next to the
 * name, and null renders NOTHING (a badge is never client-claimed).
 *
 * Phase 5-emotes (ADR-0011): when the caller passes the room host's id,
 * the panel fetches the host club's emote map ONCE per mount. Bodies are
 * split by the FROZEN pure module (renderEmoteSegments) into text/emote
 * segments — React text nodes only, never HTML; unknown codes stay text.
 * The composer grows an emote picker when the map is non-empty: entitled
 * rows append their `:code:`; locked rows are DISABLED with the level
 * lock — the entitled stamp is display-only (the server re-derives on
 * send; a forged send surfaces as the existing 403 error toast). A fetch
 * failure (or a zero-emote map) leaves the picker hidden and chat intact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Flag,
  Loader2,
  Lock,
  LogIn,
  Megaphone,
  MicOff,
  MoreVertical,
  SendHorizontal,
  ShieldMinus,
  ShieldPlus,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { beaconOps } from "@/lib/live/ops-beacon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CreateLiveReportInput,
  LiveStreamEvent,
  LiveChatMessageDto,
  LiveClubEmotesDto,
  LiveModerationActionDto,
  LiveReportDto,
  LiveReportReason,
  LiveRoomPolicyDto,
  PerformLiveModerationInput,
  SendLiveChatInput,
} from "@/lib/live/types";
import { renderEmoteSegments, type EmoteGlyph } from "@/lib/live/emote-render";
import { liveFetch, toastLiveFailure, type UseLiveStreamResult } from "./use-live-stream";

/** Frozen numeric law (src/lib/live/permissions.ts CHAT_BODY_MAX). */
const CHAT_BODY_MAX = 280;
/** Frozen mute window used by the "Mute for 10 minutes" shortcut. */
const MUTE_TEN_MINUTES = 600;
/** How close to the bottom the list must be before new rows auto-scroll. */
const NEAR_BOTTOM_PX = 80;

const CHAT_BLOCKED_COPY: Record<
  Exclude<LiveRoomPolicyDto["chatBlockedReason"], null>,
  string
> = {
  banned: "You are banned from this room",
  muted: "You are muted",
  "chat-disabled": "The host disabled chat",
  "slow-mode": "Slow mode is on — wait a few seconds between messages",
  "session-ended": "Chat opens when the broadcast is live",
  "members-only": "Members-only chat — join the fan club to chat",
};

const REPORT_REASONS: ReadonlyArray<{ reason: LiveReportReason; label: string }> = [
  { reason: "spam", label: "Spam" },
  { reason: "harassment", label: "Harassment" },
  { reason: "inappropriate", label: "Inappropriate" },
  { reason: "other", label: "Something else" },
];

type ComposerState =
  | { mode: "signin" }
  | { mode: "blocked"; copy: string }
  | { mode: "ready" };

type PendingConfirm =
  | { kind: "delete-message"; message: LiveChatMessageDto }
  | { kind: "ban"; message: LiveChatMessageDto }
  | null;

/** One picker row's display facts (ADR-0011 §3 — the entitled stamp is a
 * display hint from the GET map, never authority; the send path re-derives). */
interface EmoteEntry {
  unicode: string;
  requiredLevel: number;
  entitled: boolean;
}

export interface LiveChatPanelProps {
  roomId: string;
  /** Chat only when the broadcast is live — the server enforces it too. */
  sessionLive: boolean;
  /** Caller-scoped policy from the room GET (null → derive minimal state). */
  policy: LiveRoomPolicyDto | null;
  /** Host or granted moderator — unlocks the moderation menu. */
  canModerate: boolean;
  signedIn: boolean;
  /** The page-level stream (ONE EventSource per page — no per-panel one). */
  stream: UseLiveStreamResult;
  /** The room host's id (either plane — the server resolves). When absent
   * the emote map stays empty: no fetch, no picker, plain-text bodies. */
  hostId?: string | null;
  className?: string;
}

export function LiveChatPanel({
  roomId,
  sessionLive,
  policy,
  canModerate,
  signedIn,
  stream,
  hostId = null,
  className,
}: LiveChatPanelProps) {
  const { messages, connected } = stream;
  const { user } = useWebFlixSession();
  const myId = user?.id ?? null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Blocks the server just taught us about (403 on send) — honest overrides
  // that persist until the caller's policy prop catches up.
  const [serverBlock, setServerBlock] = useState<
    "banned" | "muted" | "chat-disabled" | null
  >(null);
  const [authLost, setAuthLost] = useState(false);
  const [localTombstones, setLocalTombstones] = useState<ReadonlySet<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  // ── Phase 5-emotes: the room host's club emote map (ADR-0011) ──
  // One GET per mount PLUS a re-derive every time the picker OPENS: the
  // entitlement law is per-request (a member may join mid-session, points
  // move levels) — a map fetched once at mount would render stale locks.
  // A failure (or a no-club/zero-emote answer) keeps the map empty — the
  // picker stays hidden and chat NEVER breaks. The emote state is display
  // truth only; the send path is untouched (the server re-derives
  // entitlement and answers 403 emote-locked like any other).
  const [emoteMap, setEmoteMap] = useState<{
    clubName: string | null;
    emotes: LiveClubEmotesDto["emotes"];
  }>({ clubName: null, emotes: [] });
  const [pickerOpen, setPickerOpen] = useState(false);

  const refreshEmotes = useCallback(async (): Promise<void> => {
    if (!hostId) return;
    try {
      const res = await fetch(
        `/api/live-clubs/emotes?hostId=${encodeURIComponent(hostId)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!res.ok) return; // map stays as-is — picker shows what it had
      const body = (await res.json().catch(() => null)) as LiveClubEmotesDto | null;
      if (!body || !Array.isArray(body.emotes)) return;
      setEmoteMap({ clubName: body.clubName ?? null, emotes: body.emotes });
    } catch {
      /* a fetch failure NEVER breaks chat — the map simply stays as-is */
    }
  }, [hostId]);

  useEffect(() => {
    if (!hostId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/live-clubs/emotes?hostId=${encodeURIComponent(hostId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (cancelled || !res.ok) return; // map stays empty — picker hidden
        const body = (await res.json().catch(() => null)) as LiveClubEmotesDto | null;
        if (cancelled || !body || !Array.isArray(body.emotes)) return;
        setEmoteMap({ clubName: body.clubName ?? null, emotes: body.emotes });
      } catch {
        /* a fetch failure NEVER breaks chat — the map simply stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  // The picker's rows (code → display facts), derived once per map change.
  const emoteEntries = useMemo<Map<string, EmoteEntry>>(
    () =>
      new Map(
        emoteMap.emotes.map((e) => [
          e.code,
          { unicode: e.unicode, requiredLevel: e.requiredLevel, entitled: e.entitled },
        ]),
      ),
    [emoteMap.emotes],
  );
  // The body renderer's glyph list — byte-for-byte from the server map.
  const emoteGlyphs = useMemo<readonly EmoteGlyph[]>(
    () => emoteMap.emotes.map((e) => ({ code: e.code, unicode: e.unicode })),
    [emoteMap.emotes],
  );
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  /** Append `:code:` (with a trailing space) and hand focus back. */
  function appendEmote(code: string): void {
    setDraft((prev) => `${prev}:${code}: `);
    setPickerOpen(false);
    composerRef.current?.focus();
  }

  // Slow-mode countdown — starts ONLY from a server 403 ("slow-mode").
  const [slowModeUntil, setSlowModeUntil] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const slowRemainingSec =
    slowModeUntil > clockNow ? Math.ceil((slowModeUntil - clockNow) / 1000) : 0;

  useEffect(() => {
    if (slowRemainingSec <= 0) return;
    const timer = setInterval(() => setClockNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [slowRemainingSec]);

  // ── Envelope handling: moderation tombstones arrive via the page stream.
  // Prop-derived state adjusts during render (the React-documented
  // pattern — the same one useLiveStream uses for room changes). ──
  const latestEnvelope = stream.latestEnvelope;
  const [lastTombstoneEnvelope, setLastTombstoneEnvelope] = useState<LiveStreamEvent | null>(null);
  if (latestEnvelope !== lastTombstoneEnvelope) {
    setLastTombstoneEnvelope(latestEnvelope);
    if (
      latestEnvelope?.kind === "moderation" &&
      latestEnvelope.action.action === "delete-message" &&
      latestEnvelope.action.messageId !== null
    ) {
      const messageId = latestEnvelope.action.messageId;
      setLocalTombstones((prev) =>
        prev.has(messageId) ? prev : new Set(prev).add(messageId),
      );
    }
  }

  // ── Composer state: every disabled state names its real reason ──
  const composerState: ComposerState = useMemo(() => {
    if (!signedIn || authLost) return { mode: "signin" };
    if (serverBlock === "banned") return { mode: "blocked", copy: CHAT_BLOCKED_COPY.banned };
    if (serverBlock === "muted") return { mode: "blocked", copy: CHAT_BLOCKED_COPY.muted };
    if (serverBlock === "chat-disabled") {
      return { mode: "blocked", copy: CHAT_BLOCKED_COPY["chat-disabled"] };
    }
    if (policy) {
      // policy.canChat is the server's combined policy+sanctions verdict —
      // when it says yes, the composer is ready (the server still decides).
      if (policy.canChat) {
        return sessionLive
          ? { mode: "ready" }
          : { mode: "blocked", copy: CHAT_BLOCKED_COPY["session-ended"] };
      }
      const reason = policy.chatBlockedReason;
      if (reason !== null) {
        return { mode: "blocked", copy: CHAT_BLOCKED_COPY[reason] };
      }
      return { mode: "blocked", copy: "You can't chat in this room right now" };
    }
    // No policy — derive the minimal honest state.
    if (!sessionLive) return { mode: "blocked", copy: CHAT_BLOCKED_COPY["session-ended"] };
    return { mode: "ready" };
  }, [signedIn, authLost, serverBlock, policy, sessionLive]);

  // ── Auto-scroll: only when the reader is already near the bottom ──
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  // Phase 4-OPS: the every-5th-send chat-latency sampler (see send()).
  const chatSendCountRef = useRef(0);
  function onListScroll(): void {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }
  useEffect(() => {
    const el = listRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ── Send ──
  async function send(): Promise<void> {
    const body = draft.trim();
    if (body.length === 0 || sending || slowRemainingSec > 0) return;
    setSending(true);
    const payload: SendLiveChatInput = {
      body,
      clientMessageId: crypto.randomUUID(),
    };
    // Phase 4-OPS: every 5th own send samples the SERVER-COMMIT latency
    // (POST start → durable 200). A client observation, fire-and-forget;
    // sessionId is deliberately omitted (the panel never knew it — the
    // per-room aggregate is the honest granularity available here).
    const chatStartedAt = Date.now();
    const result = await liveFetch<{ message: LiveChatMessageDto; duplicate?: boolean }>(
      `/api/live-rooms/${roomId}/chat`,
      { body: payload },
    );
    setSending(false);
    if (result.ok) {
      chatSendCountRef.current += 1;
      if (chatSendCountRef.current % 5 === 1) {
        beaconOps({
          kind: "chat_latency",
          roomId,
          valueMs: Date.now() - chatStartedAt,
        });
      }
      // The message arrives via the stream like every other row — the
      // response is deliberately NOT appended (no double render).
      setDraft("");
      return;
    }
    const { failure } = result;
    if (failure.code === "forbidden") {
      switch (failure.message) {
        case "slow-mode": {
          const seconds =
            policy && policy.slowModeSeconds > 0 ? policy.slowModeSeconds : 10;
          setClockNow(Date.now());
          setSlowModeUntil(Date.now() + seconds * 1000);
          toast.info("Slow mode is on", {
            description: "The host limits how fast messages can be sent.",
          });
          return;
        }
        case "muted":
          setServerBlock("muted");
          toast.error(CHAT_BLOCKED_COPY.muted);
          return;
        case "banned":
          setServerBlock("banned");
          toast.error(CHAT_BLOCKED_COPY.banned);
          return;
        case "chat-disabled":
          setServerBlock("chat-disabled");
          toast.error(CHAT_BLOCKED_COPY["chat-disabled"]);
          return;
        case "not-live":
          toast.error(CHAT_BLOCKED_COPY["session-ended"]);
          return;
        default:
          toast.error(failure.message ?? "You can't send this message right now.");
          return;
      }
    }
    if (failure.code === "rate-limited") {
      toast.error("You're sending too fast", {
        description: "Wait a moment, then try again — your message was not sent.",
      });
      return;
    }
    if (failure.code === "unauthenticated") {
      setAuthLost(true);
      toast.error("Your session ended", {
        description: "Sign in again to keep chatting — the message was not sent.",
      });
      return;
    }
    toastLiveFailure(failure, "The message was not sent.");
  }

  // ── Moderation ──
  async function runModerationAction(
    input: PerformLiveModerationInput,
    success: string,
  ): Promise<void> {
    const result = await liveFetch<{ action: LiveModerationActionDto }>(
      `/api/live-rooms/${roomId}/moderation`,
      { body: input },
    );
    if (!result.ok) {
      toastLiveFailure(result.failure, "The moderation action didn't go through — nothing changed.");
      return;
    }
    if (input.action === "delete-message" && input.messageId) {
      // Server confirmed the tombstone — render it immediately (the
      // stream's moderation envelope does the same for other mods).
      const messageId = input.messageId;
      setLocalTombstones((prev) =>
        prev.has(messageId) ? prev : new Set(prev).add(messageId),
      );
    }
    toast.success(success);
  }

  async function setModerator(userId: string, grant: boolean): Promise<void> {
    const result = await liveFetch<{ moderator: unknown }>(
      `/api/live-rooms/${roomId}/moderators`,
      { method: grant ? "POST" : "DELETE", body: { userId } },
    );
    if (!result.ok) {
      toastLiveFailure(
        result.failure,
        grant ? "Couldn't add this moderator." : "Couldn't remove this moderator.",
      );
      return;
    }
    toast.success(grant ? "Moderator added" : "Moderator removed");
  }

  // ── Reports (viewers) ──
  async function sendReport(
    message: LiveChatMessageDto,
    reason: LiveReportReason,
  ): Promise<void> {
    const payload: CreateLiveReportInput = {
      reason,
      messageId: message.id,
      targetId: message.senderId,
    };
    const result = await liveFetch<{ report: LiveReportDto }>(
      `/api/live-rooms/${roomId}/reports`,
      { body: payload },
    );
    if (!result.ok) {
      toastLiveFailure(result.failure, "The report wasn't sent — nothing was recorded.");
      return;
    }
    toast.success("Report sent", {
      description: "The host and WebFlix moderators can now review it.",
    });
  }

  async function runConfirmed(target: NonNullable<PendingConfirm>): Promise<void> {
    if (target.kind === "delete-message") {
      await runModerationAction(
        { action: "delete-message", messageId: target.message.id },
        "Message removed",
      );
    } else {
      await runModerationAction(
        { action: "ban", targetId: target.message.senderId },
        `Banned @${target.message.senderHandle} from this room`,
      );
    }
  }

  return (
    <Card className={cn("min-w-0 gap-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="text-base">Live chat</CardTitle>
        <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-emerald-500" : "animate-pulse bg-amber-500",
            )}
          />
          {connected ? "Connected" : "Connecting…"}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ── Message list ── */}
        <div
          ref={listRef}
          onScroll={onListScroll}
          aria-live="polite"
          aria-label="Live chat messages"
          className="max-h-96 min-h-20 overflow-y-auto pr-1"
        >
          {messages.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {connected ? "No messages yet — say hello." : "Connecting to the room chat…"}
            </p>
          ) : (
            <ul className="space-y-1">
              {messages.map((m) => (
                <ChatRow
                  key={m.id}
                  message={m}
                  deleted={m.deleted || localTombstones.has(m.id)}
                  emoteGlyphs={emoteGlyphs}
                  isMine={myId !== null && m.senderId === myId}
                  canModerate={canModerate && signedIn}
                  canReport={signedIn && !canModerate && m.senderId !== myId}
                  onModerate={(input, success) => void runModerationAction(input, success)}
                  onSetModerator={(userId, grant) => void setModerator(userId, grant)}
                  onReport={(message, reason) => void sendReport(message, reason)}
                  onConfirm={(pending) => setPendingConfirm(pending)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ── Composer ── */}
        {composerState.mode === "signin" ? (
          <Button asChild className="h-11 w-full md:h-9">
            <Link href={`/signin?redirect=${encodeURIComponent(`/live/${roomId}`)}`}>
              <LogIn aria-hidden /> Sign in to chat
            </Link>
          </Button>
        ) : composerState.mode === "blocked" ? (
          <p
            role="status"
            className="rounded-lg border border-dashed px-3 py-2.5 text-center text-sm text-muted-foreground"
          >
            {composerState.copy}
          </p>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="min-w-0 flex-1">
              <Textarea
                ref={composerRef}
                aria-label="Chat message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Say something…"
                maxLength={CHAT_BODY_MAX}
                rows={1}
                disabled={sending || slowRemainingSec > 0}
                className="max-h-32 min-h-11 md:min-h-9"
              />
              {CHAT_BODY_MAX - draft.length <= 20 && (
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {CHAT_BODY_MAX - draft.length} characters left
                </p>
              )}
            </div>
            {emoteEntries.size > 0 && (
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Emotes"
                  aria-expanded={pickerOpen}
                  data-testid="emote-picker-trigger"
                  onClick={() =>
                    setPickerOpen((o) => {
                      if (!o) void refreshEmotes(); // re-derive on every open
                      return !o;
                    })
                  }
                  className="size-11 md:size-9"
                >
                  <SmilePlus aria-hidden />
                </Button>
                {pickerOpen && (
                  <div
                    data-testid="emote-picker"
                    role="group"
                    aria-label="Emotes"
                    className="absolute bottom-full right-0 z-50 mb-2 max-h-64 w-64 overflow-y-auto rounded-xl border bg-popover p-2 shadow-md"
                  >
                    {emoteMap.clubName !== null && (
                      <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {emoteMap.clubName}
                      </p>
                    )}
                    <div className="flex flex-col gap-0.5">
                      {Array.from(emoteEntries.entries()).map(([code, entry]) =>
                        entry.entitled ? (
                          <button
                            key={code}
                            type="button"
                            data-testid="emote-row"
                            onClick={() => appendEmote(code)}
                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span className="text-base leading-none" aria-hidden>
                              {entry.unicode}
                            </span>
                            <span className="text-xs text-muted-foreground">:{code}:</span>
                          </button>
                        ) : (
                          <button
                            key={code}
                            type="button"
                            disabled
                            aria-disabled="true"
                            title={`Unlocks at club level ${entry.requiredLevel}`}
                            data-testid="emote-row"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-muted-foreground/60"
                          >
                            <span className="text-base leading-none" aria-hidden>
                              {entry.unicode}
                            </span>
                            <span className="text-xs">:{code}:</span>
                            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <Lock className="size-3" aria-hidden /> Level {entry.requiredLevel}
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <Button
              type="submit"
              size="icon"
              aria-label="Send chat message"
              disabled={
                sending || slowRemainingSec > 0 || draft.trim().length === 0
              }
              className="size-11 md:size-9"
            >
              {sending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <SendHorizontal aria-hidden />
              )}
            </Button>
          </form>
        )}
        {slowRemainingSec > 0 && (
          <p role="status" className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Slow mode: wait {slowRemainingSec}s
          </p>
        )}
      </CardContent>

      {/* ── Destructive moderation confirm (ban / delete) ── */}
      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingConfirm?.kind === "ban"
                ? `Ban @${pendingConfirm.message.senderHandle} from this room?`
                : "Delete this message?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirm?.kind === "ban"
                ? "Banning removes their ability to chat in this room. The action is recorded in the moderation audit trail."
                : "The message is replaced by a public tombstone — “Message removed by a moderator”. It is never silently erased."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingConfirm) void runConfirmed(pendingConfirm);
              }}
            >
              {pendingConfirm?.kind === "ban" ? "Ban" : "Delete message"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// One chat row (announcement / deleted / normal) + its action menu.
// ═══════════════════════════════════════════════════════════════════

interface ChatRowProps {
  message: LiveChatMessageDto;
  deleted: boolean;
  /** The room host's emote glyphs (empty when the map is absent/failed —
   * bodies then render as plain text, the honest history). */
  emoteGlyphs: readonly EmoteGlyph[];
  isMine: boolean;
  canModerate: boolean;
  /** Signed-in non-moderators may report — never on their own rows. */
  canReport: boolean;
  onModerate: (input: PerformLiveModerationInput, success: string) => void;
  onSetModerator: (userId: string, grant: boolean) => void;
  onReport: (message: LiveChatMessageDto, reason: LiveReportReason) => void;
  onConfirm: (pending: NonNullable<PendingConfirm>) => void;
}

function ChatRow({
  message,
  deleted,
  emoteGlyphs,
  isMine,
  canModerate,
  canReport,
  onModerate,
  onSetModerator,
  onReport,
  onConfirm,
}: ChatRowProps) {
  const announcement = message.kind !== "chat" && !deleted;

  // Menu visibility: mods never get mute/ban/mod controls on their own
  // rows; viewers get a report menu; own/deleted rows get neither.
  const showModMenu = canModerate && !isMine && !deleted;
  const showReportMenu = canReport && !isMine && !deleted;

  return (
    <li
      className={cn(
        "group relative rounded-lg px-2 py-1.5",
        announcement && "border border-amber-500/30 bg-amber-500/10",
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {deleted ? (
            <p className="text-sm italic text-muted-foreground">
              Message removed by a moderator
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-1.5 text-sm leading-snug">
                <span className="min-w-0 truncate font-medium text-foreground">
                  {message.senderName}
                </span>
                {/* Phase 5: the sender's fan-club badge — server-derived at
                    read (ADR-0010 §5), rendered as a neutral zinc pill next
                    to the name; null means the sender isn't a member and
                    renders NOTHING (never a client-claimed badge). */}
                {message.senderClubBadge && (
                  <span
                    data-testid="chat-club-badge"
                    title={`${message.senderClubBadge.clubName} · fan-club level ${message.senderClubBadge.level}`}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-300 bg-zinc-100 px-1.5 py-px text-[10px] font-semibold leading-none text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    <span aria-hidden>★</span>
                    {message.senderClubBadge.level}
                  </span>
                )}
                <span className="shrink-0 truncate text-xs text-muted-foreground">
                  @{message.senderHandle}
                </span>
                <span className="ml-auto shrink-0 pl-1 text-[11px] text-muted-foreground/70">
                  {formatRelativeDate(message.createdAt)}
                </span>
              </p>
              <p
                className={cn(
                  "break-words text-sm leading-snug text-foreground/90",
                  announcement && "font-medium text-amber-700 dark:text-amber-400",
                )}
              >
                {/* Phase 5-emotes (ADR-0011 §4): the FROZEN pure module does
                    the ONLY substitution — exact :code: matches against the
                    server map render its unicode as a React text node; every
                    other colon (scores, times, unknown/retired codes) stays
                    literal text. Never HTML, never a client-invented glyph. */}
                {renderEmoteSegments(message.body, emoteGlyphs).map((seg, i) =>
                  seg.kind === "emote" ? (
                    <span
                      key={i}
                      title={`:${seg.code}:`}
                      className="text-base leading-none"
                      aria-label={`emote :${seg.code}:`}
                    >
                      {seg.value}
                    </span>
                  ) : (
                    seg.value
                  ),
                )}
              </p>
              {announcement && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  <Megaphone className="size-3" aria-hidden /> Announcement
                </p>
              )}
            </>
          )}
        </div>

        {(showModMenu || showReportMenu) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${message.senderName}'s message`}
                className="size-11 opacity-70 md:size-8 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
              >
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            {showModMenu ? (
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={() =>
                    onModerate(
                      {
                        action: "mute",
                        targetId: message.senderId,
                        expiresInSeconds: MUTE_TEN_MINUTES,
                      },
                      `Muted @${message.senderHandle} for 10 minutes`,
                    )
                  }
                >
                  <MicOff aria-hidden /> Mute for 10 minutes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetModerator(message.senderId, true)}>
                  <ShieldPlus aria-hidden /> Make moderator
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetModerator(message.senderId, false)}>
                  <ShieldMinus aria-hidden /> Remove moderator
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onConfirm({ kind: "delete-message", message })}
                >
                  <Trash2 aria-hidden /> Delete message
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onConfirm({ kind: "ban", message })}
                >
                  <Ban aria-hidden /> Ban @{message.senderHandle}
                </DropdownMenuItem>
              </DropdownMenuContent>
            ) : (
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Report this message
                </DropdownMenuLabel>
                {REPORT_REASONS.map(({ reason, label }) => (
                  <DropdownMenuItem
                    key={reason}
                    onClick={() => onReport(message, reason)}
                  >
                    <Flag aria-hidden /> {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
