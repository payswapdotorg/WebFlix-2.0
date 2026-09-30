"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Check,
  ExternalLink,
  Flag,
  Heart,
  Search,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers, formatCount, formatRelativeDate } from "@/lib/format";
import type {
  ChannelPageDTO,
  ChannelSearchDTO,
  ChannelTabDTO,
  ChannelTabId,
} from "@/lib/types";

/** The join route's response shape. */
interface JoinInfo {
  joinable: boolean;
  tiers: { title: string; priceText: string; perksText: string | null }[] | null;
  signinRequired: boolean;
  note: string | null;
}

/**
 * Channel page — YouTube deep parity (WFX2-B-S):
 *
 * - Tabs: Home / Videos / Shorts / Live / Playlists / Community / About —
 *   availability from the channel's own tab list; each tab lazy-loads via
 *   /api/channel/[handle]/tab (browse with the response-own tab params);
 *   the last-open tab is remembered per channel (localStorage).
 * - Community = the Posts tab (backstagePostRenderer rows); About = the
 *   engagement-panel continuation payload (stats + links); Playlists = the
 *   playlists-tab lockup grid.
 * - Join button when the channel offers memberships: the sheet shows the
 *   real state — tiers when reachable through the operator session,
 *   YouTube's own logged-out "Sign in to become a member." otherwise
 *   (never fabricated).
 * - The "Search this channel" flow (WFX2-B-W) stays untouched.
 * - The walled channel read honest-degrades (walled: true) — a clear
 *   unavailable state, never a blank page.
 */

const ALL_TABS: { id: ChannelTabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
  { id: "live", label: "Live" },
  { id: "playlists", label: "Playlists" },
  { id: "community", label: "Community" },
  { id: "about", label: "About" },
];

/** Tabs whose first page is seeded from the main channel payload. */
const SEEDED_TABS: ChannelTabId[] = ["home", "videos", "shorts"];

const tabStorageKey = (handle: string) => `wfx2:channel:tab:${handle}`;

function readStoredTab(handle: string, available: ChannelTabId[]): ChannelTabId | null {
  try {
    const stored = localStorage.getItem(tabStorageKey(handle)) as ChannelTabId | null;
    if (stored && available.includes(stored)) return stored;
  } catch {
    /* private mode */
  }
  return null;
}

function storeTab(handle: string, tab: ChannelTabId): void {
  try {
    localStorage.setItem(tabStorageKey(handle), tab);
  } catch {
    /* private mode */
  }
}

export default function ChannelPage() {
  const { handle } = useParams<{ handle: string }>();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [searchOpen, setSearchOpen] = useState(Boolean(initialQ));
  const [query, setQuery] = useState(initialQ);
  const [input, setInput] = useState(initialQ);
  const [searchTick, setTick] = useState(0);
  const { data, loading, error, reload } = useApi<ChannelPageDTO>(
    handle ? `/api/channel/${encodeURIComponent(handle)}` : null
  );
  const { data: results, loading: searching, error: searchError } = useApi<ChannelSearchDTO>(
    searchOpen && query.trim()
      ? `/api/channel/${encodeURIComponent(handle)}/search?q=${encodeURIComponent(query.trim())}&t=${searchTick}`
      : null
  );
  const [subscribing, setSubscribing] = useState(false);
  const [tab, setTab] = useState<ChannelTabId>("home");
  const [joinOpen, setJoinOpen] = useState(false);
  const { data: joinInfo } = useApi<JoinInfo>(
    joinOpen && handle ? `/api/channel/${encodeURIComponent(handle)}/join` : null
  );

  const availableTabs = useMemo<ChannelTabId[]>(() => {
    const own = data?.tabs?.length ? data.tabs : ALL_TABS.map((t) => t.id);
    return ALL_TABS.filter((t) => own.includes(t.id)).map((t) => t.id);
  }, [data]);

  // remember the last tab per channel: restore on load, persist on change
  useEffect(() => {
    if (!handle || !data) return;
    const stored = readStoredTab(handle, availableTabs);
    if (stored && stored !== "home") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stored-preference hydration (mount-time only)
      setTab(stored);
    }
  }, [handle, data?.channel?.id, availableTabs]);

  const selectTab = useCallback(
    (t: ChannelTabId) => {
      setTab(t);
      if (handle) storeTab(handle, t);
    },
    [handle]
  );

  // the lazy tab payload (only the non-seeded tabs fetch)
  const tabNeedsFetch = data !== null && !SEEDED_TABS.includes(tab);
  const { data: tabData, loading: tabLoading } = useApi<ChannelTabDTO>(
    tabNeedsFetch && handle ? `/api/channel/${encodeURIComponent(handle)}/tab?tab=${tab}` : null
  );

  async function toggleSubscribe() {
    if (!data) return;
    setSubscribing(true);
    try {
      const res = await postJson<{ subscribed: boolean }>("/api/subscribe", {
        channelId: data.channel.id,
      });
      toast.success(res.subscribed ? "Subscribed" : "Unsubscribed");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subscription");
    } finally {
      setSubscribing(false);
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = input.trim();
    if (term) {
      setQuery(term);
      setTick((t) => t + 1);
      setSearchOpen(true);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setInput("");
  }

  if (error) {
    return (
      <div className="px-4 py-16 text-center sm:px-6" role="alert">
        <p className="text-lg font-medium">Channel not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
          Back to home
        </Link>
      </div>
    );
  }

  const walled = data?.walled === true && !data.channel;

  return (
    <div className="pb-10">
      {loading && (
        <div className="space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}
      {walled && (
        <div className="px-4 py-16 text-center sm:px-6" role="status">
          <p className="text-lg font-medium">Channel data is unavailable right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {data?.note ??
              "youtube.com is currently blocking the channel read from this server. A last-known copy will serve here once one exists — nothing is fabricated."}
          </p>
          <Button variant="secondary" className="mt-4 rounded-full" onClick={() => reload()}>
            Retry
          </Button>
        </div>
      )}
      {data && data.channel && (
        <>
          {/* banner */}
          <div className="h-28 w-full overflow-hidden bg-secondary sm:h-36 lg:h-44">
            {data.channel.bannerUrl && (
              <img
                src={data.channel.bannerUrl}
                alt={`${data.channel.name} banner`}
                className="h-full w-full object-cover"
              />
            )}
          </div>

          {/* header */}
          <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
            <img
              src={data.channel.avatarUrl}
              alt={data.channel.name}
              className="size-20 rounded-full object-cover sm:size-24"
            />
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-xl font-bold sm:text-3xl">
                <span className="truncate">{data.channel.name}</span>
                {data.channel.verified && <VerifiedBadge className="size-5" />}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                @/{data.channel.handle} ·{" "}
                <span className="font-medium text-foreground">
                  {formatSubscribers(data.channel.subscriberCount)}
                </span>{" "}
                · {formatCount(data.channel.videoCount)} videos
              </p>
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                {data.channel.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data.channel.isOwner ? (
                <Button asChild variant="secondary" className="rounded-full">
                  <Link href="/studio">Your channel — open Studio</Link>
                </Button>
              ) : (
                <>
                  {data.joinable && (
                    <Button
                      onClick={() => setJoinOpen(true)}
                      className="rounded-full"
                      aria-label={`Join ${data.channel.name}`}
                    >
                      Join
                    </Button>
                  )}
                  <Button
                    onClick={toggleSubscribe}
                    disabled={subscribing}
                    className={`rounded-full ${
                      data.channel.isSubscribed
                        ? "bg-secondary text-foreground hover:bg-accent"
                        : "bg-foreground text-background hover:bg-foreground/90"
                    }`}
                  >
                    {data.channel.isSubscribed ? (
                      <>
                        <Bell className="mr-2 size-4" /> Subscribed
                      </>
                    ) : (
                      "Subscribe"
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* search-this-channel mode: results REPLACE the tab content (WFX2-B-W, untouched) */}
          {searchOpen ? (
            <section
              aria-label={`Channel search results for ${query}`}
              className="border-b border-border bg-transparent px-4 sm:px-6"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                <form
                  role="search"
                  onSubmit={submitSearch}
                  className="relative w-full max-w-md"
                  aria-label="Search this channel"
                >
                  <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`Search ${data.channel.name}`}
                    aria-label={`Search ${data.channel.name}`}
                    className="h-9 rounded-full pl-10 pr-9"
                    autoFocus
                  />
                  {input && (
                    <button
                      type="button"
                      aria-label="Clear channel search"
                      onClick={() => setInput("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </form>
                <Button variant="ghost" size="sm" onClick={closeSearch} className="shrink-0 gap-1.5">
                  <ArrowLeft className="size-4" aria-hidden /> Back to channel
                </Button>
              </div>
              <div className="pt-4">
                <h2 className="mb-4 text-sm font-medium text-muted-foreground" aria-live="polite">
                  {searching
                    ? "Searching…"
                    : `${results?.videos.length ?? 0} results${query ? ` for “${query}”` : ""} in this channel`}
                </h2>
                {searchError && (
                  <p className="py-6 text-center text-sm text-muted-foreground" role="alert">
                    {searchError}
                  </p>
                )}
                {searching && (
                  <div
                    className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                    aria-busy="true"
                  >
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="aspect-video w-full rounded-xl" />
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    ))}
                  </div>
                )}
                {results && results.videos.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No videos in this channel match “{query}”.
                  </p>
                )}
                {results && results.videos.length > 0 && (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {results.videos.map((video) => (
                      <VideoCard key={video.id} video={video} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : (
            /* channel tabs + the magnifier affordance */
            <div className="px-4 sm:px-6">
              <div className="flex items-end justify-between gap-4">
                <div
                  role="tablist"
                  aria-label="Channel tabs"
                  className="flex w-auto justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 no-scrollbar"
                >
                  {ALL_TABS.filter((t) => availableTabs.includes(t.id)).map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      type="button"
                      aria-selected={tab === t.id}
                      onClick={() => selectTab(t.id)}
                      className={`rounded-none border-b-2 px-1 pb-3 pt-2 text-sm font-medium ${
                        tab === t.id
                          ? "border-foreground bg-transparent text-foreground"
                          : "border-transparent bg-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Search this channel"
                  title="Search this channel"
                  onClick={() => setSearchOpen(true)}
                  className="mb-2 shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Search className="size-5" />
                </button>
              </div>

              <div className="mt-6" role="tabpanel" aria-label={`${tab} tab`}>
                {tab === "home" && <HomeTab data={data} />}
                {tab === "videos" && (
                  <VideosTab videos={data.videos} emptyNote="This channel hasn't uploaded any videos yet." />
                )}
                {tab === "shorts" && <ShortsTab shorts={data.shorts} />}
                {tab === "live" && (
                  <LazyTab
                    tab="live"
                    tabData={tabData}
                    tabLoading={tabLoading}
                    render={(t) => (
                      <VideosTab
                        videos={t.videos ?? []}
                        emptyNote="This channel has no live streams or premieres right now."
                      />
                    )}
                  />
                )}
                {tab === "playlists" && (
                  <LazyTab
                    tab="playlists"
                    tabData={tabData}
                    tabLoading={tabLoading}
                    render={(t) => <PlaylistsTab playlists={t.playlists ?? []} />}
                  />
                )}
                {tab === "community" && (
                  <LazyTab
                    tab="community"
                    tabData={tabData}
                    tabLoading={tabLoading}
                    render={(t) => <CommunityTab posts={t.posts ?? []} />}
                  />
                )}
                {tab === "about" && (
                  <LazyTab
                    tab="about"
                    tabData={tabData}
                    tabLoading={tabLoading}
                    render={(t) => (
                      <AboutTab
                        about={t.about}
                        subscriberCount={data.channel.subscriberCount}
                        videoCount={data.channel.videoCount}
                        description={data.channel.description}
                      />
                    )}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Join sheet — real tiers when reachable, honest degrade otherwise */}
      <Sheet open={joinOpen} onOpenChange={setJoinOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[80vh] overflow-y-auto sm:max-w-md sm:rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Join {data?.channel?.name ?? "this channel"}</SheetTitle>
            <SheetDescription>
              Membership perks unlock member badges, emojis and members-only videos.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 pb-2">
            {!joinInfo && (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            )}
            {joinInfo && joinInfo.joinable === false && (
              <p className="py-2 text-sm text-muted-foreground">
                This channel doesn&apos;t offer memberships.
              </p>
            )}
            {joinInfo?.tiers && joinInfo.tiers.length > 0 && (
              <>
                {joinInfo.tiers.map((tier, i) => (
                  <div key={i} className="rounded-xl border border-border p-4">
                    <p className="text-sm font-semibold">{tier.title}</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">{tier.priceText}</p>
                    {tier.perksText && (
                      <p className="mt-1 text-xs text-muted-foreground">{tier.perksText}</p>
                    )}
                  </div>
                ))}
                <Button asChild className="w-full rounded-full">
                  <a href="/account">Join</a>
                </Button>
              </>
            )}
            {joinInfo?.signinRequired && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{joinInfo.note}</p>
                <p className="text-xs text-muted-foreground">
                  WebFlix joins act on the operator&apos;s YouTube session (single-tenant live
                  mode) — no session is configured right now.
                </p>
                <Button asChild className="w-full rounded-full">
                  <a href="/account">Sign in</a>
                </Button>
              </div>
            )}
            {joinInfo && !joinInfo.signinRequired && (!joinInfo.tiers || joinInfo.tiers.length === 0) && joinInfo.joinable && (
              <p className="py-2 text-sm text-muted-foreground">
                {joinInfo.note ?? "Membership tiers are not readable right now."}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ------------------------------ tab bodies ------------------------------ */

function HomeTab({ data }: { data: ChannelPageDTO }) {
  return (
    <div className="space-y-8">
      <section aria-label="Featured videos">
        <VideosTab videos={data.videos} emptyNote="This channel hasn't uploaded any videos yet." compactHeading />
      </section>
      {data.shorts.length > 0 && (
        <section aria-label="Shorts">
          <h2 className="mb-3 text-base font-semibold">Shorts</h2>
          <ShortsGrid shorts={data.shorts} />
        </section>
      )}
    </div>
  );
}

function VideosTab({
  videos,
  emptyNote,
  compactHeading,
}: {
  videos: ChannelPageDTO["videos"];
  emptyNote: string;
  compactHeading?: boolean;
}) {
  if (videos.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyNote}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}

function ShortsTab({ shorts }: { shorts: ChannelPageDTO["shorts"] }) {
  if (shorts.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No Shorts from this channel yet.</p>;
  }
  return <ShortsGrid shorts={shorts} />;
}

function ShortsGrid({ shorts }: { shorts: ChannelPageDTO["shorts"] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      {shorts.map((short) => (
        <Link
          key={short.id}
          href="/shorts"
          className="group flex flex-col gap-2"
          aria-label={short.title}
        >
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
            <img
              src={short.thumbnailUrl}
              alt={short.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <p className="line-clamp-2 text-sm font-medium leading-snug">{short.title}</p>
          <p className="-mt-1 text-xs text-muted-foreground">{formatCount(short.views)} views</p>
        </Link>
      ))}
    </div>
  );
}

function PlaylistsTab({ playlists }: { playlists: NonNullable<ChannelTabDTO["playlists"]> }) {
  if (playlists.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No public playlists from this channel yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {playlists.map((pl) => (
        <Link
          key={pl.id}
          href={`/playlist/${pl.id}`}
          className="group flex flex-col gap-2"
          aria-label={`Open playlist ${pl.title}`}
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
            {pl.thumbnailUrl ? (
              <img
                src={pl.thumbnailUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.02]"
              />
            ) : null}
            <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatCount(pl.videoCount)} videos
            </span>
          </div>
          <p className="line-clamp-2 text-sm font-medium leading-snug">{pl.title}</p>
          {pl.videoCountText && (
            <p className="-mt-1 text-xs text-muted-foreground">{pl.videoCountText}</p>
          )}
        </Link>
      ))}
    </div>
  );
}

function CommunityTab({ posts }: { posts: NonNullable<ChannelTabDTO["posts"]> }) {
  if (posts.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        This channel hasn&apos;t posted to the Community tab yet.
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {posts.map((post) => (
        <article
          key={post.id}
          className="rounded-xl border border-border p-4"
          aria-label="Community post"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Flag className="size-3.5" aria-hidden="true" />
            {post.authorName ?? "Channel"} · {post.publishedText ?? ""}
          </div>
          {post.text && (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{post.text}</p>
          )}
          {post.imageUrl && (
            <div className="mt-3 overflow-hidden rounded-xl">
              <img src={post.imageUrl} alt="Post attachment" loading="lazy" className="max-h-96 w-full object-cover" />
            </div>
          )}
          <div className="mt-3 flex items-center gap-5 text-xs text-muted-foreground">
            {post.likesText && (
              <span className="flex items-center gap-1.5">
                <ThumbsUp className="size-3.5" aria-hidden="true" />
                {post.likesText}
              </span>
            )}
            {post.replyCountText && (
              <span className="flex items-center gap-1.5">
                <Heart className="size-3.5" aria-hidden="true" />
                {post.replyCountText}
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function AboutTab({
  about,
  subscriberCount,
  videoCount,
  description,
}: {
  about: ChannelTabDTO["about"];
  subscriberCount: number;
  videoCount: number;
  description: string | null;
}) {
  const a = about ?? null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold">Description</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
          {a?.description ?? description ?? "No description."}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Subscribers</dt>
          <dd className="font-medium">
            {a?.subscriberCountText ?? formatCount(subscriberCount)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Videos</dt>
          <dd className="font-medium">{a?.videoCountText ?? formatCount(videoCount)}</dd>
        </div>
        {a?.viewCountText && (
          <div>
            <dt className="text-muted-foreground">Views</dt>
            <dd className="font-medium">{a.viewCountText}</dd>
          </div>
        )}
        {a?.joinedDateText && (
          <div>
            <dt className="text-muted-foreground">Joined</dt>
            <dd className="font-medium">{a.joinedDateText.replace(/^Joined\s+/i, "")}</dd>
          </div>
        )}
        {a?.country && (
          <div>
            <dt className="text-muted-foreground">Country</dt>
            <dd className="font-medium">{a.country}</dd>
          </div>
        )}
      </dl>
      {a?.links && a.links.length > 0 && (
        <div>
          <h2 className="text-base font-semibold">Links</h2>
          <ul className="mt-2 space-y-2">
            {a.links.map((link, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    {link.title}
                  </a>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Check className="size-3.5" aria-hidden="true" />
                    {link.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!a && (
        <p className="py-4 text-sm text-muted-foreground">
          About details are unavailable right now.
        </p>
      )}
      {a && (a.description === null || a.joinedDateText === null) && (
        <p className="text-xs text-muted-foreground">
          {formatRelativeDate(new Date().toISOString())} — some About details weren&apos;t
          reachable from the channel page.
        </p>
      )}
    </div>
  );
}

function LazyTab({
  tab,
  tabData,
  tabLoading,
  render,
}: {
  tab: ChannelTabId;
  tabData: ChannelTabDTO | null;
  tabLoading: boolean;
  render: (t: ChannelTabDTO) => React.ReactNode;
}) {
  if (tabLoading || !tabData) {
    return (
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label={`Loading ${tab}`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  if (tabData.walled) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" role="status">
        This tab&apos;s data is unavailable from this egress right now. A last-known copy serves
        here once one exists — nothing is fabricated.
      </p>
    );
  }
  return <>{render(tabData)}</>;
}
