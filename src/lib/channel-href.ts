/**
 * The channel-href law (P103-mini-6) — a channel WITHOUT a handle has NO
 * in-app page. The honest answer is null (the UI renders a non-link), never
 * a dead `/channel/` href.
 *
 * MEASURED on production (the walk's HTTP failure law, 2026-11-08): the home
 * feed's handle-less "KiDi and Lasmid" topic row rendered two links to bare
 * /channel — the router prefetch answered 404 and a click lands on the 404
 * page. YouTube topic/auto-generated channels legitimately carry no @handle;
 * every `/channel/${x.handle}` template that assumes one is the bug class.
 */
export function channelHref(handle: string | null | undefined): string | null {
  const h = (handle ?? "").trim();
  return h ? `/channel/${h}` : null;
}
