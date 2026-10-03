"use client";

/**
 * WFX2-P5-YA — the /you hub (youtube.com's signed-in home base).
 *
 * Guests → the PersonalSurfaceGate signed-out screen (the AU law; the gate's
 * identity-level copy + the /you redirect — the surface union is shared
 * code, so the closest surface is reused rather than editing the gate).
 * Signed-in → the profile header (the WebFlix identity, the session's real
 * data) + sections fed by the existing read seams only:
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

  return (
    <div className="pb-10">
      {/* the profile header — the WebFlix identity (the session's real data) */}
      <header
        className="flex flex-col items-center gap-4 px-4 py-10 sm:flex-row sm:gap-6 sm:px-6"
        data-testid="you-profile-header"
      >
        <SessionAvatar
          displayName={identity?.displayName ?? ""}
          avatarSeed={identity?.avatarSeed ?? 0}
          size="size-20 text-2xl"
        />
        <div className="min-w-0 text-center sm:text-left">
          <h1 className="truncate text-2xl font-bold" data-testid="you-display-name">
            {identity?.displayName}
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{identity?.email}</p>
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <HistorySection state={history} />
        <WatchInsightsSection state={insights} />
        <PlaylistsSection state={playlists} />
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
