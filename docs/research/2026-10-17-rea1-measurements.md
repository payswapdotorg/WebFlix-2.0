# REA-1 live measurements — youtube.com, 2026-10-17 (the Wave-A law record)

All measurements taken from this sandbox's egress: agent-browser (signed-out,
public youtube.com) + plain InnerTube POSTs. Evidence screenshots:
`evidence/rea1/`. Real captured fixtures:
`tests/fixtures/yt/hashtag_browse_lofi.json` (+`_page2`),
`next_playlist_panel_lofi.json`, `next_mix_panel_lofi.json`,
`browse_vl_mix_unviewable.json`, `search_mix_lofi.json`.

## G16 — playlist Play all / Shuffle

- Playlist page header action row (real RDCLAK playlist, signed-out):
  **"Play all"** and **"Shuffle"** buttons side by side (each ~152×40 px,
  `ytSpecButtonShapeNextHost` anchors), below the playlist meta. A hero
  thumbnail overlay carries a second "PLAY ALL".
- **Play all** navigates to `/watch?v=<first-video>&list=<playlistId>&pp=…`
  (measured: `watch?v=1FxeCa6kypU&list=RDCLAK…&pp=8AUB`). The watch page's
  queue panel (`ytd-playlist-panel-renderer`) renders the playlist in **list
  order** (first item = the playlist page's first video), now-playing at
  index 0, counter "1 / …".
- **Shuffle** navigates to `/watch?v=<random-video>&list=<playlistId>&pp=…`
  (two different random hrefs present in the same DOM — server-randomized per
  render: `jrGLERRTuow` and `FcBaTjGk5Cg`). After clicking: URL
  `watch?v=FcBaTjGk5Cg&list=RDCLAK…`, the queue panel renders the playlist in
  a **shuffled order** (panel item 1 "Nonchalant…" ≠ playlist page item 1
  "Still"), now-playing marker at the random start position (index 25),
  counter "26 / …". ~25–50 items load first; more lazy-load as playback
  advances. There is **no** `shuffle=1`-style URL param — the cue is the
  random start video + the `list` param; the queue follows the shuffled
  sequence.
- The panel carries: title + owner, the "N / M" position counter, an autoplay
  toggle, per-item thumbnails/durations, "▶" indexText on the selected row,
  "Now playing" overlay on the selected thumbnail.
- The queue panel order for a playlist arriving via **Play all** is the list
  order; via **Shuffle** it is server-shuffled — the shuffle state is not in
  the URL (youtube.com rebuilds it server-side per navigation).
- Signed-out `/playlist?list=WL` redirects to sign-in — the WL/LL shuffle
  click could NOT be re-measured signed-out; WebFlix implements it per the
  work order's contract (local deterministic seeded shuffle, no YouTube
  write) over the already-fetched special-list read.

## G17 — hashtag pages

- `youtube.com/hashtag/lofi` (signed-out) renders: `#lofi` header +
  "7M videos • 1.4M channels" meta + a chip row (All / Shorts) + a video
  grid (richGridRenderer, videoRenderer items), infinite scroll.
- The watch-page description hashtag links carry the browseEndpoint shape
  `{browseId:"FEhashtag", params:"…"}` (measured from the served watch HTML
  for four tags: #lofimusic, #lofi, #lofihiphop, #chill).
- The `params` protobuf decodes as: **field 93** (`ea 05`) wrapping
  **field 1 = the tag bytes** + **field 3 = 1** (the chip state — "All").
  Reconstructed params for "lofi" byte-match youtube.com's own
  (`6gUICgRsb2ZpGAE=`).
- The live read reproduces from this egress: `POST /youtubei/v1/browse
  {browseId:"FEhashtag", params}` → 200 with pageHeaderRenderer title "#lofi",
  metadata "7M videos • 1.4M channels", 37 videoRenderer items, and a
  continuation token (decode: field 2 "FEhashtag" + field 3 the continuation
  id). Continuation pages POST back `{continuation}` and answer
  `onResponseReceivedActions[0].appendContinuationItemsAction
  .continuationItems` (37 more items + the next token — verified live).

## G19 — mixes / radios

- Search results (live `search` POST, "lofi hip hop beats"): mix entries are
  **lockupViewModel** with `contentId` `RD…` (measured `RDn61ULEU7CO0`,
  `RDAT…`); titles "Mix - <video title>" / "Mix • <title>".
- The mix lockup's thumbnail carries a **bottom-end overlay badge with the
  MIX icon + text "Mix"** and a "Play all" hover overlay. Metadata rows: the
  channel byline ("LoFi GIRL, Burbank, Lo-Fi Beats, and more") + "Playlist",
  sample videos with durations, each linking
  `/watch?v=<id>&list=RDn61ULEU7CO0&start_radio=1`.
- **The whole-lockup click = "start radio"**: the primary onSelect endpoint
  is `/watch?v=<seed>&list=RD<mixId>&start_radio=1`
  (watchEndpoint params `wAEB`/`OALAAQE=`). The `start_radio=1` URL param is
  the measured start-radio cue.
- **`/playlist?list=RD…` does NOT render a playlist page**: youtube.com
  answers **"This playlist type is unviewable."** (browser page + the browse
  `VL<RD…>` alertRenderer, measured identically at both layers). Mixes are
  watch-page constructs.
- The watch-page mix queue: `POST /youtubei/v1/next {videoId, playlistId:
  "RD…", params:"wAEB"}` → `contents.twoColumnWatchNextResults.playlist
  .playlist` = the queue panel: `title` ("Mix - …"), `shortBylineText` /
  `ownerName` ("YouTube"), `isInfinite: true`, `currentIndex`, `playlistId`,
  25 `playlistPanelVideoRenderer` items (seed video selected, indexText "▶"),
  and continuation tokens for the infinite autoload. The same seam serves a
  regular playlist in list order (measured: RDCLAK via `next` → 25 items,
  currentIndex 0, list order). Signed-out `next {playlistId:"WL"}` returns no
  panel (the special lists need the session — WebFlix's WL/LL queue rides the
  existing special-list read).
- The signed-out related rail for the measured video carries **zero** RD mix
  lockups (20 video lockups, no playlist-class entries) — the related-rail
  mix card could not be reproduced this run; search-results mix cards and the
  start-radio affordance are the measured surfaces (recorded honestly).
