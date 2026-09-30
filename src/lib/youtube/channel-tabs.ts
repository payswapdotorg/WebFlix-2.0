/**
 * WFX2-B-S channel tabs — deep parity for the channel page.
 *
 * Mechanism (LIVE-VERIFIED 2026-09-30, evidence/wfx2bs/CHANNEL-TABS.md):
 *  - every tab is `browse {browseId: "UC…", params: <the channel's own tab
 *    param>}` — the params come from the channel home response's own tab
 *    list (tabRenderer[].endpoint.browseEndpoint.params); the constant
 *    fallbacks are the verified family forms. NOTE: the family constants
 *    MUST be the full forms (the truncated "…IQaC" Playlists param falls
 *    back to Home — verified live).
 *  - Playlists: LOCKUP_CONTENT_TYPE_PLAYLIST lockups — id contentId, title
 *    metadata.lockupMetadataViewModel.title.content, video-count badge
 *    ("N videos") on contentImage.collectionThumbnailViewModel
 *    .primaryThumbnail.thumbnailViewModel overlays, thumbnail from image
 *    .sources[0].
 *  - Community: the "Posts" tab — backstagePostRenderer rows (postId,
 *    contentText.runs, voteCount accessibility label = "4.4K likes",
 *    reply button text = "12K replies", publishedText).
 *  - About: NOT a tab param — the channel home response's description
 *    "…more" tap carries a showEngagementPanel whose content holds a
 *    continuation token; `browse {continuation}` returns
 *    aboutChannelViewModel (full stats + links). The classic
 *    "EgVhYm91dPIGBAoCEgA=" about-tab param just returns the channel home
 *    (verified dead end).
 *  - Join/membership detection: the pageHeaderViewModel actions row carries
 *    a "Join" button (pageHeaderViewModel.actions.flexibleActionsViewModel
 *    .actionsRows[].actions[].buttonViewModel.title) only when the channel
 *    offers memberships. Tier data requires the signed-in memberships panel
 *    (operator session) — public mode honestly reports `joinable` with no
 *    tiers (never fabricated).
 */
import { innertubeBrowse } from "./innertube";
import { cachedResilient, TTL } from "./cache";
import { hasSession } from "./session";
import { resolveChannel } from "./channels";
import {
  walkTree,
  findFirst,
  runsText,
  mapVideos,
  mapShorts,
  parseCompactCount,
  channelJoinable,
} from "./mappers";
import type {
  ChannelTabDTO,
  ChannelTabId,
  ChannelPlaylistDTO,
  CommunityPostDTO,
  ChannelAboutDTO,
} from "@/lib/types";

/** Live-verified tab-param constants (full forms — the fallback family). */
export const CHANNEL_TAB_PARAMS: Record<Exclude<ChannelTabId, "home" | "about">, string> = {
  videos: "EgZ2aWRlb3PyBgQKAjoA",
  shorts: "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
  live: "EgdzdHJlYW1z8gYECgJ6AA%3D%3D",
  playlists: "EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA",
  community: "EgVwb3N0c_IGBAoCSgA%3D",
};

/** Map the response's tab titles to our tab ids (Community tab = "Posts"). */
const TAB_TITLE_TO_ID: Record<string, ChannelTabId> = {
  Home: "home",
  Videos: "videos",
  Shorts: "shorts",
  Live: "live",
  Playlists: "playlists",
  Posts: "community",
  Community: "community",
};
/** The response-own tab param for one of our tab ids (null → fallback). */
export function tabParamFromResponse(response: unknown, tab: ChannelTabId): string | null {
  for (const t of walkTree(response, "tabRenderer")) {
    const id = TAB_TITLE_TO_ID[String(t?.title ?? "")];
    if (id === tab) {
      const params = t?.endpoint?.browseEndpoint?.params;
      if (typeof params === "string" && params) return params;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// pure mappers (fixture-testable)
// ---------------------------------------------------------------------------

/** lockupViewModel (playlist) → ChannelPlaylistDTO. */
export function mapPlaylistLockup(l: unknown): ChannelPlaylistDTO | null {
  const lockup = l as any;
  const id = lockup?.contentId;
  if (typeof id !== "string" || !id) return null;
  const md = lockup?.metadata?.lockupMetadataViewModel;
  const title = md?.title?.content ?? "";
  const collection = lockup?.contentImage?.collectionThumbnailViewModel;
  const thumb = collection?.primaryThumbnail?.thumbnailViewModel;
  const sources = thumb?.image?.sources ?? [];
  const badges = walkTree(thumb?.overlays ?? {}, "thumbnailBadgeViewModel")
    .map((b) => (typeof b?.text === "string" ? b.text : null))
    .filter(Boolean) as string[];
  const videoCountText = badges.find((b) => /video/i.test(b)) ?? null;
  // "3 videos" / "1.2K videos" → the count
  const m = videoCountText ? /([\d.,]+)\s*(K|M|B)?\s*videos?/i.exec(videoCountText) : null;
  const videoCount = m
    ? Math.round(Number(m[1].replace(/,/g, "")) * (m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()]! : 1))
    : 0;
  return {
    id,
    title,
    videoCount,
    videoCountText,
    thumbnailUrl: sources.length ? (sources[sources.length - 1].url as string) : null,
  };
}

/** All playlist lockups in a Playlists-tab response. */
export function mapChannelPlaylists(response: unknown, limit = 24): ChannelPlaylistDTO[] {
  const out: ChannelPlaylistDTO[] = [];
  for (const l of walkTree(response, "lockupViewModel")) {
    if (l?.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST") continue;
    const dto = mapPlaylistLockup(l);
    if (dto) out.push(dto);
    if (out.length >= limit) break;
  }
  return out;
}

/** backstagePostRenderer → CommunityPostDTO. */
export function mapBackstagePost(p: unknown): CommunityPostDTO | null {
  const post = p as any;
  const id = post?.postId;
  if (typeof id !== "string" || !id) return null;
  const likesText =
    post?.voteCount?.accessibility?.accessibilityData?.label ??
    post?.voteCount?.simpleText ??
    null;
  const replyCountText =
    post?.actionButtons?.commentActionButtonsRenderer?.replyButton?.buttonRenderer?.text
      ?.simpleText ?? null;
  const image = post?.backstageAttachment?.backstageImageRenderer?.image?.thumbnails;
  const imageUrl =
    Array.isArray(image) && image.length ? (image[image.length - 1].url as string) : null;
  return {
    id,
    text: runsText(post?.contentText),
    authorName: runsText(post?.authorText) || null,
    publishedText: post?.publishedText?.simpleText ?? null,
    likesText,
    replyCountText,
    imageUrl,
  };
}

/** All community posts in a Posts-tab response. */
export function mapCommunityPosts(response: unknown, limit = 20): CommunityPostDTO[] {
  const out: CommunityPostDTO[] = [];
  for (const p of walkTree(response, "backstagePostRenderer")) {
    const dto = mapBackstagePost(p);
    if (dto) out.push(dto);
    if (out.length >= limit) break;
  }
  return out;
}

/** aboutChannelViewModel → ChannelAboutDTO (stats + links). */
export function mapAboutChannel(response: unknown): ChannelAboutDTO | null {
  const vm = findFirst(response, "aboutChannelViewModel");
  if (!vm) return null;
  const links: { title: string; url: string | null }[] = [];
  for (const l of vm?.links ?? []) {
    // each link is a {channelExternalLinkViewModel: {title, link}} wrapper
    const inner = l?.channelExternalLinkViewModel ?? l;
    const title = inner?.title?.content ?? null;
    const content = inner?.link?.content ?? null;
    const url =
      inner?.link?.commandRuns?.[0]?.onTap?.innertubeCommand?.urlEndpoint?.url ?? null;
    // youtube.com/redirect?q=<real url> — unwrap the honest target
    const target = url ? extractRedirectTarget(url) : null;
    if (title || content) links.push({ title: title ?? content ?? "", url: target ?? url });
  }
  return {
    description: vm?.description ?? null,
    joinedDateText: vm?.joinedDateText?.content ?? null,
    viewCountText: vm?.viewCountText ?? null,
    subscriberCountText: vm?.subscriberCountText ?? null,
    videoCountText: vm?.videoCountText ?? null,
    country: vm?.country ?? null,
    links,
  };
}

/** youtube.com/redirect?...&q=<encoded target> → the target (else null). */
export function extractRedirectTarget(url: string): string | null {
  try {
    const u = new URL(url, "https://www.youtube.com");
    if (u.pathname !== "/redirect") return null;
    const q = u.searchParams.get("q");
    return q && /^https?:\/\//.test(q) ? q : null;
  } catch {
    return null;
  }
}

/**
 * The About panel's continuation token — the channel home response's
 * description "…more" tap (descriptionPreviewViewModel.rendererContext
 * .commandContext.onTap.showEngagementPanel) carries the panel whose
 * sectionList content holds the continuation.
 */
export function aboutContinuationToken(channelResponse: unknown): string | null {
  const panels = walkTree(channelResponse, "engagementPanelSectionListRenderer");
  for (const panel of panels) {
    const token = walkTree(panel, "continuationCommand")
      .map((c) => c?.token)
      .find((t) => typeof t === "string" && t);
    if (typeof token === "string" && token) return token;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tab data (cached, resilient through the adapter)
// ---------------------------------------------------------------------------

const unhealthy = (t: ChannelTabDTO) => t.walled === true;

/** One channel tab's payload — the cutover resilience contract: the walled
 * marker is never cached; a last-good tab serves when the wall hits; cold +
 * walled → the honest `{tab, walled: true}` (HTTP 200 at the route). */
export async function getChannelTab(
  handle: string,
  tab: ChannelTabId
): Promise<ChannelTabDTO> {
  if (tab === "about") return getChannelAbout(handle);
  const cleaned = decodeURIComponent(handle).trim();
  const key = `yt:channel:tab:${cleaned.toLowerCase()}:${tab}`;
  return cachedResilient(key, TTL.FEED_MS, () => computeChannelTab(cleaned, tab), {
    isEmpty: (t: unknown) => unhealthy(t as ChannelTabDTO),
  });
}

async function computeChannelTab(cleaned: string, tab: ChannelTabId): Promise<ChannelTabDTO> {
  try {
    const lookup = await resolveChannel(cleaned);
    if (!lookup || !lookup.header) return { tab, walled: true } as ChannelTabDTO;
    const ownParam = tabParamFromResponse(lookup.homeResponse, tab);
    const params =
      ownParam ??
      (tab === "home"
        ? null
        : CHANNEL_TAB_PARAMS[tab as keyof typeof CHANNEL_TAB_PARAMS] ?? null);
    const response = await innertubeBrowse(
      params ? { browseId: lookup.browseId, params } : { browseId: lookup.browseId }
    );
    const joinable = channelJoinable(response);
    const dto: ChannelTabDTO = { tab, joinable };
    switch (tab) {
      case "home":
        dto.videos = mapVideos(response, { dedupe: true, limit: 24 });
        dto.shorts = mapShorts(response, 12);
        break;
      case "videos":
      case "live":
        dto.videos = mapVideos(response, { dedupe: true, limit: 48 }).filter((v) => !v.isShort);
        break;
      case "shorts":
        dto.shorts = mapShorts(response, 48);
        break;
      case "playlists":
        dto.playlists = mapChannelPlaylists(response);
        break;
      case "community":
        dto.posts = mapCommunityPosts(response);
        break;
    }
    return dto;
  } catch {
    return { tab, walled: true } as ChannelTabDTO;
  }
}

/** The About panel (the engagement-panel continuation → aboutChannelViewModel). */
export async function getChannelAbout(handle: string): Promise<ChannelTabDTO> {
  const cleaned = decodeURIComponent(handle).trim();
  const key = `yt:channel:about:${cleaned.toLowerCase()}`;
  return cachedResilient(key, TTL.FEED_MS, () => computeChannelAbout(cleaned), {
    isEmpty: (t: unknown) => unhealthy(t as ChannelTabDTO),
  });
}

async function computeChannelAbout(cleaned: string): Promise<ChannelTabDTO> {
  try {
    const lookup = await resolveChannel(cleaned);
    if (!lookup || !lookup.header) return { tab: "about", walled: true } as ChannelTabDTO;
    const token = aboutContinuationToken(lookup.homeResponse);
    if (!token) {
      // no engagement panel → no About data reachable; honest empty About
      return {
        tab: "about",
        about: {
          description: null,
          joinedDateText: null,
          viewCountText: null,
          subscriberCountText: null,
          videoCountText: null,
          country: null,
          links: [],
        },
      };
    }
    const response = await innertubeBrowse({ continuation: token });
    const about = mapAboutChannel(response);
    if (!about) return { tab: "about", walled: true } as ChannelTabDTO;
    return { tab: "about", about };
  } catch {
    return { tab: "about", walled: true } as ChannelTabDTO;
  }
}

// ---------------------------------------------------------------------------
// memberships (Join) — the join button renderer + the honest tier degrade
// ---------------------------------------------------------------------------

export interface ChannelJoinDTO {
  joinable: boolean;
  /** tier rows when genuinely reachable through the operator session */
  tiers: { title: string; priceText: string; perksText: string | null }[] | null;
  /** public mode: YouTube's own logged-out Join modal state */
  signinRequired: boolean;
  note: string | null;
}

/**
 * The Join surface (WFX2-B-S): `joinable` from the channel page's Join
 * button renderer (pageHeaderViewModel actions / legacy
 * sponsorButtonRenderer). Tier data rides the signed-in memberships panel —
 * reachable only with the operator session (the join button's own
 * getMembershipsPanelCommand when signed in); public mode honestly reports
 * YouTube's own logged-out Join modal state ("Sign in to become a member"),
 * never fabricated tiers.
 */
export async function getChannelJoin(handle: string): Promise<ChannelJoinDTO> {
  const cleaned = decodeURIComponent(handle).trim();
  const signinRequired = !hasSession();
  return cachedResilient(`yt:channel:join:${cleaned.toLowerCase()}`, TTL.FEED_MS, async () => {
    try {
      const lookup = await resolveChannel(cleaned);
      if (!lookup || !lookup.header) {
        return { joinable: false, tiers: null, signinRequired, note: "channel unavailable" };
      }
      const joinable = channelJoinable(lookup.homeResponse);
      if (!joinable) {
        return { joinable: false, tiers: null, signinRequired, note: null };
      }
      if (signinRequired) {
        // YouTube's own logged-out Join modal: "Sign in to become a member."
        return {
          joinable: true,
          tiers: null,
          signinRequired: true,
          note: "Sign in to become a member.",
        };
      }
      // signed-in: the Join button's memberships panel command carries the
      // tiers — walk it (the response's own command; honest null when absent)
      const cmd = findFirst(lookup.homeResponse, "getMembershipsPanelCommand");
      if (cmd && typeof cmd.params === "string") {
        const panel = await innertubeBrowse({ params: cmd.params });
        const tiers = mapMembershipTiers(panel);
        if (tiers.length) {
          return { joinable: true, tiers, signinRequired: false, note: null };
        }
      }
      return {
        joinable: true,
        tiers: null,
        signinRequired: false,
        note: "Membership tiers are not readable from this session right now.",
      };
    } catch {
      return {
        joinable: false,
        tiers: null,
        signinRequired,
        note: "channel unavailable",
      };
    }
  });
}

/** Best-effort tier mapping from a memberships-panel response (honest empty
 * when the response carries no recognizable tier rows). */
export function mapMembershipTiers(panel: unknown): {
  title: string;
  priceText: string;
  perksText: string | null;
}[] {
  const out: { title: string; priceText: string; perksText: string | null }[] = [];
  for (const r of walkTree(panel, "membershipsRenderer")) {
    const title = runsText(r?.title) || "";
    const price = r?.subtitle?.simpleText ?? runsText(r?.priceText) ?? "";
    if (title || price) {
      out.push({ title, priceText: price, perksText: runsText(r?.perksText) || null });
    }
  }
  return out;
}
