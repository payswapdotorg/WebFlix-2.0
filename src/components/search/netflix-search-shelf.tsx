"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { NetflixCard } from "@/components/netflix/netflix-card";
import { ChevronRight } from "lucide-react";
import type { NetflixSearchResultsDTO } from "@/lib/netflix/types";

/**
 * P42 — the Netflix shelf on /search, ADDITIVE to the YouTube results (ADR
 * 0002 §6): a horizontal rail of Netflix catalog matches riding the same
 * query, rendered only when the Netflix mirror actually answers with real
 * titles (the honest absence — never a placeholder row). Results deep-link
 * through the WebFlix hub (`/netflix/t/<id>`).
 */
export function NetflixSearchShelf({ q }: { q: string }) {
  const { data } = useApi<NetflixSearchResultsDTO>(
    q ? `/api/netflix/search?q=${encodeURIComponent(q)}` : null
  );
  const titles = data?.titles ?? [];
  if (!q || titles.length === 0) return null;
  return (
    <section aria-label="Netflix results" className="py-4" data-testid="netflix-search-shelf">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
          <span className="rounded bg-[#e50914] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
            Netflix
          </span>
          On Netflix
          <span className="text-xs font-normal text-muted-foreground">
            {data?.note ? "· Netflix's Top 10 & Most Popular" : null}
          </span>
        </h2>
        <Link
          href="/netflix"
          className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Browse <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto pb-2">
        {titles.slice(0, 8).map((title) => (
          <NetflixCard key={title.netflixId} title={title} />
        ))}
      </div>
    </section>
  );
}
