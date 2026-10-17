"use client";

/**
 * WFX2-P23-A — the clip page view: the ranged player on the source video,
 * cued to the clip's [start, end) window, looping exactly like youtube.com's
 * clip page (measured 2026-10-17: ytInitialPlayerResponse.clipConfig +
 * loopCommand {loop: true, startTimeMs, endTimeMs}; "Watch full video" sets
 * loop=false and shows the "Watching full video" toast with a "Return to
 * clip" action; scrubbing back before the window start has the same effect
 * — the onScrubExit semantics).
 *
 * Layout (youtube.com's measured clip page): the FULL watch-page shape —
 * player + the source video's title as the page h1 + the Clip attribution
 * panel in the secondary column (~410px, "Clip" heading): the clip
 * author's avatar + name, "N views · age" (upstream text; WebFlix-local
 * clips honestly carry the age only — no view count is tracked), the clip
 * title, and the "Share clip" / "Watch full video" footer buttons.
 *
 * Honest states (never a synthesized clip):
 *  - not-found / clip-unavailable → youtube.com's own wording family
 *    ("Clip not available - Try again later" — the measured toast copy).
 *  - read-failed → the P22-B unavailable family (the clip page could not
 *    be read — open it on youtube.com to check).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Check, Copy, ExternalLink, Scissors } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { playerHost, usePlayerHost } from "@/lib/player/player-host";
import { readProgress } from "@/components/watch/youtube-player";
import type { ClipViewDto } from "@/lib/clip/clip-service";
import { ShareTargetRow } from "@/components/watch/share-targets";

/** The loop guard's tolerance (the playhead reports ~1/sec; youtube.com's
 * own loop has the same granularity — a hair past the end is fine). */
const LOOP_TOLERANCE_SEC = 0.75;

export function ClipPageView({ clipId }: { clipId: string }) {
  const { data, loading, error } = useApi<ClipViewDto>(`/api/clip/${clipId}`);
  const hostHasVideo = usePlayerHost((s) => s.videoId === (data?.videoId ?? null));

  if (loading) return <ClipSkeleton />;
  if (error || !data) return <ClipErrorState message={error ?? "Clip not found"} />;
  return <ClipResolved clip={data} hostHasVideo={hostHasVideo} />;
}

/* ---------------- the honest states ---------------- */

function ClipSkeleton() {
  return (
    <main className="mx-auto max-w-[1754px] px-0 py-0 sm:px-4 sm:pt-4" aria-busy="true" aria-label="Loading clip">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_402px]">
        <div className="min-w-0">
          <div className="relative aspect-video w-full animate-pulse overflow-hidden rounded-xl bg-secondary sm:rounded-xl" />
          <div className="mt-4 h-6 w-3/4 animate-pulse rounded bg-secondary" />
          <div className="mt-3 flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-full bg-secondary" />
            <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
          </div>
        </div>
      </div>
    </main>
  );
}

function ClipErrorState({ message }: { message: string }) {
  // youtube.com's own dead-clip family (measured: "Clip not available -
  // Try again later"); read failures get the P22-B unavailable wording.
  const readFailed = /could not be read|Too many|unavailable right now/i.test(message);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center">
      <Scissors className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-bold">
        {readFailed ? "This clip is unavailable right now" : "Clip not available - Try again later"}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground" role="status">
        {readFailed
          ? "The clip page could not be read — it may be unavailable on YouTube, or YouTube didn't serve it to WebFlix. Open it on youtube.com to check."
          : message}
      </p>
      <Link
        href="/"
        className="mt-6 flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
      >
        Go to home
      </Link>
    </main>
  );
}

/* ---------------- the resolved clip page ---------------- */

function ClipResolved({
  clip,
  hostHasVideo,
}: {
  clip: ClipViewDto;
  hostHasVideo: boolean;
}) {
  const { videoId, startSec, endSec, title, clipAuthor, clipAuthorAvatarUrl, createdText } = clip;
  const [watchingFull, setWatchingFull] = useState(false);
  const [copied, setCopied] = useState(false);
  // the loop's armed flag — written ONLY from the progress subscription and
  // the Return-to-clip handler (never during render; the house refs law)
  const armedRef = useRef(true);

  // take the persistent player: takeover/expand at the clip start (the
  // watch page's attach pattern; the clip start ALWAYS seeks — youtube.com
  // cues the clip window on every clip-page entry).
  useEffect(() => {
    playerHost.attach({
      videoId,
      startSec,
      title: clip.videoTitle ?? title,
      channelName: clip.channelName ?? "",
      thumbnailUrl: null,
      durationSec: 0,
    });
    const trySeek = (attempts: number) => {
      if (playerHost.handleRef.current) {
        playerHost.seekTo(startSec);
      } else if (attempts > 0) {
        setTimeout(() => trySeek(attempts - 1), 500);
      }
    };
    trySeek(10); // ~5s of retries while the iframe API loads
  }, [videoId, startSec, title, clip.videoTitle, clip.channelName]);

  // the ranged loop (youtube.com's loopCommand semantics):
  //   - past the end → seek back to the start (loop: true)
  //   - scrubbed BEFORE the window → the loop disarms + the "Watching full
  //     video" state (youtube.com's onScrubExit → toast + Return to clip)
  useEffect(() => {
    return playerHost.onProgress((sec) => {
      if (!armedRef.current) return;
      if (sec >= endSec - LOOP_TOLERANCE_SEC && sec <= endSec + 5) {
        playerHost.seekTo(startSec);
      } else if (sec < startSec - 1.5) {
        armedRef.current = false;
        setWatchingFull(true);
      }
    });
  }, [startSec, endSec]);

  const returnToClip = useCallback(() => {
    armedRef.current = true;
    setWatchingFull(false);
    playerHost.seekTo(startSec);
  }, [startSec]);

  // the inline slot (the persistent player's landing node)
  const setSlotEl = useCallback((el: HTMLDivElement | null) => {
    if (el) playerHost.registerSlot(el);
    // release → the host takes the player to the miniplayer (its own matrix)
  }, []);

  const clipUrl = typeof window !== "undefined" ? `${window.location.origin}/clip/${clip.clipId}` : `/clip/${clip.clipId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(clipUrl);
      setCopied(true);
      toast.success("Clip link copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the link text instead");
    }
  };

  // youtube.com's clip page title = the SOURCE video's title (measured)
  useEffect(() => {
    if (clip.videoTitle) document.title = `${clip.videoTitle} - WebFlix`;
  }, [clip.videoTitle]);

  return (
    <main className="mx-auto w-full max-w-[1754px] px-0 sm:px-4 sm:pb-8">
      <div className="mx-auto grid grid-cols-1 gap-6 px-0 pt-0 sm:px-4 sm:pt-4 lg:grid-cols-[minmax(0,1fr)_402px]">
        {/* primary column — the ranged player + the source video's title */}
        <div className="min-w-0">
          <div className="sm:rounded-xl">
            <div className="w-full sticky top-0 z-30 bg-black sm:static sm:rounded-xl">
              <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-xl">
                {/* the persistent player's inline slot (host wrapper) */}
                <div
                  ref={setSlotEl}
                  className="absolute inset-0"
                  data-testid="clip-player-slot"
                />
                {!hostHasVideo && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-full w-full animate-pulse bg-secondary/60" />
                  </div>
                )}
                {watchingFull && (
                  <div
                    role="status"
                    data-testid="clip-watching-full"
                    className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-black/80 px-4 py-2.5 text-sm text-white"
                  >
                    <span className="font-medium">Watching full video</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={returnToClip}
                      className="h-8 gap-1 rounded-full px-3 text-xs"
                    >
                      <Scissors className="size-3.5" aria-hidden="true" />
                      Return to clip
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-0">
            <h1 className="mt-2 text-lg font-bold leading-snug sm:text-xl">
              {clip.videoTitle ?? title}
            </h1>

            {/* the Clip attribution panel — youtube.com's clipSectionRenderer
                shape (avatar · author · views·age · clip title), rendered in
                the secondary column on wide viewports (the measured layout)
                and inline on narrow ones. */}
            <div className="mt-3 border-b border-border pb-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Scissors className="size-4" aria-hidden="true" />
                Clip
              </h2>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-10 shrink-0">
                    <AvatarImage src={clipAuthorAvatarUrl ?? undefined} alt="" />
                    <AvatarFallback>{clipAuthor.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{clipAuthor}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {createdText ?? "—"} · {startSec}s–{endSec}s
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    asChild
                    className="h-9 gap-1.5 rounded-full px-4 text-sm"
                  >
                    <Link href={`/watch/${videoId}`}>
                      <ExternalLink className="size-4" aria-hidden="true" />
                      Watch full video
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={copy}
                    className="h-9 gap-1.5 rounded-full px-4 text-sm"
                    aria-label="Share clip"
                  >
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    Share clip
                  </Button>
                </div>
              </div>

              <p className="mt-2 text-sm font-medium" data-testid="clip-title">
                {title}
              </p>
              {clip.source === "webflix" && (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="clip-local-note">
                  A WebFlix clip — this link shares the {startSec}s–{endSec}s range of the video.
                  Clips aren&apos;t created on YouTube accounts anymore (YouTube removed the web
                  create flow).
                </p>
              )}
            </div>

            {/* the share row (youtube.com's share-sheet family: the link box
                + Copy + the social targets) */}
            <ShareTargetRow url={clipUrl} title={title} copied={copied} onCopy={copy} />
          </div>
        </div>

        {/* secondary column — the source video's channel attribution
            (youtube.com's clip page rides the full watch page's secondary
            column; WebFlix keeps the honest subset: the channel row) */}
        <aside aria-label="Clip details" className="hidden px-3 sm:px-0 lg:block">
          {clip.channelName && (
            <div className="flex items-center gap-3 rounded-xl border border-border p-4">
              <Avatar className="size-10 shrink-0">
                <AvatarImage src={clip.channelAvatarUrl ?? undefined} alt="" />
                <AvatarFallback>{clip.channelName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-sm font-semibold">
                  <span className="truncate">{clip.channelName}</span>
                  <BadgeCheck className="size-4 shrink-0 text-muted-foreground" aria-label="Channel" />
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {clip.channelHandle ?? "—"} · from the source video
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export default ClipPageView;
