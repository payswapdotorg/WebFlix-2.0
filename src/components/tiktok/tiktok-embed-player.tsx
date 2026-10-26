"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tiktokPlayerEmbedUrl } from "@/lib/tiktok/urls";
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

export function TikTokEmbedPlayer({
  postId,
  title,
  className,
}: {
  postId: string;
  title?: string | null;
  className?: string;
}) {
  // Render-phase reset on postId change (the React-docs pattern the house
  // uses — no setState inside the effect body).
  const [state, setState] = useState<{
    error: TikTokPlayerError | null;
    ready: boolean;
    forPost: string;
  }>({ error: null, ready: false, forPost: postId });
  if (state.forPost !== postId) {
    setState({ error: null, ready: false, forPost: postId });
  }
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const src = useMemo(() => tiktokPlayerEmbedUrl(postId), [postId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // The documented protocol tags every player message.
      const data = event.data as HostMessage<PlayerErrorValue> | undefined;
      if (!data || typeof data !== "object" || data["x-tiktok-player"] !== true) return;
      if (data.type === "onPlayerReady") setState((s) => ({ ...s, ready: true }));
      if (data.type === "onPlayerError") {
        const v = (data.value ?? {}) as PlayerErrorValue;
        setState((s) => ({ ...s, error: describeError(v.errorCode, v.errorType) }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const error = state.error;
  const ready = state.ready;

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
          Loading TikTok's player…
        </p>
      ) : null}
    </div>
  );
}
