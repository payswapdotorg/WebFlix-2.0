"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tiktokPlayerEmbedUrl, tiktokVideoUrl } from "@/lib/tiktok/urls";
import type { TikTokPlayerError } from "@/lib/tiktok/types";

/**
 * P58-TIKTOK-SOURCE — the official Embed Player host (ADR 0004 §1/§5).
 *
 * The iframe is fetched by the VIEWER's browser directly from TikTok
 * (immune to WebFlix's egress walls); WebFlix builds the URL locally from
 * the documented params and never renders the remote oEmbed `html`. Player
 * errors arrive through the documented postMessage protocol
 * ("x-tiktok-player": true) and surface as an honest banner — never a
 * silent black frame — with the outbound TikTok link intact.
 *
 * P59-R4: a player that never becomes ready (region-walled viewer, dead
 * network, dead post on an old player build that never posts errors) is no
 * longer a silent black box. A 12-second readiness timer flips an honest
 * banner with the outbound TikTok link, cleared by a late onPlayerReady;
 * a real error always beats the timeout; and every terminal state reports
 * ONCE per (post, kind) to /api/tiktok/player-events so the dead-post
 * ledger learns what the viewer's browser learned.
 */

interface HostMessage<T = unknown> {
  "x-tiktok-player"?: boolean;
  type: string;
  value: T;
}

interface PlayerErrorValue {
  errorCode?: number;
  errorType?: string;
}

function describeError(code: number | undefined, type: string | undefined): TikTokPlayerError {
  const c = typeof code === "number" ? code : 0;
  const t = typeof type === "string" && type ? type : "PLAYER_ERROR";
  if (c >= 1000 && c <= 1099) {
    return { code: c, type: t, message: "This post can't be embedded — it may be private, removed, or the id is invalid." };
  }
  if (c >= 2000 && c <= 2099) {
    return { code: c, type: t, message: "TikTok's servers failed to serve this player right now." };
  }
  if (c === 3002) {
    return { code: c, type: t, message: "The browser blocked autoplay — press play in the player." };
  }
  if (c >= 3000 && c <= 3099) {
    return { code: c, type: t, message: "Playback failed inside TikTok's player." };
  }
  return { code: c, type: t, message: "TikTok's player reported an error." };
}

/** The readiness budget (P59-R4): generous — TikTok's player boot is slow on
 * cold networks; 12s past mount with no protocol message = walled. */
export const TIKTOK_PLAYER_READY_TIMEOUT_MS = 12_000;

export function TikTokEmbedPlayer({
  postId,
  title,
  className,
  readyTimeoutMs = TIKTOK_PLAYER_READY_TIMEOUT_MS,
}: {
  postId: string;
  title?: string | null;
  className?: string;
  /** P59-R4 seam: the readiness budget, overridable for tests. */
  readyTimeoutMs?: number;
}) {
  // Render-phase reset on postId change (the React-docs pattern the house
  // uses — no setState inside the effect body).
  const [state, setState] = useState<{
    error: TikTokPlayerError | null;
    ready: boolean;
    timedOut: boolean;
    forPost: string;
  }>({ error: null, ready: false, timedOut: false, forPost: postId });
  if (state.forPost !== postId) {
    setState({ error: null, ready: false, timedOut: false, forPost: postId });
  }
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One telemetry report per (post, kind) — the set is reset inside the
  // effect (never during render, per the react-hooks/refs law).
  const sentRef = useRef<{ forPost: string; kinds: Set<string> }>({
    forPost: postId,
    kinds: new Set<string>(),
  });
  const src = useMemo(() => tiktokPlayerEmbedUrl(postId), [postId]);

  useEffect(() => {
    // postId changed → a fresh one-report-per-kind budget for this post.
    sentRef.current = { forPost: postId, kinds: new Set<string>() };

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
      // The documented protocol tags every player message.
      const data = event.data as HostMessage<PlayerErrorValue> | undefined;
      if (!data || typeof data !== "object" || data["x-tiktok-player"] !== true) return;
      if (data.type === "onPlayerReady") {
        clearTimer();
        setState((s) => ({ ...s, ready: true, timedOut: false }));
      }
      if (data.type === "onPlayerError") {
        clearTimer();
        const v = (data.value ?? {}) as PlayerErrorValue;
        const code = typeof v.errorCode === "number" ? v.errorCode : null;
        report("error", code, typeof v.errorType === "string" ? v.errorType : "PLAYER_ERROR");
        setState((s) => ({ ...s, error: describeError(v.errorCode, v.errorType) }));
      }
    }
    window.addEventListener("message", onMessage);

    // P59-R4: the silent-black-box guard. Error beats timeout; a late
    // onPlayerReady clears the banner.
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
      clearTimer();
    };
  }, [postId, readyTimeoutMs]);

  const error = state.error;
  const ready = state.ready;
  const timedOut = state.timedOut;
  const outboundUrl = tiktokVideoUrl(null, postId);

  return (
    <div className={className} data-testid="tiktok-embed-player">
      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
          data-testid="tiktok-player-error"
        >
          {error.message}
          <span className="ml-1 text-muted-foreground">
            (code {error.code}
            {error.type ? ` · ${error.type}` : ""})
          </span>
        </div>
      ) : null}
      {timedOut && !error ? (
        <div
          role="status"
          className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
          data-testid="tiktok-player-timeout"
        >
          The TikTok player didn&apos;t load from this network. This happens when TikTok blocks
          your region or network, or the post is unavailable.{" "}
          <a
            href={outboundUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
            data-testid="tiktok-player-timeout-link"
          >
            Open on TikTok
          </a>
        </div>
      ) : null}
      <div
        className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl bg-black"
        style={{ aspectRatio: "9 / 16" }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={title ? `${title} — TikTok` : "TikTok player"}
          // The allow list mirrors the official oEmbed html sample.
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 size-full"
        />
      </div>
      {!ready && !error ? (
        <p className="mt-2 text-center text-xs text-muted-foreground" data-testid="tiktok-player-loading">
          Loading TikTok&apos;s player…
        </p>
      ) : null}
    </div>
  );
}
