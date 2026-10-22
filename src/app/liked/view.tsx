"use client";

import Link from "next/link";
import { ThumbsUp } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoDTO } from "@/lib/types";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

type LikedPayload = {
  videos: VideoDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  unavailable: boolean;
  session: boolean;
  /** WFX2-P36: the per-user truth — false → the connect link in the notice */
  connected?: boolean;
  /** WFX2-P38: the deployment truth — false → NO connect link (the errand is
   * impossible on a deployment without the Google OAuth env) */
  oauthConfigured?: boolean;
  /** WFX2-P36: the honest per-user notice (no official liked-list API) */
  notice?: string;
};

/** WFX2-P36 — the honest per-user notice banner: the route's notice text,
 * plus the connect link when the acting user has no connected account. */
function LikedNoticeBanner({ payload }: { payload: LikedPayload }) {
  if (!payload.notice) return null;
  return (
    <div
      className="mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-secondary/40 px-4 py-3 sm:mx-6"
      role="status"
      data-testid="liked-notice"
    >
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{payload.notice}</p>
      {/* WFX2-P38 — the connect link ONLY on a deployment where connecting is
          actually possible (oauthConfigured !== false) */}
      {payload.connected === false && payload.oauthConfigured !== false && (
        <Link
          href="/settings"
          className="shrink-0 text-sm font-medium text-foreground underline underline-offset-2"
        >
          Connect your YouTube account
        </Link>
      )}
    </div>
  );
}

/** Liked videos — WFX2-P36: the honest per-user surface. The list of videos
 * you liked on YouTube has no official API (your LIKE BUTTON still acts on
 * your own account through the official lane) — the notice banner hands the
 * list off to youtube.com/feed/liked, and no one else's list is ever read
 * (the pre-P36 operator-session read is retired).
 * WFX2-P2-AU: guests get the youtube.com signed-out screen (the gate). */
export default function LikedPage() {
  return (
    <PersonalSurfaceGate surface="liked">
      <LikedContent />
    </PersonalSurfaceGate>
  );
}

function LikedContent() {
  const { data, loading, error } = useApi<LikedPayload>("/api/liked");
  const videos = data?.videos ?? [];

  return (
    <div className="pb-6">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <ThumbsUp className="size-7 text-yt-red" /> Liked videos
      </h1>

      {loading && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && <LikedNoticeBanner payload={data} />}
      {data && (data.unavailable || data.loginRequired) && !data.notice && (
        <div className="px-4 py-16 text-center sm:px-6" role="status">
          <p className="text-lg font-medium">Liked videos are unavailable right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your liked list could not be read just now — try again shortly, or open it on
            youtube.com.
          </p>
        </div>
      )}
      {data && !data.loginRequired && !data.unavailable && videos.length === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Your liked list lives on YouTube</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The list of videos you liked has no official API — your likes still act on your
            account (the like button);{" "}
            <a
              href="https://www.youtube.com/feed/liked"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              youtube.com/feed/liked
            </a>{" "}
            has the list.
          </p>
        </div>
      )}
      {videos.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
