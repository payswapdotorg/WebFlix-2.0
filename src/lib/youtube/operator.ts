/**
 * WFX2-B-S — the operator's own channel id (creator-mode detection).
 *
 * Mechanism (the studio lane's verified pattern, WFX2-C-B): the signed-in
 * youtube.com home page carries the session's own channel id in its `ytcfg`
 * bootstrap (`"CHANNEL_ID":"UC…"`). No session → null (public mode — no
 * creator powers, honestly). Cached for the session's lifetime.
 */
import { fetchPageHtml } from "./ssr";
import { getCookieHeader } from "./session";
import { cached, TTL } from "./cache";

const CHANNEL_ID_IN_HTML_RE = /"CHANNEL_ID"\s*:\s*"(UC[\w-]{20,})"/;

/** Pure extractor (exported for fixture-driven tests). */
export function extractChannelIdFromHtml(html: string): string | null {
  const m = CHANNEL_ID_IN_HTML_RE.exec(html);
  return m ? m[1] : null;
}

/**
 * The operator's channel id from the signed-in home page's ytcfg bootstrap,
 * or null in public mode. Cached (the session is stable for its lifetime).
 */
export async function operatorChannelId(): Promise<string | null> {
  const cookies = getCookieHeader();
  if (!cookies) return null;
  return cached("yt:operator:channel-id", TTL.WATCH_MS, async () => {
    const html = await fetchPageHtml("/", { cookies }).catch(() => null);
    return html ? extractChannelIdFromHtml(html) : null;
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
