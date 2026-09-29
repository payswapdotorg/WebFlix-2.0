/**
 * WFX2-B-B subscriptions — the operator's real subscriptions feed (SSR +
 * continuation) and the subscribed-channel list for the sidebar / manage rail.
 *
 * VERIFIED shape (tests/fixtures/yt/ssr_subscriptions.json — a REAL capture of
 * /feed/subscriptions, 95 items):
 *  - page: contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
 *      .richGridRenderer.contents[]:
 *      [ richSectionRenderer (the "Latest" shelf header + "All subscriptions"
 *        manage link — browseId FEchannels), richItemRenderer ×95 (each wraps
 *        a lockupViewModel), continuationItemRenderer (the next-page cursor) ]
 *  - per-item channel: metadata.lockupMetadataViewModel.metadata
 *      .contentMetadataViewModel.metadataRows[0].metadataParts[0].text
 *      .commandRuns[0].onTap.innubeCommand.browseEndpoint (browseId UC…,
 *      canonicalBaseUrl /@handle) + the avatar stack image + the Verified icon
 *  - browse XHR FEsubscriptions is valid but returned the empty-state for this
 *      account (research log §4) — SSR is the primary mechanism
 *  - public mode (no session): backgroundPromoRenderer "Don't miss new
 *      videos" with an accounts.google.com CTA — honest login-required
 *      degradation (fixture ssr_subscriptions_public.json, REAL)
 */
import { innertubeBrowse } from "./innertube";
import { fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import { walkTree, mapLockupViewModel } from "./mappers";
import type { ChannelLite, SubscriptionsPageDTO, VideoDTO } from "@/lib/types";

export interface SubscriptionsFeed extends SubscriptionsPageDTO {
  videos: VideoDTO[];
  nextCursor: string | null;
  /** true when the SSR response is the logged-out promo (no session) */
  loginRequired: boolean;
  /** feed-level "Latest" shelf semantics (present on the real page) */
  latestShelf: boolean;
}

/** True when the SSR response is the logged-out promo (login required). */
export function subscriptionsLoginRequired(response: unknown): boolean {
  for (const promo of walkTree(response, "backgroundPromoRenderer")) {
    const cta = JSON.stringify(promo?.ctaButton ?? {});
    if (/accounts\.google\.com\/ServiceLogin/.test(cta)) return true;
  }
  return false;
}

/** Channel-lite from a feed item's byline part (name + browseId + avatar). */
function channelFromBylinePart(part: any, item: any): ChannelLite | null {
  const nav =
    part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint ??
    part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.commandMetadata ??
    null;
  const channelId: string = nav?.browseId ?? "";
  if (!channelId.startsWith("UC")) return null;
  const canonical: string = nav?.canonicalBaseUrl ?? "";
  const handle = canonical.startsWith("/@") ? canonical.slice(1) : channelId;
  const avatarSources =
    item?.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.avatar
      ?.avatarViewModel?.image?.sources ?? [];
  const avatarUrl =
    avatarSources.length > 0 ? avatarSources[avatarSources.length - 1]?.url ?? "" : "";
  const iconJson = JSON.stringify(part?.icon ?? {});
  return {
    id: channelId,
    handle,
    name: part?.text?.content ?? "",
    avatarUrl,
    verified: /CHECK_CIRCLE/i.test(iconJson) || part?.icon?.accessibilityLabel === "Verified",
    subscriberCount: 0,
  };
}

/**
 * The distinct channels from the feed's own items (document order — the
 * operator's subscribed channels with recent uploads; channels that have been
 * quiet since before the feed window do not surface here — honest limitation
 * of the SSR feed; the FEchannels manage page is the complete list).
 */
export function channelsFromSubscriptionsResponse(response: unknown): ChannelLite[] {
  const out: ChannelLite[] = [];
  const seen = new Set<string>();
  for (const lockup of walkTree(response, "lockupViewModel")) {
    const rows =
      lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
        ?.metadataRows ?? [];
    const parts = rows.flatMap((r: any) => r?.metadataParts ?? []);
    const byline = parts.find((p: any) =>
      p?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId?.startsWith?.(
        "UC"
      )
    );
    if (!byline) continue;
    const channel = channelFromBylinePart(byline, lockup);
    if (!channel || !channel.name || seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push(channel);
  }
  return out;
}

/** Feed videos (document order) from the richGrid items. */
export function videosFromSubscriptionsResponse(response: unknown, limit?: number): VideoDTO[] {
  const out: VideoDTO[] = [];
  const seen = new Set<string>();
  for (const item of walkTree(response, "richItemRenderer")) {
    const dto = mapLockupViewModel(item?.content?.lockupViewModel);
    if (!dto || seen.has(dto.id)) continue;
    seen.add(dto.id);
    out.push(dto);
  }
  return limit ? out.slice(0, limit) : out;
}

/** Continuation token (richGrid tail or browse-continuation shape). */
export function subscriptionsContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  for (const item of walkTree(response, "continuationItemViewModel")) {
    const token = item?.continuationCommand?.innertubeCommand?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/** Map one subscriptions response (first page or continuation). */
export function mapSubscriptionsPage(response: unknown): SubscriptionsFeed {
  const loginRequired = subscriptionsLoginRequired(response);
  const videos = videosFromSubscriptionsResponse(response);
  const channels = channelsFromSubscriptionsResponse(response);
  return {
    channels,
    videos,
    nextCursor: subscriptionsContinuationToken(response),
    loginRequired,
    latestShelf: walkTree(response, "richSectionRenderer").length > 0,
  };
}

const SUBS_CACHE_KEY = "yt:subs:page";

/**
 * The live subscriptions feed. Without a session the SSR page is the
 * logged-out promo → honest loginRequired empties. `cursor` pages via
 * browse {continuation} (the feed's own continuation token).
 */
export async function getSubscriptionsFeed(cursor?: string): Promise<SubscriptionsFeed> {
  if (cursor) {
    const response = await innertubeBrowse({ continuation: cursor });
    return mapSubscriptionsPage(response);
  }
  if (!hasSession()) {
    const response = await cached(`${SUBS_CACHE_KEY}:public`, TTL.FEED_MS, () =>
      fetchYtInitialData("/feed/subscriptions", { cookies: null })
    );
    return mapSubscriptionsPage(response);
  }
  const response = await cached(SUBS_CACHE_KEY, TTL.FEED_MS, () =>
    fetchYtInitialData("/feed/subscriptions")
  );
  return mapSubscriptionsPage(response);
}

/**
 * The subscribed-channel list for the sidebar's SUBSCRIPTIONS section.
 * Session-gated: public mode → [] (the sidebar falls back to its own
 * "no subscriptions" hint — honest).
 */
export async function getSubscribedChannels(): Promise<ChannelLite[]> {
  if (!hasSession()) return [];
  const feed = await getSubscriptionsFeed();
  return feed.channels;
}
