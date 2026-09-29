"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers, formatViews } from "@/lib/format";
import type { SearchPageDTO } from "@/lib/types";

/** Search — real LIKE search over titles/descriptions/channels. */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const { data, loading, error } = useApi<SearchPageDTO>(q ? `/api/search?q=${encodeURIComponent(q)}` : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="pb-6">
      <form role="search" onSubmit={submit} className="flex gap-2 px-4 py-4 sm:px-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search WebFlix"
            aria-label="Search WebFlix"
            className="rounded-full pl-10"
            autoFocus
          />
          {input && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" variant="secondary" className="rounded-full">
          Search
        </Button>
      </form>

      {!q && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Search WebFlix</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Find videos and channels — try “blender”, “elden ring” or “travel”.
          </p>
        </div>
      )}

      {q && loading && (
        <div className="space-y-6 px-4 sm:px-6" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="aspect-video w-[240px] shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}
      {q && error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {q && data && data.videos.length === 0 && data.channels.length === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No results for “{q}”</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different keywords — WebFlix searches all of YouTube.
          </p>
        </div>
      )}

      {data && data.channels.length > 0 && (
        <section aria-label="Channel results" className="px-4 pb-4 sm:px-6">
          <h2 className="pb-2 text-base font-semibold">Channels</h2>
          {data.channels.map((ch) => (
            <Link
              key={ch.id}
              href={`/channel/${ch.handle}`}
              className="flex items-center gap-4 border-b border-border/40 py-4 transition-colors hover:bg-accent/30"
            >
              <img src={ch.avatarUrl} alt={ch.name} className="size-16 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-base font-medium">
                  <span className="truncate">{ch.name}</span>
                  {ch.verified && <VerifiedBadge />}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ch.handle.startsWith("@") ? ch.handle : `@/${ch.handle}`} · {formatSubscribers(ch.subscriberCount)}
                </p>
              </div>
            </Link>
          ))}
        </section>
      )}

      {data && data.videos.length > 0 && (
        <section aria-label="Video results" className="px-4 sm:px-6">
          <h2 className="pb-2 text-base font-semibold">
            Videos {q && <span className="font-normal text-muted-foreground">for “{q}”</span>}
          </h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
