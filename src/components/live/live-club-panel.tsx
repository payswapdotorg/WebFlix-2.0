"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 — Lane 5-c (UI lane): the viewer room's
 * fan-club panel (work order issue #2; ADR-0010).
 *
 * THE NON-MONETARY LAW (ADR-0010 §1), enforced on every surface here:
 * points, levels and missions are ENTERTAINMENT facts. Nothing in this
 * panel is money, a wallet, or convertible — the "Fan points — no cash
 * value" label is part of the contract wherever points render, never
 * styled away, and no "coins" language exists anywhere in this file.
 *
 * Honest-state law (work order principle #8), applied end to end:
 * - the club data comes ONLY from GET /api/live-clubs/[hostId] via
 *   useLiveClub (frozen DTOs in, no invented fields, no client-claimed
 *   points — the optimistic join window shows the frozen derivation floor
 *   labelled "syncing…", never a fabricated server answer);
 * - 404 renders the honest "no club yet" empty state; the create CTA is
 *   the HOST's alone;
 * - a load failure renders a real error with a working Retry;
 * - join/leave are optimistic intents with rollback: a failed POST reverts
 *   the view and renders the server's honest error copy — a disabled or
 *   failed action never fakes success;
 * - signed-out callers get a sign-in prompt, not a disabled mystery.
 *
 * Missions are derived server-side (ADR-0010 §7) — this panel only renders
 * their rows. The roster is a bounded preview with the long-list law:
 * max-h-96 overflow-y-auto on the codebase's slim scrollbar.
 */

import { useState } from "react";
import type { JSX } from "react";
import { Loader2, LogIn, LogOut, RefreshCw, Users } from "lucide-react";
import Link from "next/link";
import { useLiveClub } from "@/hooks/use-live-club";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Frozen numeric law — mirrors src/lib/live/permissions.ts CLUB_NAME_MAX /
 * CLUB_MOTTO_MAX (mirrored, not imported: permissions.ts is server-only —
 * it imports the Prisma client — and this is a client component).
 */
const CLUB_NAME_MAX = 40;
const CLUB_MOTTO_MAX = 120;

export interface LiveClubPanelProps {
  /** The room's hostId — the club key (one club per creator, frozen law). */
  hostId: string | null;
  hostHandle?: string | null;
  hostName?: string | null;
  signedIn: boolean;
  /** This viewer IS the room's host → the empty state carries the CTA. */
  isHost?: boolean;
  /** Where the sign-in CTA leads (the view passes a room-scoped redirect). */
  signInHref?: string;
  className?: string;
}

export function LiveClubPanel({
  hostId,
  hostHandle,
  hostName,
  signedIn,
  isHost = false,
  signInHref = "/signin",
  className,
}: LiveClubPanelProps): JSX.Element | null {
  const club = useLiveClub(hostId);
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");

  if (hostId === null) return null;

  // ── Loading (first fetch for this host; no stale card underneath) ──
  if (club.loading) {
    return (
      <Card
        className={cn("min-w-0 w-full gap-4", className)}
        data-testid="club-loading"
        aria-busy="true"
      >
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Fan club
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ── Load error — a real failure with a working Retry, never a fake club ──
  if (club.loadError !== null) {
    return (
      <Card className={cn("min-w-0 w-full gap-4", className)} data-testid="club-error">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Fan club
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="alert" className="text-sm text-muted-foreground">
            Couldn&apos;t load the fan club —{" "}
            {club.loadErrorMessage ?? `the server answered “${club.loadError}”`}. This is a real
            failure, not an empty club.
          </p>
          <Button
            variant="outline"
            size="sm"
            data-testid="club-retry"
            onClick={club.refresh}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── No club yet — the honest empty state; the create CTA is host-only ──
  if (club.clubMissing) {
    return (
      <Card className={cn("min-w-0 w-full gap-4", className)} data-testid="club-empty">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Fan club
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {hostName ?? "This creator"} hasn&apos;t started a fan club yet.
          </p>
          {isHost && signedIn && (
            <div className="space-y-2" data-testid="club-create-form">
              <p className="text-sm font-medium text-foreground">Start your fan club</p>
              <Input
                aria-label="Club name"
                placeholder="Club name"
                value={name}
                maxLength={CLUB_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                aria-label="Club motto (optional)"
                placeholder="Motto (optional)"
                value={motto}
                maxLength={CLUB_MOTTO_MAX}
                onChange={(e) => setMotto(e.target.value)}
              />
              <Button
                data-testid="club-create"
                disabled={club.createBusy || name.trim().length === 0}
                onClick={() =>
                  void club.create({
                    name: name.trim(),
                    ...(motto.trim() ? { motto: motto.trim() } : {}),
                  })
                }
              >
                {club.createBusy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Users aria-hidden />
                )}
                {club.createBusy ? "Creating…" : "Create fan club"}
              </Button>
              {club.actionError !== null && (
                <p role="alert" data-testid="club-create-error" className="text-sm text-destructive">
                  {club.actionError.copy}
                </p>
              )}
            </div>
          )}
          {isHost && !signedIn && (
            <Button asChild data-testid="club-host-signin">
              <Link href={signInHref}>
                <LogIn aria-hidden /> Sign in to create your fan club
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Ready ──
  const overview = club.overview;
  if (!overview) return null;
  const membership = club.visibleMembership;

  return (
    <Card className={cn("min-w-0 w-full gap-4", className)} data-testid="live-club-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-0">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate" data-testid="club-name">
            {overview.club.name}
          </span>
        </CardTitle>
        {/* The ADR-0010 label — part of the contract, never omitted. */}
        <p
          data-testid="club-points-note"
          className="inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
        >
          Fan points — no cash value
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {hostName ?? overview.club.hostName}{" "}
            {hostHandle ? `· @${hostHandle}` : `· @${overview.club.hostHandle}`}{" "}
            ·{" "}
            <span data-testid="club-member-count" className="tabular-nums">
              {overview.club.memberCount}
            </span>{" "}
            members
          </p>
          {overview.club.motto && (
            <p className="break-words text-sm italic text-muted-foreground/90">
              “{overview.club.motto}”
            </p>
          )}
          {overview.liveRoom && (
            <Link
              href={`/live/${overview.liveRoom.id}`}
              data-testid="club-live-link"
              className="inline-block text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              {overview.club.hostName} is live — join the room
            </Link>
          )}
        </div>

        {/* ── Membership: member card / join CTA / sign-in prompt ── */}
        {membership ? (
          <div className="space-y-2 rounded-lg border p-3" data-testid="club-member-card">
            <p className="text-sm font-medium text-foreground">
              You&apos;re in {overview.club.hostName}&apos;s fan club
            </p>
            <p className="text-sm text-muted-foreground">
              <span data-testid="club-my-level" className="font-semibold text-foreground">
                Level {membership.level}
              </span>
              {" · "}
              <span data-testid="club-my-points" className="tabular-nums">
                {membership.points} fan points
              </span>
            </p>
            {membership.syncing && (
              <p role="status" className="text-xs text-muted-foreground">
                Syncing your membership…
              </p>
            )}
            {!isHost && (
              <Button
                variant="outline"
                size="sm"
                data-testid="club-leave"
                disabled={club.leaveBusy}
                onClick={() => void club.leave()}
              >
                {club.leaveBusy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <LogOut aria-hidden />
                )}
                {club.leaveBusy ? "Leaving…" : "Leave the club"}
              </Button>
            )}
          </div>
        ) : isHost ? (
          <p className="text-sm text-muted-foreground" data-testid="club-host-note">
            This is your club — manage it from the studio console while you&apos;re live.
          </p>
        ) : !signedIn ? (
          <Button asChild className="w-full" data-testid="club-signin">
            <Link href={signInHref}>
              <LogIn aria-hidden /> Sign in to join the fan club
            </Link>
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              className="w-full"
              data-testid="club-join"
              disabled={club.joinBusy}
              onClick={() => void club.join()}
            >
              {club.joinBusy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Users aria-hidden />
              )}
              {club.joinBusy ? "Joining…" : "Join the fan club"}
            </Button>
            {club.actionError !== null && (
              <p role="alert" data-testid="club-action-error" className="text-sm text-destructive">
                {club.actionError.copy}
              </p>
            )}
          </div>
        )}

        {/* ── Missions — derived server-side; this panel only renders ── */}
        <div className="space-y-1.5" data-testid="club-missions">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Missions
          </p>
          {overview.missions.map((mission) => (
            <div
              key={mission.key}
              data-testid="club-mission"
              data-done={mission.done ? "true" : "false"}
              className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{mission.label}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                {mission.done && <Badge variant="secondary">Done</Badge>}
                {mission.progress}/{mission.goal}
              </span>
            </div>
          ))}
        </div>

        {/* ── Top members — the bounded preview, long-list law applied ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top members
          </p>
          {overview.topMembers.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              No members yet — be the first to join.
            </p>
          ) : (
            <ul
              aria-label="Top members"
              data-testid="club-member-list"
              className="slim-scrollbar max-h-96 space-y-1 overflow-y-auto pr-1"
            >
              {overview.topMembers.map((member, index) => (
                <li
                  key={member.userId}
                  data-testid="club-member"
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {member.name}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      @{member.handle}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    Lv {member.level} · {member.points} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The ADR-0010 framing — under every surface that shows points. */}
        <p
          data-testid="club-cash-note"
          className="px-1 text-[11px] leading-relaxed text-muted-foreground/80"
        >
          Fan points are entertainment facts — no cash value, nothing to buy, nothing to
          convert.
        </p>
      </CardContent>
    </Card>
  );
}
