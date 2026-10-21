/**
 * WFX2-A-W direct YouTube write path — the InnerTube calls that work
 * server-side (verification log §16/§17: subscription/subscribe +
 * subscription/unsubscribe with cookie auth and the classic SAPISIDHASH
 * header).
 *
 * `Authorization: SAPISIDHASH <time>_<sha1(time + ' ' + SAPISID + ' ' + origin)>`
 * where SAPISID comes from the YT_COOKIES env (never committed).
 *
 * P33-DIRECT-ACTIONS (2026-10-21, the operator's directive: "my youtube
 * sessions are read only which means I can't perform any action … if we aim
 * to become the main interface for youtube.com, we can't require users to
 * go back to youtube.com before they can like, comment, etc.") — the
 * everyday action family joins the verified subscribe lane as DIRECT calls:
 *   - rateVideo (like / remove-rating) — like/like + like/removelike with
 *     the CAPTURED params templates (tests/fixtures/yt/
 *     request_payload_examples.json — the same bytes the broker's page-
 *     context fetch fallback sends, ported byte-exact from
 *     mini-services/youtube-broker/executor.ts buildLikeParams);
 *   - editPlaylistMembership — browse/edit_playlist with the broker's own
 *     verified fetch wire (ACTION_ADD_VIDEO / ACTION_REMOVE_VIDEO; works
 *     for real YouTube playlist ids AND the special WL list).
 * The one honest gap kept: like/dislike has NO captured wire template
 * (the fixture never captured one; the broker's dislike path is UI-click
 * only) — dislike stays broker-tier rather than guessing the protobuf.
 *
 * This module is the local implementation the lead dedupes against A-B's
 * `src/lib/youtube/innertube.ts` at merge time.
 */
import { createHash } from "node:crypto";
import { innertubeBrowse } from "./youtube/innertube";
import { mapPlaylistItemsPage, playlistBrowseId } from "./youtube/playlists";

const ORIGIN = "https://www.youtube.com";
const CLIENT_VERSION = "2.20250929.00.00";

function sha1hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

export interface DirectActionResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Parse a raw cookie-header string ("k=v; k2=v2") into a map. */
export function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// P33 — the like params templates (the captured wire, byte-exact)
// ---------------------------------------------------------------------------

/**
 * like/like params (captured fixture, dQw4w9WgXcQ):
 *   hex: 0a 0d 0a 0b <11-char id> 20 00 32 0c 08 <ts varint> 10 <hash>
 * i.e. protobuf {1: {1: videoId, 2: 0}, 6: {1: ts, 2: hash}}
 */
const LIKE_TPL = Buffer.from("Cg0KC2RRdzR3OVdnWGNRIAAyDAiH6OzVBhCG4ZOCAg==", "base64");
/**
 * like/removelike params (captured fixture, dQw4w9WgXcQ):
 *   hex: 0a 0d 0a 0b <11-char id> 18 00 2a 0c 08 <ts varint> 10 <hash>
 * i.e. protobuf {1: {1: videoId, 3: 0}, 5: {1: ts, 2: hash}}
 */
const REMOVELIKE_TPL = Buffer.from("Cg0KC2RRdzR3OVdnWGNRGAAqDAiH6OzVBhCurJSCAg==", "base64");

/**
 * P33 — videoId-templated like/removelike params (base64, URL-encoded
 * padding — the exact wire form youtube.com sends). Refreshes the timestamp
 * field (bytes 20-24, the captured varint slot). Returns null when the
 * videoId isn't the standard 11 chars (the template can't be byte-swapped)
 * — the caller falls back honestly, never a guessed encoding.
 * Ported byte-exact from mini-services/youtube-broker/executor.ts
 * (buildLikeParams) — the broker's verified page-context fetch fallback.
 */
export function buildLikeParams(videoId: string, remove: boolean, now?: number): string | null {
  if (videoId.length !== 11) return null;
  const buf = Buffer.from(remove ? REMOVELIKE_TPL : LIKE_TPL);
  buf.write(videoId, 4, "latin1");
  const ts = Math.floor((now ?? Date.now()) / 1000);
  buf[20] = (ts & 0x7f) | 0x80;
  buf[21] = ((ts >>> 7) & 0x7f) | 0x80;
  buf[22] = ((ts >>> 14) & 0x7f) | 0x80;
  buf[23] = ((ts >>> 21) & 0x7f) | 0x80;
  buf[24] = (ts >>> 28) & 0x7f;
  return buf.toString("base64").replace(/=/g, "%3D");
}

/** Extract a cookie value from the YT_COOKIES env string. */
export function cookieValue(name: string): string | null {
  const raw = process.env.YT_COOKIES?.trim();
  if (!raw) return null;
  return parseCookies(raw)[name] ?? null;
}

/** Whether the session cookie set is configured at all. */
export function directAuthConfigured(): boolean {
  return cookieValue("SAPISID") !== null;
}

/**
 * Build the classic SAPISIDHASH authorization value.
 * `<unix-sec>_<sha1hex(unix-sec + ' ' + sapisid + ' ' + origin)>`
 */
export function sapisidhash(sapisid: string, timeSec: number, origin = ORIGIN): string {
  return `${timeSec}_${sha1hex(`${timeSec} ${sapisid} ${origin}`)}`;
}

export interface DirectFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

/** Shared options for the direct write calls (WFX2-P6-CR: named — the
 * createComment body now branches on createCommentParams). */
export interface DirectCallOptions {
  fetchImpl?: DirectFetch;
  cookies?: string;
  now?: number;
}

export interface CreateCommentOptions extends DirectCallOptions {
  /**
   * WFX2-P6-CR — the reply thread's createCommentParams (from the live
   * payload's replyCommand). Present → this POST is a REPLY: the same
   * /comment/create_comment endpoint, the body carrying createCommentParams
   * (which encodes the thread) instead of the bare videoId.
   */
  createCommentParams?: string;
}

/**
 * Direct comment create — POST /youtubei/v1/comment/create_comment with
 * cookie auth + SAPISIDHASH (the subscribe-lane pattern; WFX2-B-S).
 * WFX2-P6-CR: opts.createCommentParams turns the call into a REPLY (same
 * endpoint; YouTube.js's create-comment reply recipe — the params come from
 * the live payload's toolbar replyCommand).
 * The response carries the created comment as entity mutations (the UI DTO
 * is synthesized by the caller — the next live read carries the real row).
 * Returns {ok:false, error:"direct-not-configured"} when YT_COOKIES lacks
 * SAPISID (caller falls back to the broker).
 */
export async function createComment(
  videoId: string,
  text: string,
  opts: CreateCommentOptions = {}
): Promise<DirectActionResult> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  const sapisid = parseCookies(rawCookies)["SAPISID"];
  if (!rawCookies || !sapisid) {
    return { ok: false, error: "direct-not-configured (YT_COOKIES/SAPISID missing)" };
  }
  const timeSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const body: Record<string, unknown> = {
    context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
    commentText: text,
  };
  if (opts.createCommentParams) {
    // reply: the params encode the comment thread (YouTube.js recipe)
    body.createCommentParams = opts.createCommentParams;
  } else {
    body.videoId = videoId;
  }
  const res = await doFetch(`${ORIGIN}/youtubei/v1/comment/create_comment?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SAPISIDHASH ${sapisidhash(sapisid, timeSec)}`,
      Origin: ORIGIN,
      Cookie: rawCookies,
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": "0",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": CLIENT_VERSION,
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: `direct create_comment returned ${res.status}` };
  }
  return { ok: true, status: res.status };
}

/**
 * Direct comment REPLY — createComment with the thread's
 * createCommentParams (WFX2-P6-CR). Same endpoint/auth as createComment;
 * the params ride the body instead of the bare videoId.
 */
export async function createReply(
  videoId: string,
  createCommentParams: string,
  text: string,
  opts: DirectCallOptions = {}
): Promise<DirectActionResult> {
  return createComment(videoId, text, { ...opts, createCommentParams });
}

/**
 * Direct subscribe/unsubscribe (VERIFIED server-side — §16/§17).
 * POST /youtubei/v1/subscription/subscribe|unsubscribe with cookie auth +
 * SAPISIDHASH. Returns {ok:false, error:"direct-not-configured"} when
 * YT_COOKIES lacks SAPISID (caller falls back to the broker).
 */
export async function subscribeChannel(
  channelId: string,
  on: boolean,
  opts: DirectCallOptions = {}
): Promise<DirectActionResult> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  const sapisid = parseCookies(rawCookies)["SAPISID"];
  if (!rawCookies || !sapisid) {
    return { ok: false, error: "direct-not-configured (YT_COOKIES/SAPISID missing)" };
  }
  const timeSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const endpoint = on ? "subscription/subscribe" : "subscription/unsubscribe";
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));

  const res = await doFetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SAPISIDHASH ${sapisidhash(sapisid, timeSec)}`,
      Origin: ORIGIN,
      Cookie: rawCookies,
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": "0",
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": CLIENT_VERSION,
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
      channelId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: `direct ${endpoint} returned ${res.status}` };
  }
  return { ok: true, status: res.status };
}

/**
 * Read whether the operator session is subscribed to a channel (SSR truth):
 * fetch the channel page with cookies and look for the subscribe button's
 * subscribed flag inside ytInitialData. Used by the toggle path of
 * /api/subscribe. Returns null when undeterminable.
 */
export async function getSubscribedState(
  channelId: string,
  opts: { fetchImpl?: DirectFetch; cookies?: string } = {}
): Promise<boolean | null> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  if (!rawCookies) return null;
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  try {
    const res = await doFetch(`${ORIGIN}/channel/${encodeURIComponent(channelId)}`, {
      headers: {
        Cookie: rawCookies,
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const idx = html.indexOf("subscribeButtonRenderer");
    if (idx === -1) return null;
    const window = html.slice(idx, idx + 2000);
    return /"subscribed"\s*:\s*true/.test(window);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// P33 — the direct everyday-action family (the main-interface doctrine)
// ---------------------------------------------------------------------------

/** The shared header set for the direct write POSTs (the subscribe-lane law). */
function directWriteHeaders(sapisid: string, timeSec: number, rawCookies: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `SAPISIDHASH ${sapisidhash(sapisid, timeSec)}`,
    Origin: ORIGIN,
    Cookie: rawCookies,
    "X-Origin": ORIGIN,
    "X-Goog-AuthUser": "0",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": CLIENT_VERSION,
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
  };
}

export interface RateVideoOptions extends DirectCallOptions {
  /** injectable clock for the params' timestamp field (tests) */
  now?: number;
}

/**
 * P33 — direct video rating: like or remove-rating.
 * POST /youtubei/v1/like/like | like/removelike with cookie auth +
 * SAPISIDHASH (the subscribe-lane pattern) and the CAPTURED params
 * templates (buildLikeParams). action "none" removes the rating.
 *
 * NOT implemented: "dislike" — like/dislike has no captured wire template
 * (the fixture never captured one; guessing the protobuf is against the
 * house law) — the caller keeps dislike on the broker tier and falls back
 * honestly. Returns {ok:false, error:"direct-not-configured"} when
 * YT_COOKIES lacks SAPISID, and {ok:false, error:"direct-like-unavailable"}
 * when the videoId can't be templated (not 11 chars) — both are the
 * caller's broker-fallback signals, never a synthesized success.
 */
export async function rateVideo(
  videoId: string,
  action: "like" | "none",
  opts: RateVideoOptions = {}
): Promise<DirectActionResult> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  const sapisid = parseCookies(rawCookies)["SAPISID"];
  if (!rawCookies || !sapisid) {
    return { ok: false, error: "direct-not-configured (YT_COOKIES/SAPISID missing)" };
  }
  const params = buildLikeParams(videoId, action === "none", opts.now);
  if (!params) {
    return { ok: false, error: "direct-like-unavailable (videoId not 11 chars)" };
  }
  const timeSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const endpoint = action === "none" ? "like/removelike" : "like/like";
  const res = await doFetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: directWriteHeaders(sapisid, timeSec, rawCookies),
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
      params,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: `direct ${endpoint} returned ${res.status}` };
  }
  return { ok: true, status: res.status };
}

/** P33 — editPlaylistMembership's options (the DirectCallOptions seam). */
export type EditPlaylistOptions = DirectCallOptions;

/**
 * P33 — direct playlist membership edit (Watch later + real playlists).
 * POST /youtubei/v1/browse/edit_playlist with cookie auth + SAPISIDHASH —
 * the broker's own VERIFIED page-context fetch wire (executor.ts: works for
 * real YouTube playlist ids AND the special WL list):
 *   add    → actions: [{action: "ACTION_ADD_VIDEO", addedVideoId, videoId}]
 *   remove → actions: [{action: "ACTION_REMOVE_VIDEO", removedVideoId, videoId}]
 * Returns {ok:false, error:"direct-not-configured"} when YT_COOKIES lacks
 * SAPISID (the caller's broker-fallback signal).
 */
export async function editPlaylistMembership(
  playlistId: string,
  videoId: string,
  want: boolean,
  opts: EditPlaylistOptions = {}
): Promise<DirectActionResult> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  const sapisid = parseCookies(rawCookies)["SAPISID"];
  if (!rawCookies || !sapisid) {
    return { ok: false, error: "direct-not-configured (YT_COOKIES/SAPISID missing)" };
  }
  const timeSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const action = want
    ? { action: "ACTION_ADD_VIDEO", addedVideoId: videoId, videoId }
    : { action: "ACTION_REMOVE_VIDEO", removedVideoId: videoId, videoId };
  const res = await doFetch(`${ORIGIN}/youtubei/v1/browse/edit_playlist?prettyPrint=false`, {
    method: "POST",
    headers: directWriteHeaders(sapisid, timeSec, rawCookies),
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
      playlistId,
      actions: [action],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: `direct edit_playlist returned ${res.status}` };
  }
  return { ok: true, status: res.status };
}

/** How many continuation pages the membership probe will walk before
 * answering honestly-unknown (realistically covers 300+ entries; deeper
 * lists fall back to the broker toggle rather than guessing). */
export const PLAYLIST_CONTAINS_PAGE_BUDGET = 4;

/** One mapped playlist page (the membership probe's narrowed view). */
export interface PlaylistContainsPage {
  videos: { id: string }[];
  nextCursor: string | null;
}

export interface PlaylistContainsOptions {
  cookies?: string;
  /** test seam: one playlist page read (cursor → page); the production
   * default composes the app's own innertubeBrowse + mapPlaylistItemsPage */
  readPage?: (cursor: string | null) => Promise<PlaylistContainsPage>;
}

/**
 * P33 — fresh (UNCACHED) playlist membership read for the direct tier's
 * TOGGLE paths: browse the playlist (VL-prefixed browseId — the same
 * read path the app's playlist page uses, minus the cache so a toggle
 * right after a write sees the truth), walk up to PLAYLIST_CONTAINS_PAGE_BUDGET
 * pages. Returns true/false membership, or null when undeterminable
 * (read failed / auth-gated / deeper than the page budget) — the caller's
 * honest broker-fallback signal, never a guess.
 */
export async function playlistContains(
  playlistId: string,
  videoId: string,
  opts: PlaylistContainsOptions = {}
): Promise<boolean | null> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  if (!rawCookies) return null;
  const readPage =
    opts.readPage ??
    (async (cursor: string | null): Promise<PlaylistContainsPage> => {
      const response = cursor
        ? await innertubeBrowse({ continuation: cursor }, { cookies: rawCookies })
        : await innertubeBrowse(
            { browseId: playlistBrowseId(playlistId) },
            { cookies: rawCookies }
          );
      const mapped = mapPlaylistItemsPage(response, playlistId);
      return { videos: mapped.videos.map((v) => ({ id: v.id })), nextCursor: mapped.nextCursor };
    });
  try {
    let cursor: string | null = null;
    for (let page = 0; page < PLAYLIST_CONTAINS_PAGE_BUDGET; page++) {
      const mapped = await readPage(cursor);
      if (mapped.videos.some((v) => v.id === videoId)) return true;
      cursor = mapped.nextCursor;
      if (!cursor) return false;
    }
    return null; // deeper than the budget — honestly unknown
  } catch {
    return null;
  }
}
