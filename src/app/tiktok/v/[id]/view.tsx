"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { TikTokEmbedPlayer } from "@/components/tiktok/tiktok-embed-player";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { isTikTokPostId, tiktokVideoUrl } from "@/lib/tiktok/urls";
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * P58 — the in-app playback page (ADR 0004 §4/§5): the official Embed Player
 * + the cached oEmbed attribution + the outbound TikTok link. An invalid id
 * and an unreachable metadata lane both stay honest — the player itself is
 * viewer-side either way.
 */
export function TikTokPostView({ postId }: { postId: string }) {
  const valid = isTikTokPostId(postId);
  const { data } = useApi<TikTokVideoDTO>(valid ? `/api/tiktok/video/${postId}` : null);

  if (!valid) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-10 text-center" data-testid="tiktok-post-invalid">
        <p className="text-sm text-muted-foreground">Not a TikTok post id.</p>
        <Link href="/tiktok" className="mt-4 inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-2">
          <ArrowLeft className="size-4" /> Back to the shelf
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6" data-testid="tiktok-post">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/tiktok"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Shelf
        </Link>
        <a
          href={data?.deepLinkUrl ?? tiktokVideoUrl(null, postId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Open on TikTok <ExternalLink className="size-3.5" />
        </a>
      </div>

      <TikTokEmbedPlayer postId={postId} title={data?.title} />

      <section className="mt-5">
        {data?.title ? (
          <h1 className="text-base font-semibold text-foreground" data-testid="tiktok-post-title">
            {data.title}
          </h1>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {data?.author ? (
            data.authorUrl ? (
              <a href={data.authorUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                @{data.author}
              </a>
            ) : (
              <span>@{data.author}</span>
            )
          ) : (
            <span>Post {postId}</span>
          )}
          {data?.source ? <span data-testid="tiktok-post-source">source: {data.source}</span> : null}
          {data?.unavailable ? (
            <span className="text-amber-600 dark:text-amber-400" data-testid="tiktok-post-unavailable">
              {data.unavailableReason}
            </span>
          ) : null}
        </div>
      </section>
    </main>
  );
}
