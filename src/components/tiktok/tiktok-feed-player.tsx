"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { tiktokPlayerEmbedUrl, tiktokVideoUrl, TIKTOK_PLAYER_ORIGIN } from "@/lib/tiktok/urls";
import type { TikTokPlayerError, TikTokVideoDTO } from "@/lib/tiktok/types";
import {
  describeError as describeTikTokPlayerError,
  TIKTOK_PLAYER_READY_TIMEOUT_MS,
} from "@/components/tiktok/tiktok-embed-player";
import {
  useInViewOnce,
  useTikTokOEmbed,
} from "@/components/tiktok/tiktok-preview-client";
import { TikTokThumbnailImage } from "@/components/tiktok/tiktok-thumbnail-image";

/**
 * ADR 0013 / WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M1 — the TikTok feed player:
 * the official Embed Player driven by the Shorts active-slide lifecycle.
 *
 * The hub's `tiktok-embed-player.tsx` stays untouched (it serves the
 * compatibility page); THIS controller is the feed's active-slide law:
 *
 *  - MOUNT LAW: the iframe mounts ONLY while the slide is active (the
 *    ShortsPlayerSlot law). A previous post therefore pauses/unmounts by
 *    construction — exactly one TikTok iframe exists per feed, ever.
 *  - COMMAND LAW: official host→player messages (`play` / `pause`) tagged
 *    `{ "x-tiktok-player": true, type }` through the narrowest targetOrigin
 *    (the player's own origin — TIKTOK_PLAYER_ORIGIN in the URL law) —
 *    never a wildcard. An explicit `pause` is
 *    sent when the slide goes inactive (belt) and when the document hides
 *    (suspenders — the unmount law already guarantees silence offscreen);
 *    `play` resumes on return unless the VIEWER paused it (their pause wins).
 *  - INBOUND LAW: a player message is trusted only when BOTH event.origin
 *    is the TikTok player origin AND event.source is THIS iframe's
 *    contentWindow. Handled events: onPlayerReady, onPlayerError,
 *    onStateChange, onCurrentTime, onMute, onVolumeChange (the latter three
 *    are protocol-acknowledged — the native controls own those surfaces).
 *  - HONESTY LAW: autoplay is attempted muted through the documented
 *    `autoplay=1&force_muted=1` params (2026-10-28 docs name; the audit
 *    lives in lib/tiktok/urls.ts); a 3002 AUTOPLAY_ERROR shows an explicit
 *    tap-to-play recovery; the 12s readiness timeout and the error banners
 *    carry the outbound TikTok link. No fabricated media ever renders.
 *  - P89 POSTER LAW (docs/research/2026-11-04-tiktok-thumbnail-hover-play-
 *    research.md R7): when the server DTO carries no thumbnailUrl, the
 *    poster/starting-cover hydrates through the same official CORS-open
 *    client oEmbed lane the tiles ride (active-or-in-view gated — the
 *    YouTube slides already poster while booting; the walled black cover
 *    was the last non-parity face). The caption/attribution fields are NOT
 *    hydrated here — the feed's attribution law (contract §6) stays the
 *    verified-server-lane's; only the visual poster closes the gap.
 */

/** The pause-then-unmount beat (ADR 0013 command law): when the slide goes
 * inactive the official `pause` command is sent WHILE the iframe still
 * lives, then the unmount follows as the guarantee. Short enough that a
 * fast flip never leaves two live players, long enough for the message to
 * land. */
export const TIKTOK_PAUSE_THEN_UNMOUNT_MS = 250;

type OutboundCommand = "play" | "pause";

/** The official host→player command (exported for the protocol unit tests:
 * the envelope shape and the narrowest targetOrigin are pinned law). */
export function sendTikTokCommand(
  iframe: HTMLIFrameElement | null,
  type: OutboundCommand,
): boolean {
  const win = iframe?.contentWindow;
  if (!win) return false;
  // The narrowest valid targetOrigin — the player's own origin (ADR 0013).
  win.postMessage({ "x-tiktok-player": true, type }, TIKTOK_PLAYER_ORIGIN);
  return true;
}

/** The documented onStateChange payload is the state number (-1 init /
 * 0 ended / 1 playing / 2 paused / 3 buffering) — parsed defensively. */
function parseStateValue(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "state" in value) {
    const s = (value as { state?: unknown }).state;
    if (typeof s === "number") return s;
  }
  return null;
}

interface HostMessage<T = unknown> {
  "x-tiktok-player"?: boolean;
  type: string;
  value: T;
}

export function TikTokFeedPlayer({
  item,
  active,
  readyTimeoutMs = TIKTOK_PLAYER_READY_TIMEOUT_MS,
}: {
  item: TikTokVideoDTO;
  active: boolean;
  /** The readiness budget, overridable for tests. */
  readyTimeoutMs?: number;
}) {
  const postId = item.postId;

  const [state, setState] = useState<{
    error: TikTokPlayerError | null;
    ready: boolean;
    timedOut: boolean;
    autoplayBlocked: boolean;
    forPost: string;
  }>({ error: null, ready: false, timedOut: false, autoplayBlocked: false, forPost: postId });
  // Render-phase reset on post change (the house pattern — no setState in
  // an effect body).
  if (state.forPost !== postId) {
    setState({ error: null, ready: false, timedOut: false, autoplayBlocked: false, forPost: postId });
  }

  // MOUNT LAW, refined: the iframe stays mounted through the pause-then-
  // unmount beat when the slide leaves (the pause command needs a living
  // iframe), then unmounts — at most ONE iframe can be playing at any
  // instant, and never more than one beat's worth of paused leftovers.
  const [mounted, setMounted] = useState(active);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One telemetry report per (post, kind) — reset inside the effect (never
  // during render, per the react-hooks/refs law). The server's dead-post
  // ledger additionally dedupes for 48h.
  const sentRef = useRef<{ forPost: string; kinds: Set<string> }>({
    forPost: postId,
    kinds: new Set<string>(),
  });
  // Whether the LAST pause was ours (visibility) — a viewer's own native
  // pause is never overridden by an auto-resume.
  const pausedByUsRef = useRef(false);

  // P89 R7 — the poster hydration lane: the official client oEmbed fills the
  // poster only when the server DTO left it null (server values always win;
  // the same in-view + TTL + foreign-row laws as the tiles).
  const [posterViewRef, posterInView] = useInViewOnce<HTMLDivElement>();
  const hydratedMeta = useTikTokOEmbed({
    postId,
    author: item.author,
    thumbnailUrl: item.thumbnailUrl,
    title: item.title,
    enabled: active || posterInView,
  });
  const posterUrl = hydratedMeta.thumbnailUrl;

  const src = useMemo(
    () =>
      tiktokPlayerEmbedUrl(postId, {
        autoplay: true,
        forceMuted: true,
        loop: true,
      }),
    [postId],
  );

  useEffect(() => {
    if (!active) return; // the iframe is mounted only for the active slide

    sentRef.current = { forPost: postId, kinds: new Set<string>() };
    pausedByUsRef.current = false;

    function report(kind: "error" | "timeout", code: number | null, type: string) {
      if (sentRef.current.forPost !== postId) return;
      if (sentRef.current.kinds.has(kind)) return;
      sentRef.current.kinds.add(kind);
      try {
        if (typeof fetch === "function") {
          void fetch("/api/tiktok/player-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ postId, code, type }),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Telemetry is best-effort — never surfaces to the viewer.
      }
    }

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function onMessage(event: MessageEvent) {
      // INBOUND LAW: origin AND source must both be this player's.
      if (event.origin !== TIKTOK_PLAYER_ORIGIN) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as HostMessage | undefined;
      if (!data || typeof data !== "object" || data["x-tiktok-player"] !== true) return;

      switch (data.type) {
        case "onPlayerReady":
          clearTimer();
          pausedByUsRef.current = false;
          setState((s) => ({ ...s, ready: true, timedOut: false }));
          break;
        case "onPlayerError": {
          clearTimer();
          const v = (data.value ?? {}) as { errorCode?: unknown; errorType?: unknown };
          const code = typeof v.errorCode === "number" ? v.errorCode : null;
          const type = typeof v.errorType === "string" ? v.errorType : "PLAYER_ERROR";
          report("error", code, type);
          setState((s) => ({
            ...s,
            // 3002 AUTOPLAY_ERROR is NOT terminal — its honest surface is the
            // explicit tap-to-play recovery below, not the error banner
            // (the banner stays reserved for real playback failures).
            error: code === 3002 ? s.error : describeTikTokPlayerError(code ?? undefined, type),
            autoplayBlocked: code === 3002,
          }));
          break;
        }
        case "onStateChange": {
          const st = parseStateValue(data.value);
          if (st === 1) {
            // playing — any autoplay denial resolved itself
            setState((s) => (s.autoplayBlocked ? { ...s, autoplayBlocked: false } : s));
          }
          if (st === 2) pausedByUsRef.current = false; // viewer/native pause wins
          break;
        }
        // onCurrentTime / onMute / onVolumeChange / onImageChange are
        // protocol-acknowledged: the native player owns those surfaces —
        // nothing for the feed chrome to mirror today.
        default:
          break;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        // the tab went away — the explicit pause (the unmount law already
        // guarantees silence for route/source changes)
        if (sendTikTokCommand(iframeRef.current, "pause")) {
          pausedByUsRef.current = true;
        }
      } else if (pausedByUsRef.current) {
        sendTikTokCommand(iframeRef.current, "play");
        pausedByUsRef.current = false;
      }
    }

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);

    // The readiness guard: error beats timeout; a late onPlayerReady clears
    // the banner (the P59-R4 law, feed-mounted).
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setState((s) => {
        if (s.ready || s.error) return s;
        report("timeout", null, "READINESS_TIMEOUT");
        return { ...s, timedOut: true };
      });
    }, readyTimeoutMs);

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
    };
  }, [active, postId, readyTimeoutMs]);

  // COMMAND LAW on inactive: the official `pause` rides out WHILE the iframe
  // still lives; the unmount beat follows as the guarantee (a re-activation
  // during the beat cancels the unmount — fast flipping never flickers).
  // All mount transitions land in timer callbacks (never a synchronous
  // setState in the effect body — the cascading-render law).
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => setMounted(true), 0);
      return () => clearTimeout(t);
    }
    if (sendTikTokCommand(iframeRef.current, "pause")) {
      const t = setTimeout(() => setMounted(false), TIKTOK_PAUSE_THEN_UNMOUNT_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setMounted(false), 0);
    return () => clearTimeout(t);
  }, [active]);

  const outboundUrl = item.deepLinkUrl || tiktokVideoUrl(item.author, postId);

  return (
    <div
      ref={posterViewRef}
      className="relative aspect-[9/16] h-full w-full max-h-full overflow-hidden rounded-2xl bg-black"
      data-testid="tiktok-feed-player"
      data-active={active ? "true" : "false"}
    >
      {/* Verified poster under the embed when the metadata lane supplied one
          (missing stays missing — no fabricated imagery). R5/R6: the img
          rides TikTokThumbnailImage (no-referrer; an expired signed URL
          drops out honestly). */}
      <TikTokThumbnailImage
        src={posterUrl}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      {mounted ? (
        <>
          <iframe
            ref={iframeRef}
            key={postId}
            src={src}
            title={item.title ? `${item.title} — TikTok` : "TikTok player"}
            // The allow list mirrors the official oEmbed html sample.
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 size-full border-0"
          />

          {/* the pending cover: the active iframe boots under the poster so
              the white-boot flash never surfaces (the ShortsPlayerSlot law) */}
          {!state.ready && !state.error && !state.timedOut ? (
            <div
              data-testid="tiktok-feed-starting"
              role="status"
              aria-label="Starting TikTok playback…"
              className="absolute inset-0 z-20 bg-black"
            >
              <TikTokThumbnailImage
                src={posterUrl}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}

          {/* HONEST autoplay-denied recovery: the tap IS the user gesture */}
          {state.autoplayBlocked && !state.error ? (
            <button
              type="button"
              data-testid="tiktok-feed-autoplay-blocked"
              onClick={() => {
                setState((s) => ({ ...s, autoplayBlocked: false }));
                sendTikTokCommand(iframeRef.current, "play");
              }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/60 text-white backdrop-blur-[2px] transition-colors hover:bg-black/50"
              aria-label="Tap to play this TikTok post"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-white/15">
                <Play className="size-8" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium">Tap to play</span>
            </button>
          ) : null}
        </>
      ) : null}

      {state.error ? (
        <div
          role="alert"
          className="absolute inset-x-4 top-4 z-30 rounded-lg border border-amber-500/40 bg-black/85 px-3 py-2 text-xs text-white"
          data-testid="tiktok-feed-player-error"
        >
          {state.error.message}
          <span className="ml-1 text-white/60">
            (code {state.error.code}
            {state.error.type ? ` · ${state.error.type}` : ""})
          </span>
          <a
            href={outboundUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 font-medium underline underline-offset-2"
          >
            Open on TikTok
          </a>
        </div>
      ) : null}

      {state.timedOut && !state.error ? (
        <div
          role="status"
          className="absolute inset-x-4 top-4 z-30 rounded-lg border border-amber-500/40 bg-black/85 px-3 py-2 text-xs text-white"
          data-testid="tiktok-feed-player-timeout"
        >
          The TikTok player didn&apos;t load from this network. This happens when TikTok
          blocks your region or network, or the post is unavailable.{" "}
          <a
            href={outboundUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
            data-testid="tiktok-feed-player-timeout-link"
          >
            Open on TikTok
          </a>
        </div>
      ) : null}
    </div>
  );
}
