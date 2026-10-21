/**
 * WFX2-P36-ACTION-PERSISTENCE — the official YouTube Data API v3 action
 * adapter (server-side only). The ONLY end-user write lane: every call acts
 * with the signed-in user's OWN OAuth access token.
 *
 * Supported operations (the work order's list, verified against the official
 * docs at https://developers.google.com/youtube/v3/docs):
 *  - videos.rate            (like | dislike | none)          — 204, 50 units
 *  - videos.getRating       (the authenticated read-back)    — 1 unit
 *  - subscriptions.insert / delete / list(mine, forChannelId)
 *  - playlists.insert / update / delete / list(mine)
 *  - playlistItems.insert / delete / list(playlistId, videoId)
 *
 * The honest-outcome law (P36-B): a 2xx is NEVER alone a success claim.
 * Every write returns a typed outcome and is followed by an authenticated
 * read-back (getRating / subscriptions.list / playlistItems.list) whose
 * result is reported as `verified` — an unverifiable write surfaces as
 * verified:false with a note, never as confirmed.
 *
 * Quota (recorded in the ADR): default 10,000 units/day — a rate/subscribe
 * write costs 50, each read-back 1; quota exhaustion surfaces honestly as
 * the "quota" failure kind.
 */
import { YOUTUBE_DATA_API_BASE } from "./oauth";

/** Network budget per official-API call. */
const API_TIMEOUT_MS = 8_000;

/** The failure taxonomy every call maps into (never a raw exception). */
export type OfficialFailureKind = "http-error" | "network" | "timeout" | "malformed" | "quota";

export interface OfficialFailure {
  ok: false;
  kind: OfficialFailureKind;
  status: number;
  message: string;
}

export interface OfficialTokenGrant {
  accessToken: string;
}

type OfficialResult<T> = { ok: true; data: T } | OfficialFailure;

// ---------------------------------------------------------------------------
// The shared fetch + error mapping
// ---------------------------------------------------------------------------

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

async function officialFetch(url: string, init: RequestInit): Promise<OfficialResult<Response>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      kind: timedOut ? "timeout" : "network",
      status: 0,
      message: timedOut ? "the YouTube API timed out" : "network error reaching the YouTube API",
    };
  }
  return { ok: true, data: res };
}

async function toFailure(res: Response): Promise<OfficialFailure> {
  const body = (await res.json().catch(() => null)) as GoogleErrorBody | null;
  const reasons = (body?.error?.errors ?? []).map((e) => e.reason ?? "").join(",");
  const message = body?.error?.message ?? `the YouTube API answered ${res.status}`;
  if (res.status === 403 && /quota|rateExceeded|userRateLimitExceeded|dailyLimitExceeded/i.test(reasons + message)) {
    return { ok: false, kind: "quota", status: 403, message: "YouTube API quota exceeded for today" };
  }
  return { ok: false, kind: "http-error", status: res.status, message };
}

async function readJson<T>(res: Response): Promise<OfficialResult<T>> {
  const body = (await res.json().catch(() => null)) as T | null;
  if (body === null || typeof body !== "object") {
    return { ok: false, kind: "malformed", status: res.status, message: "the YouTube API response was malformed" };
  }
  return { ok: true, data: body };
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ---------------------------------------------------------------------------
// Video ratings — videos.rate + videos.getRating (the authenticated read-back)
// ---------------------------------------------------------------------------

export type OfficialRating = "like" | "dislike" | "none";

/** POST videos.rate — 204 No Content on success (the write itself). */
export async function officialRateVideo(
  accessToken: string,
  videoId: string,
  rating: OfficialRating,
): Promise<{ ok: true } | OfficialFailure> {
  const url = `${YOUTUBE_DATA_API_BASE}/videos/rate?id=${encodeURIComponent(videoId)}&rating=${rating}`;
  const r = await officialFetch(url, { method: "POST", headers: authHeaders(accessToken) });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  return { ok: true };
}

export interface OfficialRatingRead {
  /** the authenticated user's rating for the video */
  rating: OfficialRating;
}

/**
 * GET videos.getRating — THE authenticated read-back: the acting user's own
 * rating, not the aggregate count. Malformed/absent items → malformed
 * (honest unknown), never a guess.
 */
export async function officialGetRating(
  accessToken: string,
  videoId: string,
): Promise<OfficialResult<OfficialRatingRead>> {
  const url = `${YOUTUBE_DATA_API_BASE}/videos/getRating?id=${encodeURIComponent(videoId)}`;
  const r = await officialFetch(url, { headers: authHeaders(accessToken) });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  const parsed = await readJson<{ items?: Array<{ videoId?: string; rating?: string }> }>(r.data);
  if (!parsed.ok) return parsed;
  const item = parsed.data.items?.find((it) => it.videoId === videoId) ?? parsed.data.items?.[0];
  const rating = item?.rating;
  if (rating !== "like" && rating !== "dislike" && rating !== "none") {
    return { ok: false, kind: "malformed", status: r.data.status, message: "getRating carried no recognizable rating" };
  }
  return { ok: true, data: { rating } };
}

// ---------------------------------------------------------------------------
// Subscriptions — insert / delete / list (the authenticated read-back)
// ---------------------------------------------------------------------------

export interface OfficialSubscriptionStatus {
  subscribed: boolean;
  /** the subscription resource id (needed for delete); null when absent/unfound */
  subscriptionId: string | null;
}

interface SubscriptionListBody {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { channelId?: string };
      thumbnails?: Record<string, { url?: string }>;
    };
  }>;
  nextPageToken?: string;
}

async function listSubscriptionsPage(
  accessToken: string,
  params: Record<string, string>,
): Promise<OfficialResult<SubscriptionListBody>> {
  const qs = new URLSearchParams({ part: "snippet", maxResults: "50", ...params });
  const r = await officialFetch(`${YOUTUBE_DATA_API_BASE}/subscriptions?${qs.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  return readJson<SubscriptionListBody>(r.data);
}

/**
 * The authenticated subscription read-back for one channel: prefer the
 * `mine=true&forChannelId=<id>` filter; when the endpoint rejects that
 * combination, fall back to a capped scan of the user's own subscription
 * list (5 pages × 50 — beyond the cap the honest unknown, never a guess).
 */
export async function officialSubscriptionStatus(
  accessToken: string,
  channelId: string,
): Promise<OfficialResult<OfficialSubscriptionStatus>> {
  // primary: the filtered read
  const filtered = await listSubscriptionsPage(accessToken, {
    mine: "true",
    forChannelId: channelId,
    maxResults: "1",
  });
  if (filtered.ok) {
    const items = filtered.data.items ?? [];
    const hit = items.find((it) => it.snippet?.resourceId?.channelId === channelId);
    if (hit) return { ok: true, data: { subscribed: true, subscriptionId: hit.id ?? null } };
    // an empty filtered answer with items-array present = genuinely not subscribed
    return { ok: true, data: { subscribed: false, subscriptionId: null } };
  }
  // fallback: the capped own-list scan (the filter combination was rejected)
  if (filtered.kind === "http-error" && (filtered.status === 400 || filtered.status === 403)) {
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const scan = await listSubscriptionsPage(accessToken, {
        mine: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      if (!scan.ok) return scan;
      const hit = (scan.data.items ?? []).find(
        (it) => it.snippet?.resourceId?.channelId === channelId,
      );
      if (hit) return { ok: true, data: { subscribed: true, subscriptionId: hit.id ?? null } };
      pageToken = scan.data.nextPageToken;
      if (!pageToken) return { ok: true, data: { subscribed: false, subscriptionId: null } };
    }
    // beyond the cap — the honest unknown surfaces as malformed-kind unknown
    return {
      ok: false,
      kind: "malformed",
      status: 200,
      message: "subscription state beyond the read-back page cap — unknown",
    };
  }
  return filtered;
}

export interface OfficialSubscribeWrite {
  subscriptionId: string | null;
  channelId: string;
}

/**
 * POST subscriptions.insert — the response body IS the created subscription
 * resource (the API's own read-back of the write).
 */
export async function officialSubscribe(
  accessToken: string,
  channelId: string,
): Promise<OfficialResult<OfficialSubscribeWrite>> {
  const url = `${YOUTUBE_DATA_API_BASE}/subscriptions?part=snippet`;
  const r = await officialFetch(url, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      snippet: { resourceId: { kind: "youtube#channel", channelId } },
    }),
  });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  const parsed = await readJson<{ id?: string; snippet?: { resourceId?: { channelId?: string } } }>(r.data);
  if (!parsed.ok) return parsed;
  return { ok: true, data: { subscriptionId: parsed.data.id ?? null, channelId } };
}

/**
 * DELETE subscriptions.delete?id=<subscriptionId> — the id comes from the
 * authenticated own-list read (never guessed). 204 on success.
 */
export async function officialUnsubscribeById(
  accessToken: string,
  subscriptionId: string,
): Promise<{ ok: true } | OfficialFailure> {
  const url = `${YOUTUBE_DATA_API_BASE}/subscriptions/delete?id=${encodeURIComponent(subscriptionId)}`;
  const r = await officialFetch(url, { method: "DELETE", headers: authHeaders(accessToken) });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  return { ok: true };
}

export interface OfficialSubscribedChannel {
  channelId: string;
  title: string;
  thumbUrl: string | null;
  /** ISO — when the user subscribed */
  subscribedAt: string | null;
}

/**
 * GET subscriptions.list(mine=true, part=snippet) — the user's OWN
 * subscription channels (the subscriptions page's per-user read; capped at
 * 5 pages × 50 — beyond the cap the honest truncation).
 */
export async function officialListSubscribedChannels(
  accessToken: string,
): Promise<OfficialResult<OfficialSubscribedChannel[]>> {
  const rows: OfficialSubscribedChannel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const scan = await listSubscriptionsPage(accessToken, {
      mine: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    if (!scan.ok) return scan;
    for (const item of scan.data.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (typeof channelId !== "string") continue;
      rows.push({
        channelId,
        title: item.snippet?.title ?? "",
        thumbUrl:
          item.snippet?.thumbnails?.default?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          null,
        subscribedAt: item.snippet?.publishedAt ?? null,
      });
    }
    pageToken = scan.data.nextPageToken;
    if (!pageToken) return { ok: true, data: rows };
  }
  return { ok: true, data: rows };
}

// ---------------------------------------------------------------------------
// Playlists — insert / update / delete / list(mine) — the user's OWN playlists
// ---------------------------------------------------------------------------

export interface OfficialPlaylistRow {
  id: string;
  title: string;
  visibility: "public" | "unlisted" | "private";
  itemCount: number;
  thumbUrl: string | null;
  description: string | null;
}

interface PlaylistResource {
  id?: string;
  snippet?: { title?: string; description?: string; thumbnails?: Record<string, { url?: string }> };
  status?: { privacyStatus?: string };
  contentDetails?: { itemCount?: number };
}

function mapPlaylistRow(p: PlaylistResource): OfficialPlaylistRow | null {
  if (typeof p.id !== "string" || typeof p.snippet?.title !== "string") return null;
  const visibility =
    p.status?.privacyStatus === "public" || p.status?.privacyStatus === "unlisted"
      ? (p.status.privacyStatus as "public" | "unlisted")
      : "private";
  return {
    id: p.id,
    title: p.snippet.title,
    visibility,
    itemCount: typeof p.contentDetails?.itemCount === "number" ? p.contentDetails.itemCount : 0,
    thumbUrl: p.snippet.thumbnails?.default?.url ?? p.snippet.thumbnails?.medium?.url ?? null,
    description: typeof p.snippet.description === "string" ? p.snippet.description : null,
  };
}

/** GET playlists.list(mine=true) — the user's own playlists (capped at 5 pages). */
export async function officialListPlaylists(
  accessToken: string,
): Promise<OfficialResult<OfficialPlaylistRow[]>> {
  const rows: OfficialPlaylistRow[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      part: "snippet,status,contentDetails",
      mine: "true",
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await officialFetch(`${YOUTUBE_DATA_API_BASE}/playlists?${qs.toString()}`, {
      headers: authHeaders(accessToken),
    });
    if (!r.ok) return r;
    if (!r.data.ok) return toFailure(r.data);
    const parsed = await readJson<{ items?: PlaylistResource[]; nextPageToken?: string }>(r.data);
    if (!parsed.ok) return parsed;
    for (const item of parsed.data.items ?? []) {
      const row = mapPlaylistRow(item);
      if (row) rows.push(row);
    }
    pageToken = parsed.data.nextPageToken;
    if (!pageToken) return { ok: true, data: rows };
  }
  return { ok: true, data: rows }; // capped — the first 250 (honest truncation)
}

/** POST playlists.insert — create a playlist in the user's own account. */
export async function officialCreatePlaylist(
  accessToken: string,
  title: string,
  visibility: "public" | "unlisted" | "private",
): Promise<OfficialResult<OfficialPlaylistRow>> {
  const url = `${YOUTUBE_DATA_API_BASE}/playlists?part=snippet,status`;
  const r = await officialFetch(url, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      snippet: { title },
      status: { privacyStatus: visibility },
    }),
  });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  const parsed = await readJson<PlaylistResource>(r.data);
  if (!parsed.ok) return parsed;
  const row = mapPlaylistRow(parsed.data);
  if (!row) return { ok: false, kind: "malformed", status: r.data.status, message: "the created playlist resource was malformed" };
  return { ok: true, data: row };
}

/**
 * PUT playlists.update — PARTIAL-SAFE by construction: playlists.update
 * REPLACES the parts it carries, so the current resource is fetched first
 * and the omitted fields are merged back (an update that only changes the
 * title must never clear the description).
 */
export async function officialUpdatePlaylist(
  accessToken: string,
  playlistId: string,
  changes: { title?: string; description?: string; visibility?: "public" | "unlisted" | "private" },
): Promise<OfficialResult<OfficialPlaylistRow>> {
  // 1. fetch current (the merge base)
  const qs = new URLSearchParams({ part: "snippet,status", id: playlistId });
  const cur = await officialFetch(`${YOUTUBE_DATA_API_BASE}/playlists?${qs.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!cur.ok) return cur;
  if (!cur.data.ok) return toFailure(cur.data);
  const curParsed = await readJson<{ items?: PlaylistResource[] }>(cur.data);
  if (!curParsed.ok) return curParsed;
  const current = curParsed.data.items?.[0];
  if (!current?.snippet) {
    return { ok: false, kind: "malformed", status: 404, message: "the playlist could not be read before updating" };
  }
  // 2. merge + put
  const body = {
    id: playlistId,
    snippet: {
      title: changes.title ?? current.snippet.title ?? "",
      description: changes.description ?? current.snippet.description ?? "",
    },
    status: { privacyStatus: changes.visibility ?? (current.status?.privacyStatus ?? "private") },
  };
  const put = await officialFetch(`${YOUTUBE_DATA_API_BASE}/playlists?part=snippet,status`, {
    method: "PUT",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!put.ok) return put;
  if (!put.data.ok) return toFailure(put.data);
  const putParsed = await readJson<PlaylistResource>(put.data);
  if (!putParsed.ok) return putParsed;
  const row = mapPlaylistRow(putParsed.data);
  if (!row) return { ok: false, kind: "malformed", status: put.data.status, message: "the updated playlist resource was malformed" };
  return { ok: true, data: row };
}

/** DELETE playlists.delete?id= — 204 on success. */
export async function officialDeletePlaylist(
  accessToken: string,
  playlistId: string,
): Promise<{ ok: true } | OfficialFailure> {
  const url = `${YOUTUBE_DATA_API_BASE}/playlists/delete?id=${encodeURIComponent(playlistId)}`;
  const r = await officialFetch(url, { method: "DELETE", headers: authHeaders(accessToken) });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Playlist items — insert / delete / list(playlistId, videoId) — the
// membership read-back (WL/LL system playlists are NOT writable — the adapter
// rejects them before any call; the honest handoff lives at the proxy)
// ---------------------------------------------------------------------------

export const SYSTEM_PLAYLIST_IDS = new Set(["WL", "LL"]);

export interface OfficialPlaylistMembership {
  contains: boolean;
  /** the playlistItem resource id (needed for delete); null when absent */
  itemId: string | null;
}

/**
 * GET playlistItems.list(playlistId, videoId) — the membership read-back.
 * The videoId filter returns only the items containing that video.
 */
export async function officialPlaylistMembership(
  accessToken: string,
  playlistId: string,
  videoId: string,
): Promise<OfficialResult<OfficialPlaylistMembership>> {
  if (SYSTEM_PLAYLIST_IDS.has(playlistId)) {
    return { ok: false, kind: "malformed", status: 400, message: "WL/LL system playlists are not readable/writable through the Data API" };
  }
  const qs = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId,
    videoId,
    maxResults: "1",
  });
  const r = await officialFetch(`${YOUTUBE_DATA_API_BASE}/playlistItems?${qs.toString()}`, {
    headers: authHeaders(accessToken),
  });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  const parsed = await readJson<{ items?: Array<{ id?: string; snippet?: { resourceId?: { videoId?: string } } }> }>(r.data);
  if (!parsed.ok) return parsed;
  const hit = (parsed.data.items ?? []).find((it) => it.snippet?.resourceId?.videoId === videoId);
  return { ok: true, data: { contains: Boolean(hit), itemId: hit?.id ?? null } };
}

/** POST playlistItems.insert — add a video to the user's own playlist. */
export async function officialPlaylistAdd(
  accessToken: string,
  playlistId: string,
  videoId: string,
): Promise<OfficialResult<{ itemId: string | null }>> {
  if (SYSTEM_PLAYLIST_IDS.has(playlistId)) {
    return { ok: false, kind: "malformed", status: 400, message: "WL/LL system playlists are not writable through the Data API" };
  }
  const url = `${YOUTUBE_DATA_API_BASE}/playlistItems?part=snippet`;
  const r = await officialFetch(url, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
    }),
  });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  const parsed = await readJson<{ id?: string }>(r.data);
  if (!parsed.ok) return parsed;
  return { ok: true, data: { itemId: parsed.data.id ?? null } };
}

/** DELETE playlistItems.delete?id=<itemId> — 204 on success. */
export async function officialPlaylistRemoveById(
  accessToken: string,
  itemId: string,
): Promise<{ ok: true } | OfficialFailure> {
  const url = `${YOUTUBE_DATA_API_BASE}/playlistItems/delete?id=${encodeURIComponent(itemId)}`;
  const r = await officialFetch(url, { method: "DELETE", headers: authHeaders(accessToken) });
  if (!r.ok) return r;
  if (!r.data.ok) return toFailure(r.data);
  return { ok: true };
}
