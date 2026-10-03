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
 *  - WFX2-P7-CH — the Membership tab: the channel's own tab list carries a
 *    "Membership" tab title (TAB_TITLE_TO_ID maps it); the tab's tier data
 *    rides the SAME join surface /join walks (getChannelJoin — the single
 *    shared memberships-panel walk; getChannelMembershipTab is a thin shaper
 *    over it, so the tab and the sheet can never diverge).
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
  ChannelJoinDTO,
  ChannelMembershipTierDTO,
  ChannelPlaylistDTO,
  CommunityPostDTO,
  CommunityPollDTO,
  CommunityPollChoiceDTO,
  ChannelAboutDTO,
  ChannelSortChipDTO,
} from "@/lib/types";

// WFX2-P7-CH: ChannelJoinDTO moved to types.ts (ChannelTabDTO.membership
// references it) — re-exported here so existing importers keep working.
export type { ChannelJoinDTO };

/** Live-verified tab-param constants (full forms — the fallback family).
 * WFX2-P7-CH: "membership" has NO browse-tab param — its data rides the
 * join surface (the shared memberships-panel walk), so it is excluded here
 * and branches off in the tab route before getChannelTab. */
export const CHANNEL_TAB_PARAMS: Record<Exclude<ChannelTabId, "home" | "about" | "membership">, string> = {
  videos: "EgZ2aWRlb3PyBgQKAjoA",
  shorts: "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
  live: "EgdzdHJlYW1z8gYECgJ6AA%3D%3D",
  playlists: "EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA",
  community: "EgVwb3N0c_IGBAoCSgA%3D",
};

/** Map the response's tab titles to our tab ids (Community tab = "Posts").
 * WFX2-P7-CH: "Membership" → the membership tab id, kept in lockstep with
 * mappers.ts's TAB_TITLE_TO_ID (the tab list's source of truth). */
const TAB_TITLE_TO_ID: Record<string, ChannelTabId> = {
  Home: "home",
  Videos: "videos",
  Shorts: "shorts",
  Live: "live",
  Playlists: "playlists",
  Posts: "community",
  Community: "community",
  Membership: "membership",
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

/** One poll attachment → CommunityPollDTO (read-only vote display). */
export function mapBackstagePoll(att: unknown): CommunityPollDTO | null {
  const poll = (att as any)?.pollRenderer ?? (att as any)?.backstagePollRenderer ?? null;
  if (!poll || !Array.isArray(poll.choices) || poll.choices.length === 0) return null;
  const choices: CommunityPollChoiceDTO[] = [];
  for (const c of poll.choices) {
    const text = runsText(c?.text);
    if (!text) continue;
    // voteCount: a plain number (live results) or absent before results exist;
    // the per-choice percentage rides votePercentage / votePercentageIfSelected
    const votes =
      typeof c?.voteCount === "number"
        ? c.voteCount
        : typeof c?.voteCountIfSelected === "number"
          ? c.voteCountIfSelected
          : null;
    const percentText =
      (typeof c?.votePercentage?.content === "string" ? c.votePercentage.content : null) ??
      (typeof c?.votePercentageIfSelected?.content === "string"
        ? c.votePercentageIfSelected.content
        : null);
    choices.push({ text, votes, percentText });
  }
  if (choices.length === 0) return null;
  const totalVotesText =
    (typeof poll?.totalVotes?.simpleText === "string" ? poll.totalVotes.simpleText : null) ??
    runsText(poll?.totalVotes) ??
    null;
  const totalVotes = totalVotesText
    ? parseCompactCount(totalVotesText.replace(/\s*votes?\s*$/i, ""))
    : null;
  return { choices, totalVotesText, totalVotes };
}

/** All image URLs inside a post's backstageAttachment (single + grid). */
export function mapBackstageImages(att: unknown): string[] {
  const out: string[] = [];
  for (const img of walkTree(att, "backstageImageRenderer")) {
    const thumbs = img?.image?.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length) {
      const url = thumbs[thumbs.length - 1].url;
      if (typeof url === "string" && url) out.push(url);
    }
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
  const images = mapBackstageImages(post?.backstageAttachment);
  const avatar = post?.authorThumbnail?.thumbnails ?? post?.avatarRenderer?.avatar?.thumbnails ?? null;
  const authorAvatarUrl =
    Array.isArray(avatar) && avatar.length ? (avatar[avatar.length - 1].url as string) : null;
  return {
    id,
    text: runsText(post?.contentText),
    authorName: runsText(post?.authorText) || null,
    authorAvatarUrl,
    publishedText: post?.publishedText?.simpleText ?? null,
    likesText,
    replyCountText,
    imageUrl: imageUrl ?? (images.length ? images[0] : null),
    images,
    poll: post?.backstageAttachment ? mapBackstagePoll(post.backstageAttachment) : null,
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
 * WFX2-P6-CH — one chip's continuation token from either chip-bar shape:
 *  - the 2026 view-model form: chipViewModel.tapCommand.innertubeCommand
 *    .continuationCommand.token (live-verified on the channel Videos tab —
 *    see ChannelSortChipDTO in types.ts);
 *  - the legacy renderer form: chipCloudChipRenderer.navigationEndpoint
 *    .continuationCommand.token (the trending chip family — the same
 *    extractor law as trending-categories.ts, with the continuation token
 *    where that page family carries browseEndpoint params).
 */
function chipContinuationToken(chip: any): string | null {
  const token =
    chip?.tapCommand?.innertubeCommand?.continuationCommand?.token ??
    chip?.navigationEndpoint?.continuationCommand?.token ??
    null;
  return typeof token === "string" && token ? token : null;
}

/**
 * The Videos tab's sort chips (Latest / Popular / Oldest) from a tab payload
 * — both chip-bar shapes, document order, de-duplicated by label. A chip is
 * surfaced ONLY when its label AND continuation token are really there
 * (never a dead chip); a payload with no chip bar maps to [] (the UI hides
 * the chip row — honest omission).
 */
export function mapChannelSortChips(response: unknown): ChannelSortChipDTO[] {
  const out: ChannelSortChipDTO[] = [];
  const seen = new Set<string>();
  for (const chip of walkTree(response, "chipViewModel")) {
    const label = typeof chip?.text === "string" ? chip.text : "";
    const token = chipContinuationToken(chip);
    if (!label || !token || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, token, selected: chip?.selected === true });
  }
  for (const chip of walkTree(response, "chipCloudChipRenderer")) {
    const label = runsText(chip?.text);
    const token = chipContinuationToken(chip);
    if (!label || !token || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, token, selected: chip?.isSelected === true });
  }
  return out;
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
 * walled → the honest `{tab, walled: true}` (HTTP 200 at the route).
 *
 * WFX2-P6-CH: `chip` (Videos tab only) swaps the fetch to the clicked chip's
 * own continuation — browse {continuation} — whose response carries the
 * sorted grid + the re-marked chip bar (the chosen sort selected). Each
 * chip token is its own cache entry (Popular and Oldest must never alias
 * Latest's cached grid). */
export async function getChannelTab(
  handle: string,
  tab: ChannelTabId,
  chip?: string
): Promise<ChannelTabDTO> {
  if (tab === "about") return getChannelAbout(handle);
  const cleaned = decodeURIComponent(handle).trim();
  const chipToken = tab === "videos" && chip ? chip : null;
  const key = chipToken
    ? `yt:channel:tab:${cleaned.toLowerCase()}:videos:chip:${chipToken}`
    : `yt:channel:tab:${cleaned.toLowerCase()}:${tab}`;
  return cachedResilient(key, TTL.FEED_MS, () => computeChannelTab(cleaned, tab, chipToken), {
    isEmpty: (t: unknown) => unhealthy(t as ChannelTabDTO),
  });
}

async function computeChannelTab(
  cleaned: string,
  tab: ChannelTabId,
  chipToken: string | null
): Promise<ChannelTabDTO> {
  try {
    let response: unknown;
    if (chipToken) {
      // WFX2-P6-CH — the clicked chip's own continuation (the live-verified
      // chip fetch family: browse {continuation}); no channel resolve is
      // needed — the token IS the addressed state
      response = await innertubeBrowse({ continuation: chipToken });
    } else {
      const lookup = await resolveChannel(cleaned);
      if (!lookup || !lookup.header) return { tab, walled: true } as ChannelTabDTO;
      const ownParam = tabParamFromResponse(lookup.homeResponse, tab);
      const params =
        ownParam ??
        (tab === "home"
          ? null
          : CHANNEL_TAB_PARAMS[tab as keyof typeof CHANNEL_TAB_PARAMS] ?? null);
      response = await innertubeBrowse(
        params ? { browseId: lookup.browseId, params } : { browseId: lookup.browseId }
      );
    }
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
        if (tab === "videos") {
          // WFX2-P6-CH: the tab payload's own chip bar (the default fetch
          // marks Latest; a chip-continuation fetch re-marks the chosen
          // sort). Absent chip bar → the field stays absent (the UI hides
          // the chip row — honest omission).
          const chips = mapChannelSortChips(response);
          if (chips.length > 0) dto.sortChips = chips;
        }
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

/** The join surface's honest unavailable-channel note — the degrade marker
 * getChannelMembershipTab recognizes to shape the standard walled tab. */
const JOIN_CHANNEL_UNAVAILABLE_NOTE = "channel unavailable";

/**
 * The Join surface (WFX2-B-S): `joinable` from the channel page's Join
 * button renderer (pageHeaderViewModel actions / legacy
 * sponsorButtonRenderer). Tier data rides the signed-in memberships panel —
 * reachable only with the operator session (the join button's own
 * getMembershipsPanelCommand when signed in); public mode honestly reports
 * YouTube's own logged-out Join modal state ("Sign in to become a member"),
 * never fabricated tiers.
 *
 * WFX2-P7-CH: this IS the single shared memberships-panel walk — both the
 * /join route and the Membership tab (getChannelMembershipTab below)
 * consume THIS function (and its one cache entry), so the tab and the sheet
 * can never diverge: one walk, one honest-state contract.
 */
export async function getChannelJoin(handle: string): Promise<ChannelJoinDTO> {
  const cleaned = decodeURIComponent(handle).trim();
  const signinRequired = !hasSession();
  return cachedResilient(`yt:channel:join:${cleaned.toLowerCase()}`, TTL.FEED_MS, async () => {
    try {
      const lookup = await resolveChannel(cleaned);
      if (!lookup || !lookup.header) {
        return { joinable: false, tiers: null, signinRequired, note: JOIN_CHANNEL_UNAVAILABLE_NOTE };
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
        note: JOIN_CHANNEL_UNAVAILABLE_NOTE,
      };
    }
  });
}

/**
 * WFX2-P7-CH — the Membership tab's payload: the SAME join surface /join
 * serves, shaped as a ChannelTabDTO. This is a thin shaper over the shared
 * walk (getChannelJoin) — it owns NO fetching logic of its own, so /join and
 * the tab can never copy-paste-diverge (one walk, one cache entry, one
 * honest-state contract). The tab route branches here for ?tab=membership
 * (the same per-tab-switch shape the Community tab uses) instead of
 * extending the /join response — that is where the code's shape makes the
 * tab data natural (documented per the delivery brief).
 *
 * Honest states (verbatim the app's law):
 *  - the join walk degrades to its unavailable-channel marker → the standard
 *    `{tab, walled: true}` (the tab family's byte-identical wall copy);
 *  - otherwise the membership field carries the join surface as-is — real
 *    tiers, YouTube's logged-out copy, or the honest unreadable note.
 */
export async function getChannelMembershipTab(handle: string): Promise<ChannelTabDTO> {
  const cleaned = decodeURIComponent(handle).trim();
  const join = await getChannelJoin(cleaned);
  if (join.joinable === false && join.note === JOIN_CHANNEL_UNAVAILABLE_NOTE) {
    // the join surface's own wall marker → the tab family's honest degrade
    return { tab: "membership", walled: true } as ChannelTabDTO;
  }
  return { tab: "membership", joinable: join.joinable, membership: join };
}

/** Best-effort tier mapping from a memberships-panel response (honest empty
 * when the response carries no recognizable tier rows). */
export function mapMembershipTiers(panel: unknown): ChannelMembershipTierDTO[] {
  const out: ChannelMembershipTierDTO[] = [];
  for (const r of walkTree(panel, "membershipsRenderer")) {
    const title = runsText(r?.title) || "";
    const price = r?.subtitle?.simpleText ?? runsText(r?.priceText) ?? "";
    if (title || price) {
      out.push({ title, priceText: price, perksText: runsText(r?.perksText) || null });
    }
  }
  return out;
}
