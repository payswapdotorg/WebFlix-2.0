/**
 * WFX2-A-W direct YouTube write path — the ONE InnerTube call that is
 * verified to work server-side (verification log §16/§17):
 * subscription/subscribe + subscription/unsubscribe with cookie auth and
 * the classic SAPISIDHASH header.
 *
 * `Authorization: SAPISIDHASH <time>_<sha1(time + ' ' + SAPISID + ' ' + origin)>`
 * where SAPISID comes from the YT_COOKIES env (never committed).
 *
 * This module is the local implementation the lead dedupes against A-B's
 * `src/lib/youtube/innertube.ts` at merge time.
 */
import { createHash } from "node:crypto";

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

/**
 * Direct comment create — POST /youtubei/v1/comment/create_comment with
 * cookie auth + SAPISIDHASH (the subscribe-lane pattern; WFX2-B-S).
 * The response carries the created comment as entity mutations (the UI DTO
 * is synthesized by the caller — the next live read carries the real row).
 * Returns {ok:false, error:"direct-not-configured"} when YT_COOKIES lacks
 * SAPISID (caller falls back to the broker).
 */
export async function createComment(
  videoId: string,
  text: string,
  opts: { fetchImpl?: DirectFetch; cookies?: string; now?: number } = {}
): Promise<DirectActionResult> {
  const rawCookies = opts.cookies ?? process.env.YT_COOKIES?.trim() ?? "";
  const sapisid = parseCookies(rawCookies)["SAPISID"];
  if (!rawCookies || !sapisid) {
    return { ok: false, error: "direct-not-configured (YT_COOKIES/SAPISID missing)" };
  }
  const timeSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const doFetch = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
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
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
      videoId,
      commentText: text,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: `direct create_comment returned ${res.status}` };
  }
  return { ok: true, status: res.status };
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
  opts: { fetchImpl?: DirectFetch; cookies?: string; now?: number } = {}
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
