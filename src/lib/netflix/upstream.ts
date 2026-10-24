/**
 * P42-NETFLIX-SOURCE — the Netflix upstream transport, the source-adapter
 * mirror of src/lib/youtube/upstream.ts (ADR 0002 §4).
 *
 * Every netflix.com byte WebFlix ever fetches flows through this seam:
 * the running app uses the real global fetch; tests inject fixture-serving
 * fakes via `setNetflixUpstream()`. The rate limiter's stand-down check and
 * the honest-degrade paths both read `isNetflixTestUpstream()`.
 */

export type NetflixUpstreamFetch = (url: string, init?: RequestInit) => Promise<Response>;

let injected: NetflixUpstreamFetch | null = null;

/** The active Netflix upstream fetch (injected test fake or real fetch). */
export function netflixUpstreamFetch(): NetflixUpstreamFetch {
  return injected ?? ((url, init) => fetch(url, init));
}

/** Test-only: serve fixture bytes instead of the network. */
export function setNetflixUpstream(impl: NetflixUpstreamFetch | null): void {
  injected = impl;
}

/** True while a test upstream is injected (rate limiting stands down). */
export function isNetflixTestUpstream(): boolean {
  return injected !== null;
}
