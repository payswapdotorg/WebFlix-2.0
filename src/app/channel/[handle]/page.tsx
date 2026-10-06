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
import { CommunityPostCard, CommunityPostSkeleton } from "@/components/community/community-post-card";
import { PostComposer, CreatePostButton } from "@/components/community/post-composer";
import { formatSubscribers, formatCount, formatRelativeDate } from "@/lib/format";
import type {
  ChannelPageDTO,
  ChannelSearchDTO,
  ChannelSortChipDTO,
  ChannelTabDTO,
  ChannelTabId,
  ChannelJoinDTO,
} from "@/lib/types";

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
 *
 * WFX2-P6-CH (channel YouTube-parity):
 * - The Videos tab's sort chips (Latest / Popular / Oldest) render when the
 *   tab payload carries them (absent → no chip row — honest omission);
 *   clicking a chip refetches the grid via the chip's own continuation
 *   token (?tab=videos&chip=<token> — browse {continuation}); the chip list
 *   itself is reused, only the grid data changes; the response re-marks the
 *   selected chip.
 * - The header shows the BARE handle with a single leading "@" (the DTO
 *   normalizes upstream "@name"/"@/name" forms — the doubled "@/@name" bug
 *   is dead), the live subscriber text (typed-absent when the payload
 *   carries none — composed pages show it only after the real watch
 *   enrichment), the video count on the same line, and the truncated
 *   description snippet with the "…more" affordance into the About tab.
 *
 * WFX2-P7-CH (the Membership tab + the Join sheet completion):
 * - The Membership tab renders ONLY when the channel's own tab list carries
 *   it AND the channel is joinable; its tiers come from the SAME join
 *   surface the sheet walks (the shared memberships-panel helper — one
 *   walk, no divergence), rendered YouTube-style: a "Join this channel"
 *   header line + tier cards (title, priceText, perk rows split on
 *   newlines/commas — null perksText → no perk rows, honest empty).
 * - The Join sheet's tier cards each carry a "Join on YouTube" CTA — the
 *   real channel's join page (bare-handle URL, external link) — with the
 *   one-line honest explainer: checkout + payment happen on YouTube;
 *   WebFlix shows the real tiers and never processes or fakes a payment.
 */

const ALL_TABS: { id: ChannelTabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
  { id: "live", label: "Live" },
  { id: "playlists", label: "Playlists" },
  { id: "community", label: "Community" },
  { id: "membership", label: "Membership" },
  { id: "about", label: "About" },
];

/** Tabs whose first page is seeded from the main channel payload. */
const SEEDED_TABS: ChannelTabId[] = ["home", "videos", "shorts"];

/**
 * WFX2-P7-CH — perksText → perk rows: split on newlines/commas, trim, drop
 * empty rows (a null perksText never reaches here — no perk rows, the
 * honest empty).
 */
function splitPerkRows(perksText: string): string[] {
  return perksText
    .split(/[\n,]+/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
}

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
  /** WFX2-P2-SO: the Studio deep link — open the own-channel composer */
  const composeDeepLink = searchParams.get("compose") === "1";
  const [searchOpen, setSearchOpen] = useState(Boolean(initialQ));
  const [query, setQuery] = useState(initialQ);
  const [input, setInput] = useState(initialQ);
  const [searchTick, setTick] = useState(0);
  const { data, loading, error, reload } = useApi<ChannelPageDTO>(
    handle ? `/api/channel/${encodeURIComponent(handle)}` : null
  );
  // P14-YOU: the operator's own-channel affordances — resolve the operator's
  // REAL channel through the studio seam (session-only; cached server-side)
  // and compare with the viewed channel. Honest null in public mode → the
  // Subscribe button stays for every channel.
  const { data: studioInfo } = useApi<{ session: boolean; channel: { id: string; handle: string } | null }>(
    handle ? "/api/studio?enrich=0" : null
  );
  const ownChannel =
    data?.channel && studioInfo?.channel
      ? studioInfo.channel.id === data.channel.id ||
        studioInfo.channel.handle.replace(/^@/, "") === data.channel.handle.replace(/^@/, "")
      : false;
  const { data: results, loading: searching, error: searchError } = useApi<ChannelSearchDTO>(
    searchOpen && query.trim()
      ? `/api/channel/${encodeURIComponent(handle)}/search?q=${encodeURIComponent(query.trim())}&t=${searchTick}`
      : null
  );
  const [subscribing, setSubscribing] = useState(false);
  const [tab, setTab] = useState<ChannelTabId>(composeDeepLink ? "community" : "home");
  const [joinOpen, setJoinOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const { data: joinInfo } = useApi<ChannelJoinDTO>(
    joinOpen && handle ? `/api/channel/${encodeURIComponent(handle)}/join` : null
  );

  // WFX2-P6-CH — the Videos tab's sort: the clicked chip's own continuation
  // token (null → the tab's default order). The url swaps per chip so the
  // useApi render-phase reset re-fetches; the chip list itself is REUSED
  // (never refetched per click — only the grid data changes).
  const [sortToken, setSortToken] = useState<string | null>(null);
  const chipUrl =
    tab === "videos" && sortToken && handle
      ? `/api/channel/${encodeURIComponent(handle)}/tab?tab=videos&chip=${encodeURIComponent(sortToken)}`
      : null;
  const { data: chipData, loading: chipLoading, error: chipError } = useApi<ChannelTabDTO>(chipUrl);

  const availableTabs = useMemo<ChannelTabId[]>(() => {
    const own = data?.tabs?.length ? data.tabs : ALL_TABS.map((t) => t.id);
    return ALL_TABS.filter((t) => {
      // WFX2-P7-CH — the Membership tab renders ONLY when the channel's own
      // tab list carries it AND the channel is really joinable (the Join
      // button renderer) — never a guessed membership surface. The own-list
      // check is explicit (never the ALL_TABS fallback), so a tabs-less
      // payload never surfaces the tab.
      if (t.id === "membership") {
        return data?.tabs?.includes("membership") === true && data?.joinable === true;
      }
      return own.includes(t.id);
    }).map((t) => t.id);
  }, [data]);

  // remember the last tab per channel: restore on load, persist on change
  // (the ?compose=1 deep link pins the Community tab — never overridden)
  useEffect(() => {
    if (!handle || !data || composeDeepLink) return;
    const stored = readStoredTab(handle, availableTabs);
    if (stored && stored !== "home") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stored-preference hydration (mount-time only)
      setTab(stored);
    }
  }, [handle, data?.channel?.id, availableTabs, composeDeepLink]);

  const selectTab = useCallback(
    (t: ChannelTabId) => {
      setTab(t);
      if (handle) storeTab(handle, t);
    },
    [handle]
  );

  // the lazy tab payload (only the non-seeded tabs fetch)
  const tabNeedsFetch = data !== null && !SEEDED_TABS.includes(tab);
  const { data: tabData, loading: tabLoading, reload: reloadTab } = useApi<ChannelTabDTO>(
    tabNeedsFetch && handle ? `/api/channel/${encodeURIComponent(handle)}/tab?tab=${tab}` : null
  );

  // the ?compose=1 deep link opens the composer once the tab payload says
  // this session owns the channel (compose === true — the operator session)
  useEffect(() => {
    if (composeDeepLink && tabData?.compose === true) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link hydration
      setComposerOpen(true);
    }
  }, [composeDeepLink, tabData?.compose]);

  // WFX2-P6-CH — the sort-chip bar's derived state (never synced): the chip
  // LIST is the last chip-read's re-marked bar when it carried one, else the
  // page payload's own bar; the selected chip is the clicked token while a
  // chip read is in flight or landed (the response re-marks the same chip),
  // else the payload's own selected marker (Latest on the default fetch).
  const sortChips: ChannelSortChipDTO[] = (
    chipData?.sortChips?.length ? chipData.sortChips : data?.sortChips
  ) ?? [];
  const selectedSortToken =
    sortToken ?? (sortChips.find((c) => c.selected === true)?.token ?? null);

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

          {/* header (WFX2-P6-CH: the completed youtube.com composition —
              name + verified badge, the bare handle with ONE leading "@",
              live subscriber text + video count on the same line, the
              truncated description snippet with the …more affordance) */}
          <ChannelHeaderBlock
            channel={data.channel}
            joinable={data.joinable}
            ownChannel={ownChannel}
            subscribing={subscribing}
            onToggleSubscribe={toggleSubscribe}
            onJoin={() => setJoinOpen(true)}
            onMore={availableTabs.includes("about") ? () => selectTab("about") : null}
          />

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
                  <div className="space-y-4">
                    {/* WFX2-P6-CH — the sort-chip row: ONLY when the tab
                        payload really carries chips (absent → no row —
                        honest omission, never fabricated
                        Latest/Popular/Oldest) */}
                    {sortChips.length > 0 && (
                      <SortChipBar
                        chips={sortChips}
                        selectedToken={selectedSortToken}
                        onSelect={setSortToken}
                        loading={chipLoading}
                      />
                    )}
                    {sortToken === null ? (
                      <VideosTab videos={data.videos} emptyNote="This channel hasn't uploaded any videos yet." />
                    ) : chipLoading ? (
                      <div
                        className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                        aria-busy="true"
                        aria-label="Loading sorted videos"
                      >
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div key={i} className="space-y-2">
                            <Skeleton className="aspect-video w-full rounded-xl" />
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                          </div>
                        ))}
                      </div>
                    ) : chipError ? (
                      <p className="py-10 text-center text-sm text-muted-foreground" role="alert">
                        This sort is unavailable right now — {chipError}
                      </p>
                    ) : chipData?.walled ? (
                      <p className="py-10 text-center text-sm text-muted-foreground" role="status">
                        This tab&apos;s data is unavailable from this egress right now. A last-known copy
                        serves here once one exists — nothing is fabricated.
                      </p>
                    ) : (
                      <VideosTab
                        videos={chipData?.videos ?? []}
                        emptyNote="This channel has no videos in this order."
                      />
                    )}
                  </div>
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
                  /* WFX2-P6-CH — the broker family speaks the "@name" form:
                     the DTO's bare handle is re-prefixed here (a UC… id
                     fallback passes through as-is) */
                  <CommunityTabPanel
                    tabData={tabData}
                    tabLoading={tabLoading}
                    channelName={data.channel.name}
                    channelAvatarUrl={data.channel.avatarUrl}
                    channelHandle={
                      isChannelIdHandle(data.channel.handle)
                        ? data.channel.handle
                        : `@${data.channel.handle}`
                    }
                    compose={tabData?.compose === true}
                    composerOpen={composerOpen}
                    onComposerOpen={setComposerOpen}
                    onCreated={reloadTab}
                  />
                )}
                {tab === "membership" && (
                  /* WFX2-P7-CH — the Membership tab: the tier surface from the
                     SAME join walk the sheet consumes (the tab route's
                     membership branch → the shared helper) */
                  <MembershipTabPanel tabData={tabData} tabLoading={tabLoading} />
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

      {/* Join sheet — real tiers when reachable, honest degrade otherwise.
          WFX2-P7-CH: each tier card carries its own "Join on YouTube" CTA
          (the real channel's join page — bare handle, external link), with
          the one-line honest explainer: checkout + payment happen on
          YouTube; WebFlix shows the real tiers and never processes or fakes
          a payment (the old in-app "Join" button is gone — it faked a
          checkout this app never performs). */}
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
                    {data?.channel && (
                      <Button asChild variant="secondary" className="mt-3 w-full rounded-full">
                        <a
                          href={`https://www.youtube.com/${data.channel.handle}/join`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Join ${data.channel.name} on YouTube — ${tier.title}`}
                        >
                          Join on YouTube <ExternalLink className="size-4" aria-hidden="true" />
                        </a>
                      </Button>
                    )}
                  </div>
                ))}
                {data?.channel && (
                  <p className="text-center text-xs text-muted-foreground" role="note">
                    Checkout and payment happen on YouTube — WebFlix shows the real tiers and
                    never processes or fakes a payment.
                  </p>
                )}
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

/**
 * WFX2-P6-CH — does the (bare) handle stand for a "UC…" channel id? The
 * header mapper falls back to the id when the payload carries no @handle;
 * such a value is an id, not a handle, and renders as-is (never dressed up
 * with a fake "@"). Exported for the component tests.
 */
export function isChannelIdHandle(handle: string): boolean {
  return /^UC[\w-]{20,}$/.test(handle);
}

/**
 * WFX2-P6-CH — the channel header block (youtube.com parity composition):
 * avatar → name + verified badge (when the DTO carries one) → handle,
 * subscriber count AND video count on the same line → the truncated
 * description snippet with the "…more" affordance (into the About tab) →
 * Subscribe/Join. Exported for the component tests.
 *
 * Honesty law: the subscriber segment renders ONLY when real data exists —
 * the live passthrough text ("4.55M subscribers") wins; the parsed count
 * formats only when the text is absent but the count is real; composed
 * pages carry real text only after the watch enrichment, so before it BOTH
 * are absent and the segment hides (typed-absent, never a fake
 * "0 subscribers"). The description row hides entirely when the payload
 * carries none.
 */
export function ChannelHeaderBlock({
  channel,
  joinable,
  ownChannel = false,
  subscribing,
  onToggleSubscribe,
  onJoin,
  onMore,
}: {
  channel: ChannelPageDTO["channel"];
  joinable?: boolean;
  /** P14-YOU: the viewed channel IS the operator's own (the studio seam's
   *  resolution) — youtube.com swaps Subscribe for "Customize channel" +
   *  "Manage videos" (measured live: Customize first, then Manage). */
  ownChannel?: boolean;
  subscribing: boolean;
  onToggleSubscribe: () => void;
  onJoin: () => void;
  /** the "…more" description affordance — null when no About tab exists (hidden) */
  onMore: (() => void) | null;
}) {
  // the bare-handle law: the DTO normalizes upstream "@name"/"@/name" forms,
  // so the header prefixes the ONE "@" itself — the doubled "@/@name" the
  // live bug showed can never render
  const subscriberText =
    channel.subscriberCountText ??
    (channel.subscriberCount > 0 ? formatSubscribers(channel.subscriberCount) : null);
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
      <img
        src={channel.avatarUrl}
        alt={channel.name}
        className="size-20 rounded-full object-cover sm:size-24"
      />
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-3xl">
          <span className="truncate">{channel.name}</span>
          {channel.verified && <VerifiedBadge className="size-5" />}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isChannelIdHandle(channel.handle) ? channel.handle : `@${channel.handle}`}
          {subscriberText !== null && (
            <>
              {" · "}
              <span className="font-medium text-foreground">{subscriberText}</span>
            </>
          )}{" "}
          · {formatCount(channel.videoCount)} videos
        </p>
        {channel.description && (
          <div className="mt-1 flex items-start gap-1">
            <p className="line-clamp-1 text-sm text-muted-foreground">{channel.description}</p>
            {onMore && (
              <button
                type="button"
                onClick={onMore}
                aria-label={`More about ${channel.name}`}
                className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                …more
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {ownChannel ? (
          // youtube.com's own-channel controls (live 2026: Customize channel
          // first, then Manage videos — NO Subscribe on your own channel)
          <>
            <Button asChild variant="secondary" className="rounded-full">
              <Link href="/studio">Customize channel</Link>
            </Button>
            <Button asChild variant="secondary" className="rounded-full">
              <Link href="/studio">Manage videos</Link>
            </Button>
          </>
        ) : channel.isOwner ? (
          <Button asChild variant="secondary" className="rounded-full">
            <Link href="/studio">Your channel — open Studio</Link>
          </Button>
        ) : (
          <>
            {joinable && (
              <Button onClick={onJoin} className="rounded-full" aria-label={`Join ${channel.name}`}>
                Join
              </Button>
            )}
            <Button
              onClick={onToggleSubscribe}
              disabled={subscribing}
              className={`rounded-full ${
                channel.isSubscribed
                  ? "bg-secondary text-foreground hover:bg-accent"
                  : "bg-foreground text-background hover:bg-foreground/90"
              }`}
            >
              {channel.isSubscribed ? (
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
  );
}

/**
 * WFX2-P6-CH — the Videos tab's sort-chip bar (youtube.com parity): one
 * house-style pill per chip (Latest / Popular / Oldest), the selected chip
 * visually marked (aria-pressed) + keyboard accessible (native buttons).
 * Exported for the component tests.
 */
export function SortChipBar({
  chips,
  selectedToken,
  onSelect,
  loading,
}: {
  chips: ChannelSortChipDTO[];
  /** the token of the chip that renders selected (null → none marked) */
  selectedToken: string | null;
  onSelect: (token: string) => void;
  loading?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Sort videos"
      aria-busy={loading ? true : undefined}
      className="flex flex-wrap gap-2"
    >
      {chips.map((chip) => {
        const selected = chip.token === selectedToken;
        return (
          <button
            key={chip.token}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(chip.token)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              selected
                ? "bg-foreground text-background"
                : "bg-secondary text-secondary-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

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

/**
 * WFX2-P2-SO — the Community tab panel: the wall-ladder payload's honest
 * states (walled → the channel page's honest-empty pattern; source → the
 * rung badge — never a lie about where the posts came from), the full post
 * cards, and the creator composer on the own channel.
 */
function CommunityTabPanel({
  tabData,
  tabLoading,
  channelName,
  channelAvatarUrl,
  channelHandle,
  compose,
  composerOpen,
  onComposerOpen,
  onCreated,
}: {
  tabData: ChannelTabDTO | null;
  tabLoading: boolean;
  channelName: string;
  channelAvatarUrl: string | null;
  channelHandle: string;
  compose: boolean;
  composerOpen: boolean;
  onComposerOpen: (v: boolean) => void;
  onCreated: () => void;
}) {
  if (tabLoading || !tabData) {
    return (
      <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Loading community posts">
        <CommunityPostSkeleton />
        <CommunityPostSkeleton />
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
  const posts = tabData.posts ?? [];
  const source = tabData.source ?? null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {compose && !composerOpen && (
        <div className="flex justify-end">
          <CreatePostButton onClick={() => onComposerOpen(true)} />
        </div>
      )}
      {compose && composerOpen && (
        <PostComposer
          handle={channelHandle}
          onClose={() => onComposerOpen(false)}
          onCreated={() => {
            onComposerOpen(false);
            onCreated();
          }}
        />
      )}
      {posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          This channel hasn&apos;t posted to the Community tab yet.
        </p>
      ) : (
        posts.map((post) => (
          <CommunityPostCard
            key={post.id}
            post={post}
            channelAvatarUrl={channelAvatarUrl}
            channelName={channelName}
            channelHandle={channelHandle}
          />
        ))
      )}
      {source === "broker" && (
        <p className="text-center text-[11px] text-muted-foreground" role="note">
          Live posts — read through the logged-in browser (the unwalled channel).
        </p>
      )}
      {source === "last-good" && (
        <p className="text-center text-[11px] text-muted-foreground" role="note">
          Serving the last-known copy of this Community tab.
        </p>
      )}
    </div>
  );
}

/**
 * WFX2-P7-CH — the Membership tab panel (youtube.com parity): a "Join this
 * channel" header line, then the REAL tier cards from the memberships panel
 * (the channel's own tier order) — title, priceText, and the perk rows
 * (perksText split on newlines/commas; null perksText → no perk rows, the
 * honest empty).
 *
 * Honest states, verbatim the app's law: session absent → YouTube's own
 * logged-out copy ("Sign in to become a member.") with the Join sheet's
 * sign-in affordance (the /account pattern); tiers unreadable from the
 * session → the honest note line; the walled/unavailable read → the tab
 * family's standard degrade copy. NEVER a fabricated tier, NEVER a
 * fabricated price — a tier row renders ONLY when the panel really
 * carried it.
 */
function MembershipTabPanel({
  tabData,
  tabLoading,
}: {
  tabData: ChannelTabDTO | null;
  tabLoading: boolean;
}) {
  if (tabLoading || !tabData) {
    return (
      <div
        className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-busy="true"
        aria-label="Loading membership tiers"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
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
  const join = tabData.membership ?? null;
  const tiers = join?.tiers ?? null;
  const hasTiers = !!tiers && tiers.length > 0;
  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-base font-semibold">Join this channel</h2>
      {hasTiers && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers!.map((tier, i) => {
            const perks = tier.perksText ? splitPerkRows(tier.perksText) : [];
            return (
              <div key={i} className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold">{tier.title}</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{tier.priceText}</p>
                {perks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {perks.map((perk, j) => (
                      <li
                        key={j}
                        className="flex items-start gap-1.5 text-xs text-muted-foreground"
                      >
                        <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!hasTiers && join?.signinRequired && (
        /* session absent — YouTube's own logged-out Join modal copy + the
           sheet's sign-in affordance (the /account pattern) */
        <div className="mt-4 max-w-sm space-y-3">
          <p className="text-sm text-muted-foreground">{join.note}</p>
          <p className="text-xs text-muted-foreground">
            WebFlix joins act on the operator&apos;s YouTube session (single-tenant live
            mode) — no session is configured right now.
          </p>
          <Button asChild className="w-full rounded-full">
            <a href="/account">Sign in</a>
          </Button>
        </div>
      )}
      {!hasTiers && join && !join.signinRequired && join.joinable === false && (
        <p className="mt-4 py-6 text-center text-sm text-muted-foreground">
          This channel doesn&apos;t offer memberships.
        </p>
      )}
      {!hasTiers && !join?.signinRequired && join?.joinable !== false && (
        /* tiers unreadable from the session — the honest note line (never a
           fabricated tier, never a fabricated price); join null (a malformed
           payload) degrades to the same honest note */
        <p className="mt-4 py-6 text-center text-sm text-muted-foreground">
          {join?.note ?? "Membership tiers are not readable from this session right now."}
        </p>
      )}
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
