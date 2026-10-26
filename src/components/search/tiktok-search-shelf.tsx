"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { TikTokCard } from "@/components/tiktok/tiktok-card";
import { ChevronRight } from "lucide-react";
import type { TikTokSearchResultsDTO } from "@/lib/tiktok/types";

/**
 * P58 — the TikTok shelf on /search, ADDITIVE to the YouTube results after
 * the Netflix shelf (ADR 0004 §4): curated-library matches riding the same
 * query, rendered only when the library actually answers with real matches
 * (the honest absence — never a placeholder row). Results open the WebFlix
 * embed page (`/tiktok/v/<id>`).
 */
export function TikTokSearchShelf({ q }: { q: string }) {
  const { data } = useApi<TikTokSearchResultsDTO>(
    q ? `/api/tiktok/search?q=${encodeURIComponent(q)}` : null
  );
  const videos = data?.videos ?? [];
  if (!q || videos.length === 0) return null;
  return (
    <section aria-label="TikTok results" className="py-4" data-testid="tiktok-search-shelf">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
          <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-background">
            TikTok
          </span>
          On TikTok
          <span className="text-xs font-normal text-muted-foreground">· curated shelf</span>
        </h2>
        <Link
          href="/tiktok"
          className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Browse <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pb-2">
        {videos.slice(0, 8).map((video) => (
          <TikTokCard key={video.postId} video={video} />
        ))}
      </div>
    </section>
  );
}
