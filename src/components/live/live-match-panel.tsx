"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 — Worker 3-d (UI lane): the server-
 * authoritative match panel (work order §4E).
 *
 * Scoring-law boundaries, client side:
 * - the panel renders ONLY dto numbers — `team.score` is the server's
 *   SUM over the append-only ScoreEvents; there is NO local score
 *   mutation anywhere in this file (the client never invents a point);
 * - the countdown is the one thing that ticks locally, and it is
 *   anchored honestly: remaining = endsAt − serverNow, both ISO strings
 *   straight from the dto, computed ONCE at first render (deterministic
 *   SSR/hydration — no Date.now() in the render path), then decremented
 *   by a setInterval started AFTER mount. A fresh snapshot (new
 *   serverNow) re-anchors the local tick to the server's clock;
 * - wall-clock expiry before the lazy timeout lands renders "Ending…",
 *   never a negative number and never a self-declared result — the
 *   winner comes from `winnerTeamId` (server-derived) only;
 * - terminal statuses are terminal: no LIVE badge, no ticking, and a
 *   cancelled match shows its banked scores muted with no winner.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Swords, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LiveMatchDto, LiveMatchTeamDto } from "@/lib/live/types";

/** remaining = endsAt − serverNow, both from the dto (never Date.now). */
function computeRemainingSeconds(match: LiveMatchDto): number {
  const endsMs = Date.parse(match.endsAt);
  const nowMs = Date.parse(match.serverNow);
  if (Number.isNaN(endsMs) || Number.isNaN(nowMs)) return 0;
  return Math.floor((endsMs - nowMs) / 1000);
}

/** 125 → "2:05", 3725 → "1:02:05". Clamped at zero by the caller. */
function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** The dto always carries a label; the fallback keeps the arity honest. */
function teamLabel(team: LiveMatchTeamDto): string {
  const trimmed = team.label.trim();
  if (trimmed.length > 0) return trimmed;
  return team.position === 1 ? "Team A" : `Team ${team.position}`;
}

function policyLine(match: LiveMatchDto): string {
  const parts: string[] = [];
  if (match.scoring.reactions) parts.push("Taps count");
  if (match.scoring.gifts) parts.push("Gifts count");
  return parts.length > 0 ? parts.join(" · ") : "No scoring inputs";
}

export interface LiveMatchPanelProps {
  match: LiveMatchDto | null;
  className?: string;
}

export function LiveMatchPanel({ match, className }: LiveMatchPanelProps): JSX.Element | null {
  // The local tick is seeded from the dto's OWN clocks (hydration-safe:
  // the first server render and the first client render agree exactly).
  const [secondsLeft, setSecondsLeft] = useState(() =>
    match ? computeRemainingSeconds(match) : 0,
  );
  // The serverNow the local tick was anchored against — a snapshot with a
  // fresher serverNow re-anchors (React-documented render-phase state
  // adjustment, guarded by the previous value; same pattern as the stream
  // hook's room change).
  const [anchoredServerNow, setAnchoredServerNow] = useState(match?.serverNow ?? "");
  if (match && match.serverNow !== anchoredServerNow) {
    setAnchoredServerNow(match.serverNow);
    setSecondsLeft(computeRemainingSeconds(match));
  }

  // The ONLY local mutation: the countdown decrements after mount, while
  // the match is active. Scores are never touched.
  const isActive = match !== null && match.status === "active";
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  if (!match) return null;

  const ended = match.status === "ended";
  const cancelled = match.status === "cancelled";
  const scoresMuted = cancelled; // banked but muted
  const winner = match.winnerTeamId !== null
    ? match.teams.find((t) => t.id === match.winnerTeamId) ?? null
    : null;
  const countdown =
    secondsLeft > 0 ? `Ends in ${formatCountdown(secondsLeft)}` : "Ending…";

  return (
    <Card className={cn("min-w-0 gap-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="size-4 text-muted-foreground" aria-hidden />
          {match.kind === "team" ? "Team match" : "Solo match"}
        </CardTitle>
        {isActive && (
          <Badge variant="destructive" data-testid="match-live-badge">
            LIVE
          </Badge>
        )}
        {ended && (
          <Badge variant="secondary" data-testid="match-ended-badge">
            Ended
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Result banners — server-derived only (winnerTeamId), never guessed. */}
        {ended && (
          <p
            role="status"
            data-testid="match-result"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground"
          >
            <Trophy className="size-4 text-amber-500" aria-hidden />
            {match.winnerTeamId === null ? "Draw" : winner ? `${teamLabel(winner)} wins` : "Match ended"}
          </p>
        )}
        {cancelled && (
          <p
            role="status"
            data-testid="match-cancelled"
            className="rounded-lg border border-dashed px-3 py-2 text-center text-sm font-medium text-muted-foreground"
          >
            Match cancelled — no winner was recorded
          </p>
        )}

        {/* Team standings — the big numbers are the server's computed SUMs. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="match-teams">
          {match.teams.map((team) => (
            <div
              key={team.id}
              data-testid="match-team"
              className={cn(
                "rounded-lg border p-4 transition-colors",
                ended && winner?.id === team.id && "border-primary/60 bg-primary/5",
                scoresMuted && "opacity-60",
              )}
            >
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {teamLabel(team)}
              </p>
              <p
                data-testid="team-score"
                aria-label={`${teamLabel(team)} score: ${team.score}`}
                className="mt-1 text-3xl font-bold tabular-nums text-foreground"
              >
                {team.score}
              </p>
              {team.members.length > 0 && (
                <ul className="mt-2 space-y-0.5" aria-label={`${teamLabel(team)} members`}>
                  {team.members.map((member) => (
                    <li
                      key={member.userId}
                      className={cn(
                        "truncate text-xs text-muted-foreground",
                        member.leftAt !== null && "italic opacity-75",
                      )}
                    >
                      {member.name}
                      {member.leftAt !== null ? " (left)" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Countdown ticks locally while active; wall-clock-past → "Ending…". */}
        {isActive && (
          <p
            role="timer"
            data-testid="match-countdown"
            className="text-center text-sm font-semibold tabular-nums text-foreground"
          >
            {countdown}
          </p>
        )}
        <p
          data-testid="match-policy"
          className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {policyLine(match)}
        </p>
      </CardContent>
    </Card>
  );
}
