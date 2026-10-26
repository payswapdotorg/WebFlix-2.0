/**
 * P58-TIKTOK-SOURCE — the TikTok upstream transport, the source-adapter
 * mirror of src/lib/netflix/upstream.ts (ADR 0002 §4, ADR 0004 §2).
 *
 * Every tiktok.com byte WebFlix's servers ever fetch flows through this seam:
 * the running app uses the real global fetch (the keyless oEmbed call);
 * tests inject fixture-serving fakes via `setTikTokUpstream()`. The embed
 * player lane does NOT ride this seam — the viewer's browser fetches the
 * iframe directly from TikTok.
 */

export type TikTokUpstreamFetch = (url: string, init?: RequestInit) => Promise<Response>;

let injected: TikTokUpstreamFetch | null = null;

/** The active TikTok upstream fetch (injected test fake or real fetch). */
export function tiktokUpstreamFetch(): TikTokUpstreamFetch {
  return injected ?? ((url, init) => fetch(url, init));
}

/** Test-only: serve fixture bytes instead of the network. */
export function setTikTokUpstream(impl: TikTokUpstreamFetch | null): void {
  injected = impl;
}

/** True while a test upstream is injected. */
export function isTikTokTestUpstream(): boolean {
  return injected !== null;
}
