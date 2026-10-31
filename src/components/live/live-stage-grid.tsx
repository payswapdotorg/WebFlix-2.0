"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 — Worker 3-d (UI lane): the stage roster grid
 * (work order §4D, the presentation half of the guest-run law).
 *
 * Props-driven law (same as every panel in this lane): the viewer room page
 * passes the `LiveStageDto` slice it derived from its ONE page-level stream
 * (`stage` envelopes); this component NEVER subscribes, fetches, or mutates.
 *
 * Honest-state rendering:
 * - `stage` null renders nothing — no fake stage is invented;
 * - the roster renders in the dto's order (the server already puts the host
 *   first) — the client never re-orders the server's roster;
 * - muted state tags name the REAL state: "reconnecting…" (disconnected) and
 *   "removed by host" (removed) — the ui never hides a removal;
 * - the guest-slot count follows the frozen law: slots are occupied by guests
 *   whose state is NOT `removed`, and the cap comes from `stage.guestsMax`
 *   (never a hardcoded 4);
 * - `guestsEnabled === false` shows the honest "Guests are disabled by the
 *   host" line — a policy fact, not an error.
 */

import type { JSX } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  LiveStageDto,
  LiveStageParticipantDto,
  LiveParticipantState,
} from "@/lib/live/types";

/**
 * Deterministic avatar palette keyed by a hash of the participant's userId —
 * the SAME identity always gets the SAME color, client and server renders
 * alike (no Math.random, no hydration drift).
 */
const AVATAR_COLORS: ReadonlyArray<string> = [
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  "bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300",
];

function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

/** The muted state tag copy — "connected" renders no tag at all. */
const STATE_TAGS: ReadonlyMap<LiveParticipantState, string> = new Map([
  ["disconnected", "reconnecting…"],
  ["removed", "removed by host"],
]);

function StageTile({ participant }: { participant: LiveStageParticipantDto }): JSX.Element {
  const stateTag = STATE_TAGS.get(participant.state) ?? null;
  return (
    <li
      data-testid="stage-tile"
      data-role={participant.role}
      data-state={participant.state}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3",
        participant.state === "removed" && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          avatarColor(participant.userId),
        )}
      >
        {initialOf(participant.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight text-foreground">
          {participant.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">@{participant.handle}</p>
        {stateTag !== null && (
          <p
            role="status"
            data-testid="stage-state-tag"
            className="mt-0.5 text-[11px] font-medium italic text-muted-foreground"
          >
            {stateTag}
          </p>
        )}
      </div>
      <Badge
        variant={participant.role === "host" ? "default" : "secondary"}
        data-testid="stage-role"
      >
        {participant.role === "host" ? "Host" : "Guest"}
      </Badge>
    </li>
  );
}

export interface LiveStageGridProps {
  stage: LiveStageDto | null;
  className?: string;
}

export function LiveStageGrid({ stage, className }: LiveStageGridProps): JSX.Element | null {
  if (!stage) return null;

  // Frozen slot law: a slot is occupied by a guest whose state is NOT
  // "removed" on the active session. The cap is the dto's guestsMax.
  const occupiedGuests = stage.participants.filter(
    (p) => p.role === "guest" && p.state !== "removed",
  ).length;
  const solo =
    stage.participants.length === 1 && stage.participants[0]?.role === "host";

  return (
    <Card className={cn("min-w-0 gap-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="text-base">Stage</CardTitle>
        <span
          data-testid="stage-slots"
          className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground"
        >
          {occupiedGuests} / {stage.guestsMax} guest slots
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {stage.guestsEnabled === false && (
          <p
            role="note"
            data-testid="stage-guests-disabled"
            className="rounded-lg border border-dashed px-3 py-2 text-center text-sm text-muted-foreground"
          >
            Guests are disabled by the host
          </p>
        )}

        <ul
          aria-label="Stage roster"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {stage.participants.map((p) => (
            <StageTile key={p.userId} participant={p} />
          ))}
        </ul>

        {solo && (
          <p
            role="status"
            data-testid="stage-solo"
            className="text-xs text-muted-foreground"
          >
            Solo broadcast — the host is alone on stage
          </p>
        )}
      </CardContent>
    </Card>
  );
}
