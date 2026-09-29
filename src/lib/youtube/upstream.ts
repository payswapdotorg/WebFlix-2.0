/**
 * WFX2-A-B upstream transport — a single injectable fetch seam shared by every
 * youtube.com call (InnerTube + SSR + suggestqueries).
 *
 * Tests inject fixture-serving fakes via `setUpstream()` (exported through
 * `innertube.ts` per the lane spec); the running app always uses the real
 * global fetch. `isTestUpstream()` lets the rate limiter stand down while
 * fixtures serve requests.
 */

export type UpstreamFetch = (url: string, init?: RequestInit) => Promise<Response>;

let injected: UpstreamFetch | null = null;

/** The active upstream fetch (injected test fake or the real global fetch). */
export function upstreamFetch(): UpstreamFetch {
  return injected ?? ((url, init) => fetch(url, init));
}

/** Test-only: serve fixture bytes instead of the network. */
export function setUpstream(impl: UpstreamFetch | null): void {
  injected = impl;
}

/** True while a test upstream is injected (rate limiting stands down). */
export function isTestUpstream(): boolean {
  return injected !== null;
}
