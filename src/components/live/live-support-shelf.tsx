"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P70 — the room's SUPPORT SHELF (the
 * TikTok-parity layer, ADR-0012): the Top-supporters wall (P70-2) and the
 * LIVE goal card (P70-3), the room's non-monetary recognition surfaces.
 *
 * Presentation-only law: every number arrives from the server (the wall is
 * the room GET's `topGifters` SUM; the goal's `progress` is the server's
 * read-time derivation). This component never invents a number, never
 * claims one. The non-monetary sandbox label rides the wall verbatim
 * (ADR-0007 extends: DEV credits, zero cash value).
 */
import type { JSX } from "react";
import { Flame, Goal, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { LiveGoalDto, LiveTopGifterDto } from "@/lib/live/types";

/** The Top-supporters wall — up to GIFT_WALL_MAX rows, server order verbatim. */
export function LiveTopSupporters({
  topGifters,
  className,
}: {
  topGifters: LiveTopGifterDto[];
  className?: string;
}): JSX.Element {
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Trophy className="size-4 text-muted-foreground" aria-hidden />
          Top supporters
        </CardTitle>
        <p
          data-testid="top-supporters-sandbox-label"
          className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400"
        >
          Dev credits — no cash value
        </p>
      </CardHeader>
      <CardContent>
        {topGifters.length === 0 ? (
          <p
            data-testid="top-supporters-empty"
            className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground"
          >
            No supporters yet — gifts land here
          </p>
        ) : (
          <ol data-testid="top-supporters-list" className="space-y-1.5">
            {topGifters.map((g, i) => (
              <li
                key={g.userId}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-label={`Rank ${i + 1}`}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums text-muted-foreground"
                  >
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-foreground">{g.displayName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">@{g.handle}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                  {g.totalCredits} dev credits
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const GOAL_KIND_LABEL: Record<LiveGoalDto["kind"], string> = {
  hearts: "hearts",
  giftCredits: "dev credits gifted",
  chat: "chat messages",
};

/**
 * The LIVE goal card — the OPEN goal's derived progress (the celebration
 * line when reached; the honest empty state when the host hasn't started
 * one). Closed goals stay in the room's history, not on this card.
 */
export function LiveGoalCard({
  goals,
  className,
}: {
  goals: LiveGoalDto[];
  className?: string;
}): JSX.Element {
  const open = goals.find((g) => g.status === "open") ?? null;
  const reached = goals.find((g) => g.status === "reached") ?? null;
  const current = open ?? reached;
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Goal className="size-4 text-muted-foreground" aria-hidden />
          LIVE goal
        </CardTitle>
        {current?.status === "reached" && (
          <p
            data-testid="goal-reached-badge"
            className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary"
          >
            <Flame className="size-3" aria-hidden />
            Goal reached
          </p>
        )}
      </CardHeader>
      <CardContent>
        {!current ? (
          <p
            data-testid="goal-empty"
            className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground"
          >
            No goal right now — the host can start one from the console
          </p>
        ) : (
          <div className="space-y-2" data-testid="goal-card">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">
                {current.title ?? "Room goal"}
              </p>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {Math.min(current.progress, current.target)} / {current.target}{" "}
                {GOAL_KIND_LABEL[current.kind]}
              </p>
            </div>
            <Progress
              value={Math.min(100, Math.round((current.progress / Math.max(current.target, 1)) * 100))}
              aria-label={`Goal progress ${current.progress} of ${current.target}`}
            />
            {current.status === "reached" && (
              <p data-testid="goal-celebration" className="text-xs font-medium text-primary">
                Goal reached — thanks for the support!
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
