"use client";

/**
 * WFX2-W watch page orchestrator — primary column + related rail, theater
 * mode, ?t= seek-on-load, resume, transcript panel, dialogs, sticky mobile
 * player. Data via /api/watch/session + /api/videos/[id].
 *
 * WFX2-A-W: the demo player is swapped for the REAL YouTube player
 * (IFrame Player API — live streams included). Native player UI (captions/
 * quality/speed/fullscreen); autoplay-next on ENDED; theater CSS toggle;
 * the player docks bottom-right (miniplayer) once scrolled past on
 * desktop. Progress memory + view ping live inside the player component.
 * (A-S adds the conditional LiveChatPanel below the player.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Maximize2, Minimize2, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/watch/client";
import { compactCount } from "@/lib/watch/format";
import { parseChapters } from "@/lib/watch/chapters";
import type {
  RelatedVideoDto,
  TranscriptCueDto,
  VideoDetailDto,
  ViewerDto,
} from "@/lib/watch/types";
import {
  YoutubePlayer,
  type YoutubePlayerHandle,
  type YoutubePlayerState,
} from "./youtube-player";
import { SubscribeButton } from "./subscribe-button";
import { ActionRow } from "./action-row";
import { ShareDialog } from "./share-dialog";
import { SaveDialog } from "./save-dialog";
import { ReportDialog } from "./report-dialog";
import { DescriptionBox } from "./description-box";
import { TranscriptPanel } from "./transcript-panel";
import { CommentsSection } from "./comments-section";
import { RelatedRail } from "./related-rail";

const AUTOPLAY_KEY = "wfx2-autoplay";

export function WatchPage({ videoId, startAt }: { videoId: string; startAt: number | null }) {
  const router = useRouter();
  const [detail, setDetail] = useState<VideoDetailDto | null>(null);
  const [viewer, setViewer] = useState<ViewerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theater, setTheater] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [cues, setCues] = useState<TranscriptCueDto[]>([]);
  const [cuesLoaded, setCuesLoaded] = useState(false);
  const [nextVideo, setNextVideo] = useState<RelatedVideoDto | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [subCount, setSubCount] = useState<number | null>(null);
  const [docked, setDocked] = useState(false);

  const playerRef = useRef<YoutubePlayerHandle>(null);
  const timeRef = useRef(0);
  const transcriptFetchedRef = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // bootstrap: session cookie + video detail (fresh mount per video via key)
  useEffect(() => {
    let alive = true;

    void api<{ viewer: ViewerDto }>("/api/watch/session")
      .then((r) => {
        if (alive) setViewer(r.viewer);
      })
      .catch(() => {});

    api<VideoDetailDto>(`/api/videos/${videoId}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setSubCount(d.video.channel.subscriberCount);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load video");
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  // autoplay preference (the Wave-1 key, default on)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of a persisted pref (SSR renders the default)
      setAutoplay(localStorage.getItem(AUTOPLAY_KEY) !== "0");
    } catch {
      /* private mode */
    }
  }, []);

  const setAutoplayPref = useCallback((on: boolean) => {
    setAutoplay(on);
    try {
      localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  // fetch transcript once the page is live (captions + panel share the cues)
  useEffect(() => {
    let alive = true;
    if (detail && !transcriptFetchedRef.current) {
      transcriptFetchedRef.current = true;
      api<{ cues: TranscriptCueDto[] }>(`/api/videos/${videoId}/transcript`)
        .then((r) => {
          if (!alive) return;
          setCues(r.cues);
          setCuesLoaded(true);
        })
        .catch(() => {
          transcriptFetchedRef.current = false;
        });
    }
    return () => {
      alive = false;
    };
  }, [detail, videoId]);

  // miniplayer: dock the player bottom-right once scrolled past it. The app
  // shell scrolls an inner container (not the window) — find the player's
  // real scroll parent and listen there.
  useEffect(() => {
    const anchor = anchorRef.current;
    let scrollEl: HTMLElement | Window = window;
    if (anchor) {
      let node: HTMLElement | null = anchor.parentElement;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        if (/(auto|scroll|overlay)/.test(style.overflowY)) {
          scrollEl = node;
          break;
        }
        node = node.parentElement;
      }
    }
    const onScroll = () => {
      const el = anchorRef.current;
      if (!el) {
        setDocked(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      setDocked((d) => (d === rect.bottom < 80 ? d : rect.bottom < 80));
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [theater, detail]);

  const undock = useCallback(() => {
    setDocked(false);
    anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const seek = useCallback((sec: number) => {
    playerRef.current?.seekTo(sec);
  }, []);

  const chapters = useMemo(
    () => (detail ? parseChapters(detail.video.description, detail.video.durationSec) : []),
    [detail]
  );

  if (error) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">This video isn&apos;t available anymore</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Link
          href="/"
          className="mt-6 flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Go to home
        </Link>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6" aria-busy="true" aria-label="Loading video">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-secondary" />
        <div className="mt-4 h-6 w-3/4 animate-pulse rounded bg-secondary" />
        <div className="mt-3 flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-full bg-secondary" />
          <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
        </div>
      </main>
    );
  }

  const { video, state } = detail;
  const isLive = video.durationSec === 0;

  const player = (
    <YoutubePlayer
      handleRef={playerRef}
      videoId={videoId}
      startSec={startAt ?? state.resumeSec}
      onProgress={(sec) => {
        timeRef.current = sec;
      }}
      onStateChange={(_s: YoutubePlayerState) => {
        /* native player UI owns the controls */
      }}
      onEnded={() => {
        // autoplay-next: the related rail's first item (A-B's autoplay set
        // lands in the same DTO shape)
        if (autoplay && nextVideo) router.push(`/watch/${nextVideo.id}`);
      }}
    />
  );

  return (
    <main className="mx-auto w-full max-w-[1754px] px-0 sm:px-4 sm:pb-8">
      {theater ? (
        <div className="bg-black">
          <div className="mx-auto max-w-[1754px]">{player}</div>
        </div>
      ) : null}

      <div
        className={
          theater
            ? "mx-auto grid grid-cols-1 gap-6 px-4 pt-4 lg:grid-cols-[minmax(0,1fr)_402px]"
            : "mx-auto grid grid-cols-1 gap-6 px-0 pt-0 sm:px-4 sm:pt-4 lg:grid-cols-[minmax(0,1fr)_402px]"
        }
      >
        {/* primary column */}
        <div className="min-w-0">
          {!theater && (
            <div className="sm:rounded-xl">
              <div
                ref={anchorRef}
                className={cn(
                  "w-full",
                  !docked && "sticky top-0 z-30 bg-black sm:static sm:rounded-xl"
                )}
              >
                {/* aspect keeper: holds the layout slot while the player docks */}
                <div className="relative aspect-video w-full overflow-hidden">
                  <div
                    className={
                      docked
                        ? "fixed bottom-4 right-4 z-50 aspect-video w-80 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-border"
                        : "absolute inset-0"
                    }
                  >
                    {player}
                    {docked && (
                      <button
                        type="button"
                        onClick={undock}
                        aria-label="Expand player back into the page"
                        className="absolute left-1 top-1 z-10 rounded-full bg-black/70 p-1.5 text-white opacity-80 transition hover:opacity-100"
                      >
                        <Maximize2 className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className={theater ? "" : "px-3 sm:px-0"}>
            {/* player control row: theater toggle + autoplay-next toggle */}
            <div className="mt-2 flex items-center justify-between gap-3">
              <h1 className="min-w-0 text-lg font-bold leading-snug sm:text-xl">
                {video.title}
                {isLive && (
                  <span className="ml-2 inline-flex items-center rounded bg-destructive px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase text-white">
                    Live
                  </span>
                )}
              </h1>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTheater((t) => !t)}
                  aria-pressed={theater}
                  aria-label={theater ? "Default view" : "Theater mode"}
                  title={theater ? "Default view (t)" : "Theater mode (t)"}
                  className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition hover:bg-secondary/70 sm:size-10"
                >
                  {theater ? (
                    <Minimize2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-4" aria-hidden="true" />
                  )}
                </button>
                {nextVideo && (
                  <button
                    type="button"
                    onClick={() => router.push(`/watch/${nextVideo.id}`)}
                    aria-label="Play next video"
                    title="Play next"
                    className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition hover:bg-secondary/70 sm:size-10"
                  >
                    <SkipForward className="size-4" aria-hidden="true" />
                  </button>
                )}
                <div className="flex items-center gap-1.5" title="Autoplay next video">
                  <Switch
                    checked={autoplay}
                    onCheckedChange={setAutoplayPref}
                    aria-label="Autoplay next video"
                  />
                  <span className="hidden text-xs text-muted-foreground sm:inline">Autoplay</span>
                </div>
              </div>
            </div>

            {/* channel row + actions */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <Link href={`/channel/${video.channel.handle}`} aria-label={video.channel.name}>
                  <Avatar className="size-10">
                    <AvatarImage src={video.channel.avatarUrl} alt="" />
                    <AvatarFallback>{video.channel.name.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                </Link>
                <div className="min-w-0">
                  <Link
                    href={`/channel/${video.channel.handle}`}
                    className="flex items-center gap-1 text-sm font-semibold hover:opacity-80"
                  >
                    <span className="truncate">{video.channel.name}</span>
                    {video.channel.verified && (
                      <BadgeCheck className="size-4 shrink-0 text-muted-foreground" aria-label="Verified" />
                    )}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {compactCount(subCount ?? video.channel.subscriberCount)} subscribers
                  </p>
                </div>
                <SubscribeButton
                  channelId={video.channel.id}
                  channelName={video.channel.name}
                  initialSubscribed={state.subscribed}
                  initialBell={state.bell}
                  subscriberCount={subCount ?? video.channel.subscriberCount}
                  onCountChange={setSubCount}
                />
              </div>

              <ActionRow
                videoId={videoId}
                likes={video.likes}
                dislikes={video.dislikes}
                yourLike={state.like}
                savedWatchLater={state.savedWatchLater}
                onLikeResult={(r) => {
                  // server truth → page-level state (honest counts)
                  setDetail((d) =>
                    d
                      ? {
                          ...d,
                          video: {
                            ...d.video,
                            likes: r.likes,
                            dislikes: r.dislikes,
                          },
                          state: { ...d.state, like: r.yourLike },
                        }
                      : d
                  );
                }}
                onShare={() => {
                  setCurrentTime(timeRef.current);
                  setShareOpen(true);
                }}
                onSave={() => setSaveOpen(true)}
                onToggleTranscript={openTranscript}
                onReport={() => setReportOpen(true)}
              />
            </div>

            {/* description */}
            <DescriptionBox
              videoId={videoId}
              description={video.description}
              views={video.views}
              createdAt={video.createdAt}
              durationSec={video.durationSec}
              thumbnailUrl={video.thumbnailUrl}
              onSeek={seek}
            />

            {/* transcript panel */}
            {transcriptOpen && (
              <TranscriptPanel
                cues={cues}
                getTime={() => timeRef.current}
                query={transcriptQuery}
                onQueryChange={setTranscriptQuery}
                onSeek={seek}
                onClose={() => setTranscriptOpen(false)}
              />
            )}

            {/* comments */}
            {viewer && (
              <CommentsSection
                videoId={videoId}
                viewer={viewer}
                viewerIsCreator={state.isCreator}
                creatorName={video.channel.name}
              />
            )}
          </div>
        </div>

        {/* related rail */}
        <aside aria-label="Related videos" className={theater ? "min-w-0" : "px-3 sm:px-0"}>
          <RelatedRail videoId={videoId} onFirstPage={setNextVideo} />
        </aside>
      </div>

      {/* dialogs (conditional mount → fresh state per open) */}
      {shareOpen && (
        <ShareDialog
          open
          onOpenChange={setShareOpen}
          videoId={videoId}
          title={video.title}
          currentTime={currentTime}
        />
      )}
      {saveOpen && (
        <SaveDialog
          open
          onOpenChange={setSaveOpen}
          videoId={videoId}
          onSavedChange={(watchLater) => {
            setDetail((d) => (d ? { ...d, state: { ...d.state, savedWatchLater: watchLater } } : d));
          }}
        />
      )}
      {reportOpen && <ReportDialog open onOpenChange={setReportOpen} videoId={videoId} />}
    </main>
  );

  function openTranscript() {
    setTranscriptOpen((o) => !o);
  }
}
