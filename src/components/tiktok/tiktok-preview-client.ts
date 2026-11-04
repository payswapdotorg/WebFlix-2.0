"use client";

/**
 * WFX2-TIKTOK-SHORTS-EQUIPMENT-1 P88 — the client-side TikTok preview lane:
 * thumbnails + hover-play for every TikTok tile (home shelf, hub cards,
 * search shelf), mirroring the YouTube shorts-shelf interaction contract on
 * TikTok's OFFICIAL lanes only.
 *
 * THUMBNAILS — the honest ladder:
 *  1. the server lane's `thumbnailUrl` wins (lib/tiktok/library.ts — the
 *     shared oEmbed cache);
 *  2. where the server egress is walled (measured: Vercel), the VIEWER's
 *     browser hydrates from TikTok's keyless oEmbed endpoint — it answers
 *     CORS-open (`access-control-allow-origin: *`), which makes it the same
 *     viewer-side official lane the Embed Player already rides;
 *  3. a failed/blocked/foreign answer leaves the fallback tile — honest
 *     absence, never a fabricated identity.
 * The laws the hydration keeps (each mirrors the server lane):
 *  - every tiktok.com string is built through lib/tiktok/urls.ts (ADR 0004 §1);
 *  - the oEmbed `embed_product_id` must equal the requested post id (the
 *    foreign-row guard) before any field is trusted;
 *  - caching rides sessionStorage + an in-memory mirror with the server
 *    lane's own 6h TTL;
 *  - fetches are in-view gated and concurrency-bounded (max 3 in flight) —
 *    the keyless endpoint is shared and WebFlix stays polite.
 *
 * HOVER-PLAY — the shorts-tile contract on the official player:
 * fine pointers only (touch never hovers — the tap deep-links into the
 * shared feed), a 450ms dwell (the shared hover-preview constant), then ONE
 * muted-autoplay loop iframe; mouse-leave unmounts it — the same
 * pause-then-unmount law the shared feed player runs, so no offscreen media
 * and at most one preview embed alive at a time.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefCallback,
} from "react";
import {
  isTikTokPostId,
  tiktokOEmbedApiUrl,
  tiktokPlayerEmbedUrl,
  tiktokVideoUrl,
  TIKTOK_PLAYER_ORIGIN,
} from "@/lib/tiktok/urls";

/** The R8 lanes already warmed this page-load (per-connection-kind, once). */
const preconnected = new Set<string>();

function ensurePreconnect(key: string, crossOrigin: boolean): void {
  if (preconnected.has(key)) return;
  try {
    if (typeof document !== "undefined" && document.head) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = TIKTOK_PLAYER_ORIGIN; // the URL law's own origin export
      if (crossOrigin) link.crossOrigin = "anonymous";
      document.head.appendChild(link);
      preconnected.add(key);
    }
  } catch {
    // no DOM — the fetch/iframe paths this warms do not exist either
  }
}

/**
 * R8 (docs/research/2026-11-04-tiktok-thumbnail-hover-play-research.md §5) —
 * warm the browser's connections to the ONE origin both client lanes hit:
 * the CORS-eligible connection for the hydration oEmbed fetch and the
 * classic connection for the hover-preview iframe. Inserted links are the
 * deterministic form of react-dom's resource API (same DOM effect, no app
 * context needed) — once per connection kind per page-load.
 */
export function preconnectTikTok(): void {
  ensurePreconnect("cors", true);
  ensurePreconnect("classic", false);
}

// ---------------------------------------------------------------------------
// The oEmbed hydration lane (thumbnails + title/author fill)
// ---------------------------------------------------------------------------

interface OEmbedMeta {
  thumbnailUrl: string | null;
  title: string | null;
  author: string | null;
}

const CACHE_PREFIX = "webflix:tt:oembed:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // the server lane's soft TTL
const FETCH_TIMEOUT_MS = 8_000; // the server lane's own fetch timeout

/** The module-level in-memory mirror (works even when storage refuses). */
const memory = new Map<string, OEmbedMeta>();

function readCache(postId: string): OEmbedMeta | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + postId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; meta: OEmbedMeta } | null;
    if (!parsed || typeof parsed.t !== "number" || Date.now() - parsed.t > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(CACHE_PREFIX + postId);
      return null;
    }
    return parsed.meta ?? null;
  } catch {
    return null;
  }
}

function writeCache(postId: string, meta: OEmbedMeta): void {
  try {
    window.sessionStorage.setItem(
      CACHE_PREFIX + postId,
      JSON.stringify({ t: Date.now(), meta })
    );
  } catch {
    // storage full / private mode — the in-memory mirror still holds
  }
}

// A small concurrency gate: the endpoint is keyless and shared; stay polite.
const MAX_INFLIGHT = 3;
let inflight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inflight += 1;
}

function releaseSlot(): void {
  inflight = Math.max(0, inflight - 1);
  const next = waiters.shift();
  if (next) next();
}

async function fetchOEmbedMeta(
  postId: string,
  author: string | null
): Promise<OEmbedMeta | null> {
  if (!isTikTokPostId(postId)) return null;
  await acquireSlot();
  try {
    const res = await fetch(tiktokOEmbedApiUrl(tiktokVideoUrl(author, postId)), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      credentials: "omit",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      embed_product_id?: string;
      thumbnail_url?: string;
      title?: string;
      author_name?: string;
    };
    // The foreign-row guard the server lane runs: the answer must describe
    // the requested post, or the hydration is honest absence.
    if (!body || body.embed_product_id !== postId) return null;
    return {
      thumbnailUrl:
        typeof body.thumbnail_url === "string" && body.thumbnail_url
          ? body.thumbnail_url
          : null,
      title: typeof body.title === "string" && body.title ? body.title : null,
      author:
        typeof body.author_name === "string" && body.author_name
          ? body.author_name
          : null,
    };
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

/**
 * useInViewOnce — a stable ref callback that flips true the first time the
 * element nears the viewport (the hydration gate: offscreen tiles never
 * fetch). Degrades to immediately-true where IntersectionObserver is missing.
 */
export function useInViewOnce<T extends Element>(): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  // Environments without IntersectionObserver hydrate immediately — decided
  // at mount, never via a synchronous effect setState (the cascading-render
  // rule). SSR/first client render agree: real browsers run the observer.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  const ref = useCallback<RefCallback<T>>((el) => setNode(el), []);

  useEffect(() => {
    if (!node || inView) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, inView]);

  return [ref, inView];
}

/**
 * useTikTokOEmbed — fills ONLY what the server lane left null, from the
 * official CORS-open oEmbed, once the tile is in view. Server values win;
 * hydrated values never overwrite them.
 */
export function useTikTokOEmbed(input: {
  postId: string;
  author: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  /** The in-view gate (useInViewOnce). */
  enabled: boolean;
}): { thumbnailUrl: string | null; title: string | null; author: string | null } {
  const { postId, author, thumbnailUrl, title, enabled } = input;
  const [meta, setMeta] = useState<OEmbedMeta | null>(null);
  const needsHydration = !thumbnailUrl || !title;

  useEffect(() => {
    if (!enabled || !needsHydration) return;
    let cancelled = false;
    // The cache (memory first, then sessionStorage) short-circuits the
    // network — both paths settle ASYNC so the setState never runs
    // synchronously within the effect (the cascading-render rule).
    const cached = memory.get(postId) ?? readCache(postId);
    if (!cached) preconnectTikTok(); // R8 — warm the origin before the fetch
    const source = cached
      ? Promise.resolve(cached)
      : fetchOEmbedMeta(postId, author);
    void source.then((fetched) => {
      if (!fetched || cancelled) return;
      memory.set(postId, fetched);
      if (!cached) writeCache(postId, fetched);
      setMeta(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, needsHydration, postId, author]);

  return {
    thumbnailUrl: thumbnailUrl ?? meta?.thumbnailUrl ?? null,
    title: title ?? meta?.title ?? null,
    author: author ?? meta?.author ?? null,
  };
}

// ---------------------------------------------------------------------------
// The hover-play lane (the official player, the shorts-shelf contract)
// ---------------------------------------------------------------------------

/** The shared hover-preview dwell (video-hover-preview's own constant). */
const DWELL_MS = 450;

export interface TikTokHoverPlay {
  hoverProps: {
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => void;
    onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => void;
  };
  /** True while the official muted-autoplay embed should be mounted. */
  previewing: boolean;
}

/**
 * useTikTokHoverPlay — fine pointers only, a 450ms dwell, then ONE official
 * muted-autoplay iframe; leave unmounts it (pause-then-unmount — no
 * offscreen media, and a single pointer can never hold two dwells).
 */
export function useTikTokHoverPlay(): TikTokHoverPlay {
  const [previewing, setPreviewing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onMouseEnter = useCallback(() => {
    // Coarse pointers never preview — hover does not exist there (the
    // shorts-shelf law); the tap deep-links into the shared feed instead.
    const fine =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: fine)").matches
        : false;
    if (!fine || timerRef.current !== null) return;
    preconnectTikTok(); // R8 — the preview iframe hits the same origin
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPreviewing(true);
    }, DWELL_MS);
  }, []);

  const onMouseLeave = useCallback(() => {
    clearTimer();
    setPreviewing(false);
  }, [clearTimer]);

  return { hoverProps: { onMouseEnter, onMouseLeave }, previewing };
}

/**
 * The tile-preview embed URL: muted autoplay + loop with TikTok's own
 * controls (the viewer unmutes through the player itself), no attribution
 * chrome in the tile face, and no related videos — the hub owns discovery.
 */
export function tikTokTilePreviewUrl(postId: string): string {
  return tiktokPlayerEmbedUrl(postId, {
    autoplay: true,
    forceMuted: true,
    loop: true,
    controls: true,
    musicInfo: false,
    description: false,
    timestamp: false,
    closedCaption: false,
    rel: false,
  });
}
