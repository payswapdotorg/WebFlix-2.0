"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PlayCircle, VideoOff, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadYouTubeIframeApi } from "@/components/watch/youtube-player";
import { formatDuration } from "@/lib/format";
import {
  fetchPlayback,
  pickPreviewStreamFormat,
  pickStoryboardLevel,
  storyboardSheetUrl,
} from "@/lib/watch/playback-client";
import type { StoryboardLevelDto, StreamFormatDto } from "@/lib/watch/types";

/**
 * YouTube-style hover preview (WFX2-P6-HP → P12-UX Task 4 → P22-A: the mini
 * player that PLAYS).
 *
 * ONE shared layer follows the hovered card (fixed, over the thumbnail)
 * after a 600ms dwell — exactly what youtube.com's home grid does on hover.
 *
 * P22-A: each hovered card is a MINI VIDEO PLAYER with youtube.com's preview
 * chrome — a SCRUBBABLE TIMELINE and a MUTE/UNMUTE button over the muted
 * autoplaying YouTube iframe embed (the same IFrame API the watch player
 * uses). The health gate was the P12 bug the operator reported: a flat
 * 1.5s-from-construction deadline destroyed healthy-but-slow embeds (a
 * first-hover iframe legitimately needs 1-2.5s: API script → iframe boot →
 * first buffer), so the preview almost always degraded to the storyboard
 * and — when no storyboard exists — to the ken-burns zoom. The honest
 * ladder the P22 gate keeps:
 *
 *  - the embed gets a FAIR window (the watch player's own laws): onReady
 *    must arrive within EMBED_NO_READY_MS (~5s — a loaded iframe API whose
 *    onReady never arrives is a dead/walled iframe), then PLAYING/BUFFERING
 *    within EMBED_PLAYING_MS (~4s from ready), with a BUFFERING report
 *    extending that deadline once to 2× (the probeEmbedHealth pattern —
 *    slow-but-working embeds pass; only hard onError or a truly silent
 *    iframe falls back);
 *  - onReady also belt-and-braces mutes + plays (the probe's pattern);
 *  - the STORYBOARD animation (WFX2-P6-HP) stays the fallback — sprite
 *    sheets from /api/videos/[id]/playback animated Invidious-style;
 *  - ken-burns remains the LAST resort (embed dead AND no storyboard),
 *    never the common case.
 *
 * P22-A controls: youtube.com's home-grid hover preview carries a slim
 * progress/seek bar along the bottom edge and a circular mute toggle in the
 * corner. Ours ride the same geometry; the layer itself stays
 * pointer-events-none (clicks everywhere else pass through to the card's
 * watch link — youtube.com's preview is clickable the same way), only the
 * controls take pointer events. Riding the controls must not close the
 * preview: the card's mouseleave ignores exits whose relatedTarget is
 * inside this layer, and the controls' mouseleave ignores exits onto the
 * hovered card (the store carries the card element for exactly that).
 *
 * P26-HPV — the NATIVE lane (the operator's report, 2026-10-18: "the
 * preview feature should play the video normally from within the box …
 * others are just showing slideshows of pictures from the video — that is
 * not how youtube.com does it"). Embed-disabled videos (onError 101/150 —
 * extremely common on real content) used to fall PERMANENTLY to the
 * storyboard; youtube.com plays its own streams so no embed wall exists
 * for it. The fix: embed death armed a native `<video muted autoPlay
 * playsInline>` (no controls — OUR chrome drives it) fed by the server-side
 * googlevideo proxy.
 *
 * P31-HPV5 — NATIVE-FIRST (the operator's 2026-10-20 dispatch, verbatim:
 * "now all the long format video boxes are showing slideshows instead
 * they should be playing the video from inside the box as if the box was
 * a video player just like on youtube.com"; the measured truths behind
 * it: the embed auth-wall moved onto the healthy class from datacenter
 * egresses — both hosts, "Sign in to confirm you're not a bot" — and the
 * legacy native lane's fuel was architecturally dead in production: the
 * client-held googlevideo URL is IP-bound to the playback function's
 * egress while the stream function's own egress cannot run the playback
 * chain at all — the P29 regen's 11/11 fast-502s). The ladder inverts:
 *
 *   1. the NATIVE lane FIRST — the box IS the video player: the moment
 *      the (prefetched) playback fetch lands a playable format, the
 *      muted `<video>` boots against /api/videos/<id>/playback?itag=<n>
 *      &stream=1 — the playback route's own invocation generates AND
 *      fetches the googlevideo URL (the one egress that demonstrably
 *      wins the chain lottery), so the lane's fate is BROWSER-
 *      INDEPENDENT (no embed wall, no host sensitivity, no iframe API);
 *      the storyboard keeps them company while it buffers;
 *   2. the EMBED lane — the FALLBACK now: it boots only when the native
 *      lane cannot (the fetch settled with no formats — the walled
 *      class — or the native stream died). The operator's browser may
 *      still play the walled class's embed (the datacenter cannot);
 *   3. the STORYBOARD frames — the loading companion under BOTH playing
 *      lanes (the crossfade base) and the honest floor when both die;
 *   4. ken-burns — LAST resort (no storyboard either).
 *
 * The P22-A chrome (Preview pill, mute toggle, scrubbable timeline) drives
 * BOTH playing lanes through one lane-agnostic ops adapter (previewOps).
 * Reduced-motion keeps frames-only (the documented device policy — no
 * playing video on that lane).
 *
 * P26B-HPV3 — the walled-floor pill (the operator's 2026-10-19 re-file:
 * "showing a slideshow for some videos"). When BOTH playing lanes are dead
 * AND the playback fetch has settled, the storyboard/ken-burns floor is
 * FINAL — and a silent cycling slideshow reads as a BROKEN preview, which
 * is exactly how the operator filed it. The floor now says what it is: a
 * compact "Preview unavailable" pill in the same geometry as the playing
 * lanes' own Preview pill (honest degrade over silent fake-play — the
 * repo's house law). It NEVER shows while a lane is still booting (the
 * storyboard stays the loading companion there) nor on the reduced-motion
 * lane (storyboard-only is that lane's DESIGN, not a degrade).
 *
 * P32-HPV6 — THE STRICT YOUTUBE.COM PREVIEW LAW + THE PARALLEL EMBED
 * HEAD-START (the operator's FIFTH slideshow re-file, 2026-10-21, verbatim:
 * "the shorts preview boxes are playing correctly as opposed to the long
 * format video preview boxes that are showing slideshows instead of the
 * video"; the measured truths behind it — production 2026-10-21: ALL 12
 * shorts tiles' stream modes 502, so the operator's playing shorts ride
 * THEIR browser's embed lane; the long-format popular class's native lane
 * ARMS on watch-page formats whose googlevideo fetches die at ~1.5–4.4s,
 * and while that doomed boot runs the storyboard frames CYCLE — the exact
 * "slideshow" window the operator keeps filing; the healthy class plays
 * in ~1–2.5s — TTFB 0.3–0.8s + first buffer):
 *
 *  1. THE STRICT LAW: the storyboard frames animate ONLY on the
 *     reduced-motion design lane (mode "storyboard" — that lane never
 *     plays video; cycling frames ARE its documented design). On every
 *     video-capable lane the box shows the card's own static thumbnail
 *     until a lane reports playback — the playing lane crossfades in over
 *     the STATIC THUMBNAIL. NEVER cycling pictures anywhere else: under a
 *     booting native lane, under a probing embed fallback, on a settled
 *     floor — all five re-files read the animating storyboard as "a
 *     slideshow instead of the video". (P31's companion law already banned
 *     the embed-boot window and the floor; P32 closes the last cycling
 *     class — the native boot window.)
 *  2. THE PARALLEL EMBED HEAD-START: when the native lane is armed but
 *     silent past EMBED_HEADSTART_MS, the embed boots INVISIBLE in
 *     parallel. Whichever lane proves playback first owns the box — the
 *     native's canplay/playing destroys the parallel embed boot (never two
 *     players), and the parallel embed's playback makes the silent native
 *     CONCEDE (a derived lane term — the video unmounts and the ladder
 *     falls through to the embed lane it already owns, a 2–4s earlier
 *     handoff for the operator's browser on the class whose stream is
 *     Vercel-walled but whose embed is residentially playable — exactly
 *     the shorts' measured path).
 *
 * P28-HPV4 — the operator's 2026-10-19 third re-file (verbatim: "the
 * slideshow bug is still not solved… check how youtube.com does it… the
 * previous webflix implementation (webflix-steel.vercel.app) also does the
 * preview better"), answered with the two measured laws:
 *
 *  1. THE NO-COOKIE HOST + THE HOST RETRY: webflix-steel's preview (the
 *     operator-endorsed implementation, measured live 2026-10-19) boots
 *     youtube-nocookie.com — the privacy-enhanced embed domain. The
 *     measured matrix (4 shapes × walled + control videos): every shape
 *     plays the healthy class; the wall is per-VIDEO protection class
 *     (music/VEVO), domain-insensitive from a datacenter. But the
 *     operator's browser may treat the nocookie shape differently than
 *     this sandbox could measure — so the embed lane now boots
 *     NOCOOKIE-FIRST (steel's endorsed domain, minimal playerVars) and,
 *     when that boot dies, retries ONCE on the youtube.com host with a
 *     tightened no-ready window (the API script + iframe machinery are
 *     warm; a healthy second boot reports ready fast). Coverage over
 *     latency: a walled video costs one extra boot before the honest
 *     floor; a host-walled-for-the-operator video gets SAVED by the retry.
 *  2. THE YOUTUBE.COM FLOOR ("check how youtube.com does it" — measured
 *     live 2026-10-19: youtube.com's own hover degrade NEVER animates a
 *     dead preview; it plays real video or shows the static thumbnail,
 *     nothing in between): when the walled floor is FINAL (both playing
 *     lanes dead + fetch settled), the storyboard CLOCK STOPS and the
 *     frame layer unmounts — the card's own static thumbnail shows
 *     through the preview layer, with the honest pill. The storyboard
 *     animates only while it has a real job: the loading companion under
 *     booting lanes (and the reduced-motion design lane, untouched).
 *
 * Device policy (youtube.com parity):
 *  - touch / coarse pointers: NO preview at all (hover doesn't exist);
 *  - prefers-reduced-motion: storyboard-only (no embed; the ken-burns
 *    degrade is disabled in CSS for these users too);
 *  - P22-A: shorts tiles PREVIEW ON HOVER like youtube.com (it plays
 *    shorts on hover now — muted autoplay); the old [data-no-preview]
 *    shorts opt-out is gone.
 *
 * The store lives on globalThis so the layer (rendered from the app shell)
 * and the cards (page tree) always share ONE instance, even if the bundler
 * splits the module across chunk graphs. Never more than ONE preview
 * player exists: a new show destroys the previous embed first, and hide
 * destroys it on the way out.
 */
type PreviewVideo = { id: string; title: string; thumbnailUrl?: string | null };

/** How the preview plays this video. */
type PreviewMode = "embed" | "storyboard";

type PreviewSnapshot = {
  video: PreviewVideo | null;
  rect: DOMRect | null;
  mode: PreviewMode;
  /**
   * The hovered CARD element (the article/Link that carries the hover
   * handlers). The controls' mouseleave needs it to tell "pointer moved
   * back onto the card" (keep the preview) from "pointer left for good"
   * (hide) — the fixed layer is NOT a DOM child of the card, so the card's
   * own leave/enter pair cannot express it alone.
   */
  card: HTMLElement | null;
};

type PreviewStore = {
  snapshot: PreviewSnapshot;
  listeners: Set<() => void>;
  show: (
    video: PreviewVideo,
    card: HTMLElement,
    anchor: HTMLElement,
    mode?: PreviewMode
  ) => void;
  hide: () => void;
};

const globalRef = globalThis as unknown as { __wfxPreviewStore?: PreviewStore };
const store: PreviewStore =
  globalRef.__wfxPreviewStore ??
  (globalRef.__wfxPreviewStore = {
    // ONE stable snapshot object per state (React's useSyncExternalStore
    // requires getSnapshot to return a cached reference).
    snapshot: { video: null, rect: null, mode: "storyboard", card: null },
    listeners: new Set(),
    show(video, card, anchor, mode = "storyboard") {
      store.snapshot = { video, rect: anchor.getBoundingClientRect(), mode, card };
      for (const listener of store.listeners) listener();
    },
    hide() {
      if (!store.snapshot.video) return;
      store.snapshot = { video: null, rect: null, mode: "storyboard", card: null };
      for (const listener of store.listeners) listener();
    },
  });

const DWELL_MS = 450;

/**
 * 2026-10-16 operator pass (hover speed) — the global playback prefetch
 * queue. Cards enqueue their video id on mount; ONE request runs at a time
 * (120ms spacing, 24 per session — the playback route is rate-limited and
 * each call is a server-side player fetch, so the queue keeps the warm-up
 * invisible to the rate limiter while making the FIRST sheet of every
 * likely-hovered card browser-cached). fetchPlayback itself dedupes per
 * session, and the resolved storyboard's sheet 0 is preloaded as an Image
 * so frame 0 paints the instant the preview layer shows.
 */
const PREFETCH_LIMIT = 24;
const PREFETCH_SPACING_MS = 120;

type PrefetchQueue = {
  queued: string[];
  started: Set<string>;
  running: boolean;
};

const prefetchRef = globalThis as unknown as { __wfxPlaybackPrefetch?: PrefetchQueue };
const prefetchQueue: PrefetchQueue =
  prefetchRef.__wfxPlaybackPrefetch ??
  (prefetchRef.__wfxPlaybackPrefetch = { queued: [], started: new Set(), running: false });

function enqueuePlaybackPrefetch(videoId: string): void {
  if (prefetchQueue.started.has(videoId) || prefetchQueue.started.size >= PREFETCH_LIMIT) return;
  if (!prefetchEligible()) return;
  prefetchQueue.queued.push(videoId);
  void drainPlaybackPrefetch();
}

/**
 * The prefetch is a REAL-browser optimization only: it must never fire in
 * test DOMs (happy-dom windows are about:blank — the repo's fixture-only
 * law: no stray fetches in the harness) nor on coarse-pointer devices (the
 * app's own previewModeForDevice policy — touch gets no preview at all).
 */
function prefetchEligible(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const proto = window.location?.protocol ?? "";
    if (!proto.startsWith("http")) return false;
    if (typeof window.matchMedia === "function") {
      if (window.matchMedia("(pointer: coarse)").matches) return false;
    }
  } catch {
    return false;
  }
  return true;
}

async function drainPlaybackPrefetch(): Promise<void> {
  if (prefetchQueue.running) return;
  prefetchQueue.running = true;
  try {
    while (prefetchQueue.queued.length > 0) {
      const next = prefetchQueue.queued.shift();
      if (!next || prefetchQueue.started.has(next)) continue;
      prefetchQueue.started.add(next);
      if (prefetchQueue.started.size > PREFETCH_LIMIT) break;
      try {
        const playback = await fetchPlayback(next);
        const level = playback ? pickStoryboardLevel(playback.storyboards) : null;
        if (level && typeof window !== "undefined" && typeof Image === "function") {
          // warm the first sprite sheet into the browser image cache
          const img = new Image();
          img.src = storyboardSheetUrl(level.templateUrl, 0);
        }
      } catch {
        /* a failed prefetch costs nothing — the hover lane fetches on demand */
      }
      await new Promise((resolve) => setTimeout(resolve, PREFETCH_SPACING_MS));
    }
  } finally {
    prefetchQueue.running = false;
  }
}

/**
 * P22-A — how long the embed gets for its IFrame to come ready. The watch
 * player's own no-ready law (youtube-player.tsx): "a loaded iframe API
 * whose onReady never arrives (~5s) is a dead/walled embed" — the wall
 * never initializes the player. Replaces P12's flat 1.5s-from-construction
 * deadline, which killed healthy first-hover embeds mid-boot.
 */
export const EMBED_NO_READY_MS = 5000;

/**
 * P28-HPV4 — the no-ready window for the RETRY boot (the youtube.com host,
 * after the nocookie boot died). The iframe API script and the player
 * machinery are already warm by then; a healthy second boot reports ready
 * fast, so the tightened window only shortens the walled class's road to
 * the honest floor (never murders a healthy boot — the first boot's own
 * 5s window already covered the slow-boot class).
 */
export const EMBED_RETRY_NO_READY_MS = 2500;

/**
 * P28-HPV4 — the embed hosts, in boot order: NOCOOKIE first (the
 * privacy-enhanced domain webflix-steel rides — the operator-endorsed
 * implementation, measured no-worse on the healthy class), then the
 * classic youtube.com host as the one retry (the host axis is the one
 * degree of freedom a datacenter sandbox cannot measure for the
 * operator's browser).
 */
export const EMBED_HOSTS = [
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
] as const;

/**
 * P22-A — how long after onReady the embed has to report playback
 * (PLAYING/ENDED, or BUFFERING while it keeps working). A BUFFERING report
 * extends this deadline once, to 2× (probeEmbedHealth's semantics). The
 * watch player's probe allows 7s from scratch with the same extension; a
 * hover preview crossfades in the moment playback starts, so a generous
 * window is invisible to the user — the storyboard keeps them company.
 */
export const EMBED_PLAYING_MS = 4000;

/**
 * P32-HPV6 — the parallel embed head-start window. The healthy native lane
 * proves life within ~1–2.5s of arming (measured 2026-10-21 on production:
 * the stream mode's TTFB is 0.3–0.8s, canplay follows the first buffer);
 * the doomed classes never do (the popular class's stream 502s at
 * 1.5–4.4s — and a 502 only ERRORS the element then). Past this window the
 * silent native is presumptively doomed and the embed gets its parallel
 * head start — the operator's browser can play classes the server cannot
 * (the measured shorts path: ALL 12 production shorts streams 502, the
 * operator's shorts still play — their embed lane). A healthy-but-slow
 * native that wins after the head start simply destroys the parallel boot.
 */
export const EMBED_HEADSTART_MS = 1500;

/**
 * P26-HPV — how long the NATIVE lane's <video> gets to prove it is booting
 * (playing/canplay fired, or readyState >= 2 = current data in hand). A
 * hanging /api/stream proxy fetch keeps the element in readyState 0
 * forever; after this window such a zombie is declared dead and the lane
 * falls to the storyboard (the honest floor) — a dead lane must never stay
 * armed. A playing video stops this clock for good (like the embed gate,
 * sustained playback is the proof).
 */
export const NATIVE_NO_PLAY_MS = 8000;

/**
 * P26-HPV — the delayed belt-and-braces play nudge's window (the
 * NativeFallbackPlayer's AUTOPLAY_FALLBACK_MS precedent: well inside the
 * 8s health gate, invisible under the storyboard companion). Private: the
 * tests prove the health gate through NATIVE_NO_PLAY_MS, not the nudge.
 */
const NATIVE_PLAY_NUDGE_MS = 1500;

/**
 * The hover mode for the current device — null means NO preview at all
 * (touch). Reduced-motion users get the storyboard lane only.
 */
function previewModeForDevice(): PreviewMode | null {
  if (typeof window === "undefined") return "storyboard";
  try {
    if (typeof window.matchMedia === "function") {
      if (window.matchMedia("(pointer: coarse)").matches) return null;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "storyboard";
    }
  } catch {
    /* unmatchable — fall through to the embed lane */
  }
  return "embed";
}

/**
 * Frame display cadence: storyboards typically carry a frame every ~1-2s of
 * video (real-time pace feels static on a hover) — cycle at a lively but
 * honest-feeling 1 frame/second, clamped for exotic intervals.
 */
function frameTickMs(level: StoryboardLevelDto): number {
  return Math.max(400, Math.min(1000, level.intervalMs || 1000));
}

/** The preview layer element (unique — rendered once in the app shell). */
function previewLayerEl(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector("[data-hover-preview-layer]");
}

/** Is this event target inside the shared preview layer? (the controls' home) */
function nodeInPreviewLayer(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Node)) return false;
  const layer = previewLayerEl();
  return !!layer && layer.contains(target);
}

/** Hover handlers for video cards (dwell-delayed preview start). */
export function useHoverPreview(video: PreviewVideo) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(video);

  useEffect(() => {
    current.current = video;
  }, [video]);

  // 2026-10-16 operator pass (hover speed): prefetch the playback data for
  // this card the moment it MOUNTS (throttled globally — one request at a
  // time, small spacing, session-capped) so that by the time a dwell fires,
  // the storyboard data + its first sprite sheet are already in the browser
  // cache and the preview can start moving INSTANTLY (youtube.com's own
  // previews feel immediate because their player data is preloaded with the
  // feed; the embed iframe then crossfades in over the animating frames).
  useEffect(() => {
    if (video.id) enqueuePlaybackPrefetch(video.id);
  }, [video.id]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const anchor = e.currentTarget.querySelector<HTMLElement>("[data-thumb-anchor]");
      if (!anchor) return;
      const card = e.currentTarget;
      const v = current.current;
      timer.current = setTimeout(() => {
        // The preview keys on the YouTube video id (it IS the id).
        if (!v.id) return;
        const mode = previewModeForDevice();
        if (!mode) return; // touch device — no hover preview, like youtube.com
        store.show(v, card, anchor, mode);
      }, DWELL_MS);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (timer.current) clearTimeout(timer.current);
      // P22-A: leaving the card ONTO the preview's own controls (the layer
      // is a fixed sibling, not a card child) must NOT close the preview —
      // youtube.com keeps the mini player alive while you ride its
      // timeline/mute. Everything else closes it.
      if (nodeInPreviewLayer(e.nativeEvent.relatedTarget)) return;
      store.hide();
    },
  };
}

/** Subscribe the layer to the shared preview state. */
function usePreviewSnapshot(): PreviewSnapshot {
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.snapshot,
    () => EMPTY_SNAPSHOT
  );
}

const EMPTY_SNAPSHOT: PreviewSnapshot = {
  video: null,
  rect: null,
  mode: "storyboard",
  card: null,
};

/**
 * Hidden park: offscreen at a stable nonzero size so the layer never
 * collapses while it is not showing.
 */
const PARKED_STYLE = { left: -10000, top: -10000, width: 320, height: 180 };

type Phase = "loading" | "embed" | "native" | "storyboard" | "degraded";

/**
 * The minimal embed surface the preview player + its controls need (the
 * YT.Player contract the watch player already types).
 */
type PreviewEmbedPlayer = {
  destroy(): void;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
};

/**
 * P26-HPV — the lane-agnostic player surface the P22-A chrome drives. The
 * "embed" phase maps it onto the YT embedRef methods; the "native" phase
 * maps it onto the <video> element's own properties. The control code
 * (toggleMute, seekToFraction, keyboard seek, the 4Hz progress poll) stays
 * written ONCE against this shape — it never learns which lane is live.
 */
type PreviewPlayerOps = {
  isMuted(): boolean;
  setMuted(m: boolean): void;
  seekTo(sec: number): void;
  time(): number;
  duration(): number;
};

function safeNum(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect, mode, card } = usePreviewSnapshot();
  // state for the CURRENTLY shown video only (reset per show)
  const [level, setLevel] = useState<StoryboardLevelDto | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [frame, setFrame] = useState(0);
  const [embedDead, setEmbedDead] = useState(false);
  const [embedAlive, setEmbedAlive] = useState(false);
  // P28-HPV4 — which EMBED_HOSTS boot this is (0 = nocookie first,
  // 1 = the youtube.com retry). embedAttempt === EMBED_HOSTS.length
  // means every host died — the lane is dead.
  const [embedAttempt, setEmbedAttempt] = useState(0);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState<{ time: number; duration: number }>({
    time: 0,
    duration: 0,
  });
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  // P26-HPV — the native lane's state: the fetched stream formats (one
  // playback fetch serves BOTH lanes) + the lane's own health flags.
  const [formats, setFormats] = useState<StreamFormatDto[]>([]);
  const [nativeAlive, setNativeAlive] = useState(false);
  const [nativeDead, setNativeDead] = useState(false);
  // P32-HPV6 — the parallel embed head-start flag: fired once the armed
  // native lane has been silent past EMBED_HEADSTART_MS (the timer effect
  // below). Sits in the embedLane gate so the parallel boot survives renders
  // while `!nativeAlive` still guards the never-two-players law.
  const [embedHeadstart, setEmbedHeadstart] = useState(false);
  const embedMountRef = useRef<HTMLDivElement>(null);
  const embedRef = useRef<PreviewEmbedPlayer | null>(null);
  const nativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const draggingRef = useRef(false);

  const shownId = video?.id ?? null;

  // P26-HPV — the NATIVE lane's stream: a pure pick (nearest-360p — the
  // preview box renders at thumbnail size) from the SAME playback fetch that
  // feeds the storyboard lane.
  const nativeFmt = useMemo(() => pickPreviewStreamFormat(formats), [formats]);
  // P31-HPV5 — the src rides the playback route's BOX-PLAYER STREAM MODE
  // (?itag=<n>&stream=1): the route generates AND fetches the googlevideo
  // URL in its own invocation — the egress that demonstrably wins the
  // playback-chain lottery (measured 2026-10-20: the legacy /api/stream
  // function's egress cannot run the chain at all, and any URL generated
  // by a different function's egress is IP-bound dead on arrival). No
  // client-held `url` parameter anymore — the server's own chain is the
  // only fuel, so the lane's fate is browser-independent.
  const nativeSrc = useMemo(
    () =>
      nativeFmt && shownId
        ? `/api/videos/${encodeURIComponent(shownId)}/playback?itag=${nativeFmt.itag}&stream=1`
        : null,
    [nativeFmt, shownId]
  );
  // P31-HPV5 — NATIVE-FIRST: the native lane arms the moment the playback
  // fetch lands a playable format (the prefetch queue usually has the DTO
  // warm before the dwell even fires). While the fetch is in flight the
  // storyboard/loading companion holds the box (neither lane is decidable
  // yet — never a wasted iframe boot on the healthy class). Reduced-motion
  // (mode "storyboard") never plays video — the design lane, untouched.
  const nativeLane =
    mode === "embed" &&
    !!nativeFmt &&
    !nativeDead &&
    // P32-HPV6 — THE CONCESSION, derived (never a setState-in-effect): a
    // parallel embed that reported playback while the native is
    // armed-and-silent takes the box — the silent native's lane folds RIGHT
    // HERE, the video unmounts in the same render, and the ladder falls
    // through to the embed lane it already owns. This is the operator's
    // measured shorts path generalized: the browser's embed plays classes
    // the server's stream cannot. (embedAlive is only ever set by a BOOTED
    // embed, which required the head start — so the term is inert before it.)
    !(embedAlive && !nativeAlive);
  // P31-HPV5 — the EMBED lane is the FALLBACK: it boots only when the
  // native lane cannot — the fetch settled with NO formats (the walled
  // class), the native stream died mid-preview, the native CONCEDED to a
  // playing parallel embed (the derived term above), OR (P32-HPV6) the
  // armed native has been silent past the parallel head-start window while
  // not (yet) proving playback (the doomed class's stream dies at 1.5–4.4s
  // while the operator's browser can still play that class's embed — the
  // measured shorts path). The fetchDone gate keeps the embed from booting
  // speculatively during the in-flight window (the old first-rung position
  // is gone: the operator's own browser class now sits behind the same auth
  // wall the datacenter measured). A native that DIED (nativeDead — error
  // after playback included) hands the box back via `!nativeLane`; a native
  // that is PLAYING keeps it (the `!nativeAlive` term inside the head-start
  // arm — the single-player law: the lane flip destroys the parallel boot).
  const embedLane =
    mode === "embed" &&
    !embedDead &&
    fetchDone &&
    (!nativeLane || (embedHeadstart && !nativeAlive));

  // Reset the animation + controls when the shown video changes — the
  // sanctioned adjust-during-render pattern (setState synchronously in an
  // effect body is the cascading-render anti-pattern the linter rightly
  // rejects).
  const [resetFor, setResetFor] = useState<string | null>(shownId);
  if (resetFor !== shownId) {
    setResetFor(shownId);
    setLevel(null);
    setFetchDone(false);
    setFrame(0);
    setEmbedDead(false);
    setEmbedAlive(false);
    setEmbedAttempt(0);
    setMuted(true);
    setProgress({ time: 0, duration: 0 });
    setScrubFrac(null);
    setFormats([]);
    setNativeAlive(false);
    setNativeDead(false);
    setEmbedHeadstart(false);
  }

  // Hide when the page scrolls (the anchor rect would go stale).
  useEffect(() => {
    if (!video) return;
    const onScroll = () => store.hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [video]);

  // Per shown video: fetch the storyboard (client-cached by fetchPlayback —
  // one request per video per session). The storyboard is the PRIMARY lane
  // in storyboard mode (reduced motion) and the FALLBACK data for the embed
  // lane — one fetch serves both. P26-HPV: the SAME fetch now also feeds the
  // NATIVE lane (playback.streamFormats — the embed-death fallback's fuel;
  // the watch page's PlayerFallback reads the same endpoint).
  useEffect(() => {
    if (shownId === null) return;
    let alive = true;
    void fetchPlayback(shownId).then((playback) => {
      if (!alive) return;
      setLevel(playback ? pickStoryboardLevel(playback.storyboards) : null);
      setFormats(playback?.streamFormats ?? []);
      setFetchDone(true);
    });
    return () => {
      alive = false;
    };
  }, [shownId]);

  // The embed lane: ONE muted autoplaying player per shown video, created
  // inside an imperative host (the probeEmbedHealth pattern — YT.Player
  // replaces the host with an iframe, so the React-owned mount stays
  // stable). The P22-A health gate (honest ladder — never a walled iframe,
  // never a murdered healthy one):
  //   - onReady within the boot's no-ready window (EMBED_NO_READY_MS for
  //     the first boot; the tighter EMBED_RETRY_NO_READY_MS for retries),
  //     else give up (dead iframe);
  //   - onReady → belt-and-braces mute + play, then a EMBED_PLAYING_MS
  //     window for playback, extended ONCE to 2× by a BUFFERING report;
  //   - onError → give up immediately (101/150 embed-disabled included);
  //   - PLAYING/ENDED → healthy, the deadline clocks stop for good.
  //
  // P28-HPV4 — the HOST LADDER: boot 0 rides the no-cookie host
  // (webflix-steel's endorsed domain), and give-up on any boot before the
  // last RETRIES on the next host rather than declaring the lane dead —
  // the host axis is the one degree of freedom the datacenter matrix
  // could not measure for the operator's browser. Only the LAST boot's
  // death sets embedDead (arming the honest floor).
  //
  // P31-HPV5 — the lane runs only when embedLane (the FALLBACK position:
  // the fetch settled with no formats, or the native lane died). Keyed on
  // embedLane itself so the boot follows the mount: the div renders in the
  // same commit that flips the lane, this effect re-runs on the dep, and a
  // lane flip AWAY (the native lane arming, or the ladder's death) runs
  // the cleanup — destroying any boot in flight. Never two players.
  useEffect(() => {
    if (shownId === null || !embedLane) return;
    const mount = embedMountRef.current;
    if (!mount) return;
    // a fresh embed means a fresh scrub (an interrupted drag must not leak
    // into the next preview's pointermove — refs only move inside effects)
    draggingRef.current = false;
    const attempt = Math.min(embedAttempt, EMBED_HOSTS.length - 1);
    const embedHost = EMBED_HOSTS[attempt];
    const isRetry = attempt > 0;
    let cancelled = false;
    let noReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let playingTimer: ReturnType<typeof setTimeout> | null = null;
    let extended = false; // BUFFERING extends the playing deadline once
    let embed: PreviewEmbedPlayer | null = null;
    const host = document.createElement("div");
    host.className = "absolute inset-0 h-full w-full";
    mount.appendChild(host);

    const clearTimers = () => {
      if (noReadyTimer) {
        clearTimeout(noReadyTimer);
        noReadyTimer = null;
      }
      if (playingTimer) {
        clearTimeout(playingTimer);
        playingTimer = null;
      }
    };

    const giveUp = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimers();
      // capture the handle before nulling the closure (the ref clear below
      // must compare against the REAL player, not against null)
      const dead = embed;
      try {
        dead?.destroy();
      } catch {
        /* already destroyed */
      }
      // P28-HPV4 — null the closure's handle: the effect cleanup that
      // follows the embedAttempt bump must not destroy this boot a SECOND
      // time (the real YT destroy is idempotent, but the double call is
      // observable in tests and semantically wrong — one death, one destroy).
      embed = null;
      if (embedRef.current === dead) embedRef.current = null;
      host.remove();
      setEmbedAlive(false);
      if (attempt < EMBED_HOSTS.length - 1) {
        // P28-HPV4 — one host remains: boot it (the effect re-runs on the
        // embedAttempt bump; this cleanup already tore this boot down).
        setEmbedAttempt(attempt + 1);
      } else {
        setEmbedDead(true);
      }
    };

    const armPlaying = (ms: number) => {
      if (playingTimer) clearTimeout(playingTimer);
      playingTimer = setTimeout(() => {
        // Belt-and-braces: the state may have advanced without the event
        // landing yet — ask the player itself before giving up.
        let state = -1;
        try {
          state = embed?.getPlayerState() ?? -1;
        } catch {
          state = -1;
        }
        if (state === 1 || state === 3 || state === 0) {
          clearTimers();
          setEmbedAlive(true);
        } else giveUp();
      }, ms);
    };

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        embed = new YT.Player(host, {
          videoId: shownId,
          // P28-HPV4 — the host ladder: no-cookie first (steel's endorsed
          // privacy-enhanced domain), youtube.com as the retry.
          host: embedHost,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            mute: 1,
            // youtube.com's preview chrome is its own slim timeline + mute
            // toggle (see the controls below) — the full ytp chrome would
            // dwarf a 320px card. The controls live in OUR layer. The rest
            // of the old var bundle (rel/modestbranding/iv_load_policy/
            // fs/disablekb) is GONE — the P28 measured matrix keeps the
            // boot shape minimal, exactly the family webflix-steel rides.
            controls: 0,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              // The watch player's own belt-and-braces: muted autoplay is
              // the policy every browser allows — ask for it explicitly.
              try {
                embed?.mute();
                embed?.playVideo();
              } catch {
                /* the deadline decides */
              }
              if (noReadyTimer) {
                clearTimeout(noReadyTimer);
                noReadyTimer = null;
              }
              armPlaying(EMBED_PLAYING_MS);
            },
            onStateChange: (e: { data: number }) => {
              if (cancelled) return;
              if (e.data === 1 || e.data === 0) {
                // PLAYING / ENDED — sustained playback proof. The clocks stop.
                clearTimers();
                setEmbedAlive(true);
              } else if (e.data === 3) {
                // BUFFERING — the embed is alive (the wall never buffers);
                // crossfade it in, and give a slow-but-working player one
                // deadline extension (the probe's semantics).
                setEmbedAlive(true);
                if (!extended) {
                  extended = true;
                  armPlaying(EMBED_PLAYING_MS * 2);
                }
              }
            },
            onError: () => giveUp(),
          },
        });
        embedRef.current = embed;
        // The no-ready law: a loaded iframe API whose onReady never arrives
        // is a dead/walled iframe (the watch player's ~5s precedent). The
        // retry boot rides the tightened window — the machinery is warm.
        noReadyTimer = setTimeout(() => {
          if (!cancelled) giveUp();
        }, isRetry ? EMBED_RETRY_NO_READY_MS : EMBED_NO_READY_MS);
      })
      .catch(() => giveUp()); // iframe_api dead → no embed can play

    return () => {
      cancelled = true;
      clearTimers();
      try {
        embed?.destroy();
      } catch {
        /* already destroyed */
      }
      if (embedRef.current === embed) embedRef.current = null;
      host.remove();
    };
    // P31-HPV5 — embedLane keyed: the boot follows the mount (the lane
    // flips after the fetch settles / the native lane dies), and a flip
    // away destroys any boot in flight. mode is carried inside embedLane.
  }, [shownId, embedLane, embedAttempt]);

  // The effective phase — the 2026-10-16 operator pass (hover speed): the
  // STORYBOARD animates immediately whenever its data is in hand
  // (prefetched at card mount) — the preview starts moving the moment the
  // dwell fires, exactly like youtube.com's instant previews, and the real
  // video crossfades in over the moving frames when a playing lane reports
  // playback. The spinner + ken-burns "loading" chrome only shows when
  // there is genuinely no storyboard data yet (fetch still in flight).
  //
  // P31-HPV5 — NATIVE-FIRST: the native rung owns the box whenever a
  // playable format exists (the storyboard stays the companion while it
  // buffers — the same crossfade law); the EMBED rung covers the walled
  // class (no formats) and the native-death class; both dead → the honest
  // floor (storyboard unmounted + the pill, per the P28 law).
  const phase: Phase = nativeLane
    ? nativeAlive
      ? "native"
      : level
        ? "storyboard"
        : "loading"
    : embedLane
      ? embedAlive
        ? "embed"
        : level
          ? "storyboard"
          : "loading"
      : level
        ? "storyboard"
        : fetchDone
          ? "degraded"
          : "loading";

  // P26B-HPV3 — the walled floor is FINAL when both playing lanes are dead
  // (P31: the embed ladder exhausted AND the native lane cannot arm — no
  // format / died) and the playback fetch has settled: no playing lane can
  // still arrive. This is the pill's gate — strictly narrower than
  // `phase === "storyboard"`, which also covers the loading companion
  // while a lane boots.
  const walledFloor =
    mode === "embed" &&
    embedDead &&
    !nativeLane &&
    fetchDone &&
    (phase === "storyboard" || phase === "degraded");

  // P26-HPV — belt-and-braces play (the NativeFallbackPlayer precedent): a
  // declarative <video muted autoPlay> can still arrive paused in odd
  // runtimes, so one delayed nudge re-asks for playback — guarded twice:
  //  - `paused` — autoplay already took (the common case), nothing to brace;
  //  - `readyState >= 2` — the element has current data in hand but is not
  //    playing. A still-empty buffer (readyState < 2) is the HEALTH GATE's
  //    business, not the nudge's: kicking play() at an empty buffer only
  //    re-issues the load the autoPlay attribute already started, and in
  //    runtimes without a media stack (the test DOM) the nudge stays inert.
  // Keyed on the lane + the src: once per stream, never per render.
  useEffect(() => {
    if (!nativeLane || !nativeSrc) return;
    const v = nativeVideoRef.current;
    if (!v) return;
    const t = setTimeout(() => {
      if (!v.paused) return; // autoplay took
      if (v.readyState < 2) return; // nothing playable in hand yet
      v.muted = true; // muted autoplay is the policy every browser allows
      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* runtime without media playback — the health gate decides */
      }
    }, NATIVE_PLAY_NUDGE_MS);
    return () => clearTimeout(t);
  }, [nativeLane, nativeSrc]);

  // P26-HPV — the native health gate (the zombie guard): if neither
  // `playing` nor `canplay` fired by NATIVE_NO_PLAY_MS AND readyState < 2,
  // the lane is dead — a hanging proxy fetch must not keep a dead lane
  // armed — and the storyboard takes over (the honest floor). A playing
  // video stops this clock for good (the effect disarms on nativeAlive).
  useEffect(() => {
    if (!nativeLane || nativeAlive) return;
    const timer = setTimeout(() => {
      const v = nativeVideoRef.current;
      if (!v) return; // unmounted mid-window — nothing to guard
      if (v.readyState < 2) setNativeDead(true);
    }, NATIVE_NO_PLAY_MS);
    return () => clearTimeout(timer);
  }, [nativeLane, nativeAlive]);

  // P32-HPV6 — the parallel embed head-start timer: an armed native that
  // stays silent past EMBED_HEADSTART_MS is presumptively doomed (the
  // healthy class proves life in ~1–2.5s — measured; the popular class's
  // stream dies at 1.5–4.4s). Firing the flag arms the embed lane IN
  // PARALLEL (invisible — its opacity gate is the phase, which stays on the
  // native's storyboard/loading label until a lane reports playback). A
  // native that proves life afterwards simply flips embedLane false via
  // `!nativeAlive` and the boot effect's cleanup destroys the parallel
  // embed — never two players, and the healthy class's only cost is one
  // speculative iframe boot on its slow tail.
  useEffect(() => {
    if (!nativeLane || nativeAlive) return;
    const timer = setTimeout(() => setEmbedHeadstart(true), EMBED_HEADSTART_MS);
    return () => clearTimeout(timer);
  }, [nativeLane, nativeAlive]);

  // The animation clock: advance the frame cursor while shown + storyboard.
  // P31-HPV5 — THE YOUTUBE.COM COMPANION LAW; P32-HPV6 — THE STRICT LAW (the
  // operator's five slideshow re-files distilled): the frames animate ONLY
  // on the reduced-motion design lane (mode "storyboard" — that lane's
  // documented DESIGN, it never plays video). On every video-capable lane
  // the frames are GONE — the card's own static thumbnail holds the box
  // until a lane reports playback, and the playing lane crossfades in over
  // the static thumbnail: youtube.com's own measured hover law ("it plays
  // real video or shows the static thumbnail, nothing in between") applied
  // to EVERY lane state — booting native, probing embed, settled floor. A
  // cycling frame sequence under ANY lane is exactly the "slideshow" the
  // operator kept filing (re-files #1–#5, 2026-10-16 → 2026-10-21).
  const framesLive = mode === "storyboard";
  useEffect(() => {
    if (!framesLive || phase !== "storyboard" || !level || shownId === null) return;
    const tick = frameTickMs(level);
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % Math.max(1, level.frameCount));
    }, tick);
    return () => clearInterval(timer);
  }, [framesLive, phase, level, shownId]);

  // P26-HPV — the ops adapter: the ONE lane-agnostic surface the P22-A
  // chrome drives. The "embed" phase maps it onto the YT embedRef methods,
  // the "native" phase onto the <video> element's own properties; null when
  // no playing lane owns the card. Stable per phase (refs only move inside
  // effects), so the poll below can depend on it.
  const previewOps = useCallback((): PreviewPlayerOps | null => {
    if (phase === "embed") {
      const p = embedRef.current;
      if (!p) return null;
      return {
        isMuted: () => {
          try {
            return p.isMuted();
          } catch {
            return true;
          }
        },
        setMuted: (m) => {
          try {
            if (m) p.mute();
            else p.unMute();
          } catch {
            /* player gone */
          }
        },
        seekTo: (sec) => {
          try {
            p.seekTo(sec, true);
          } catch {
            /* player gone */
          }
        },
        time: () => {
          try {
            return safeNum(p.getCurrentTime());
          } catch {
            return 0;
          }
        },
        duration: () => {
          try {
            return safeNum(p.getDuration());
          } catch {
            return 0;
          }
        },
      };
    }
    if (phase === "native") {
      const v = nativeVideoRef.current;
      if (!v) return null;
      return {
        isMuted: () => v.muted,
        setMuted: (m) => {
          v.muted = m;
        },
        seekTo: (sec) => {
          v.currentTime = sec;
        },
        time: () => safeNum(v.currentTime),
        duration: () => safeNum(v.duration),
      };
    }
    return null;
  }, [phase]);

  // P22-A — the timeline's heartbeat: poll the live player ~4Hz while a
  // PLAYING lane owns the card (the watch player's progress loop,
  // preview-sized). P26-HPV: keys on "embed" OR "native" and routes through
  // the lane-agnostic ops adapter — the poll never learns which lane is live
  // (the native <video> also self-reports via onTimeUpdate; the poll is the
  // belt-and-braces that keeps the embed lane moving).
  useEffect(() => {
    if ((phase !== "embed" && phase !== "native") || shownId === null) return;
    const poll = setInterval(() => {
      const ops = previewOps();
      if (!ops) return;
      try {
        setProgress({ time: ops.time(), duration: ops.duration() });
        setMuted(ops.isMuted());
      } catch {
        /* player gone — the phase change will stop the poll */
      }
    }, 250);
    return () => clearInterval(poll);
  }, [phase, shownId, previewOps]);

  const visible = !!video && !!rect;

  // storyboard geometry for the current frame (sheet/col/row) — P32's
  // STRICT LAW: the frames render ONLY on the reduced-motion design lane
  // (their one animating home — the clock above runs there). On the
  // video-capable lanes the geom stays null and the card's own static
  // thumbnail (the img below, always mounted) is every lane's crossfade
  // base — the playing <video>/embed fades in over IT, exactly the way the
  // embed lane already did (P28).
  const geom = (() => {
    if (!framesLive || !level) {
      return null;
    }
    const perSheet = level.cols * level.rows;
    const clamped = Math.min(frame, Math.max(0, level.frameCount - 1));
    const sheet = Math.floor(clamped / perSheet);
    const inSheet = clamped % perSheet;
    const col = inSheet % level.cols;
    const row = Math.floor(inSheet / level.cols);
    return {
      sheetUrl: storyboardSheetUrl(level.templateUrl, sheet),
      backgroundSize: `${level.cols * level.frameWidth}px ${level.rows * level.frameHeight}px`,
      backgroundPosition: `${-col * level.frameWidth}px ${-row * level.frameHeight}px`,
    };
  })();

  /* ---- P22-A: the preview chrome (youtube.com's home-grid hover) ---- */

  /** Leave a control: keep the preview while the pointer rides this layer's
   * controls or returns to the hovered card; everything else hides it. */
  const onControlsLeave = (e: React.MouseEvent) => {
    const to = e.nativeEvent.relatedTarget;
    if (nodeInPreviewLayer(to)) return;
    if (to instanceof Node && card?.contains(to)) return;
    store.hide();
  };
  const toggleMute = () => {
    // P26-HPV — routed through the ops adapter: the same button drives the
    // YT embed (mute/unMute) and the native <video> (the muted property).
    const ops = previewOps();
    if (!ops) return;
    const next = !ops.isMuted();
    ops.setMuted(next);
    setMuted(next);
  };

  const seekToFraction = (frac: number) => {
    const clamped = Math.min(1, Math.max(0, frac));
    setScrubFrac(clamped); // the bar follows the pointer immediately
    // P26-HPV — routed through the ops adapter (YT seekTo / currentTime).
    const ops = previewOps();
    if (!ops) return;
    const dur = ops.duration();
    if (dur > 0) ops.seekTo(clamped * dur);
  };

  const fracFromPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  };

  const shownFrac =
    scrubFrac ??
    (progress.duration > 0 ? Math.min(1, progress.time / progress.duration) : 0);

  return (
    <div
      data-hover-preview-layer=""
      data-testid={visible ? "hover-preview" : undefined}
      aria-label="Video preview"
      className={cn(
        "pointer-events-none fixed z-30 overflow-hidden rounded-xl border border-border/40 bg-black shadow-2xl",
        !visible && "invisible"
      )}
      style={
        rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : PARKED_STYLE
      }
    >
      {video ? (
        <div className="relative h-full w-full bg-black" data-preview-phase={phase}>
          {/* the thumbnail base: ken-burns while loading/degraded; static
              backdrop under the storyboard frames (a failed sheet load
              degrades to this — never a broken box) */}
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              className={cn(
                "absolute inset-0 h-full w-full object-cover",
                (phase === "loading" || phase === "degraded") && "wfx-kenburns"
              )}
            />
          ) : null}
          {/* the mini player: a muted autoplaying embed, crossfaded in over
              the thumbnail once it reports playback. It occupies this layer
              — the card's own thumbnail rect — so the preview can never
              shift layout. */}
          {embedLane && (
            <div
              ref={embedMountRef}
              data-testid="hover-preview-embed"
              className={cn(
                "absolute inset-0 h-full w-full bg-black transition-opacity duration-300",
                phase === "embed" ? "opacity-100" : "opacity-0"
              )}
            />
          )}
          {/* P31-HPV5 — the NATIVE lane, FIRST: a declarative muted-
              autoplaying <video> — THE BOX IS THE VIDEO PLAYER — fed by the
              playback route's own stream mode (generate + fetch on one
              egress; React renders a plain video element fine — only the YT
              embed needs its imperative host). NO controls: our own P22-A
              chrome drives it through the ops adapter; aria-hidden because
              the LAYER carries the preview's aria (a muted decorative
              video needs no second announcement). The storyboard frames
              stay mounted underneath as the crossfade companion while it
              buffers — the same law the embed lane follows. */}
          {nativeLane && nativeFmt ? (
            <video
              ref={nativeVideoRef}
              data-testid="hover-preview-video"
              src={nativeSrc ?? undefined}
              muted
              autoPlay
              playsInline
              preload="auto"
              aria-hidden="true"
              className={cn(
                "absolute inset-0 h-full w-full bg-black object-contain transition-opacity duration-300",
                phase === "native" ? "opacity-100" : "opacity-0"
              )}
              onPlaying={() => setNativeAlive(true)}
              onCanPlay={() => setNativeAlive(true)}
              onTimeUpdate={() => {
                // self-reported progress (the native lane's own heartbeat —
                // the 4Hz poll below is the belt-and-braces)
                const v = nativeVideoRef.current;
                if (!v) return;
                setProgress({ time: safeNum(v.currentTime), duration: safeNum(v.duration) });
              }}
              onError={() => setNativeDead(true)}
            />
          ) : null}
          {phase === "loading" ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-black/30"
            >
              <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          ) : null}
          {/* P32-HPV6 — the storyboard frame layer: the reduced-motion
              design lane's OWN surface (cycling frames are that lane's
              documented design — it never plays video). NOWHERE ELSE — the
              video-capable lanes show the card's own static thumbnail (the
              img above, always mounted) until a lane reports playback, and
              the playing lane crossfades in over IT: youtube.com's own
              measured law (play video or show the static thumbnail — never
              a cycling "slideshow" under a booting native, a probing embed
              fallback, or a settled floor; the operator's five re-files). */}
          {geom && !walledFloor ? (
            <div
              data-testid="storyboard-frame"
              className="absolute inset-0 transition-opacity duration-300"
              style={{
                backgroundImage: `url("${geom.sheetUrl}")`,
                backgroundSize: geom.backgroundSize,
                backgroundPosition: geom.backgroundPosition,
                backgroundRepeat: "no-repeat",
                imageRendering: "auto",
              }}
            />
          ) : null}
          {/* P26B-HPV3 — the walled-floor pill: both playing lanes dead + the
              fetch settled → the floor is final and SAYS SO (the operator's
              2026-10-19 re-file: a silent slideshow reads as a broken
              preview). Same geometry as the playing lanes' Preview pill. */}
          {walledFloor ? (
            <span
              data-testid="hover-preview-unavailable"
              title="Playback is blocked from this server right now — the preview cannot play this video here"
              className="pointer-events-none absolute bottom-3 left-2 z-10 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
            >
              <VideoOff className="size-3" aria-hidden="true" />
              Preview unavailable
            </span>
          ) : null}
          {phase === "embed" || phase === "native" ? (
            <>
              {/* the pill — youtube.com's own "Preview" label, decorative */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-3 left-2 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                <PlayCircle className="size-3" aria-hidden="true" /> Preview
              </span>
              {/* the mute toggle — youtube.com's circular corner button */}
              <button
                type="button"
                data-testid="hover-preview-mute"
                aria-label={muted ? "Unmute preview" : "Mute preview"}
                onClick={toggleMute}
                onMouseLeave={onControlsLeave}
                className="pointer-events-auto absolute bottom-3 right-2 flex size-8 items-center justify-center rounded-full bg-black/80 text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
              >
                {muted ? (
                  <VolumeX className="size-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="size-4" aria-hidden="true" />
                )}
              </button>
              {/* the timeline — youtube.com's slim bottom seek bar (scrub by
                  pointer, step by keyboard — a real slider, not a picture
                  of one) */}
              <div
                data-testid="hover-preview-seek"
                role="slider"
                tabIndex={0}
                aria-label="Seek preview"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round(progress.duration))}
                aria-valuenow={Math.min(
                  Math.max(0, Math.round(progress.time)),
                  Math.max(0, Math.round(progress.duration))
                )}
                aria-valuetext={
                  progress.duration > 0
                    ? `${formatDuration(progress.time)} of ${formatDuration(progress.duration)}`
                    : "Loading"
                }
                onPointerDown={(e) => {
                  draggingRef.current = true;
                  // capture is best-effort (it throws for non-active
                  // pointers, e.g. synthetic events): without it the drag
                  // still tracks while the pointer rides the bar.
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* capture unavailable — the bar-local drag still works */
                  }
                  seekToFraction(fracFromPointer(e));
                }}
                onPointerMove={(e) => {
                  if (draggingRef.current) seekToFraction(fracFromPointer(e));
                }}
                onPointerUp={(e) => {
                  draggingRef.current = false;
                  setScrubFrac(null);
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* capture already lost */
                  }
                }}
                onKeyDown={(e) => {
                  // P26-HPV — routed through the ops adapter (YT seekTo /
                  // currentTime): the same keys step both playing lanes.
                  const ops = previewOps();
                  const dur = ops ? ops.duration() : 0;
                  if (dur <= 0) return;
                  const step = e.key === "Home" || e.key === "End" ? 0 : 5;
                  let next: number | null = null;
                  if (e.key === "ArrowRight") next = progress.time + step;
                  else if (e.key === "ArrowLeft") next = progress.time - step;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = dur;
                  if (next === null) return;
                  e.preventDefault();
                  next = Math.min(dur, Math.max(0, next));
                  ops?.seekTo(next);
                  setProgress((prev) => ({ ...prev, time: next }));
                }}
                onMouseLeave={onControlsLeave}
                className="group/seek pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex h-4 cursor-pointer touch-none items-end focus-visible:outline-none"
              >
                <div className="relative h-1 w-full bg-white/30 transition-[height] group-hover/seek:h-1.5">
                  <div
                    data-testid="hover-preview-seek-fill"
                    className="absolute inset-y-0 left-0 bg-yt-red"
                    style={{ width: `${shownFrac * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
