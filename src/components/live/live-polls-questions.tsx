"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — Worker 2-d (UI lane): the polls + Q&A
 * panel.
 *
 * Honest-state law (work order principle #8), applied end to end:
 * - there is NO frozen GET route that lists polls, so the panel owns its
 *   `openPoll` snapshot fed ONLY by real sources: the stream's `poll`
 *   envelopes (via useLiveStream.onEnvelope) and the POST responses of
 *   create/vote/close. On mount it truthfully says "No poll right now";
 * - every count and percentage is server-computed (votes are SUMs) —
 *   the client renders them, never invents them;
 * - a closed poll keeps its final counts and says "Poll closed"; a 409
 *   vote says the poll closed instead of faking a vote;
 * - Q&A lists come from the frozen GET route; hidden rows render only in
 *   the moderator view with an explicit "Hidden" badge; hide asks first.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  EyeOff,
  Loader2,
  LogIn,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CreateLivePollInput,
  CreateLiveQuestionInput,
  LivePollDto,
  LiveQuestionDto,
  LiveStreamEvent,
} from "@/lib/live/types";
import { liveFetch, toastLiveFailure } from "./use-live-stream";

/** Frozen numeric laws (src/lib/live/permissions.ts). */
const QUESTION_BODY_MAX = 280;
const POLL_OPTIONS_MIN = 2;
const POLL_OPTIONS_MAX = 6;
const POLL_LABEL_MAX = 80;

export interface LivePollsQuestionsProps {
  roomId: string;
  sessionLive: boolean;
  canModerate: boolean;
  signedIn: boolean;
  /** Live-updates indicator from the page-level stream (ONE per page). */
  streamConnected: boolean;
  /** The page-level stream's latest envelope (identity changes per event). */
  envelope: LiveStreamEvent | null;
  className?: string;
}

export function LivePollsQuestions({
  roomId,
  sessionLive,
  canModerate,
  signedIn,
  streamConnected,
  envelope,
  className,
}: LivePollsQuestionsProps) {
  // The page owns the single stream subscription — poll envelopes feed the
  // polls pane, question envelopes tick the Q&A pane's refresh. Prop-derived
  // state adjusts during render (the React-documented pattern).
  const [openPoll, setOpenPoll] = useState<LivePollDto | null>(null);
  const [questionTick, setQuestionTick] = useState(0);
  const [lastEnvelope, setLastEnvelope] = useState<LiveStreamEvent | null>(null);
  if (envelope !== lastEnvelope) {
    setLastEnvelope(envelope);
    if (envelope?.kind === "poll") {
      const poll = envelope.poll;
      setOpenPoll((prev) => {
        // One open poll per session: an open poll always takes over; a
        // closed envelope only matters when it closes the poll we show.
        if (poll.status === "open") return poll;
        return prev !== null && prev.id === poll.id ? poll : prev;
      });
    } else if (envelope?.kind === "question") {
      setQuestionTick((t) => t + 1);
    }
  }

  const connected = streamConnected;

  return (
    <Card className={cn("min-w-0 gap-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="text-base">Polls &amp; Q&amp;A</CardTitle>
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              connected ? "bg-emerald-500" : "animate-pulse bg-amber-500",
            )}
          />
          {connected ? "Live updates" : "Connecting…"}
        </span>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="polls">
          <TabsList className="w-full">
            <TabsTrigger value="polls" className="flex-1">
              Polls
            </TabsTrigger>
            <TabsTrigger value="questions" className="flex-1">
              Q&amp;A
            </TabsTrigger>
          </TabsList>
          <TabsContent value="polls" className="mt-3">
            <PollsPane
              roomId={roomId}
              sessionLive={sessionLive}
              canModerate={canModerate}
              signedIn={signedIn}
              openPoll={openPoll}
              onOpenPollChange={setOpenPoll}
              connected={connected}
            />
          </TabsContent>
          <TabsContent value="questions" className="mt-3">
            <QuestionsPane
              roomId={roomId}
              sessionLive={sessionLive}
              canModerate={canModerate}
              signedIn={signedIn}
              refreshSignal={questionTick}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Polls pane — stream-fed open poll + create/vote/close.
// ═══════════════════════════════════════════════════════════════════

interface PollsPaneProps {
  roomId: string;
  sessionLive: boolean;
  canModerate: boolean;
  signedIn: boolean;
  openPoll: LivePollDto | null;
  onOpenPollChange: (poll: LivePollDto | null) => void;
  connected: boolean;
}

function PollsPane({
  roomId,
  sessionLive,
  canModerate,
  signedIn,
  openPoll,
  onOpenPollChange,
  connected,
}: PollsPaneProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [optionDrafts, setOptionDrafts] = useState<string[]>(["", ""]);
  const [creating, setCreating] = useState(false);
  const [votingOptionId, setVotingOptionId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const createPoll = useCallback(async () => {
    const q = question.trim();
    const options = optionDrafts.map((o) => o.trim()).filter((o) => o.length > 0);
    if (q.length === 0 || options.length < POLL_OPTIONS_MIN) {
      toast.error("A poll needs a question and at least 2 options");
      return;
    }
    setCreating(true);
    const payload: CreateLivePollInput = { question: q, options };
    const result = await liveFetch<{ poll: LivePollDto }>(
      `/api/live-rooms/${roomId}/polls`,
      { body: payload },
    );
    setCreating(false);
    if (!result.ok) {
      toastLiveFailure(result.failure, "The poll wasn't created.");
      return;
    }
    // Seed immediately from the route response; stream events refresh it.
    onOpenPollChange(result.data.poll);
    setQuestion("");
    setOptionDrafts(["", ""]);
    setFormOpen(false);
    toast.success("Poll created", {
      description: "Every viewer in this room can vote now.",
    });
  }, [question, optionDrafts, roomId, onOpenPollChange]);

  const vote = useCallback(
    async (pollId: string, optionId: string) => {
      setVotingOptionId(optionId);
      const result = await liveFetch<{ poll: LivePollDto }>(
        `/api/live-rooms/${roomId}/polls/${pollId}/vote`,
        { body: { optionId } },
      );
      setVotingOptionId(null);
      if (!result.ok) {
        if (result.failure.code === "conflict" || result.failure.status === 409) {
          toast.error("Poll closed", {
            description: "This poll already closed — the counts below are final.",
          });
          return;
        }
        if (result.failure.code === "unauthenticated") {
          toast.error("Sign in to vote");
          return;
        }
        toastLiveFailure(result.failure, "Your vote wasn't counted.");
        return;
      }
      onOpenPollChange(result.data.poll);
    },
    [roomId, onOpenPollChange],
  );

  const closePoll = useCallback(
    async (pollId: string) => {
      setClosing(true);
      const result = await liveFetch<{ poll: LivePollDto }>(
        `/api/live-rooms/${roomId}/polls/${pollId}/close`,
      );
      setClosing(false);
      if (!result.ok) {
        toastLiveFailure(result.failure, "The poll wasn't closed.");
        return;
      }
      onOpenPollChange(result.data.poll);
      toast.success("Poll closed", {
        description: "Voting is over — the final counts stay visible.",
      });
    },
    [roomId, onOpenPollChange],
  );

  const poll = openPoll;
  const options =
    poll !== null ? [...poll.options].sort((a, b) => a.position - b.position) : [];
  const totalVotes = poll !== null ? poll.options.reduce((sum, o) => sum + o.votes, 0) : 0;
  const canVote = signedIn && sessionLive && poll !== null && poll.status === "open";

  return (
    <div className="space-y-3">
      {/* ── The open (or just-closed) poll ── */}
      {poll === null ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No poll right now.
          <span className="mt-1 block text-xs">
            {connected
              ? "When the host creates one, it appears here instantly."
              : "Connecting to the room stream…"}
          </span>
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 break-words text-sm font-medium">{poll.question}</p>
            {poll.status === "closed" ? (
              <Badge variant="secondary">Poll closed</Badge>
            ) : (
              <Badge className="bg-yt-red text-white">Open poll</Badge>
            )}
          </div>

          <div className="space-y-1.5">
            {options.map((option) => {
              const pct = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
              const mine = poll.myVoteOptionId === option.id;
              const label = (
                <>
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {option.label}
                      {mine && (
                        <span className="ml-1.5 text-xs font-medium text-yt-red">
                          · Your vote
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        aria-hidden
                        className="block h-full rounded-full bg-yt-red"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {formatCount(option.votes)}
                    </span>
                  </span>
                </>
              );
              return poll.status === "open" ? (
                <Button
                  key={option.id}
                  variant="outline"
                  disabled={!canVote || votingOptionId !== null}
                  onClick={() => void vote(poll.id, option.id)}
                  aria-label={`Vote for ${option.label}`}
                  className={cn(
                    "relative h-auto w-full flex-col items-stretch gap-1.5 px-3 py-2.5",
                    mine && "border-yt-red",
                  )}
                >
                  {label}
                  {votingOptionId === option.id && (
                    <Loader2 className="absolute right-2 top-2 size-3 animate-spin" aria-hidden />
                  )}
                </Button>
              ) : (
                <div
                  key={option.id}
                  className="relative flex flex-col gap-1.5 rounded-md border border-dashed px-3 py-2.5"
                >
                  {label}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {formatCount(totalVotes)} vote{totalVotes === 1 ? "" : "s"}
              {poll.status === "open" && !signedIn && " — sign in to vote"}
              {poll.status === "open" && signedIn && !sessionLive &&
                " — voting pauses while the broadcast isn't live"}
            </span>
            {poll.status === "open" && canModerate && signedIn && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 md:h-7"
                disabled={closing}
                onClick={() => void closePoll(poll.id)}
              >
                {closing ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <XCircle aria-hidden />
                )}
                Close poll
              </Button>
            )}
            {poll.closedAt !== null && (
              <span>Closed {formatRelativeDate(poll.closedAt)}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Create form (host/moderators only) ── */}
      {canModerate && signedIn ? (
        formOpen ? (
          <form
            className="space-y-2 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createPoll();
            }}
          >
            <p className="text-sm font-medium">Create a poll</p>
            <Input
              aria-label="Poll question"
              placeholder="Ask the room…"
              value={question}
              maxLength={POLL_LABEL_MAX}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {optionDrafts.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${index + 1}`}
                  placeholder={`Option ${index + 1}`}
                  value={value}
                  maxLength={POLL_LABEL_MAX}
                  onChange={(e) =>
                    setOptionDrafts((prev) =>
                      prev.map((v, i) => (i === index ? e.target.value : v)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={optionDrafts.length <= POLL_OPTIONS_MIN}
                  onClick={() =>
                    setOptionDrafts((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="size-11 shrink-0 md:size-8"
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-8"
                disabled={optionDrafts.length >= POLL_OPTIONS_MAX}
                onClick={() => setOptionDrafts((prev) => [...prev, ""])}
              >
                <Plus aria-hidden /> Add option
              </Button>
              <Button type="submit" className="h-11 md:h-8" disabled={creating}>
                {creating && <Loader2 className="animate-spin" aria-hidden />}
                Create poll
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 md:h-8"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Creating a new poll closes the previous one — one open poll per
              session.
            </p>
          </form>
        ) : (
          <Button
            variant="outline"
            className="h-11 w-full md:h-9"
            onClick={() => setFormOpen(true)}
          >
            <Plus aria-hidden /> Create a poll
          </Button>
        )
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Q&A pane — ask, list, answer/hide (moderators).
// ═══════════════════════════════════════════════════════════════════

interface QuestionsPaneProps {
  roomId: string;
  sessionLive: boolean;
  canModerate: boolean;
  signedIn: boolean;
  /** Bumped by every `question` envelope — triggers a refetch. */
  refreshSignal: number;
}

function QuestionsPane({
  roomId,
  sessionLive,
  canModerate,
  signedIn,
  refreshSignal,
}: QuestionsPaneProps) {
  const questionsUrl = `/api/live-rooms/${roomId}/questions${
    canModerate && signedIn ? "?includeHidden=1" : ""
  }`;
  const { data, error, loading, reload } = useApi<{ questions: LiveQuestionDto[] }>(
    questionsUrl,
  );

  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null);
  const [hideTarget, setHideTarget] = useState<LiveQuestionDto | null>(null);

  // Stream question events → one debounced refetch (a burst of asks is
  // one GET, not ten: each tick clears the previous timer).
  useEffect(() => {
    if (refreshSignal <= 0) return;
    const timer = setTimeout(() => reload(), 300);
    return () => clearTimeout(timer);
  }, [refreshSignal, reload]);

  const ask = useCallback(async () => {
    const body = draft.trim();
    if (body.length === 0 || asking) return;
    setAsking(true);
    const payload: CreateLiveQuestionInput = { body };
    const result = await liveFetch<{ question: LiveQuestionDto }>(
      `/api/live-rooms/${roomId}/questions`,
      { body: payload },
    );
    setAsking(false);
    if (!result.ok) {
      const { failure } = result;
      if (failure.code === "forbidden") {
        toast.error(
          failure.message === "muted"
            ? "You are muted"
            : failure.message === "banned"
              ? "You are banned from this room"
              : (failure.message ?? "You can't ask a question right now."),
        );
        return;
      }
      if (failure.code === "rate-limited") {
        toast.error("You're asking too fast", {
          description: "Wait a moment, then try again — the question was not sent.",
        });
        return;
      }
      if (failure.code === "unauthenticated") {
        setAuthLost(true);
        toast.error("Your session ended", {
          description: "Sign in again to ask — the question was not sent.",
        });
        return;
      }
      toastLiveFailure(failure, "The question wasn't sent.");
      return;
    }
    setDraft("");
    toast.success("Question sent", {
      description: "The host and moderators can now see and answer it.",
    });
    reload();
  }, [draft, asking, roomId, reload]);

  const moderateQuestion = useCallback(
    async (questionId: string, action: "answer" | "hide") => {
      setBusyQuestionId(questionId);
      const result = await liveFetch<{ question: LiveQuestionDto }>(
        `/api/live-rooms/${roomId}/questions/${questionId}/${action}`,
      );
      setBusyQuestionId(null);
      if (!result.ok) {
        toastLiveFailure(
          result.failure,
          action === "answer"
            ? "Couldn't mark it answered — nothing changed."
            : "Couldn't hide the question — nothing changed.",
        );
        return;
      }
      toast.success(action === "answer" ? "Marked as answered" : "Question hidden");
      reload();
    },
    [roomId, reload],
  );

  const questions = data?.questions ?? [];

  return (
    <div className="space-y-3">
      {/* ── Ask composer ── */}
      {!signedIn || authLost ? (
        <Button asChild className="h-11 w-full md:h-9">
          <Link href={`/signin?redirect=${encodeURIComponent(`/live/${roomId}`)}`}>
            <LogIn aria-hidden /> Sign in to ask a question
          </Link>
        </Button>
      ) : !sessionLive ? (
        <p
          role="status"
          className="rounded-lg border border-dashed px-3 py-2.5 text-center text-sm text-muted-foreground"
        >
          Questions open when the broadcast is live
        </p>
      ) : (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Textarea
            aria-label="Your question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the host something…"
            maxLength={QUESTION_BODY_MAX}
            rows={2}
            disabled={asking}
            className="min-h-11"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {QUESTION_BODY_MAX - draft.length} characters left
            </span>
            <Button type="submit" size="sm" className="h-11 md:h-8" disabled={asking || draft.trim().length === 0}>
              {asking && <Loader2 className="animate-spin" aria-hidden />}
              Ask
            </Button>
          </div>
        </form>
      )}

      {/* ── Question list ── */}
      {loading ? (
        <div aria-busy="true" aria-label="Loading questions" className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : error !== null ? (
        <div
          role="status"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm"
        >
          Couldn&apos;t load questions ({error}).
          <Button variant="outline" size="sm" className="mt-2 h-11 md:h-8" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : questions.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No questions yet — be the first to ask.
        </p>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Questions">
          {questions.map((q) => {
            const hidden = q.hiddenAt !== null;
            const answered = q.answeredAt !== null;
            return (
              <li
                key={q.id}
                className={cn(
                  "rounded-lg border p-3",
                  hidden && "border-dashed bg-muted/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="min-w-0 max-w-[60%] truncate font-medium text-foreground">
                    @{q.askerHandle}
                  </span>
                  <span className="shrink-0">{formatRelativeDate(q.createdAt)}</span>
                  {answered && (
                    <Badge
                      variant="secondary"
                      className="h-4 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400"
                    >
                      Answered
                    </Badge>
                  )}
                  {hidden && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      Hidden
                    </Badge>
                  )}
                </div>
                <p className={cn("mt-1 break-words text-sm", hidden && "text-muted-foreground")}>
                  {q.body}
                </p>
                {canModerate && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!answered && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-8"
                        disabled={busyQuestionId === q.id}
                        onClick={() => void moderateQuestion(q.id, "answer")}
                      >
                        {busyQuestionId === q.id ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Check aria-hidden />
                        )}
                        Mark answered
                      </Button>
                    )}
                    {!hidden && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-8"
                        disabled={busyQuestionId === q.id}
                        onClick={() => setHideTarget(q)}
                      >
                        <EyeOff aria-hidden /> Hide
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Hide confirmation ── */}
      <AlertDialog
        open={hideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setHideTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this question?</AlertDialogTitle>
            <AlertDialogDescription>
              Hidden questions leave the public list but stay in the audit set
              for moderators. This can&apos;t be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (hideTarget) void moderateQuestion(hideTarget.id, "hide");
              }}
            >
              Hide question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
