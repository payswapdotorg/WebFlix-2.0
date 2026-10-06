"use client";

/**
 * WFX2-P5-YA + P14-YOU — the /you hub (youtube.com's signed-in home base).
 *
 * Guests → the PersonalSurfaceGate signed-out screen (the AU law; the gate's
 * identity-level copy + the /you redirect — the surface union is shared
 * code, so the closest surface is reused rather than editing the gate).
 * Signed-in → the profile header carries the operator's REAL YouTube
 * identity when the operator session is live (/api/studio — avatar image,
 * channel name, @handle, the prominent "View channel" link + a Google
 * Account pill, measured on live youtube.com 2026-10-06); the honest
 * WebFlix-local fallback when it is not. Sections fed by the existing read
 * seams only (real data or honest degradation — never fabricated):
 *   /api/history           → History (the real total + recent strip)
 *   /api/playlists         → Playlists + Watch later + Liked (counts only
 *                            when the read carries them — never fabricated)
 *   /api/studio?enrich=0   → Your videos (the operator channel's public
 *                            uploads — honest degradation in public mode)
 */
import { useApi } from "@/hooks/use-api";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { SessionAvatar } from "@/components/app/account-menu";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { ChevronRight } from "lucide-react";
import {
  HistorySection,
  LikedCard,
  MoreFromRail,
  PlaylistsSection,
  WatchInsightsSection,
  WatchLaterCard,
  YourVideosSection,
  type YouHistoryPayload,
  type YouInsightsPayload,
  type YouPlaylistsPayload,
  type YouStudioPayload,
} from "./sections";
import type { StudioPageDTO } from "@/lib/types";

export default function YouView() {
  return (
    <PersonalSurfaceGate surface="account" redirect="/you">
      <YouContent />
    </PersonalSurfaceGate>
  );
}

function YouContent() {
  const session = useWebFlixSession(); // authenticated here (the gate ran)
  const identity = session.user;

  const history = useApi<YouHistoryPayload>("/api/history");
  const playlists = useApi<YouPlaylistsPayload>("/api/playlists");
  const studio = useApi<YouStudioPayload>("/api/studio?enrich=0");
  // WFX2-P7-AN — the watch analytics seam (real rows only, zero-filled series)
  const insights = useApi<YouInsightsPayload>("/api/watch/insights");

  // P14-YOU: the operator's REAL YouTube identity (avatar image, name,
  // @handle) when the session is live — the honest WebFlix-local fallback
  // otherwise (never fabricated)
  const operator = studio.data?.channel ?? null;
  const operatorHandle = operator
    ? operator.handle.startsWith("@")
      ? operator.handle
      : `@${operator.handle}`
    : null;

  return (
    <div className="pb-10">
      {/* the profile header — youtube.com's /you shape: large avatar, name,
          "@handle · View channel", the Google Account pill (measured live) */}
      <header
        className="flex flex-col items-center gap-4 px-4 py-10 sm:flex-row sm:gap-6 sm:px-6"
        data-testid="you-profile-header"
      >
        {operator ? (
          <img
            src={operator.avatarUrl}
            alt=""
            className="size-20 rounded-full object-cover sm:size-28"
            data-testid="you-operator-avatar"
          />
        ) : (
          <SessionAvatar
            displayName={identity?.displayName ?? ""}
            avatarSeed={identity?.avatarSeed ?? 0}
            size="size-20 text-2xl sm:size-28 sm:text-3xl"
          />
        )}
        <div className="min-w-0 text-center sm:text-left">
          <h1 className="truncate text-2xl font-bold sm:text-4xl" data-testid="you-display-name">
            {operator ? operator.name : identity?.displayName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-muted-foreground sm:justify-start">
            {operator ? (
              <>
                <span className="truncate" data-testid="you-operator-handle">
                  {operatorHandle}
                </span>
                <span aria-hidden>·</span>
                <a
                  href={`/channel/${operator.handle}`}
                  className="inline-flex min-h-9 items-center gap-0.5 font-medium text-primary hover:underline"
                  data-testid="you-view-channel"
                >
                  View channel
                  <ChevronRight className="size-4" aria-hidden />
                </a>
              </>
            ) : (
              <span className="truncate">{identity?.email}</span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <a
              href="/account"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Google Account
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <HistorySection state={history} />
        <PlaylistsSection state={playlists} />
        <WatchInsightsSection state={insights} />
        <YourVideosSection state={studio} />
        <div className="grid gap-4 px-4 sm:grid-cols-2 sm:px-6">
          <WatchLaterCard state={playlists} />
          <LikedCard state={playlists} />
        </div>
        <MoreFromRail />
      </div>
    </div>
  );
}
