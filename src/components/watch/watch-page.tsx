"use client";

/**
 * WFX2-W watch page orchestrator — primary column + related rail, theater
 * mode, ?t= seek-on-load, resume, transcript panel, dialogs, sticky mobile
 * player. Data via /api/watch/session + /api/videos/[id].
 *
 * WFX2-A-W: the REAL YouTube player (IFrame Player API — live streams
 * included). Native player UI (captions/quality/speed/fullscreen);
 * theater CSS toggle; autoplay-next on ENDED; progress memory + view ping
 * live inside the player component. (A-S adds the conditional
 * LiveChatPanel below the player.)
 *
 * WFX2-C-S — replay polish:
 * - The player is hosted by the persistent player host (miniplayer
 *   persistence): this page renders an inline SLOT the host's wrapper
 *   lands in. Same video → expand at the same position; different video →
 *   takeover via loadVideoById (no reload); scrolling past the anchor or
 *   navigating away shrinks the player into the bottom-right miniplayer.
 * - Ambient mode: the blurred/desaturated thumbnail glow behind the
 *   player (CSS filter + radial mask — static thumbnail only; the
 *   cross-origin iframe can never be frame-grabbed).
 * - Watch-next autoplay chain: ENDED arms the 5s countdown overlay
 *   (circular cancel, "Playing next in…", next-title preview) before
 *   advancing; wall-clock ticks survive throttled tabs; Esc/space cancel.
 * - The playhead feeds the chat replay (seeking classifier +
 *   reveal gating) at ~1/sec through the player-host store.
 *
 * WFX2-P4-QT — the queue: Add to queue joins the action row (guest gate →
 * the AU signed-out law; the real WL write precedes the session append —
 * queue-actions), the autoplay countdown takes the queue's next over the
 * related next (fired consumes the played video — it STAYS in WL), the
 * queue engine drives continuous play when the miniplayer owns the player,
 * and the queue list panel mounts under the actions row.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Maximize2, Minimize2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/watch/client";
import { compactCount } from "@/lib/watch/format";
import { parseChapters } from "@/lib/watch/chapters";
import { readProgress } from "@/components/watch/youtube-player";
import { playerHost, usePlayerHost } from "@/lib/player/player-host";
import {
  countdownReducer,
  initialCountdown,
} from "@/lib/watch/autoplay-countdown";
import type {
  RelatedVideoDto,
  TranscriptCueDto,
  VideoDetailDto,
  ViewerDto,
} from "@/lib/watch/types";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref } from "@/lib/auth/client";
import { addToQueue } from "@/lib/queue/queue-actions";
import { useQueueStore, type QueueItem } from "@/lib/queue/queue-store";
import { startQueueEngine } from "@/lib/queue/queue-engine";
import { QueuePanel } from "./queue-panel";
import { AmbientBackdrop } from "./ambient-backdrop";
import { AutoplayCountdownOverlay } from "./autoplay-countdown-overlay";
import { SubscribeButton } from "./subscribe-button";
import { ActionRow } from "./action-row";
import { ShareDialog } from "./share-dialog";
import { SaveDialog } from "./save-dialog";
import { ReportDialog } from "./report-dialog";
import { DescriptionBox } from "./description-box";
import { TranscriptPanel } from "./transcript-panel";
import { CommentsSection } from "./comments-section";
import { RelatedRail } from "./related-rail";
import dynamic from "next/dynamic";

const LiveChatPanel = dynamic(
  () => import("@/components/watch/live-chat-panel").then((m) => m.LiveChatPanel),
  { ssr: false },
);

const AUTOPLAY_KEY = "wfx2-autoplay";

export function WatchPage({ videoId, startAt }: { videoId: string; startAt: number | null }) {
  const router = useRouter();
  // WFX2-P2-AU: the account gate source of truth — guests get the
  // youtube.com write prompts (composer box, like/subscribe/save/report
  // routing to /signin), signed-in users get EXACTLY the prior behavior.
  const wfSession = useWebFlixSession();
  const guest = wfSession.status === "unauthenticated";
  const gate = (open: () => void) => () => {
    if (guest) {
      window.location.assign(signInHref(`/watch/${videoId}`));
      return;
    }
    open();
  };
  const [detail, setDetail] = useState<VideoDetailDto | null>(null);
  const [viewer, setViewer] = useState<ViewerDto | null>(null);
  const [operatorSession, setOperatorSession] = useState(true);
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

  // WFX2-C-S: the watch-next countdown machine (advance on "fired").
  const [countdown, dispatch] = useReducer(countdownReducer, initialCountdown);

  const timeRef = useRef(0);
  const transcriptFetchedRef = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef(false);
  const slotElRef = useRef<HTMLDivElement | null>(null);
  const startAtRef = useRef(startAt);
  const autoplayRef = useRef(autoplay);
  const nextVideoRef = useRef<RelatedVideoDto | null>(null);
  const resumeAppliedRef = useRef(false);
  const queueNextRef = useRef<QueueItem | null>(null);

  // player-host state (the persistent player + its playhead)
  const positionSec = usePlayerHost((s) => s.positionSec);
  const hostHasVideo = usePlayerHost((s) => s.videoId === videoId);

  // WFX2-P4-QT: the session queue (WL-backed) — the queue's next takes
  // priority over the related next in the countdown; the pressed affordance
  // mirrors membership; the panel renders while the queue exists.
  const queueItems = useQueueStore((s) => s.items);
  const queued = useQueueStore((s) => s.has(videoId));
  const queueNext = useQueueStore((s) => s.nextAfter(videoId));

  // WFX2-P4-QT: the queue engine (continuous play when the miniplayer owns
  // the player). Idempotent — the subscription lives on the playerHost
  // singleton for the whole session; a queue can only become non-empty from
  // a watch page affordance, so the engine is always armed before any ENDED.
  useEffect(() => {
    startQueueEngine();
  }, []);

  // bootstrap: session cookie + video detail (fresh mount per video via key)
  useEffect(() => {
    let alive = true;

    void api<{ viewer: ViewerDto; operatorSession?: boolean }>("/api/watch/session")
      .then((r) => {
        if (alive) {
          setViewer(r.viewer);
          setOperatorSession(r.operatorSession !== false);
        }
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

  // WFX2-C-S: take the persistent player — same videoId expands at the
  // same position; a different id is a takeover (loadVideoById, no reload).
  useEffect(() => {
    playerHost.attach({ videoId, startSec: startAtRef.current });
  }, [videoId]);

  // enrich the miniplayer meta once the detail arrives
  useEffect(() => {
    if (!detail) return;
    playerHost.updateMeta({
      title: detail.video.title,
      channelName: detail.video.channel.name,
      thumbnailUrl: detail.video.thumbnailUrl,
      durationSec: detail.video.durationSec ?? 0,
    });
  }, [detail]);

  // playhead mirror for transcript/share reads (no re-render)
  useEffect(() => playerHost.onProgress((sec) => {
    timeRef.current = sec;
  }), []);

  // server-side resume fallback: only when neither ?t= nor the local
  // progress memory applies (the player itself seeks on startSec). The
  // handle appears once the iframe API is ready — retry briefly.
  useEffect(() => {
    if (!detail || resumeAppliedRef.current) return;
    resumeAppliedRef.current = true;
    if (startAtRef.current !== null) return; // explicit ?t= wins
    if (readProgress(videoId) !== null) return; // local memory wins
    const resume = detail.state.resumeSec;
    if (resume === null || resume <= 5) return;
    const trySeek = (attempts: number) => {
      if (playerHost.handleRef.current) {
        playerHost.seekTo(resume);
      } else if (attempts > 0) {
        setTimeout(() => trySeek(attempts - 1), 500);
      }
    };
    trySeek(10); // ~5s of retries while the iframe API loads
  }, [detail, videoId]);

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
    // AUTOPLAY_OFF mid-count cancels instantly (countdown state machine)
    dispatch({ type: "TOGGLE", autoplay: on });
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

  // WFX2-P4-QT: player events → the countdown machine.
  //   ENDED   → arm (once per cycle — the machine's idle guard); the queue's
  //             next counts as "has next" (queue-first over related)
  //   PLAYING → reset (replay / seek-after-ended restarts the cycle)
  useEffect(() => {
    autoplayRef.current = autoplay;
    nextVideoRef.current = nextVideo;
    queueNextRef.current = queueNext;
  }, [autoplay, nextVideo, queueNext]);
  useEffect(() => {
    return playerHost.onEnded(() => {
      dispatch({
        type: "ENDED",
        autoplay: autoplayRef.current,
        hasNext: nextVideoRef.current !== null || queueNextRef.current !== null,
        now: Date.now(),
      });
    });
  }, []);
  useEffect(() => {
    return playerHost.onStateChange((st) => {
      if (st === "playing") dispatch({ type: "PLAYING" });
    });
  }, []);

  // "fired" (wall-clock deadline or FIRE click) → advance exactly once.
  // WFX2-P4-QT: the queue's next wins over the related next; consuming the
  // played video only leaves the SESSION queue (it stays in Watch Later).
  useEffect(() => {
    if (countdown.status !== "fired") return;
    const qn = queueNextRef.current;
    if (qn) {
      useQueueStore.getState().markPlayed(videoId);
      router.push(`/watch/${qn.videoId}`);
      return;
    }
    const next = nextVideoRef.current;
    if (next) router.push(`/watch/${next.id}`);
  }, [countdown.status, router, videoId]);

  // WFX2-C-S: miniplayer — dock the player bottom-right once scrolled past
  // it (the app shell scrolls an inner container — find the player's real
  // scroll parent and listen there).
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
        if (dockedRef.current) {
          dockedRef.current = false;
          setDocked(false);
          playerHost.setMini(false);
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      const next = rect.bottom < 80;
      if (next !== dockedRef.current) {
        dockedRef.current = next;
        setDocked(next);
        playerHost.setMini(next);
      }
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [theater, detail]);

  const undock = useCallback(() => {
    dockedRef.current = false;
    setDocked(false);
    playerHost.setMini(false);
    anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // miniplayer "expand" while ON the watch page → back inline + scroll up
  useEffect(() => {
    return playerHost.onExpand(() => {
      dockedRef.current = false;
      setDocked(false);
      anchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  // the persistent player's inline slot (ref callback — registers with the
  // host; on unmount the host takes the player to the miniplayer)
  const setSlotEl = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      slotElRef.current = el;
      playerHost.registerSlot(el);
    } else {
      playerHost.releaseSlot(slotElRef.current);
      slotElRef.current = null;
    }
  }, []);

  const seek = useCallback((sec: number) => {
    playerHost.seekTo(sec);
  }, []);

  // WFX2-P4-QT: Add to queue — the AU guest gate, then the real WL write
  // BEFORE the session append (queue-actions; honest outcomes only).
  const onAddToQueue = useCallback(async () => {
    if (guest) {
      window.location.assign(signInHref(`/watch/${videoId}`));
      return;
    }
    const v = detail?.video;
    if (!v) return;
    const outcome = await addToQueue({
      videoId,
      title: v.title,
      channelName: v.channel.name,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.durationSec ?? 0,
    });
    if (outcome.status === "appended") toast.success("Added to queue");
    else if (outcome.status === "already-queued") toast.info("Already in the queue");
    else if (outcome.status === "full") toast.info("The queue is full");
    else if (outcome.status === "error") toast.error(outcome.message);
  }, [guest, detail, videoId]);

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
        {/* the host slot — the persistent player lands here immediately
            (takeover/expand) while the page metadata loads */}
        <div
          className={cn(
            "relative aspect-video w-full overflow-hidden rounded-xl bg-secondary",
            !hostHasVideo && "animate-pulse",
          )}
        >
          <div ref={setSlotEl} className="absolute inset-0" />
        </div>
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

  const countdownNext = queueNext
    ? {
        id: queueNext.videoId,
        title: queueNext.title,
        channelName: queueNext.channelName,
        thumbnailUrl: queueNext.thumbnailUrl,
      }
    : nextVideo
      ? {
          id: nextVideo.id,
          title: nextVideo.title,
          channelName: nextVideo.channel.name,
          thumbnailUrl: nextVideo.thumbnailUrl,
        }
      : null;

  const countdownOverlay =
    countdown.status === "counting" && countdownNext ? (
      <AutoplayCountdownOverlay state={countdown} next={countdownNext} dispatch={dispatch} />
    ) : null;

  return (
    <main className="mx-auto w-full max-w-[1754px] px-0 sm:px-4 sm:pb-8">
      {theater ? (
        <div className="bg-black">
          <div className="mx-auto max-w-[1754px]">
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <div ref={setSlotEl} className="absolute inset-0" />
              {countdownOverlay}
            </div>
          </div>
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
                <div className="relative">
                  {/* WFX2-C-S: ambient mode — blurred thumbnail glow behind
                      the player (light/dark honored; no layout shift) */}
                  {!docked && <AmbientBackdrop thumbnailUrl={video.thumbnailUrl} />}

                  {/* aspect keeper: holds the layout slot while the player
                      shrinks into the miniplayer */}
                  <div className="relative z-10 aspect-video w-full overflow-hidden bg-black sm:rounded-xl">
                    {/* the persistent player's inline slot (host wrapper) */}
                    <div ref={setSlotEl} className="absolute inset-0" />
                    {docked && (
                      <button
                        type="button"
                        onClick={undock}
                        aria-label="Expand player back into the page"
                        className="absolute inset-0 bg-black/60"
                      >
                        <img
                          src={video.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover opacity-50"
                          draggable={false}
                        />
                      </button>
                    )}
                    {countdownOverlay}
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
                {countdownNext && (
                  <button
                    type="button"
                    onClick={() => {
                      if (queueNext) useQueueStore.getState().markPlayed(videoId);
                      router.push(`/watch/${countdownNext.id}`);
                    }}
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
                  guest={guest}
                  onCountChange={setSubCount}
                />
              </div>

              <ActionRow
                videoId={videoId}
                likes={video.likes}
                dislikes={video.dislikes}
                yourLike={state.like}
                savedWatchLater={state.savedWatchLater}
                guest={guest}
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
                  setCurrentTime(playerHost.getPosition());
                  setShareOpen(true);
                }}
                onSave={gate(() => setSaveOpen(true))}
                onToggleTranscript={openTranscript}
                onReport={gate(() => setReportOpen(true))}
                onAddToQueue={() => {
                  void onAddToQueue();
                }}
                queued={queued}
              />
            </div>

            {/* WFX2-P4-QT: the queue list panel (mounted while the session
                queue exists — remove-from-queue is the real WL remove) */}
            {queueItems.length > 0 && <QueuePanel currentVideoId={videoId} />}

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

            {/* transcript panel (keyed per video — fresh language state) */}
            {transcriptOpen && (
              <TranscriptPanel
                key={videoId}
                videoId={videoId}
                cues={cues}
                getTime={() => playerHost.getPosition()}
                query={transcriptQuery}
                onQueryChange={setTranscriptQuery}
                onSeek={seek}
                onClose={() => setTranscriptOpen(false)}
              />
            )}

            {/* comments — WFX2-P6-CR: rendered for EVERY viewer (anonymous
                included — YouTube renders comments logged-out; the composer
                keeps its own guest/public gates). The video snapshot feeds
                the local rung's shadow rows via the composer. */}
            <CommentsSection
              videoId={videoId}
              viewer={viewer}
              viewerIsCreator={state.isCreator}
              creatorName={video.channel.name}
              operatorSession={operatorSession}
              guest={guest}
              video={{
                title: video.title,
                channelId: video.channel.id,
                channelHandle: video.channel.handle,
                channelName: video.channel.name,
                channelAvatarUrl: video.channel.avatarUrl,
              }}
            />
          </div>
        </div>

        {/* related rail */}
        <aside aria-label="Related videos" className={theater ? "min-w-0" : "px-3 sm:px-0"}>
          {detail && !theater && (
            <LiveChatPanel videoId={videoId} currentTimeSec={positionSec} />
          )}
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
