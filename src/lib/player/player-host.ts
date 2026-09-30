"use client";

/**
 * WFX2-C-S — the persistent player host (miniplayer persistence).
 *
 * YouTube behavior: leaving the watch page (or scrolling past the player)
 * shrinks the SAME player into a bottom-right miniplayer (~400x225 +
 * progress bar + title/channel + close/expand) that survives every route;
 * coming back to /watch/{same id} expands it at the SAME position; a
 * different video id takes the player over via loadVideoById (no iframe
 * reload); Close is the ONLY destroy path.
 *
 * Architecture (the "wrapper never unmounts" law):
 * - ONE persistent DOM node (`wrapper`) is created lazily and NEVER removed
 *   by React — the YoutubePlayer is rendered into it via createPortal from
 *   <PlayerHostLayer/> (mounted ABOVE the route tree in the AppShell), so
 *   React's reconciliation never touches the wrapper's position.
 * - We move the wrapper between hosts imperatively:
 *     · the watch page's inline slot (registered via a ref callback),
 *     · the miniplayer's video area (owned by the layer),
 *     · a detached limbo (between hosts — never painted).
 * - Release → limbo → requestAnimationFrame check: if no slot re-registered
 *   during the same commit (watch→watch takeover registers synchronously),
 *   the wrapper goes to the mini (survival matrix: every route except
 *   /watch keeps the mini; /watch always takes the player inline; watch
 *   error pages have no slot → mini shows, matching the matrix).
 * - Takeover (different video id) — the "stale-detach" guard: before
 *   attaching to a new slot the wrapper is always appendChild-ed out of its
 *   stale parent first, and the store's videoId/startSec update flows into
 *   the portal, where YoutubePlayer's [videoId] effect calls
 *   loadVideoById — the iframe keeps playing, no mini flash.
 *
 * The React-facing state lives in a zustand store (NOT persisted — the
 * miniplayer is a session construct, like YouTube's). DOM ops run through
 * the imperative `playerHost` manager below (never during React commits
 * except pure appendChild moves from ref callbacks, which are safe).
 */
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { readProgress, type YoutubePlayerHandle } from "@/components/watch/youtube-player";

export type PlayerHostVideo = {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  /** 0 → live (mini hides the progress bar). */
  durationSec: number;
};

export type PlayerHostMode = "inline" | "mini";

export type PlayerHostState = {
  /** null → no player mounted (fresh session or after Close). */
  videoId: string | null;
  meta: PlayerHostVideo | null;
  hostMode: PlayerHostMode;
  /** Latched start position for the current videoId (takeover seeks here). */
  startSec: number | null;
  /** ~1/sec while playing (drives the mini progress bar + chat reveal). */
  positionSec: number;
  durationSec: number;
  playing: boolean;
};

type Listener<T> = (value: T) => void;
type ProgressListener = (sec: number, durationSec: number) => void;

const initialHostState: PlayerHostState = {
  videoId: null,
  meta: null,
  hostMode: "mini",
  startSec: null,
  positionSec: 0,
  durationSec: 0,
  playing: false,
};

/** The store factory (tests construct isolated stores). */
export function createPlayerHostStore() {
  return create<PlayerHostState>()(() => ({ ...initialHostState }));
}

/** The app store. Session-scoped — NOT persisted (mini never survives reload). */
export const usePlayerHost: UseBoundStore<StoreApi<PlayerHostState>> =
  createPlayerHostStore();

/* ------------------------------------------------------------------ */
/* The imperative manager                                              */
/* ------------------------------------------------------------------ */

class PlayerHostManager {
  /** The persistent wrapper div — created once, never removed by React. */
  wrapper: HTMLDivElement | null = null;
  /** The watch page's inline slot (registered by ref callback). */
  slot: HTMLElement | null = null;
  /** The miniplayer's video area (registered by the layer). */
  miniHost: HTMLElement | null = null;
  /** The player handle (seek/play/pause from any surface). */
  handleRef = { current: null as YoutubePlayerHandle | null };
  /** Playhead mirror for refresh-style reads. */
  private lastPositionSec = 0;

  private progressListeners = new Set<ProgressListener>();
  private endedListeners = new Set<Listener<void>>();
  private stateListeners = new Set<
    Listener<"unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued" | "error">
  >();
  private expandListeners = new Set<Listener<void>>();
  private miniCheckScheduled = false;

  /** Lazy wrapper creation (client only). */
  ensureWrapper(): HTMLDivElement | null {
    if (typeof document === "undefined") return null;
    if (!this.wrapper) {
      this.wrapper = document.createElement("div");
      this.wrapper.className =
        "absolute inset-0 h-full w-full overflow-hidden bg-black";
      this.wrapper.setAttribute("data-wfx-player-host", "");
    }
    return this.wrapper;
  }

  private get state(): PlayerHostState {
    return usePlayerHost.getState();
  }

  private set(partial: Partial<PlayerHostState>) {
    usePlayerHost.setState(partial);
  }

  /** Move the wrapper to a host (appendChild detaches it from the stale
   * parent atomically — the "stale-detach" guard). Explicit target —
   * commit-phase callers (ref callbacks) pass it directly so the DOM move
   * never depends on (nor mutates) React state mid-commit. */
  private placeTo(target: "slot" | "mini" | "limbo") {
    const wrapper = this.wrapper;
    if (!wrapper) return;
    const parent =
      target === "mini" ? this.miniHost : target === "slot" ? this.slot : null;
    if (parent && wrapper.parentElement !== parent) {
      parent.appendChild(wrapper);
    } else if (!parent && wrapper.isConnected) {
      // limbo: a detached DocumentFragment — never painted, keeps playing
      document.createDocumentFragment().appendChild(wrapper);
    }
  }

  /** Place per the store's hostMode (post-commit contexts only). */
  private place() {
    this.placeTo(this.state.hostMode === "mini" ? "mini" : "slot");
  }

  /**
   * The watch page (or any surface) takes the player. Same videoId →
   * expand at the same position (no reload). Different videoId →
   * takeover via loadVideoById (latched startSec, no mini flash).
   */
  attach(video: {
    videoId: string;
    title?: string;
    channelName?: string;
    thumbnailUrl?: string | null;
    durationSec?: number;
    startSec?: number | null;
  }) {
    const current = this.state;
    const sameVideo = current.videoId === video.videoId;
    if (!sameVideo) {
      // takeover: latch the start position; the portal re-renders with the
      // new videoId → YoutubePlayer's [videoId] effect → loadVideoById.
      this.set({
        videoId: video.videoId,
        startSec: video.startSec ?? readProgress(video.videoId) ?? null,
        positionSec: 0,
        durationSec: video.durationSec ?? 0,
        playing: false,
        meta: {
          videoId: video.videoId,
          title: video.title ?? "",
          channelName: video.channelName ?? "",
          thumbnailUrl: video.thumbnailUrl ?? null,
          durationSec: video.durationSec ?? 0,
        },
      });
    } else {
      // same video: enrich meta as the page learns it (title/channel/etc.)
      if (video.title !== undefined || video.channelName !== undefined) {
        const meta = current.meta;
        this.set({
          meta: {
            videoId: video.videoId,
            title: video.title ?? meta?.title ?? "",
            channelName: video.channelName ?? meta?.channelName ?? "",
            thumbnailUrl: video.thumbnailUrl ?? meta?.thumbnailUrl ?? null,
            durationSec: video.durationSec ?? meta?.durationSec ?? 0,
          },
          durationSec: video.durationSec ?? current.durationSec,
        });
      }
    }
    // /watch always takes the player inline.
    this.set({ hostMode: "inline" });
    this.place();
  }

  /** Enrich the current video's meta (detail arrives after attach). */
  updateMeta(meta: {
    title?: string;
    channelName?: string;
    thumbnailUrl?: string | null;
    durationSec?: number;
  }) {
    const current = this.state;
    if (current.videoId === null || current.meta === null) return;
    this.set({
      meta: {
        ...current.meta,
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        ...(meta.channelName !== undefined ? { channelName: meta.channelName } : {}),
        ...(meta.thumbnailUrl !== undefined ? { thumbnailUrl: meta.thumbnailUrl } : {}),
        ...(meta.durationSec !== undefined ? { durationSec: meta.durationSec } : {}),
      },
      ...(meta.durationSec !== undefined ? { durationSec: meta.durationSec } : {}),
    });
  }

  /** Watch page slot registration (ref callback — commit-phase safe:
   * pure DOM move, no store mutation). A watch page ALWAYS takes the
   * player inline — same commit as the stale parent's removal → the move
   * is never painted in between → no mini flash on takeover/expand. */
  registerSlot(el: HTMLElement) {
    this.slot = el;
    if (this.state.videoId !== null) {
      this.placeTo("slot");
    }
  }

  /** Watch page slot release (ref cleanup — commit-phase safe).
   * Stale releases (an old page unmounting late) are ignored by identity. */
  releaseSlot(el: HTMLElement | null) {
    if (el !== null && this.slot !== el) return; // stale-detach guard
    this.slot = null;
    if (this.state.videoId === null) return;
    if (this.state.hostMode === "mini" && this.miniHost) return; // already mini
    // limbo now; decide mini after the commit settles (a watch→watch
    // navigation re-registers a slot synchronously in the SAME commit —
    // the wrapper is already moved there by registerSlot and this rAF
    // becomes a no-op → no mini flash on takeover).
    this.placeTo("limbo");
    this.scheduleMiniCheck();
  }

  private scheduleMiniCheck() {
    if (this.miniCheckScheduled || typeof window === "undefined") return;
    this.miniCheckScheduled = true;
    window.requestAnimationFrame(() => {
      this.miniCheckScheduled = false;
      const st = this.state;
      if (st.videoId === null) return;
      if (this.slot !== null) return; // a watch page owns the player
      // survival matrix: every route except /watch keeps the mini; watch
      // error pages have no slot → the mini shows there too.
      this.set({ hostMode: "mini" });
      this.place();
    });
  }

  /** Scroll-dock on the watch page (player scrolled past → mini geometry). */
  setMini(mini: boolean) {
    if (this.state.videoId === null) return;
    const next: PlayerHostMode = mini ? "mini" : "inline";
    if (this.state.hostMode === next) return;
    this.set({ hostMode: next });
    this.place();
  }

  /** The ONLY destroy path (mini close button). */
  close() {
    const wrapper = this.wrapper;
    // detach to limbo so the empty wrapper never paints
    if (wrapper && wrapper.isConnected) {
      document.createDocumentFragment().appendChild(wrapper);
    }
    this.set({ ...initialHostState });
  }

  /** Expand: on /watch → back inline (the page scrolls itself back);
   * anywhere else → navigate to the watch page. */
  expand() {
    const st = this.state;
    if (st.videoId === null) return;
    const onWatch =
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/watch");
    if (onWatch && this.slot !== null) {
      this.set({ hostMode: "inline" });
      this.place();
    }
    this.expandListeners.forEach((cb) => cb());
  }

  /** Mini layer's video-area registration. */
  registerMiniHost(el: HTMLElement | null) {
    this.miniHost = el;
    if (el !== null && this.state.hostMode === "mini" && this.state.videoId !== null) {
      this.place();
    }
  }

  /* ---- player events (wired once by the layer) ---- */

  progress(sec: number, durationSec: number) {
    this.lastPositionSec = sec;
    const st = this.state;
    if (st.videoId !== null) {
      this.set({ positionSec: sec, durationSec: durationSec || st.durationSec });
    }
    this.progressListeners.forEach((cb) => cb(sec, durationSec));
  }

  ended() {
    this.endedListeners.forEach((cb) => cb());
  }

  stateChange(state: "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued" | "error") {
    if (this.state.videoId !== null) this.set({ playing: state === "playing" });
    this.stateListeners.forEach((cb) => cb(state));
  }

  /* ---- surfaces ---- */

  seekTo(sec: number) {
    this.handleRef.current?.seekTo(sec);
  }

  getPosition(): number {
    return this.handleRef.current?.getCurrentTime() ?? this.lastPositionSec;
  }

  onProgress(cb: ProgressListener): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onEnded(cb: Listener<void>): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  onStateChange(
    cb: Listener<"unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued" | "error">,
  ): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onExpand(cb: Listener<void>): () => void {
    this.expandListeners.add(cb);
    return () => this.expandListeners.delete(cb);
  }
}

/** The singleton manager (imperative DOM + event fan-out). */
export const playerHost = new PlayerHostManager();

/** Test seam: reset the singleton store + manager fields between cases
 * (the production app never calls this — mirrors createSidebarStore). */
export function resetPlayerHostForTests(): void {
  usePlayerHost.setState({ ...initialHostState });
  playerHost.wrapper = null;
  playerHost.slot = null;
  playerHost.miniHost = null;
  playerHost.handleRef.current = null;
}
