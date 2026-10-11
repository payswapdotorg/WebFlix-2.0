/**
 * WFX2-B-S → P22-B — the operator's own channel resolution (creator-mode
 * detection + the own-channel surfaces).
 *
 * P22-B root cause (measured live 2026-10-11): the old single mechanism —
 * the signed-in home page's ytcfg `"CHANNEL_ID"` bootstrap — is DEAD on live
 * youtube.com (a 953KB live home-page fetch carries ZERO occurrences of the
 * key; the production deploy consequently resolves no operator channel and
 * every own-channel surface degrades: /you falls back to the WebFlix-local
 * identity, the channel page shows Subscribe on the operator's OWN channel,
 * "Your channel" disappears from the You section).
 *
 * The P22-B ladder (each rung real, cookie-authenticated, honest-null):
 *   1. `account/account_menu` POST — the topbar account menu (the endpoint
 *      the "Account menu" button's own menuRequest targets — verified live
 *      from this egress 2026-10-11: the public variant answers the settings
 *      menu). The menu's links are profile-scoped: any UC browseId (or
 *      self-handle url) inside it is the session's own channel. The POST-menu
 *      family is the one the notifications lane rides (P18 —
 *      get_notification_menu works with cookies from the production egress).
 *   2. `/feed/you` SSR — the Library page's own profile header (the
 *      "View channel" link). The scan is BOUNDED to the pageHeaderRenderer
 *      subtree: the shelves below carry OTHER channels' ids (history rows,
 *      your-videos rows link out) — a whole-tree scan there would be a guess.
 *   3. the home page ytcfg CHANNEL_ID bootstrap (the WFX2-C-B mechanism —
 *      dead on the live PUBLIC page, kept: it may live on signed-in variants
 *      and rides the cached fetch when a later rung already paid for it).
 *   4. `/@me` SSR (YouTube's signed-in self-handle — kept as the last rung).
 *
 * Every rung falls through to the next on failure; nothing found → null (the
 * honest unresolved state — never a guess). The whole ladder's outcome is
 * cached under one key per TTL window (the same semantics the pre-P22-B seam
 * had: a failure never retries within the window).
 */
import { innertube } from "./innertube";
import { resolveChannel } from "./channels";
import { fetchPageHtml, fetchYtInitialData } from "./ssr";
import { getCookieHeader } from "./session";
import { cached, TTL } from "./cache";
import { findFirst, walkTree } from "./mappers";

const CHANNEL_ID_IN_HTML_RE = /"CHANNEL_ID"\s*:\s*"(UC[\w-]{20,})"/;

/** Pure extractor (exported for fixture-driven tests). */
export function extractChannelIdFromHtml(html: string): string | null {
  const m = CHANNEL_ID_IN_HTML_RE.exec(html);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// the shared reference shape + the browse-endpoint probe
// ---------------------------------------------------------------------------

export interface OperatorChannelRef {
  /** the channel id (UC…) when known */
  id: string | null;
  /** the handle (with the leading @) when known */
  handle: string | null;
}

const UC_ID_RE = /^UC[\w-]{20,}$/;

function refFromEndpoint(endpoint: unknown): OperatorChannelRef | null {
  if (!endpoint || typeof endpoint !== "object") return null;
  const e = endpoint as { browseId?: unknown; url?: unknown };
  if (typeof e.browseId === "string" && UC_ID_RE.test(e.browseId)) {
    return { id: e.browseId, handle: null };
  }
  if (typeof e.url === "string") {
    const handle = /^\/(@[\w.-]{3,})$/.exec(e.url.trim());
    if (handle) return { id: null, handle: handle[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// rung 1 — the account menu (account/account_menu POST)
// ---------------------------------------------------------------------------

/**
 * Pure extractor: the session's own channel from an account-menu response.
 * The menu's links are profile-scoped (Your channel / YouTube Studio / the
 * channel-switcher rows) — the first UC browseId or self-handle url in the
 * tree is the operator's. The generic browseEndpoint sweep runs LAST: every
 * UC id inside an account menu belongs to the account the menu describes.
 * Null when the menu carries none (the signed-out variant carries zero —
 * verified live 2026-10-11).
 */
export function extractOperatorChannelFromAccountMenu(response: unknown): OperatorChannelRef | null {
  // the named rows first (the "Your channel" / switcher shapes)
  for (const node of walkTree(response, "compactLinkRenderer")) {
    const ref =
      refFromEndpoint(node?.navigationEndpoint?.browseEndpoint) ??
      refFromEndpoint(node?.navigationEndpoint);
    if (ref) return ref;
  }
  for (const node of walkTree(response, "accountItemRenderer")) {
    const ref =
      refFromEndpoint(node?.browseEndpoint) ??
      refFromEndpoint(node?.navigationEndpoint?.browseEndpoint);
    if (ref) return ref;
    if (typeof node?.handle === "string" && node.handle.startsWith("@")) {
      return { id: null, handle: node.handle };
    }
  }
  // the generic sweep (the account section's shapes move; a UC browseId in
  // the account menu is the session's own channel — never a feed item's)
  for (const node of walkTree(response, "browseEndpoint")) {
    const ref = refFromEndpoint(node);
    if (ref) return ref;
  }
  return null;
}

// ---------------------------------------------------------------------------
// rung 2 — the /feed/you profile header (pageHeaderRenderer-bounded)
// ---------------------------------------------------------------------------

/**
 * Pure extractor: the session's own channel from the /feed/you page's
 * profile header. BOUNDED to the pageHeaderRenderer subtree — the shelves
 * below the header link to OTHER channels (history rows, your-videos rows)
 * and must never be mistaken for the operator's. Null when the page carries
 * no header (the signed-out variant answers the Library promo).
 */
export function extractOperatorChannelFromFeedYou(response: unknown): OperatorChannelRef | null {
  const header = findFirst(response, "pageHeaderRenderer");
  if (!header) return null;
  for (const node of walkTree(header, "browseEndpoint")) {
    const ref = refFromEndpoint(node);
    if (ref) return ref;
  }
  for (const node of walkTree(header, "buttonRenderer")) {
    const ref = refFromEndpoint(node?.navigationEndpoint?.browseEndpoint);
    if (ref) return ref;
  }
  return null;
}

// ---------------------------------------------------------------------------
// the ladder
// ---------------------------------------------------------------------------

async function accountMenuRung(): Promise<OperatorChannelRef | null> {
  const cookies = getCookieHeader();
  if (!cookies) return null;
  try {
    const response = await innertube("account/account_menu", {}, { cookies });
    return extractOperatorChannelFromAccountMenu(response);
  } catch {
    return null; // honest fall-through
  }
}

async function feedYouRung(): Promise<OperatorChannelRef | null> {
  const cookies = getCookieHeader();
  if (!cookies) return null;
  try {
    const response = await fetchYtInitialData("/feed/you", { cookies });
    return extractOperatorChannelFromFeedYou(response);
  } catch {
    return null; // honest fall-through
  }
}

async function homeYtcfgRung(): Promise<OperatorChannelRef | null> {
  try {
    const html = await fetchPageHtml("/");
    const id = extractChannelIdFromHtml(html);
    return id ? { id, handle: null } : null;
  } catch {
    return null; // honest fall-through
  }
}

async function atMeRung(): Promise<OperatorChannelRef | null> {
  try {
    const ssr = await fetchYtInitialData("/@me");
    const externalId = (
      findFirst(ssr, "channelMetadataRenderer") as { externalId?: unknown } | null
    )?.externalId;
    if (typeof externalId === "string" && externalId) return { id: externalId, handle: null };
    return null;
  } catch {
    return null; // honest fall-through
  }
}

/**
 * The operator's channel reference from the session, or null in public mode
 * / when no rung yields one. The whole ladder's outcome is cached under one
 * key per TTL window.
 */
export async function operatorChannelRef(): Promise<OperatorChannelRef | null> {
  if (!getCookieHeader()) return null;
  return cached("yt:operator:channel-ref", TTL.WATCH_MS, async () => {
    const rungs: (() => Promise<OperatorChannelRef | null>)[] = [
      accountMenuRung,
      feedYouRung,
      homeYtcfgRung,
      atMeRung,
    ];
    for (const rung of rungs) {
      const ref = await rung();
      if (ref) return ref;
    }
    return null;
  });
}

/**
 * The operator's channel id, or null. A handle-only reference resolves
 * through the channel browse (the handle IS the channel's — resolveChannel
 * semantics). Cached per TTL window.
 */
export async function operatorChannelId(): Promise<string | null> {
  return cached("yt:operator:channel-id", TTL.WATCH_MS, async () => {
    const ref = await operatorChannelRef();
    if (!ref) return null;
    if (ref.id) return ref.id;
    if (ref.handle) {
      const lookup = await resolveChannel(ref.handle).catch(() => null);
      return lookup?.browseId ?? null;
    }
    return null;
  });
}

/**
 * Creator-mode check: is the operator session the channel behind this video?
 * Public mode → false (never a guess).
 */
export async function operatorIsCreator(channelId: string | null | undefined): Promise<boolean> {
  if (!channelId) return false;
  const own = await operatorChannelId();
  return own !== null && own === channelId;
}
