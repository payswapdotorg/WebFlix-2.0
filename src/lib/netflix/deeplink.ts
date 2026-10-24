/**
 * P42-NETFLIX-SOURCE — ADR 0002 §1: the ONLY place in the codebase allowed to
 * construct a netflix.com URL. WebFlix never fetches these (robots + playback
 * policy); they are outbound deep links a user's browser navigates to, handing
 * the viewer TO Netflix (the same pattern Apple TV / Google TV use).
 *
 * `netflix.com/watch/<id>` is Netflix's own per-title deep link (their app
 * intents and partner TV UIs use the same shape). `netflix.com/title/<id>` is
 * the public title page.
 */

export function netflixWatchUrl(netflixId: number): string {
  return `https://www.netflix.com/watch/${netflixId}`;
}

export function netflixTitleUrl(netflixId: number): string {
  return `https://www.netflix.com/title/${netflixId}`;
}
