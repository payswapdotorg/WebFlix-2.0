"use client";

/**
 * WFX2-W watch page orchestrator — primary column + related rail, theater
 * mode, ?t= seek-on-load, resume, transcript panel, dialogs, sticky mobile
 * player. Data via /api/watch/session + /api/videos/[id].
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/watch/client";
import { compactCount, exactCount, relativeTime } from "@/lib/watch/format";
import { parseChapters } from "@/lib/watch/chapters";
import type {
  RelatedVideoDto,
  TranscriptCueDto,
  VideoDetailDto,
  ViewerDto,
} from "@/lib/watch/types";
import { VideoPlayer, type PlayerHandle } from "./video-player";
import { SubscribeButton } from "./subscribe-button";
import { ActionRow } from "./action-row";
import { ShareDialog } from "./share-dialog";
import { SaveDialog } from "./save-dialog";
import { ReportDialog } from "./report-dialog";
import { DescriptionBox } from "./description-box";
import { TranscriptPanel } from "./transcript-panel";
import { CommentsSection } from "./comments-section";
import { RelatedRail } from "./related-rail";

export function WatchPage({ videoId, startAt }: { videoId: string; startAt: number | null }) {
  const [detail, setDetail] = useState<VideoDetailDto | null>(null);
  const [viewer, setViewer] = useState<ViewerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theater, setTheater] = useState(false);
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

  const playerRef = useRef<PlayerHandle>(null);
  const timeRef = useRef(0);
  const transcriptFetchedRef = useRef(false);

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

  const openTranscript = useCallback(() => {
    setTranscriptOpen((o) => !o);
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
  const player = (
    <VideoPlayer
      ref={playerRef}
      videoId={videoId}
      src={video.videoUrl}
      poster={video.thumbnailUrl}
      durationSec={video.durationSec ?? 0}
      resumeSec={state.resumeSec}
      startAt={startAt}
      chapters={chapters}
      cues={cues}
      cuesReady={cuesLoaded}
      theater={theater}
      onToggleTheater={() => setTheater((t) => !t)}
      nextVideo={nextVideo}
      onOpenTranscript={openTranscript}
      onTimeUpdate={(t) => {
        timeRef.current = t;
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
              <div className="sticky top-0 z-30 -mx-0 bg-black sm:static sm:mx-0 sm:bg-transparent">
                {player}
              </div>
            </div>
          )}

          <div className={theater ? "" : "px-3 sm:px-0"}>
            <h1 className="mt-3 text-lg font-bold leading-snug sm:text-xl">{video.title}</h1>

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
              viewsText={video.viewsText ?? null}
              createdAt={video.createdAt}
              publishedText={video.publishedText ?? null}
              durationSec={video.durationSec ?? 0}
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
}
