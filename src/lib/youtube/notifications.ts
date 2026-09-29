/**
 * WFX2-B-B notifications — the operator's real notification menu + unseen
 * count over the verified endpoints (research log §12):
 *   POST /youtubei/v1/notification/get_notification_menu
 *        { notificationsMenuRequestParams: { notificationsMenuRequestType:
 *          "NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX" } }
 *   POST /youtubei/v1/notification/get_unseen_count
 *
 * Fixtures:
 *  - `notification_menu_public.json` / `notification_unseen_public.json` —
 *    REAL public captures (runtime curl, no cookies): the menu answers the
 *    "Your notifications live here" backgroundPromoRenderer and the unseen
 *    count answers updateNotificationsUnseenCountAction { unseenCount: 0,
 *    timeoutMs: 1800000 } — empty is a VALID state (the account simply has
 *    none).
 *  - `notification_menu_items_synth.json` — SYNTHETIC-shaped logged-in menu
 *    (notificationRenderer items — the public capture has none; the lead
 *    re-captures a real logged-in menu on merge).
 *
 * Mark-read is Tier-2: broker kind `notifications-mark-read` (the executor
 * opens the bell menu in the logged-in tab and re-reads the unseen count).
 */
import { innertube } from "./innertube";
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import { walkTree, runsText } from "./mappers";
import type { NotificationDTO } from "@/lib/types";

export interface NotificationsFeed {
  items: NotificationDTO[];
  /** the count for the bell badge (0 when none — valid) */
  unread: number;
  /** the upstream's own poll cadence for the badge (ms) */
  pollIntervalMs: number | null;
  /** true when the menu response is the logged-out promo */
  loginRequired: boolean;
}

const NOTIF_MENU_TYPE_INBOX = "NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX";

/** kind inference from the notification's message/endpoint shapes. */
function notificationKind(r: any): NotificationDTO["kind"] {
  const watch = r?.navigationEndpoint?.watchEndpoint ?? {};
  const browse = r?.navigationEndpoint?.browseEndpoint ?? {};
  if (watch?.videoId && (/is live|is streaming|live now/i.test(runsText(r?.shortMessage)))) {
    return "live";
  }
  if (browse?.browseId && !watch?.videoId && /post|community/i.test(runsText(r?.shortMessage))) {
    return "post";
  }
  return "video";
}

/** One notificationRenderer → NotificationDTO (the UI's existing shape). */
export function mapNotificationRenderer(r: any): NotificationDTO | null {
  const id = r?.notificationId;
  if (typeof id !== "string" || !id) return null;
  const message = runsText(r?.shortMessage);
  const sentTime = runsText(r?.sentTimeText);
  const watch = r?.navigationEndpoint?.watchEndpoint ?? {};
  const browse = r?.navigationEndpoint?.browseEndpoint ?? {};
  const channelId: string = browse?.browseId ?? "";
  const channelNameMatch = /^([^\s:]+(?:\s[^\s:]+)*?)(?::|\suploaded|\sposted|\sis|\swas)/.exec(
    message
  );
  const thumbs = r?.thumbnail?.thumbnails ?? [];
  const thumbUrl = thumbs.length ? thumbs[thumbs.length - 1]?.url ?? "" : "";
  return {
    id,
    kind: notificationKind(r),
    title: message,
    body: sentTime,
    read: r?.read === true,
    createdAt: relativeIsoFromSentTime(sentTime) ?? new Date(0).toISOString(),
    videoId: typeof watch?.videoId === "string" ? watch.videoId : null,
    // notification thumbnails are the video thumbnail (or the channel avatar
    // for community posts) — the UI renders either at the row avatar spot
    videoThumbnailUrl: thumbUrl || null,
    channel: {
      id: channelId,
      handle: channelId || (channelNameMatch?.[1] ? `@${channelNameMatch[1].replace(/\s+/g, "")}` : ""),
      name: channelNameMatch?.[1] ?? "",
      avatarUrl: thumbUrl,
      verified: false,
      subscriberCount: 0,
    },
  };
}

/** "3 hours ago" / "1 day ago" → approx ISO (null passthrough-safe). */
function relativeIsoFromSentTime(text: string): string | null {
  const m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text.trim());
  if (!m) return null;
  const units: Record<string, number> = {
    second: 1, minute: 60, hour: 3600, day: 86400, week: 604800,
    month: 2592000, year: 31536000,
  };
  const seconds = Number(m[1]) * (units[m[2].toLowerCase()] ?? 0);
  return new Date(Date.now() - seconds * 1000).toISOString();
}

/** Map a get_notification_menu response. */
export function mapNotificationMenu(response: unknown): { items: NotificationDTO[]; loginRequired: boolean } {
  const items: NotificationDTO[] = [];
  const seen = new Set<string>();
  for (const renderer of walkTree(response, "notificationRenderer")) {
    const dto = mapNotificationRenderer(renderer);
    if (!dto || seen.has(dto.id)) continue;
    seen.add(dto.id);
    items.push(dto);
  }
  // the logged-out menu carries only the "Your notifications live here" promo
  let loginRequired = false;
  for (const promo of walkTree(response, "backgroundPromoRenderer")) {
    const cta = JSON.stringify(promo?.ctaButton ?? {});
    if (/accounts\.google\.com\/ServiceLogin/.test(cta)) loginRequired = true;
  }
  if (items.length === 0 && !hasSession()) loginRequired = true;
  return { items, loginRequired };
}

/** Map a get_unseen_count response → { unread, pollIntervalMs }. */
export function mapUnseenCount(response: unknown): { unread: number; pollIntervalMs: number | null } {
  for (const action of walkTree(response, "updateNotificationsUnseenCountAction")) {
    const count = action?.unseenCount;
    return {
      unread: typeof count === "number" && count >= 0 ? count : 0,
      pollIntervalMs: typeof action?.timeoutMs === "number" ? action.timeoutMs : null,
    };
  }
  return { unread: 0, pollIntervalMs: null };
}

/**
 * The live notifications feed: menu items + the unseen badge count in one
 * call (two upstream calls, cached on their own cadences). Empty is valid.
 */
export async function getNotificationsFeed(): Promise<NotificationsFeed> {
  const menuResponse = await cached("yt:notif:menu", TTL.FEED_MS, () =>
    innertube("notification/get_notification_menu", {
      notificationsMenuRequestParams: { notificationsMenuRequestType: NOTIF_MENU_TYPE_INBOX },
    })
  );
  const unseenResponse = await cached("yt:notif:unseen", 60_000, () =>
    innertube("notification/get_unseen_count", {})
  );
  const menu = mapNotificationMenu(menuResponse);
  const unseen = mapUnseenCount(unseenResponse);
  const unreadItems = menu.items.filter((i) => !i.read).length;
  return {
    items: menu.items,
    // the menu is the source of truth when it has items; the unseen endpoint
    // owns the badge otherwise (its own count can lag the menu)
    unread: menu.items.length > 0 ? unreadItems : unseen.unread,
    pollIntervalMs: unseen.pollIntervalMs,
    loginRequired: menu.loginRequired,
  };
}

/** Just the badge count (the topbar polls this shape). */
export async function getUnseenCount(): Promise<{ unread: number; pollIntervalMs: number | null }> {
  const response = await cached("yt:notif:unseen", 60_000, () =>
    innertube("notification/get_unseen_count", {})
  );
  return mapUnseenCount(response);
}
