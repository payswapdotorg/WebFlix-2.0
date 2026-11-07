"use client";

/**
 * P100-TIKTOK-LIVE — the in-app live surface (/tiktok/<handle>/live): the
 * answer to G24. Every state is honest:
 *  - probing → "Checking whether @handle is live…" (never a fake offline);
 *  - live → the LIVE panel: badge, real room data, the playback ladder
 *    (native hls rung → honest fallback rung), the watch-party chat, and
 *    the outbound TikTok actions (labeled as leaving WebFlix — no TikTok
 *    write is claimed or performed);
 *  - offline → "not live right now" (real cached data, outbound link);
 *  - degraded → the API's real error copy (502/503), poller stopped.
 */
import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Gift, MessageSquare, Radio, TriangleAlert } from "lucide-react";

import { useTikTokLiveStatus } from "@/hooks/use-tiktok-live-status";
import { TikTokLivePlayer } from "@/components/tiktok/tiktok-live-player";
import { TikTokLiveChatPanel } from "@/components/tiktok/tiktok-live-chat";
import { TikTokThumbnailImage } from "@/components/tiktok/tiktok-thumbnail-image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatRelativeDate } from "@/lib/format";
import { isTikTokHandle, normalizeTikTokHandle, tiktokChannelHref, tiktokLiveRoomUrl } from "@/lib/tiktok/urls";

function OutboundTikTokLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

export function TikTokLiveView({
  rawHandle,
  pollIntervalMs = 6_000,
  chatPollMs = 4_000,
}: {
  rawHandle: string;
  pollIntervalMs?: number;
  chatPollMs?: number;
}) {
  let decoded = rawHandle ?? "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* the raw form rides */
  }
  const handle = normalizeTikTokHandle(decoded);
  const valid = Boolean(handle) && isTikTokHandle(handle);
  const { status, error } = useTikTokLiveStatus(valid ? handle : null, pollIntervalMs);
  const [playbackFailed, setPlaybackFailed] = useState(false);

  const outboundUrl = (() => {
    try {
      return tiktokLiveRoomUrl(handle);
    } catch {
      // the URL law throws only for an invalid handle — that branch never
      // renders an outbound link, so there is no literal fallback here
      return null;
    }
  })();

  const liveUrlCandidate = status?.room?.liveUrl ?? outboundUrl ?? "";

  return (
    <div className="mx-auto max-w-[1284px] px-4 pb-16 pt-6 sm:px-6" data-testid="tiktok-live-in-app">
      {!valid ? (
        <div data-testid="tiktok-live-degraded" className="mx-auto max-w-xl py-16 text-center">
          <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">This TikTok live could not load</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The handle in the URL is not a valid TikTok creator handle.
          </p>
        </div>
      ) : error ? (
        <div data-testid="tiktok-live-degraded" className="mx-auto max-w-xl py-16 text-center">
          <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">The live status is unavailable right now</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="secondary">
              <a href={liveUrlCandidate} target="_blank" rel="noopener noreferrer">
                Open on TikTok
              </a>
            </Button>
          </div>
        </div>
      ) : !status || status.probing === true ? (
        <div data-testid="tiktok-live-probing" className="py-10" aria-live="polite">
          <p className="text-sm text-muted-foreground">Checking whether @{handle} is live…</p>
          <Skeleton className="mt-4 aspect-video w-full max-w-2xl rounded-lg" />
          <Skeleton className="mt-4 h-5 w-64" />
        </div>
      ) : status.live === false ? (
        <div data-testid="tiktok-live-offline" className="mx-auto max-w-xl py-16 text-center">
          <Radio className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">@{handle} is not live right now</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            WebFlix checked TikTok just now. When the creator goes live, this page becomes the
            watch party — the stream and the chat stay right here.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="secondary">
              <a href={liveUrlCandidate} target="_blank" rel="noopener noreferrer">
                Open on TikTok
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link href={tiktokChannelHref(handle)}>Back to the channel</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* the stage: room identity + the playback ladder */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white"
                data-testid="tiktok-live-badge"
              >
                <Radio className="size-3 animate-pulse" aria-hidden="true" />
                LIVE
              </span>
              <h1 className="min-w-0 flex-1 truncate text-lg font-bold sm:text-xl">
                {status.room?.title ?? `@${handle} is live`}
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="tiktok-live-room-stats">
              @{handle}
              {typeof status.room?.viewers === "number"
                ? ` · ${formatCount(status.room.viewers)} watching`
                : ""}
              {status.room?.startedAt ? ` · started ${formatRelativeDate(status.room.startedAt)}` : ""}
              {status.source ? ` · via ${status.source}` : ""}
            </p>

            <div className="mt-4">
              {status.stream?.hlsUrl && !playbackFailed ? (
                <TikTokLivePlayer src={status.stream.hlsUrl} onUnavailable={() => setPlaybackFailed(true)} />
              ) : (
                <div
                  data-testid="tiktok-live-fallback"
                  className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border bg-secondary/40 px-6 text-center"
                >
                  <Radio className="size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    The stream itself can&apos;t ride inside WebFlix right now — TikTok serves it
                    only to its own player. Everything else stays here: the room stats below and
                    the watch-party chat.
                  </p>
                  <OutboundTikTokLink href={liveUrlCandidate}>
                    Watch the stream on TikTok
                  </OutboundTikTokLink>
                </div>
              )}
            </div>

            {status.room?.coverUrl ? (
              <div className="mt-4 overflow-hidden rounded-lg border">
                <TikTokThumbnailImage
                  src={status.room.coverUrl}
                  alt={`${status.room.title ?? "TikTok live"} cover`}
                  className="max-h-56 w-full object-cover"
                  fallback={<div className="h-28 w-full bg-secondary" />}
                />
              </div>
            ) : null}

            {/* the TikTok-side write affordances — honest, outbound, labeled */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Interact on TikTok
              </span>
              <OutboundTikTokLink href={liveUrlCandidate} testId="tiktok-live-outbound-comment">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                Comment on TikTok
              </OutboundTikTokLink>
              <OutboundTikTokLink href={liveUrlCandidate} testId="tiktok-live-outbound-gift">
                <Gift className="size-3.5" aria-hidden="true" />
                Send a gift on TikTok
              </OutboundTikTokLink>
              <span className="text-[11px] text-muted-foreground">
                These open TikTok — WebFlix never writes to TikTok on your behalf.
              </span>
            </div>
          </div>

          {/* the interact closure: the durable watch-party chat */}
          <aside className="min-w-0">
            <TikTokLiveChatPanel roomKey={handle} chatPollMs={chatPollMs} />
          </aside>
        </div>
      )}
    </div>
  );
}
