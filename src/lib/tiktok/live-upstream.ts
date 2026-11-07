/**
 * P100-TIKTOK-LIVE — the LIVE probe transport, the mirror of
 * src/lib/tiktok/upstream.ts for the lanes whose bytes are NOT tiktok.com
 * (the Apify REST host is api.apify.com). The same law applies: the running
 * app uses the real global fetch; tests inject fixture-serving fakes via
 * `setTikTokLiveProbeUpstream()`. No other module in the live lane is
 * allowed to call fetch directly (the seam law).
 */

export type TikTokProbeFetch = (url: string, init?: RequestInit) => Promise<Response>;

let injected: TikTokProbeFetch | null = null;

/** The active probe fetch (injected test fake or real fetch). */
export function tiktokLiveProbeFetch(): TikTokProbeFetch {
  return injected ?? ((url, init) => fetch(url, init));
}

/** Test-only: serve fixture bytes instead of the network. */
export function setTikTokLiveProbeUpstream(impl: TikTokProbeFetch | null): void {
  injected = impl;
}

/** True while a test transport is injected. */
export function isTikTokLiveTestUpstream(): boolean {
  return injected !== null;
}
