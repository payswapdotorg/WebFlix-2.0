"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P70-3 — the HOST console's LIVE-goal manager
 * (the TikTok-parity layer, ADR-0012): start the room's goal (kind +
 * target + optional title), watch its derived progress, close it, start the
 * next one. ONE open goal per room is the SERVER's law — the 409 renders
 * honestly here, it is never prevented client-side.
 *
 * Presentation law: the goal state is fetched (GET) and updated by the
 * room's `goal` stream envelopes via the page's ONE stream (the envelope
 * arrives through `latestEnvelope`); every number rendered is the server's
 * derivation. This component NEVER invents progress.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Goal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { liveFetch, toastLiveFailure } from "@/components/live/use-live-stream";
import type { LiveGoalDto, LiveStreamEvent } from "@/lib/live/types";

const GOAL_TARGET_MAX = 100_000; // mirrors permissions.ts GOAL_TARGET_MAX
const GOAL_TITLE_MAX = 80; // mirrors permissions.ts GOAL_TITLE_MAX

const KIND_OPTIONS: { value: LiveGoalDto["kind"]; label: string }[] = [
  { value: "hearts", label: "Hearts (reactions)" },
  { value: "giftCredits", label: "Dev credits gifted" },
  { value: "chat", label: "Chat messages" },
];

export function LiveGoalManager({
  roomId,
  latestEnvelope,
}: {
  roomId: string;
  latestEnvelope: LiveStreamEvent | null;
}): JSX.Element {
  const [goals, setGoals] = useState<LiveGoalDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<LiveGoalDto["kind"]>("hearts");
  const [target, setTarget] = useState("100");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await liveFetch<{ goals: LiveGoalDto[] }>(`/api/live-rooms/${roomId}/goals`, {
      method: "GET",
    });
    if (res.ok) {
      setGoals(res.data.goals);
      setError(null);
    } else if (res.failure.status !== 0) {
      // a real HTTP answer is honest state; network noise stays silent (the
      // next envelope/reload re-derives)
      setError("Couldn't load the room's goals.");
    }
    setLoaded(true);
  }, [roomId]);

  useEffect(() => {
    // Deferred to a timer callback (external-system subscription shape —
    // the fetch's setState must not land in the effect body).
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // Stream law: a `goal` envelope IS the fresh state (create/progress/reach/
  // close all publish it) — adopt it verbatim, no refetch race. The seen-id
  // latch is the React-documented render-phase adjustment (the same pattern
  // the stream hook and the console's recording latch use): guarded by the
  // previously seen value, never an effect, never a ref read during render.
  const [lastGoalEventId, setLastGoalEventId] = useState<string | null>(null);
  if (
    latestEnvelope &&
    latestEnvelope.kind === "goal" &&
    latestEnvelope.eventId !== lastGoalEventId
  ) {
    setLastGoalEventId(latestEnvelope.eventId);
    const incoming = latestEnvelope.goal;
    setGoals((prev) => [incoming, ...prev.filter((g) => g.id !== incoming.id)].slice(0, 10));
  }

  const open = goals.find((g) => g.status === "open") ?? null;
  const reached = goals.find((g) => g.status === "reached") ?? null;
  const current = open ?? reached;

  const create = useCallback(async () => {
    setBusy(true);
    const parsed = Math.trunc(Number(target));
    const res = await liveFetch<{ goal: LiveGoalDto }>(`/api/live-rooms/${roomId}/goals`, {
      body: {
        kind,
        target: Number.isFinite(parsed) ? parsed : 0,
        ...(title.trim() !== "" ? { title: title.trim().slice(0, GOAL_TITLE_MAX) } : {}),
      },
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setGoals((prev) => [res.data.goal, ...prev].slice(0, 10));
      setError(null);
    } else {
      if (res.failure.code === "conflict") {
        setError("This room already has an open goal — close it first.");
      } else if (res.failure.code === "invalid") {
        setError(`Target must be 1..${GOAL_TARGET_MAX}.`);
      } else {
        toastLiveFailure(res.failure, "The goal didn't start.");
      }
    }
  }, [kind, roomId, target, title]);

  const close = useCallback(
    async (goalId: string) => {
      setBusy(true);
      const res = await liveFetch<{ goal: LiveGoalDto }>(
        `/api/live-rooms/${roomId}/goals?goalId=${encodeURIComponent(goalId)}`,
        { method: "DELETE" },
      );
      setBusy(false);
      if (res.ok) {
        setGoals((prev) => prev.map((g) => (g.id === res.data.goal.id ? res.data.goal : g)));
        setError(null);
      } else {
        toastLiveFailure(res.failure, "The goal didn't close.");
      }
    },
    [roomId],
  );

  const parsedTarget = Math.trunc(Number(target));
  const createDisabled =
    busy || !Number.isFinite(parsedTarget) || parsedTarget < 1 || parsedTarget > GOAL_TARGET_MAX;

  return (
    <Card data-testid="live-goal-manager" className="min-w-0 gap-4">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Goal className="size-4 text-muted-foreground" aria-hidden />
          LIVE goal
        </CardTitle>
        <CardDescription>
          Set a target your room chases together — hearts, dev credits gifted, or chat messages
          since the goal started. Progress derives from the room&apos;s real activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {current ? (
          <div className="space-y-2" data-testid="goal-manager-current">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium">
                {current.title ?? "Room goal"}
                <span className="ml-1.5 text-xs font-normal uppercase text-muted-foreground">
                  {current.status}
                </span>
              </p>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {Math.min(current.progress, current.target)} / {current.target}
              </p>
            </div>
            <Progress
              value={Math.min(100, Math.round((current.progress / Math.max(current.target, 1)) * 100))}
              aria-label={`Goal progress ${current.progress} of ${current.target}`}
            />
            {current.status === "reached" && (
              <p data-testid="goal-manager-reached" className="text-xs font-medium text-primary">
                Goal reached — close it to start the next one.
              </p>
            )}
            <Button
              data-testid="goal-manager-close"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void close(current.id)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Close goal
            </Button>
          </div>
        ) : (
          <div className="space-y-2" data-testid="goal-manager-create">
            <div className="flex flex-wrap gap-2">
              <Select value={kind} onValueChange={(v) => setKind(v as LiveGoalDto["kind"])}>
                <SelectTrigger
                  data-testid="goal-manager-kind"
                  aria-label="Goal kind"
                  className="h-9 w-full max-w-56"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                data-testid="goal-manager-target"
                aria-label="Goal target"
                inputMode="numeric"
                placeholder={`Target (1..${GOAL_TARGET_MAX})`}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <Input
              data-testid="goal-manager-title"
              aria-label="Goal title (optional)"
              placeholder="Title (optional)"
              value={title}
              maxLength={GOAL_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className="h-9"
            />
            <Button
              data-testid="goal-manager-start"
              size="sm"
              disabled={createDisabled}
              onClick={() => void create()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Start goal
            </Button>
            {!loaded && <p className="text-xs text-muted-foreground">Loading goals…</p>}
          </div>
        )}
        {error && (
          <p role="alert" data-testid="goal-manager-error" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
