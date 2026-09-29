/**
 * WFX2-A-S — YouTube live chat (live polling + replay) client & mappers.
 *
 * Self-contained InnerTube helper for the live-chat surface (the A-B lane
 * owns the general `src/lib/youtube/innertube.ts`; helper names here are
 * deliberately distinct: `callLiveChat`, `callLiveChatReplay`,
 * `callNextForChat`, `callUpdatedMetadata`).
 *
 * Verified mechanics (docs/research/2026-09-29-verifications.md §11 + this
 * lane's design probes, evidence/wfx2as/):
 * - session discovery: next{videoId} →
 *   contents.twoColumnWatchNextResults.conversationBar.liveChatRenderer
 *   .continuations[0].reloadContinuationData.continuation  (null when no chat)
 * - live poll: POST /youtubei/v1/live_chat/get_live_chat {context, continuation}
 *   → {messages, nextToken, pollMs} — one upstream call per client poll
 *   (serverless-friendly: NO server-side loop).
 * - REPLAY (ended lives): the same conversationBar token 400s on
 *   get_live_chat but works on POST /youtubei/v1/live_chat/get_live_chat_replay
 *   → actions wrapped in replayChatItemAction {videoOffsetTimeMsec, actions[]}
 *   with liveChatReplayContinuationData (advance) + playerSeekContinuationData.
 * - live status: POST /youtubei/v1/updated_metadata {videoId} →
 *   updateViewershipAction (isLive + "N watching now") + likeCountEntity.
 *
 * HARD RULE (architecture doc): the `player` endpoint is never called here.
 */

// ---------------------------------------------------------------------------
// InnerTube transport (minimal, self-contained)
// ---------------------------------------------------------------------------

const INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1";
const CLIENT_VERSION = "2.20260925.00.00";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Session cookies from env (never committed — see .env.example). */
function cookieHeader(): string | undefined {
  const raw = process.env.YT_COOKIES;
  if (!raw) return undefined;
  const one = raw.trim().replace(/\s*[\r\n]+\s*/g, "; ");
  return one.endsWith(";") ? one : `${one};`;
}

function chatContext(): Record<string, unknown> {
  return {
    client: {
      clientName: "WEB",
      clientVersion: CLIENT_VERSION,
      hl: "en",
      gl: "US",
    },
  };
}

function innertubeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": CLIENT_VERSION,
    "Accept-Language": "en-US,en;q=0.9",
  };
  const cookies = cookieHeader();
  if (cookies) headers.Cookie = cookies;
  return headers;
}

export class InnerTubeChatError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InnerTubeChatError";
    this.status = status;
  }
}

/** POST one InnerTube endpoint. Throws InnerTubeChatError on non-2xx. */
async function postInnerTube(
  path: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetcher(`${INNERTUBE_BASE}/${path}?prettyPrint=false`, {
    method: "POST",
    headers: innertubeHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new InnerTubeChatError(
      `InnerTube ${path} → HTTP ${res.status}`,
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Lane-distinct helper: live chat poll. */
export async function callLiveChat(
  continuation: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube(
    "live_chat/get_live_chat",
    { context: chatContext(), continuation },
    fetcher,
  );
}

/** Lane-distinct helper: live chat REPLAY (ended streams). */
export async function callLiveChatReplay(
  continuation: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube(
    "live_chat/get_live_chat_replay",
    { context: chatContext(), continuation },
    fetcher,
  );
}

/** Lane-distinct helper: watch-next (chat session discovery). */
export async function callNextForChat(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube("next", { context: chatContext(), videoId }, fetcher);
}

/** Lane-distinct helper: updated_metadata (live counters). */
export async function callUpdatedMetadata(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return postInnerTube(
    "updated_metadata",
    { context: chatContext(), videoId, mimeType: "application/json" },
    fetcher,
  );
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type LiveChatBadge = "owner" | "moderator" | "verified" | "member";

export type LiveChatAuthorDTO = {
  id: string;
  name: string;
  avatarUrl: string | null;
  badges: LiveChatBadge[];
  memberSinceText: string | null;
};

export type SuperChatDTO = {
  amountText: string;
  amountMicros: string | null;
  currency: string | null;
  body: string;
  color: string | null;
};

export type LiveChatMessageKind =
  | "text"
  | "superchat"
  | "supersticker"
  | "member-milestone"
  | "membership-gift"
  | "system"
  | "banner";

export type LiveChatMessageDTO = {
  id: string;
  author: LiveChatAuthorDTO;
  body: string;
  timestampUsec: string;
  kind: LiveChatMessageKind;
  isSuperChat: boolean;
  superChat: SuperChatDTO | null;
  isMember: boolean;
  isMemberMilestone: boolean;
  memberMilestoneText: string | null;
  /** Replay mode only: video offset of the message (msec); null live. */
  offsetMsec: number | null;
};

export type LiveChatMode = "live" | "replay";

export type LiveChatFrame = {
  messages: LiveChatMessageDTO[];
  nextToken: string | null;
  pollMs: number;
  mode: LiveChatMode;
  participants: number | null;
  /** Debug: actions skipped because their type is unknown to this mapper. */
  skippedActions: number;
  skippedKinds: string[];
};

export type LiveChatSession = {
  videoId: string;
  continuation: string;
  mode: LiveChatMode;
  /** "N watching now" viewership text from next(), when live. */
  watchingNowText: string | null;
  chatAvailable: true;
};

// ---------------------------------------------------------------------------
// Small JSON walkers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Json)
    : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Concatenate `runs[].text` (or simpleText) into one string. */
export function runsToText(v: unknown): string {
  if (typeof v === "string") return v;
  const o = asObj(v);
  if (!o) return "";
  if (typeof o.simpleText === "string") return o.simpleText;
  return arr(o.runs)
    .map((r) => (asObj(r)?.text as string | undefined) ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Session discovery (next → conversationBar)
// ---------------------------------------------------------------------------

/**
 * Find the live-chat continuation on a watch-next response.
 * VERIFIED path: contents.twoColumnWatchNextResults.conversationBar.
 * liveChatRenderer.continuations[0].reloadContinuationData.continuation.
 * Returns null when the video has no chat (no conversationBar).
 */
export function findChatContinuation(
  nextResponse: unknown,
): { continuation: string; watchingNowText: string | null } | null {
  const root = asObj(nextResponse);
  if (!root) return null;
  const contents = asObj(asObj(root.contents)?.twoColumnWatchNextResults);
  const bar = asObj(contents?.conversationBar);
  const renderer = asObj(bar?.liveChatRenderer);
  if (!renderer) return null;
  const conts = arr(renderer.continuations);
  for (const c of conts) {
    const cd =
      asObj(asObj(c)?.reloadContinuationData) ??
      asObj(asObj(c)?.liveChatReplayContinuationData);
    const token = cd?.continuation;
    if (typeof token === "string" && token) {
      return { continuation: token, watchingNowText: null };
    }
  }
  return null;
}

/**
 * Whether the watch-next response says the video is CURRENTLY live.
 * Signals (verified): videoPrimaryInfoRenderer.viewCount.
 * videoViewCountRenderer.isLive === true (+ "watching now" text).
 * Ended lives say `dateText: "Streamed live on …"` and drop isLive.
 */
export function isVideoLive(nextResponse: unknown): boolean {
  const root = asObj(nextResponse);
  if (!root) return false;
  const results = asObj(
    asObj(asObj(root.contents)?.twoColumnWatchNextResults)?.results,
  );
  const list = arr(asObj(results?.results)?.contents);
  for (const c of list) {
    const vpir = asObj(asObj(c)?.videoPrimaryInfoRenderer);
    if (!vpir) continue;
    const vcr = asObj(asObj(vpir.viewCount)?.videoViewCountRenderer);
    if (vcr?.isLive === true) return true;
    if (runsToText(vcr?.viewCount).includes("watching now")) return true;
  }
  return false;
}

/** "6,027 watching now" → 6027 (from a watch-next response). */
export function liveViewersFromNext(nextResponse: unknown): number | null {
  const root = asObj(nextResponse);
  if (!root) return null;
  const results = asObj(
    asObj(asObj(root.contents)?.twoColumnWatchNextResults)?.results,
  );
  const list = arr(asObj(results?.results)?.contents);
  for (const c of list) {
    const vpir = asObj(asObj(c)?.videoPrimaryInfoRenderer);
    if (!vpir) continue;
    const vcr = asObj(asObj(vpir.viewCount)?.videoViewCountRenderer);
    const original = vcr?.originalViewCount;
    if (
      typeof original === "string" &&
      /^\d+$/.test(original) &&
      original !== "0"
    ) {
      return Number(original);
    }
    const text = runsToText(vcr?.viewCount);
    const m = text.match(/^([\d,.]+)\s+watching now/);
    if (m) return Number(m[1].replace(/,/g, ""));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Action mapping
// ---------------------------------------------------------------------------

/** SuperChat amountText symbol → ISO currency (approximation, documented). */
const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "R$": "BRL",
  "₺": "TRY",
  "₪": "ILS",
  "₫": "VND",
  "₴": "UAH",
  "฿": "THB",
  "₱": "PHP",
  "₦": "NGN",
};

function currencyFromAmountText(amountText: string): string | null {
  for (const [sym, code] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (amountText.includes(sym)) return code;
  }
  return null;
}

function amountMicrosFromText(amountText: string): string | null {
  // "US$5.00" / "€2,50" → micros string when parseable.
  const m = amountText.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return String(Math.round(value * 1_000_000));
}

/**
 * bodyBackgroundColor is a 0xAARRGGBB int (e.g. 4294948652 for Super Chat
 * tiers). Known tiers map to YouTube's tier palette; unknown ints convert
 * to #RRGGBB with the alpha channel dropped.
 */
const KNOWN_SUPERCHAT_BG: Record<number, string> = {
  4294948652: "#0f9d58",
  4289374890: "#1de9b6",
  4289031156: "#e5d03f",
  4291217732: "#c03226",
  4288706348: "#a80a0f",
  4294934400: "#b388ff",
  4279592435: "#1d2b3d",
};

function superChatColor(raw: unknown): string | null {
  if (typeof raw === "string" && raw.startsWith("#")) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (KNOWN_SUPERCHAT_BG[raw]) return KNOWN_SUPERCHAT_BG[raw];
    const r = (raw >>> 16) & 0xff;
    const g = (raw >>> 8) & 0xff;
    const b = raw & 0xff;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function mapBadges(badgesRaw: unknown): {
  badges: LiveChatBadge[];
  memberSinceText: string | null;
} {
  const badges: LiveChatBadge[] = [];
  let memberSince: string | null = null;
  for (const raw of arr(badgesRaw)) {
    const b = asObj(asObj(raw)?.liveChatAuthorBadgeRenderer);
    if (!b) continue;
    const icon = asObj(b.icon)?.iconType;
    const styleIcon = typeof icon === "string" ? icon : "";
    const tooltip = typeof b.tooltip === "string" ? b.tooltip : "";
    if (styleIcon === "MODERATOR") badges.push("moderator");
    if (styleIcon === "VERIFIED") badges.push("verified");
    if (styleIcon === "OWNER") badges.push("owner");
    if (b.customThumbnail !== undefined || /^Member\b/i.test(tooltip)) {
      badges.push("member");
      memberSince = memberSince ?? (tooltip || null);
    }
  }
  return { badges, memberSinceText: memberSince };
}

function mapAuthor(renderer: Json): LiveChatAuthorDTO {
  const name = runsToText(renderer.authorName);
  const thumbs = arr(asObj(renderer.authorPhoto)?.thumbnails);
  let avatarUrl: string | null = null;
  for (const t of thumbs) {
    const u = asObj(t)?.url;
    if (typeof u === "string") avatarUrl = u;
  }
  const { badges, memberSinceText } = mapBadges(renderer.authorBadges);
  const external = renderer.authorExternalChannelId;
  return {
    id: typeof external === "string" ? external : "",
    name: name || "unknown",
    avatarUrl,
    badges,
    memberSinceText,
  };
}

function mapSuperChat(renderer: Json): SuperChatDTO {
  const amountText = runsToText(renderer.purchaseAmountText);
  return {
    amountText,
    amountMicros:
      typeof renderer.amountMicros === "string"
        ? renderer.amountMicros
        : amountMicrosFromText(amountText),
    currency: currencyFromAmountText(amountText),
    body: runsToText(renderer.message),
    color: superChatColor(renderer.bodyBackgroundColor),
  };
}

/** One chat item renderer → DTO (or null for unmappable placeholders). */
function mapChatItem(item: Json): LiveChatMessageDTO | null {
  const r = asObj(item.liveChatTextMessageRenderer);
  if (r) {
    const author = mapAuthor(r);
    return {
      id: typeof r.id === "string" ? r.id : "",
      author,
      body: runsToText(r.message),
      timestampUsec: typeof r.timestampUsec === "string" ? r.timestampUsec : "",
      kind: "text",
      isSuperChat: false,
      superChat: null,
      isMember: author.badges.includes("member"),
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  const paid = asObj(item.liveChatPaidMessageRenderer);
  if (paid) {
    const superChat = mapSuperChat(paid);
    const author = mapAuthor(paid);
    return {
      id: typeof paid.id === "string" ? paid.id : "",
      author,
      body: superChat.body,
      timestampUsec:
        typeof paid.timestampUsec === "string" ? paid.timestampUsec : "",
      kind: "superchat",
      isSuperChat: true,
      superChat,
      isMember: author.badges.includes("member"),
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  const sticker = asObj(item.liveChatPaidStickerRenderer);
  if (sticker) {
    const amountText = runsToText(sticker.purchaseAmountText);
    const superChat: SuperChatDTO = {
      amountText,
      amountMicros: amountMicrosFromText(amountText),
      currency: currencyFromAmountText(amountText),
      body: runsToText(asObj(asObj(sticker.sticker)?.accessibility)?.label),
      color: superChatColor(sticker.backgroundColor),
    };
    const author = mapAuthor(sticker);
    return {
      id: typeof sticker.id === "string" ? sticker.id : "",
      author,
      body: superChat.body,
      timestampUsec:
        typeof sticker.timestampUsec === "string" ? sticker.timestampUsec : "",
      kind: "supersticker",
      isSuperChat: true,
      superChat,
      isMember: author.badges.includes("member"),
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  const milestone = asObj(item.liveChatMemberMilestoneChatItemRenderer);
  if (milestone) {
    const author = mapAuthor(milestone);
    const memberSince = runsToText(milestone.memberSinceText);
    return {
      id: typeof milestone.id === "string" ? milestone.id : "",
      author,
      body: runsToText(milestone.message),
      timestampUsec:
        typeof milestone.timestampUsec === "string"
          ? milestone.timestampUsec
          : "",
      kind: "member-milestone",
      isSuperChat: false,
      superChat: null,
      isMember: true,
      isMemberMilestone: true,
      memberMilestoneText: memberSince || null,
      offsetMsec: null,
    };
  }
  const gift = asObj(item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer);
  if (gift) {
    const header = asObj(
      asObj(gift.header)?.liveChatSponsorshipsHeaderRenderer,
    );
    const source = header ?? gift;
    const author = mapAuthor(source);
    return {
      id: typeof gift.id === "string" ? gift.id : "",
      author: { ...author, badges: ["member"] },
      body: runsToText(gift.message),
      timestampUsec: "",
      kind: "membership-gift",
      isSuperChat: false,
      superChat: null,
      isMember: true,
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  const system = asObj(item.liveChatViewerEngagementMessageRenderer);
  if (system) {
    return {
      id: typeof system.id === "string" ? system.id : "",
      author: {
        id: "",
        name: "system",
        avatarUrl: null,
        badges: [],
        memberSinceText: null,
      },
      body: runsToText(system.message),
      timestampUsec:
        typeof system.timestampUsec === "string" ? system.timestampUsec : "",
      kind: "system",
      isSuperChat: false,
      superChat: null,
      isMember: false,
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  const modeChange = asObj(item.liveChatModeChangeMessageRenderer);
  if (modeChange) {
    return {
      id: typeof modeChange.id === "string" ? modeChange.id : "",
      author: {
        id: "",
        name: "system",
        avatarUrl: null,
        badges: ["moderator"],
        memberSinceText: null,
      },
      body: runsToText(modeChange.text),
      timestampUsec:
        typeof modeChange.timestampUsec === "string"
          ? modeChange.timestampUsec
          : "",
      kind: "system",
      isSuperChat: false,
      superChat: null,
      isMember: false,
      isMemberMilestone: false,
      memberMilestoneText: null,
      offsetMsec: null,
    };
  }
  // liveChatPlaceholderItemRenderer and unknown renderers → null (skipped+counted).
  return null;
}

/**
 * Map one raw action (live mode: addChatItemAction et al.; replay mode:
 * replayChatItemAction wrapping {videoOffsetTimeMsec, actions[]}) → DTOs.
 * Unknown action types are skipped gracefully and counted by the caller.
 */
export function mapChatAction(action: unknown): LiveChatMessageDTO[] {
  const a = asObj(action);
  if (!a) return [];
  const out: LiveChatMessageDTO[] = [];

  // Replay wrapper: replayChatItemAction { videoOffsetTimeMsec, actions[] }
  const replay = asObj(a.replayChatItemAction);
  if (replay) {
    const offsetRaw = replay.videoOffsetTimeMsec;
    const offset =
      typeof offsetRaw === "number"
        ? offsetRaw
        : typeof offsetRaw === "string" && /^\d+$/.test(offsetRaw)
          ? Number(offsetRaw)
          : null;
    for (const inner of arr(replay.actions)) {
      for (const m of mapChatAction(inner)) {
        out.push({ ...m, offsetMsec: offset });
      }
    }
    return out;
  }

  // Pinned banner: addBannerToLiveChatCommand.bannerRenderer.
  // liveChatBannerRenderer.contents.liveChatTextMessageRenderer
  const bannerCmd = asObj(a.addBannerToLiveChatCommand);
  if (bannerCmd) {
    const contents = asObj(
      asObj(asObj(bannerCmd.bannerRenderer)?.liveChatBannerRenderer)?.contents,
    );
    const m = contents ? mapChatItem(contents) : null;
    if (m) out.push({ ...m, kind: "banner" });
    return out;
  }

  const addItem = asObj(a.addChatItemAction);
  if (addItem) {
    const m = mapChatItem(asObj(addItem.item) ?? {});
    if (m) out.push(m);
    return out;
  }

  // Ticker (Super Chat pinned rows): addLiveChatTickerItemAction.item.
  // liveChatTickerPaidMessageItemRenderer / …SponsorItemRenderer.
  const ticker = asObj(a.addLiveChatTickerItemAction);
  if (ticker) {
    const item = asObj(ticker.item) ?? {};
    const paid = asObj(item.liveChatTickerPaidMessageItemRenderer);
    if (paid) {
      const amountText = runsToText(paid.amountText);
      const superChat: SuperChatDTO = {
        amountText,
        amountMicros: amountMicrosFromText(amountText),
        currency: currencyFromAmountText(amountText),
        body: runsToText(paid.detailText),
        color: superChatColor(paid.backgroundColor),
      };
      const author = mapAuthor(paid);
      out.push({
        id: typeof paid.id === "string" ? paid.id : "",
        author,
        body: superChat.body,
        timestampUsec: "",
        kind: "superchat",
        isSuperChat: true,
        superChat,
        isMember: author.badges.includes("member"),
        isMemberMilestone: false,
        memberMilestoneText: null,
        offsetMsec: null,
      });
    }
    return out;
  }

  // Deletions/replacements/panels — informational, not chat rows.
  return out;
}

/** Classify an action's debug kind name (for the skipped counter). */
export function actionKindName(action: unknown): string {
  const a = asObj(action);
  if (!a) return "invalid";
  for (const key of Object.keys(a)) {
    if (key === "clickTrackingParams" || key === "renderingContent") continue;
    return key;
  }
  return "empty";
}

// ---------------------------------------------------------------------------
// Frame parsing (one get_live_chat / get_live_chat_replay response)
// ---------------------------------------------------------------------------

function parseContinuations(conts: unknown[]): {
  nextToken: string | null;
  pollMs: number;
} {
  let nextToken: string | null = null;
  let pollMs = 0;
  for (const c of conts) {
    const o = asObj(c);
    if (!o) continue;
    for (const [key, val] of Object.entries(o)) {
      const d = asObj(val);
      if (!d) continue;
      if (
        key === "invalidationContinuationData" ||
        key === "timedContinuationData" ||
        key === "liveChatReplayContinuationData" ||
        key === "playerSeekContinuationData"
      ) {
        if (key !== "playerSeekContinuationData") {
          if (typeof d.continuation === "string" && d.continuation) {
            nextToken = d.continuation;
          }
          if (typeof d.timeoutMs === "number") {
            pollMs = Math.max(pollMs, d.timeoutMs);
          }
        }
      }
    }
  }
  return { nextToken, pollMs };
}

function participantsCount(frame: Json): number | null {
  const list = asObj(
    asObj(frame.participantsList)?.liveChatParticipantsListRenderer,
  );
  if (!list) return null;
  const participants = arr(list.participants);
  return participants.length > 0 ? participants.length : null;
}

/**
 * Parse ONE get_live_chat / get_live_chat_replay response into a frame.
 * pollMs comes from the response's own timeoutMs (ground rule #3).
 */
export function parseLiveChatFrame(
  response: unknown,
  mode: LiveChatMode,
): LiveChatFrame {
  const root = asObj(response);
  const lc = asObj(asObj(root?.continuationContents)?.liveChatContinuation) ?? {
    actions: [],
  };
  const actions = arr(lc.actions);
  const messages: LiveChatMessageDTO[] = [];
  let skippedActions = 0;
  const skippedKinds = new Set<string>();

  for (const action of actions) {
    const mapped = mapChatAction(action);
    if (mapped.length === 0) {
      const kind = actionKindName(action);
      // count unmapped/unknown action types in the debug field
      skippedActions += 1;
      if (kind !== "invalid") skippedKinds.add(kind);
      continue;
    }
    messages.push(...mapped);
  }

  const { nextToken, pollMs } = parseContinuations(arr(lc.continuations));
  return {
    messages,
    nextToken,
    pollMs: pollMs || (mode === "live" ? 10_000 : 0),
    mode,
    participants: participantsCount(lc as Json),
    skippedActions,
    skippedKinds: [...skippedKinds],
  };
}

// ---------------------------------------------------------------------------
// Session bootstrap + replay walk (server-side composition for the routes)
// ---------------------------------------------------------------------------

/**
 * Discover the chat session for a video via next() and decide live vs replay.
 * - live → mode "live" (get_live_chat works — verified live).
 * - ended live with chat → the conversationBar token is a REPLAY token; it
 *   400s on get_live_chat but works on get_live_chat_replay (verified).
 */
export async function discoverChatSession(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<
  | { chatAvailable: false; reason: string }
  | (LiveChatSession & { chatAvailable: true })
> {
  let nextRes: Record<string, unknown>;
  try {
    nextRes = await callNextForChat(videoId, fetcher);
  } catch (err) {
    return {
      chatAvailable: false,
      reason: `next failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  const found = findChatContinuation(nextRes);
  if (!found) return { chatAvailable: false, reason: "no conversationBar" };
  const live = isVideoLive(nextRes);
  return {
    chatAvailable: true,
    videoId,
    continuation: found.continuation,
    mode: live ? "live" : "replay",
    watchingNowText: live
      ? runsToText(
          asObj(asObj(liveViewersPath(nextRes))?.viewCount)?.videoViewCountRenderer,
        )
      : null,
  };
}

function liveViewersPath(nextResponse: Record<string, unknown>): unknown {
  const results = asObj(
    asObj(asObj(nextResponse.contents)?.twoColumnWatchNextResults)?.results,
  );
  const list = arr(asObj(results?.results)?.contents);
  for (const c of list) {
    const vpir = asObj(asObj(c)?.videoPrimaryInfoRenderer);
    if (vpir) return asObj(vpir.viewCount);
  }
  return null;
}

/**
 * Poll one frame. `mode` selects the endpoint; a 400 on the live endpoint
 * auto-falls back to the replay endpoint once (replay token family).
 */
export async function pollLiveChatFrame(
  continuation: string,
  mode: LiveChatMode,
  fetcher: typeof fetch = fetch,
): Promise<LiveChatFrame> {
  try {
    if (mode === "live") {
      const res = await callLiveChat(continuation, fetcher);
      return parseLiveChatFrame(res, "live");
    }
    const res = await callLiveChatReplay(continuation, fetcher);
    return parseLiveChatFrame(res, "replay");
  } catch (err) {
    if (
      err instanceof InnerTubeChatError &&
      err.status === 400 &&
      mode === "live"
    ) {
      // Replay token family (op2w0w…): live endpoint 400s, replay works.
      const res = await callLiveChatReplay(continuation, fetcher);
      return parseLiveChatFrame(res, "replay");
    }
    throw err;
  }
}

/**
 * Replay seek: walk replay continuations from the START token until a frame
 * reaches `offsetSec` (or the stream ends / `maxCalls` bound). This is the
 * documented fallback: the byte-level seek-params derivation was probed and
 * is not derivable from public shapes (params field ignored; patched
 * continuation tokens → 400). See evidence/wfx2as/.
 */
export async function walkReplayToOffset(
  startContinuation: string,
  offsetSec: number,
  fetcher: typeof fetch = fetch,
  maxCalls = 40,
): Promise<{ frame: LiveChatFrame; calls: number; reached: boolean }> {
  const targetMsec = Math.max(0, Math.round(offsetSec * 1000));
  let token: string | null = startContinuation;
  let calls = 0;
  let last: LiveChatFrame | null = null;
  const collected: LiveChatMessageDTO[] = [];

  while (token && calls < maxCalls) {
    calls += 1;
    const frame = parseLiveChatFrame(
      await callLiveChatReplay(token, fetcher),
      "replay",
    );
    last = frame;
    const withOffset = frame.messages.filter(
      (m) => m.offsetMsec !== null && m.offsetMsec >= targetMsec,
    );
    collected.push(...withOffset);
    if (withOffset.length > 0) {
      return { frame: { ...frame, messages: collected }, calls, reached: true };
    }
    token = frame.nextToken;
  }
  return {
    frame: {
      messages: collected,
      nextToken: last?.nextToken ?? null,
      pollMs: 0,
      mode: "replay",
      participants: null,
      skippedActions: last?.skippedActions ?? 0,
      skippedKinds: last?.skippedKinds ?? [],
    },
    calls,
    reached: false,
  };
}

/**
 * Live-edge replay: walk to the END of the chat, returning the final frame's
 * messages (the "now" of the replay) + the end-positioned token.
 */
export async function walkReplayToEdge(
  startContinuation: string,
  fetcher: typeof fetch = fetch,
  maxCalls = 40,
): Promise<{ frame: LiveChatFrame; calls: number }> {
  let token: string | null = startContinuation;
  let calls = 0;
  let last: LiveChatFrame | null = null;
  while (token && calls < maxCalls) {
    calls += 1;
    last = parseLiveChatFrame(await callLiveChatReplay(token, fetcher), "replay");
    token = last.nextToken;
  }
  return {
    frame:
      last ?? {
        messages: [],
        nextToken: null,
        pollMs: 0,
        mode: "replay",
        participants: null,
        skippedActions: 0,
        skippedKinds: [],
      },
    calls,
  };
}

// ---------------------------------------------------------------------------
// updated_metadata parsing (live-status route)
// ---------------------------------------------------------------------------

export type LiveStatusDTO = {
  isLive: boolean;
  concurrentViewers: number | null;
  viewersText: string | null;
  likesText: string | null;
  dateText: string | null;
  pollMs: number;
};

/**
 * Parse an updated_metadata response (shape verified live):
 * - actions[].updateViewershipAction.viewCount.videoViewCountRenderer
 *   { viewCount: {simpleText: "6,027 watching now"}, isLive: true,
 *     originalViewCount: "6027" }
 * - actions[].updateDateTextAction.dateText (only when YouTube pushes it)
 * - frameworkUpdates…mutations[].payload.likeCountEntity.likeCountIfLiked
 *   ("768K")
 * - continuation.timedContinuationData {timeoutMs: 5000}
 */
export function parseUpdatedMetadata(response: unknown): LiveStatusDTO {
  const root = asObj(response);
  const out: LiveStatusDTO = {
    isLive: false,
    concurrentViewers: null,
    viewersText: null,
    likesText: null,
    dateText: null,
    pollMs: 5_000,
  };
  if (!root) return out;

  for (const actionRaw of arr(root.actions)) {
    const action = asObj(actionRaw);
    if (!action) continue;
    const viewership = asObj(
      asObj(asObj(action.updateViewershipAction)?.viewCount)
        ?.videoViewCountRenderer,
    );
    if (viewership) {
      const text = runsToText(viewership.viewCount);
      if (text) out.viewersText = text;
      if (viewership.isLive === true) out.isLive = true;
      const original = viewership.originalViewCount;
      if (
        typeof original === "string" &&
        /^\d+$/.test(original) &&
        original !== "0"
      ) {
        out.concurrentViewers = Number(original);
      } else {
        const m = text.match(/^([\d,.]+)\s+watching/);
        if (m) out.concurrentViewers = Number(m[1].replace(/,/g, ""));
      }
    }
    const dateAction = asObj(action.updateDateTextAction);
    if (dateAction) {
      const t = runsToText(dateAction.dateText);
      if (t) out.dateText = t;
    }
  }

  const mutations = arr(
    asObj(asObj(root.frameworkUpdates)?.entityBatchUpdate)?.mutations,
  );
  for (const mRaw of mutations) {
    const payload = asObj(asObj(mRaw)?.payload);
    const likeEntity = asObj(payload?.likeCountEntity);
    if (likeEntity) {
      const liked = asObj(likeEntity.likeCountIfLiked)?.content;
      const indifferent = asObj(likeEntity.likeCountIfIndifferent)?.content;
      const text =
        typeof liked === "string"
          ? liked
          : typeof indifferent === "string"
            ? indifferent
            : null;
      if (text) out.likesText = text;
    }
  }

  const timed = asObj(asObj(root.continuation)?.timedContinuationData);
  if (typeof timed?.timeoutMs === "number") out.pollMs = timed.timeoutMs;

  return out;
}

// ---------------------------------------------------------------------------
// Small in-memory caches + per-IP rate limiting (local-memory only)
// ---------------------------------------------------------------------------

type CacheEntry = { value: unknown; expires: number };

const memCache = new Map<string, CacheEntry>();

export function cacheGet<T>(key: string): T | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  memCache.set(key, { value, expires: Date.now() + ttlMs });
  if (memCache.size > 500) {
    const oldest = memCache.keys().next().value;
    if (oldest !== undefined) memCache.delete(oldest);
  }
}

/** Per-IP token bucket (architecture: rate limiting on live routes). */
const buckets = new Map<string, { tokens: number; refilledAt: number }>();

export function rateLimit(
  key: string,
  capacity = 60,
  refillPerSec = 0.5,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) {
    buckets.set(key, { tokens: capacity - 1, refilledAt: now });
    return true;
  }
  const elapsed = (now - b.refilledAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.refilledAt = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}
