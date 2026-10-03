/** Shared DTO types — the contract between API routes and client components. */

export type ChannelLite = {
  id: string;
  /** "@handle" or "UC…" — both resolve through /api/channel/[handle] */
  handle: string;
  name: string;
  avatarUrl: string;
  verified: boolean;
  /** parsed from the real subscriber text (approx when abbreviated, e.g. "4.55M") */
  subscriberCount: number;
  /** live passthrough, e.g. "4.55M subscribers" */
  subscriberCountText?: string | null;
  /** channel RESULT cards only (search): the real description snippet + video count */
  description?: string | null;
  videoCountText?: string | null;
};

export type VideoDTO = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  /** null when the upstream response carries no duration (live streams, shorts cards) */
  durationSec: number | null;
  views: number;
  /** live passthrough, e.g. "1,821,187,782 views" / "1.8B views" */
  viewsText?: string | null;
  /** live passthrough, e.g. "16 years ago" */
  publishedText?: string | null;
  likes: number;
  dislikes: number;
  visibility: "public" | "unlisted" | "private";
  isMembersOnly: boolean;
  membersTier: string | null;
  category: string;
  isShort: boolean;
  isLive: boolean;
  premieredAt: string | null;
  /** null when the upstream response carries no publish date (approx from publishedText otherwise) */
  createdAt: string | null;
  /** live badge passthrough, e.g. ["verified_artist"] */
  badges?: string[];
  channel: ChannelLite;
};

/** Video + where you left off (continue watching / history). */
export type ContinueVideoDTO = VideoDTO & {
  watchedSec: number;
  watchedAt: string;
};

/**
 * WFX2-HR — which rung of the home ladder produced the payload:
 *  - "browse"         rung 1: a fresh healthy browse (FEwhat_to_watch) answer;
 *  - "last-good"      rung 2: the adapter's Upstash last-good (24h hard window)
 *                      served because the egress is walled (SWR-stale counts);
 *  - "search-compose" rung 3: real search data composed into the default home
 *                      (also the honest label for the search-backed category
 *                      mode, whose grid is likewise composed from search).
 * Never "browse" when the payload was composed — the harness + UI can trust it.
 */
export type HomeFeedSource = "browse" | "last-good" | "search-compose";

export type HomeFeedDTO = {
  hero: VideoDTO | null;
  trending: VideoDTO[];
  continueWatching: ContinueVideoDTO[];
  becauseYouWatched: { label: string; videos: VideoDTO[] } | null;
  shorts: VideoDTO[];
  recommended: VideoDTO[];
  recommendedCursor: string | null;
  chips: string[];
  /** WFX2-HR — the ladder rung that produced this feed (see HomeFeedSource). */
  source: HomeFeedSource;
};

export type VideoPageDTO = {
  videos: VideoDTO[];
  nextCursor: string | null;
};

export type NotificationDTO = {
  id: string;
  kind: "video" | "live" | "post" | "reply";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  videoId: string | null;
  videoThumbnailUrl: string | null;
  channel: ChannelLite;
};

export type MeDTO = {
  user: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string;
    description: string | null;
  };
  ownedChannel: { handle: string; name: string } | null;
  subscriptions: (ChannelLite & { bell: "off" | "personalized" | "all" })[];
};

export type PlaylistDTO = {
  id: string;
  title: string;
  visibility: "public" | "unlisted" | "private";
  isWatchLater: boolean;
  createdAt: string;
  videoCount: number;
  coverUrl: string | null;
  videos: VideoDTO[];
};

export type CommentDTO = {
  id: string;
  body: string;
  likes: number;
  likesText?: string | null;
  heartedByCreator: boolean;
  pinned: boolean;
  createdAt: string | null;
  publishedText?: string | null;
  author: { handle: string; name: string; avatarUrl: string };
  replyCount: number;
};

export type ChannelPageDTO = {
  channel: ChannelLite & {
    bannerUrl: string | null;
    description: string | null;
    /** live channel responses carry no join date (about tab — Wave B) */
    createdAt: string | null;
    isSubscribed: boolean;
    isOwner: boolean;
    videoCount: number;
    /**
     * WFX2-C-F (additive): the page was composed from real search results
     * (the channel-read wall). Header fields search cannot carry —
     * subscriberCount/subscriberCountText/bannerUrl/description — are honest
     * nulls/0, never invented (WFX2-CF-2: the subscriber fields carry REAL
     * watch data when the unwalled watch-meta enrichment serves; the honest
     * nulls stand on its failure). Videos are the exact-id-filtered results.
     */
    composed?: boolean;
  };
  videos: VideoDTO[];
  shorts: VideoDTO[];
  /** WFX2-B-S (additive): the response's own tab availability */
  tabs?: ChannelTabId[];
  /** WFX2-B-S (additive): memberships are offered (the Join button renderer) */
  joinable?: boolean;
  /**
   * WFX2-P6-CH (additive): the Videos tab's own sort chips (Latest / Popular /
   * Oldest) — the videos-tab browse response carries them; surfaced only when
   * the payload really does (undefined → the UI hides the chip row).
   */
  sortChips?: ChannelSortChipDTO[];
  /** WFX2-B-S (additive): channel data walled upstream → last-good may still serve */
  walled?: boolean;
  /** WFX2-B-S (additive): the honest-degrade explanation (walled state) */
  note?: string;
};

/** The channel page tabs (YouTube's own tab family). */
export type ChannelTabId =
  | "home"
  | "videos"
  | "shorts"
  | "live"
  | "playlists"
  | "community"
  | "about";

/** One channel playlist (the Playlists tab's lockup view models). */
export type ChannelPlaylistDTO = {
  id: string;
  title: string;
  /** "3 videos" badge text, parsed to a count when possible */
  videoCount: number;
  videoCountText: string | null;
  thumbnailUrl: string | null;
};

/** One community-post poll choice (backstageAttachment.pollRenderer.choices[]). */
export type CommunityPollChoiceDTO = {
  text: string;
  /** the real per-choice vote count — null until the response carries results */
  votes: number | null;
  /** live passthrough, e.g. "62%" — null until the response carries results */
  percentText: string | null;
};

/** One community-post poll (backstageAttachment.pollRenderer). */
export type CommunityPollDTO = {
  choices: CommunityPollChoiceDTO[];
  /** "193 votes" live passthrough (parsed count carried alongside) */
  totalVotesText: string | null;
  totalVotes: number | null;
};

/** One community post (the Community/Posts tab's backstagePostRenderer). */
export type CommunityPostDTO = {
  id: string;
  text: string;
  authorName: string | null;
  /** WFX2-P2-SO (additive): the post author's avatar when the payload carries it (null → the channel header's) */
  authorAvatarUrl?: string | null;
  publishedText: string | null;
  likesText: string | null;
  replyCountText: string | null;
  imageUrl: string | null;
  /** WFX2-P2-SO (additive): ALL image attachments (single image → [url]; grids in post order) */
  images?: string[];
  /** WFX2-P2-SO (additive): the poll attachment when the post carries one */
  poll?: CommunityPollDTO | null;
};

/**
 * WFX2-P6-CH — one Videos-tab sort chip (Latest / Popular / Oldest).
 * Live-verified 2026-10-03 (resident-browser capture, Rick Astley): the
 * channel Videos tab carries its chip bar as
 * `richGridRenderer.header.chipBarViewModel.chips[].chipViewModel` with
 * `tapCommand.innertubeCommand.continuationCommand.token` (request
 * CONTINUATION_REQUEST_TYPE_BROWSE — the fetch is browse {continuation});
 * the legacy `chipCloudChipRenderer` shape (feedFilterChipBarRenderer)
 * is honored as the fallback. Only chips the payload actually carries are
 * surfaced — a tab with no chip data renders no chip row (honest omission).
 */
export type ChannelSortChipDTO = {
  label: string;
  /** the chip's own continuation token (browse {continuation} refetch) */
  token: string;
  /** the payload's own selected marker (Latest on the default tab fetch) */
  selected: boolean;
};

/** The About panel (aboutChannelViewModel from the engagement-panel continuation). */
export type ChannelAboutDTO = {
  description: string | null;
  joinedDateText: string | null;
  viewCountText: string | null;
  subscriberCountText: string | null;
  videoCountText: string | null;
  country: string | null;
  links: { title: string; url: string | null }[];
};

/**
 * WFX2-P2-SO — which rung of the community ladder produced the Posts tab:
 *  - "browse"    rung 1: a fresh healthy InnerTube browse (works unwalled);
 *  - "broker"    rung 2: the Tier-2 broker-read — the logged-in browser's
 *                own ytInitialData from youtube.com/@handle/community,
 *                mapped through the SAME backstage mapper (one mapper,
 *                two transports);
 *  - "last-good" rung 3: the adapter's Upstash last-good (24h hard window)
 *                served because every live rung hit the wall.
 * Never set when the tab is walled (rung 4) — the honest-empty shape.
 */
export type CommunityTabSource = "browse" | "broker" | "last-good";

/** The per-tab payload (lazy-loaded per tab switch). */
export type ChannelTabDTO = {
  tab: ChannelTabId;
  videos?: VideoDTO[];
  shorts?: VideoDTO[];
  playlists?: ChannelPlaylistDTO[];
  posts?: CommunityPostDTO[];
  about?: ChannelAboutDTO;
  /** memberships (Join) info when the tab surface carries it */
  joinable?: boolean;
  /**
   * WFX2-P6-CH (additive): the Videos tab's sort chips — the default fetch
   * carries the channel's own chip bar, a chip-continuation fetch carries
   * the re-marked chip bar (the chosen sort selected). Hidden when absent.
   */
  sortChips?: ChannelSortChipDTO[];
  /** honest degrade: upstream walled and no last-good */
  walled?: boolean;
  /** WFX2-P2-SO (additive): the community ladder rung that produced the posts */
  source?: CommunityTabSource;
  /** WFX2-P2-SO (additive): the operator session owns this channel (the composer affordance) */
  compose?: boolean;
};

export type WatchPageDTO = {
  video: VideoDTO;
  isSubscribed: boolean;
  isOwner: boolean;
  memberTierName: string | null;
  related: VideoDTO[];
  comments: CommentDTO[];
};

export type StudioDTO = StudioPageDTO;

/** WFX2-C-B — the studio surface for the single-tenant operator channel. */
export type StudioPageDTO = {
  /** true when YT_COOKIES is configured (the operator session is live) */
  session: boolean;
  /** the operator's REAL channel (browse/channel-header data) — null in public mode */
  channel: StudioChannelDTO | null;
  /** the channel's public videos tab (real rows, public-scope stats) */
  videos: StudioVideoDTO[];
  /** public-scope totals computed from the real videos above (never studio-private numbers) */
  totals: {
    /** header subscriber count (real, channel-wide) */
    subscribers: number;
    subscriberCountText: string | null;
    /** header video count (real, channel-wide) */
    videoCount: number;
    /** views summed across the listed public videos (real) */
    views: number;
    /** likes summed across the enriched videos (null entries excluded — honest) */
    likes: number;
    /** comments summed across the enriched videos (null entries excluded — honest) */
    comments: number;
    /** how many listed rows the likes/comments sums cover */
    enrichedCount: number;
  };
  /** studio-scope analytics (Studio SSR with cookie auth — honest modes, never fake) */
  analytics: StudioAnalyticsDTO;
  /** deep links out to the real studio.youtube.com pages */
  deepLinks: StudioDeepLinksDTO;
};

export type StudioChannelDTO = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  bannerUrl: string | null;
  description: string | null;
  verified: boolean;
  subscriberCount: number;
  subscriberCountText: string | null;
  videoCountText: string | null;
  /** channel links from the browse/about data (real — empty when the response carries none) */
  links: { title: string; url: string }[];
};

export type StudioVideoDTO = {
  id: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number | null;
  views: number;
  viewsText: string | null;
  publishedText: string | null;
  createdAt: string | null;
  isShort: boolean;
  isLive: boolean;
  /** likes from the video's real watch metadata — null when not enriched */
  likes: number | null;
  /** comment count from the video's real comments page — null when not enriched */
  commentCount: number | null;
};

export type StudioAnalyticsDTO = {
  /**
   * "ok" — real metrics parsed from the Studio SSR page.
   * "no-session" — no YT_COOKIES; "no-channel" — operator channel unresolved.
   * "auth-required" — Studio redirected to accounts.google.com (re-auth needed).
   * "unavailable" — page fetched but no parseable metrics (honest empty).
   * "error" — upstream fetch failed.
   */
  mode: "ok" | "no-session" | "no-channel" | "auth-required" | "unavailable" | "error";
  /** real parsed metrics — null in every non-ok mode (NEVER fabricated) */
  metrics: {
    views: number | null;
    impressions: number | null;
    watchTimeMinutes: number | null;
    subscribersGained: number | null;
    estimatedRevenue: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  } | null;
  /** human-readable honest note for the UI */
  note: string;
};

export type StudioDeepLinksDTO = {
  /** https://studio.youtube.com (root — resolves the operator's channel via Google auth) */
  studioRoot: string;
  /** per-channel Studio pages (fall back to studioRoot when the channel is unresolved) */
  analytics: string;
  content: string;
  customization: string;
  /** https://www.youtube.com/upload — the real upload flow */
  upload: string;
};

/** WFX2-C-B — the upload hand-off (NO upload simulation: metadata → YouTube). */
export type UploadContextDTO = {
  session: boolean;
  /** the operator's channel (for "publishing as …" context) — null in public mode */
  channel: { name: string; handle: string; avatarUrl: string } | null;
  uploadUrl: string;
  studioRoot: string;
};

export type UploadHandoffDTO = {
  /** the real YouTube upload page */
  handoffUrl: string;
  /**
   * false — YouTube's upload page documents no URL params for title/description
   * pre-fill; the copy-to-clipboard bundle is the honest carrier.
   */
  prefillSupported: boolean;
  /** the copy-paste-ready metadata bundle */
  bundle: string;
  /** the validated fields echoed back */
  fields: {
    title: string;
    description: string;
    tags: string[];
    visibility: "public" | "unlisted" | "private";
    thumbnailUrl: string | null;
    isShort: boolean;
  };
};

/** Playlist result card (search) — real lockupViewModel/playlistRenderer data. */
export type PlaylistLiteDTO = {
  id: string;
  title: string;
  videoCount: number;
  videoCountText: string | null;
  thumbnailUrl: string | null;
  channelName: string;
  updatedText: string | null;
  /** RD… mixes / radios */
  isMix?: boolean;
};

/** The spelling correction the search page renders (real renderer data). */
export type SearchCorrection = {
  kind: "didYouMean" | "showingResultsFor";
  /** the corrected query YouTube suggests (results are shown for it when kind=showingResultsFor) */
  correctedQuery: string;
  /** the original (misspelled) query — present on showingResultsFor ("Search instead for …") */
  originalQuery: string | null;
};

export type SearchPageDTO = {
  query: string;
  videos: VideoDTO[];
  channels: ChannelLite[];
  /** playlist result cards (present when the query/filters yield playlists) */
  playlists?: PlaylistLiteDTO[];
  /** "About 3,839,607 results" — from the response's own estimatedResults */
  resultCountText?: string | null;
  /** "Showing results for X / Search instead for Y" when YouTube corrected the query */
  correction?: SearchCorrection | null;
};

export type HistoryGroupDTO = {
  label: string;
  items: ContinueVideoDTO[];
};

export type SubscriptionsPageDTO = {
  channels: ChannelLite[];
  videos: VideoDTO[];
};

export type TrendingPageDTO = {
  category: string;
  videos: VideoDTO[];
  /** "trending" = the SSR category page grid · "search" = the popular-this-week fallback (public mode) */
  source?: "trending" | "search";
};

/** The public playlist page (/playlist/[id] — browse VL…). */
export type PlaylistPageDTO = {
  playlist: {
    id: string;
    title: string;
    channelName: string;
    videoCountText: string | null;
    viewsText: string | null;
    description: string | null;
  };
  videos: VideoDTO[];
  nextCursor: string | null;
};

/** The Live surface (/explore/live) — real live streams with watching counts. */
export type LivePageDTO = {
  videos: VideoDTO[];
};

/** In-channel search results ("Search this channel"). */
export type ChannelSearchDTO = {
  query: string;
  channelId: string;
  channelName: string;
  videos: VideoDTO[];
  nextCursor: string | null;
};

export type ShortsPageDTO = {
  shorts: VideoDTO[];
};
