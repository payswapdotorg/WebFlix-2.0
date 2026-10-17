# P23-C "sound-region" — live youtube.com measurements (2026-10-17, this run, Wave-A law)

Sandbox egress: HK; youtube.com reachable; the desktop shorts PLAYER does not
boot from this egress ("Video unavailable" on every short — the rail + overlay
DO render from the SSR/prefetch data). All data-layer measurements below are
youtube.com's own live payloads (InnerTube WEB client, curl'd + DOM-inspected
via agent-browser); UI measurements are the rendered DOM of youtube.com's own
pages.

## G5 — the sound disc + the sound surface

### The rail (2026 desktop + mobile web, measured in-DOM)
`reel-action-bar-view-model` (inside `yt-reel-player-overlay-view-model` >
`div.ytReelPlayerOverlayViewModelActionsContainer`):
`LIKE-BUTTON-VIEW-MODEL | BUTTON (Comments, count) | BUTTON (Share) |
BUTTON (Remix) | PIVOT-BUTTON-VIEW-MODEL` — FIVE slots; the disc is the
rail's LAST slot (the pivot). Mobile web renders the same VM family
(`ytwReelActionBarViewModelHostMobileActionButton`).

### The disc (pivotButtonViewModel — reel_watch_sequence payload, measured)
Path: `entries[0].command.reelWatchEndpoint.unserializedPrefetchData.
reelItemWatchResponse.overlay.reelPlayerOverlayRenderer.playerOverlay.
reelPlayerOverlayViewModel.actionBar.reelActionBarViewModel.
buttonViewModels[4].pivotButtonViewModel`:
- `thumbnail.sources` — 3 sizes (48/88/176) circular artwork (yt3.ggpht for
  original sounds = the channel avatar family; measured)
- `soundAttributionTitle.content` — "Original Sound" / the sound title
- `contentDescription` — "See more videos using this sound"
- `waveformAnimationStyle` / `backgroundAnimationStyle` — the audio-bars chrome
- `onClickCommand` → `showEngagementPanelEndpoint` tag
  `engagement-panel-shorts-audio-pivot` (desktop 2026 opens the SIDE PANEL).
- MOBILE WEB measured in-DOM: the pivot renders as
  `<a href="/source/G4nmo7U9e98/shorts?bp=…">` — for ORIGINAL sounds the disc
  links youtube.com's own /source/<videoId>/shorts page (a PAGE).
- Disc at rest: 40×40 image (mobile DOM measured). The rotation animation
  could NOT be observed (player never plays from this egress) — rotation
  implemented per the audit description + youtube.com's known disc behavior;
  documented honestly in the worklog.

### The sound surface (the audio pivot) — youtube.com's own mechanism
1. `engagement-panel-shorts-audio-pivot` ships in the reelItemWatchResponse
   with: `pageHeaderViewModel` (title + vertical 2:3 image) + `richGridRenderer`
   whose only content is a `continuationItemRenderer` browse continuation.
2. POST /youtubei/v1/browse {continuation} (the token decodes with
   `FEsfzv_audio_pivot`) →
   - `header.pageHeaderRenderer.content.pageHeaderViewModel`:
     title (sound title) · image (contentPreviewImageViewModel 2:3) ·
     metadataRows (avatarStack + @handle + channel browseEndpoint)
   - `onResponseReceivedActions[].reloadContinuationItemsCommand`:
     targetId `browse-feedFEsfv_audio_pivot`, slot BODY →
     `continuationItems[]` = `richItemRenderer.shortsLockupViewModel`
     (the grid; 15 lockups in the measured page) +
     `continuationItemRenderer` (the next-page token; paging works)
   - slot HEADER → pageHeaderViewModel (same header family).
3. The /source/<videoId>/shorts page (original sounds, browser-measured):
   `yt-page-header-renderer` sound card (source title + @channel + source
   video view count) + `ytd-two-column-browse-results-renderer` shorts grid.

### Remix (G6 — measured in the same payloads + DOM)
Rail slot [3]: `iconName: "REMIX_FILLED"`, title "Remix", accessibilityId
`id.reel_remix_button`. For non-remixable videos youtube.com itself ships
`state: "BUTTON_VIEW_MODEL_STATE_DISABLED"` (DOM: `aria-disabled="true"`)
whose onTap is an honest `addToToastAction` toast: "Feature not available
for this video" — youtube.com's OWN honest-degradation pattern for an
affordance that cannot work. WebFlix mirrors it (disabled + honest note:
shorts creation is not available in WebFlix; the broker registry has no
remix/shorts-creation kind — verified).

## G7 — trending region
- Logged-out /feed/trending serves the What-to-Watch nudge (re-verified this
  run: SSR parse yields 0 videos → the app's search-backed fallback applies).
- SSR `?gl=<REGION>` IS honored by youtube.com pages: /feed/trending?gl=US vs
  ?gl=GB both serve 200 and the returned page's own payload carries
  `"gl": "US"` vs `"gl": "GB"` (measured; content differs).
- The search read (the public-mode trending fallback path) carries the region
  via InnerTube `context.client.gl`: search "trending" gl=US vs gl=GB vs gl=JP
  → measurably different ranked sets (evidence/wfx2p23c/search_gl_*.json).
- FEtrending browse XHR remains rejected server-side (400 INVALID_ARGUMENT,
  re-verified) — trending stays SSR-only, now with ?gl=.
- The region UI on the 2026 logged-out page: the topbar logo carries the
  country-code span (measured: "HK" from this egress). The logged-in trending
  location switcher + the account Content-location country list are
  session-gated — NOT measurable from this sandbox (no youtube.com session);
  the country static map ships per the audit description + the well-known
  YouTube Content-location list, documented honestly in the worklog.

## Files
- reel_sequence_web_sound.json — the reel sequence with the sound pivot (WEB)
- browse_audio_pivot_page1.json — the sound page browse continuation (page 1)
- search_gl_{US,GB,JP}.json — the region-reshaped search fallback reads
- ssr_trending_gl_{US,GB}.html — the ?gl- honored SSR pages
- shorts_page_ssr.html — the shorts page SSR (its own audio pivot panel)
- youtube-source-sound-page.png — the /source/ original-sound page (desktop)
