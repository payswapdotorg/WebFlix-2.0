# P25-PODCASTS-SHORTSAI — the podcasts surface + the Shorts-AI honest verdicts (G13–G15)

dispatched: 2026-10-19 by the resident TL station (ring-down era, Task ID 40;
base 8ad173b — the P24-SEND merge + ledger row; scope G13–G15, the parity
audit's P25 wave).

## THE WORK ORDER (verbatim)

You are the ring-down implementation worker for the WebFlix 2.0 lane
P25-PODCASTS-SHORTSAI (Task ID: 40). You write real code, run real gates, and
push a real branch. This dispatch is authorized by the resident TL station
under the operator's standing 2026-10-15 directive: "Use the existing pat,
this is an informed decision I'm making. Also focus on feature parity of the
web app with youtube.com."

- **G13 — Podcasts dedicated surface**: webflix-2.0 today has only the explore
  category (Podcasts category card). youtube.com ships a dedicated podcasts
  browse surface. MEASURE the real read from this egress first (e.g.
  https://www.youtube.com/podcasts — parse the served ytInitialData; note the
  known egress lesson: the un-logged-in egress sometimes flattens feed surfaces
  to a FEwhat_to_watch shell — the REA-3B F8 record in WORKLOG.md is the
  precedent; whatever the read answers is the truth you implement against). If
  the surface is measurable: implement the dedicated podcasts page on the house
  browse/grid family (header + grid + sentinel scroll + honest states; real
  playlist/video targets from the response; honest source labels; URL-synced
  chips only if measured). If the read is walled/flattened from this egress:
  the honest-absent disclosure law (a note with the measured reason, like the
  P24 lanes' honest-stop family) — NEVER a fabricated grid.
- **G14 — Shorts conversational editing (2026, AI first-draft)**: depends on
  the merged P23-B LLM seam (src has the env-keyed llm-seam + ask-service +
  ask-panel — grep `llm` in src/lib). MEASURE what is actually reachable of
  youtube.com's 2026 Shorts AI editing family from this egress (the editing
  drive is studio/app-side — likely login-walled or unreachable; the honest
  measurement decides). Where a seam-backed surface is measurable and grounded
  in the app's real LLM seam (env-keyed, honest degradation when un-keyed —
  the P23-B law), build the bounded honest version. Where it's studio-walled:
  the honest-absent disclosure (the P24 G11 precedent — invented-shape law
  forbids guessing a drive; a local editor that cannot save anything to
  youtube.com would be a fake affordance).
- **G15 — the defer-ledger review**: re-examine the audited defer item (Shorts
  captions/playback-speed in the ⋯ menu — player-bound by the embed
  `controls=0` limit) and re-record its verdict honestly (expected: stays
  deferred — it needs the player ladder's own rung, not a UI patch; but
  re-derive it, don't copy it).
- OUT of scope (the accumulated parity-debt ledger — leave ledgered, do not
  touch): channel themed shelves, guide Music/Kids rows, URL-driven channel
  tabs, the go-live control-room, Super Thanks watch-page display, studio
  scheduling captures, G15's player rung itself.

## THE STATION'S LAWS (every one is load-bearing — unchanged from P24-SEND)

1. **One lane = one branch.** Never touch main. Never merge. Never
   force-push. Branch: `wfx2/p25-podcasts-shortsai`.
2. **Packet-first (the two-incarnation resilience law):** this packet is the
   FIRST commit; a future incarnation must be able to complete the lane from
   it alone.
3. **Baseline before WIP (the P26-HPV2 law):** on the clean base BEFORE any
   work-in-progress, reproduce the gates: `bun run lint` → 0 errors / 1
   pre-existing warning (tests/search-layout.test.tsx:52); `bun run
   typecheck` → clean; `bun run test` → 1884 pass / 0 fail = 796 (41 files) +
   617 (38) + 150 (9) + 108 (9) + 138 (7) + 34 (1) + 41 (2). REPRODUCED this
   run exactly (2026-10-19, base 8ad173b, clean tree).
4. **Commit after every green family.** Never carry uncommitted WIP across
   long spans (the Task-37 incarnation-1 lesson).
5. **Fixtures-only tests, zero new test files.** Every new pin goes into the
   EXISTING suites. No live calls in tests. No `/player` endpoint. Live calls
   only in running routes (rate-limited + cached).
6. **YouTube is the user-data source of truth.** Honest degradation only —
   never fabricated data, never a fake affordance, never an invented shape
   (measure first; if unmeasurable, the honest-absent disclosure with the
   measured reason).
7. **PAT discipline:** the GitHub PAT lives at
   /home/z/my-project/download/recovery/github_pat.txt — read into a shell
   variable ONLY at push time; NEVER echoed, NEVER committed, NEVER pasted
   into any file. In this packet and every record:
   [REDACTED:github_token]. Before the final push: a PAT scan over the full
   lane diff (`git diff origin/main...HEAD`) — clean by pattern AND by value.
8. **Port discipline:** the station owns :3000. Dev server :3105 ONLY
   (`DATABASE_URL=file:../db/webflix2.db bunx next dev -p 3105 > /tmp/wfx2-dev.log 2>&1 &`).
   Never bind 3000; never kill processes you don't own; never touch
   /home/z/my-project/src or /home/z/my-project/db/repo-mirror.
9. **The Task-tool deadline law:** bank everything at milestones (commits +
   records). A tool-call timeout is NOT a death — finish the work; the
   artifacts are the truth.

# THE STATION EVIDENCE PACK (measured 2026-10-19, this sandbox egress —
# re-run the probes yourself; they are the binding baseline)

All probes: plain curl (Chrome UA, the repo's BROWSER_UA family) +
ytInitialData regex parse (the ssr.ts extractor's own pattern) + innertube
POSTs with the repo's WEB client shape (clientVersion 2.20260925.08.00).

## G13 — the podcasts destination surface (MEASURABLE — rich, not flattened)

- **https://www.youtube.com/podcasts** → 200, ~202KB (two fetches: 201,829B
  and 204,269B — the shape identical both times). The served ytInitialData:
  `responseContext.serviceTrackingParams[GFEEDBACK].browse_id =
  "FEpodcasts_destination"`, `logged_in=0` — this is NOT the REA-3B
  FEwhat_to_watch nudge shell; the surface serves its real public shape:
  - `contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.
    richGridRenderer` with 13 `richSectionRenderer` → `richShelfRenderer`
    shelves and **ZERO continuationItemRenderer / continuationCommand**
    anywhere in the page (the surface is one page — no infinite-scroll
    continuation is measurable).
  - `header.pageHeaderRenderer.pageHeaderViewModel`: title "Podcasts" (+
    an animated avatar artwork URL — cosmetic, not mapped).
  - The 13 shelves measured (titles verbatim): **"Popular episodes"** (24
    videoRenderer), **"Popular podcasts"** (24 lockupViewModel
    LOCKUP_CONTENT_TYPE_PODCAST), **"Live now"** (24 videoRenderer), the
    topic shelves **"Ghost stories" (12), "Wealth" (8), "Stock markets"
    (18), "Economics" (19), "Finances" (10), "Psychology" (7), "Health
    care" (5), "AI" (4), "Vocabulary" (5)** (videoRenderer), and **"Popular
    podcast creators"** (24 gridChannelRenderer). The topic-shelf set is
    egress/locale-shaped (HK egress) — the mapper follows whatever the
    response carries, never a hardcoded list.
  - **videoRenderer** (episode cards): the standard shape `mapVideoRenderer`
    already maps (videoId, title.runs, thumbnails, longBylineText with the
    channel browseEndpoint + /@handle, viewCountText "10,523 views",
    publishedTimeText "Streamed 1d ago", lengthText "6:25:42"; menu =
    Add to queue / Save to playlist / Download — the logged-out card-menu
    family).
  - **lockupViewModel** (podcast SHOW cards): `contentId` = the PLAYLIST id
    (PL…), `contentType: LOCKUP_CONTENT_TYPE_PODCAST`; the square
    collection thumbnail (`pl_c/<PL…>/studio_square_thumbnail.jpg`); the
    overlay badge carries the episode count ("139 episodes"); metadata
    rows = publisher name (commandRuns → /@handle channel browseEndpoint;
    CHECK_CIRCLE_FILLED attachmentRun = verified) · "Updated today" ·
    "View full podcast" (commandRun → `/playlist?list=<PL…>`); the card's
    own onTap → watchEndpoint {videoId, playlistId} →
    `/watch?v=<videoId>&list=<playlistId>` (the "Play all" form).
  - **gridChannelRenderer** (creator cards): channelId, title, avatar
    thumbnails, subscriberCountText ("4M subscribers"), videoCountText
    ("5,014 videos"), navigationEndpoint → /@handle; subscribeButton → the
    logged-out sign-in modal.
- **InnerTube browse `browseId: FEpodcasts_destination`** → 400
  INVALID_ARGUMENT ("Request contains an invalid argument") — the API browse
  form is NOT available; the SSR HTML read is the real seam (the same
  mechanism as trending's ssr.ts read).
- **https://www.youtube.com/feed/explore** (the hub) → 200, ~99KB, the
  REA-3B flattening confirmed from this egress (feedNudgeRenderer ×2, ZERO
  category cards, ZERO "Podcasts" strings) — the app's Explore hub stays its
  own honest composed surface; its Podcasts card is an app-side destination
  decision, grounded by youtube.com's real destination: /podcasts.
- **App-side targets verified real:** `/watch?v=<id>&list=<PL…>` IS the
  app's real form (the watch page builds the ?list= queue panel —
  REA-1 G16/G19); `/playlist/<PL…>` is the app's real playlist surface
  (P22-B); `/channel/<handle>` is the real channel surface.

## G14 — youtube.com's 2026 Shorts AI editing family (studio/app-walled — measured)

- **The shorts reel sequence** (search seed "podcast shorts" → 25
  shortsLockupViewModel → sequenceParams → POST reel/reel_watch_sequence →
  200, 155,686B): the topbar ⋯ sheet (listViewModel, path
  `entries[0].command.reelWatchEndpoint.unserializedPrefetchData.
  reelItemWatchResponse.topbar.topBarViewModel.trailingButtons[1]…`) =
  **Description / Save to playlist / Captions [selection: Off] / Full
  screen / Playback speed / Report / Send feedback** — ZERO AI-editing
  entries. The rail (reelActionBarViewModel.buttonViewModels) = like /
  comments / share / **Remix (REMIX_FILLED, state
  BUTTON_VIEW_MODEL_STATE_DISABLED, onTap → addToToastAction "Feature not
  available for this video" — youtube.com's own honest-degrade for this
  short)** / the sound pivot. The payload's only "AI" string hits are
  tracking-param/base64 artifacts — no AI feature surface exists in the
  shorts data layer logged-out.
- **https://www.youtube.com/shorts** SSR → 200, ~90KB: the reel surface
  shell (overlay/status/replacementEndpoint/sequenceContinuation) — ZERO
  "AI edit" / "Gemini" / "first draft" / "Create a Short" / "Shorts camera"
  strings.
- **https://www.youtube.com/shorts/create** → **404** logged-out (the web
  shorts-camera URL serves no public surface).
- **https://studio.youtube.com** → **302 → accounts.google.com
  ServiceLogin** (login-walled, measured).
- **App-side truth:** WebFlix has NO shorts-creation flow (the upload wizard
  is long-form only; the broker registry carries no remix/shorts-creation
  kind — verified by the P23-C G6 record); the P23-B LLM seam is a READ-side
  answer/summary seam (env-keyed, honest degradation) — a local "AI edit"
  surface would be an editor that cannot save anything to youtube.com: the
  fake-affordance law applies. G14's honest deliverable = the honest-absent
  disclosure with the measured reason (the P24 G11 precedent), surfaced on
  the rail's Remix entry (youtube.com's own shorts-creation entry point —
  measured: the Remix button IS where the editor family opens on
  youtube.com's shorts surface).

## G15 — the shorts ⋯ sheet re-probe (the defer item re-derived)

- The measured sheet (this run, 2026-10-19): "Captions" carries
  `selectionText: "Off"` + `showCaptionLanguageSelectActionCommand`;
  "Playback speed" rides the same player-command family. These are
  PLAYER-BOUND commands — they drive the native shorts player youtube.com's
  own page runs. WebFlix's shorts player is the embed iframe with
  `controls=0` (shorts-player-slot.tsx) which exposes NO caption/speed
  control seam to the host page.
- The player ladder's rung 2 (P26-HPV2's native innertube chain) exists
  ONLY as the wall fallback (PlayerFallback), not the primary shorts
  player — wiring captions/speed only on the walled path would be an
  inconsistent two-faced control; a ⋯-menu item that cannot work on the
  primary player is a dead control (forbidden).
- One drift note vs the P24 packet's sheet record: today's sheet carries NO
  "Audio Track" item (the P24 evidence pack listed it) — the sheet family
  is per-short/per-locale variable; the honest absence note stays keyed to
  the two audited items only.
- **Re-derived verdict: STAYS DEFERRED** — the defer ledger's reason stands
  on fresh measurement: the item needs the player ladder's own rung (a
  native player as the PRIMARY shorts player with real caption/speed
  control), not a UI patch in the ⋯ menu.

# SETUP (exact — all repo commands from /home/z/my-project/db/repo-mirror-wfx2)

1. cd /home/z/my-project/db/repo-mirror-wfx2
2. `git fetch origin` → `git rev-parse origin/main` MUST be 8ad173b… (else
   STOP: the stale-brief replay law). REPRODUCED this run:
   8ad173b60db2d1d797ed07cb22c64d028f5dd16e.
3. `git checkout -b wfx2/p25-podcasts-shortsai 8ad173b`
4. THIS packet committed first:
   "docs(work-item): P25-PODCASTS-SHORTSAI packet — ring-down dispatch 2026-10-19 by resident-TL, base 8ad173b, the podcasts surface + the Shorts-AI honest verdicts"
5. Baseline gates BEFORE any edit (REPRODUCED this run on the clean base):
   lint 0 errors / 1 pre-existing warning; typecheck clean; tests 1884/0
   = 796 + 617 + 150 + 108 + 138 + 34 + 41.
6. Dev server (only if needed): :3105 ONLY (the command in law 8).
7. Push (PAT never echoed):
   `PAT=$(cat /home/z/my-project/download/recovery/github_pat.txt) && git push "https://$PAT@github.com/payswapdotorg/webflix-2.0.git" wfx2/p25-podcasts-shortsai:refs/heads/wfx2/p25-podcasts-shortsai`
   (a moved-URL casing report on the push is benign — the push still lands).

# THE WORK — family by family (order G13 → G14 → G15; the reason: G13 is the
# only implementation family — the surface is measured rich and real; G14/G15
# are the honest-verdict families, each riding G13's commit rhythm)

## G13 — the dedicated podcasts page (the measured surface, house browse family)

- **Data layer** `src/lib/youtube/podcasts.ts` (the ssr.ts read + the
  trending-categories.ts cached pattern): `getPodcastsPage()` = one cached
  (`yt:podcasts:destination`, TTL.FEED_MS) SSR read of `/podcasts` via
  `fetchYtInitialData`, parsed into the DTO family: page title (the
  pageHeaderViewModel's "Podcasts"), the shelf list in document order
  (title + its episode VideoDTOs via the EXISTING mapVideoRenderer + its
  show lockups + its creator cards). Per-item honesty: an item that fails to
  map is skipped (never a fabricated slot); a shelf with zero mapped items
  is dropped; the whole read throws only when the SSR fetch itself fails
  (the route's honest 502). NO continuation machinery — the measured page
  carries none (never a fabricated sentinel loop).
- **DTOs** in `src/lib/types.ts` (the ExploreCategoryPageDTO neighborhood):
  `PodcastShowDTO` (playlistId, title, publisher name/handle/verified,
  episodeCountText, updatedText, thumbnailUrl, playAllVideoId),
  `PodcastCreatorDTO` (id, handle, name, avatarUrl, subscriberCountText,
  videoCountText), `PodcastShelfDTO` (title + episodes/shows/creators),
  `PodcastsPageDTO` (title, shelves, source:"ssr", publicMode).
- **Route** `GET /api/podcasts` (force-dynamic, rate-limited, publicMode =
  !hasSession(), 502 on the honest upstream failure — the
  explore/category/route.ts idiom).
- **Page** `/podcasts` (ISR shell revalidate 3600 + the client view): the
  header (Mic icon + the response's own title), the honest source label,
  the shelves in order — episodes ride the house `VideoCard` rail variant
  (real /watch targets), shows render the square show card (episode-count
  badge + publisher + updated text; the card links the MEASURED Play-all
  form `/watch?v=<playAllVideoId>&list=<playlistId>`; the publisher links
  `/channel/<handle>`), creators render the channel card (avatar + name +
  subscriber/video counts → `/channel/<handle>`). Honest states: skeletons
  while loading, role=alert error, the empty note. NO sentinel (nothing
  measured to scroll), NO chips (none measured).
- **Destination seam**: `categoryDestination("Podcasts")` → `/podcasts` (the
  sidebar Explore rung + the Explore hub card + the category-page chip row
  all ride this one function — youtube.com's own Podcasts destination is
  the dedicated surface, measured). The home chip row keeps its own family
  (`/?category=Podcasts` — youtube.com's home chip stays on home).
  `/explore/category/Podcasts` stays reachable (the app's composed
  category-browse mechanism — real search data, honestly labeled; it is
  simply no longer the Podcasts destination).
- **Tests** (fixtures-only, zero new test files): the sanitized REAL capture
  `tests/fixtures/yt/podcasts_destination_public.json` (trimmed to 2–3 items
  per shelf, exact shapes); the data-layer pins in
  `tests/explore-categories.test.ts` (the shelf walk + the three card
  mappers + honesty on unmappable items); the route pins in
  `tests/explore-category-api.test.ts` (the setUpstream-served fixture HTML
  → the DTO contract + publicMode + the honest 502 + rate-limit); the view
  pins in `tests/explore-layout.test.tsx` (the header + shelves + real
  targets + honest states + NO sentinel); the destination pins in
  `tests/categories.test.ts` (Podcasts → /podcasts; every other category
  unchanged).

## G14 — Shorts conversational editing (2026) — the honest-absent disclosure

- The measured basis (the evidence pack above): the editing family is
  studio/app-side (studio 302 → login; /shorts/create 404; the reel
  payload + the /shorts SSR carry ZERO AI-editing entries; the Remix button
  is youtube.com's own shorts-creation entry and THIS egress's measured
  short renders it DISABLED with youtube.com's own honest toast).
- The deliverable (the P24 G11 form, on the rail's Remix entry — youtube.com's
  own editor-family entry point): the honest-absent disclosure — the Remix
  click surfaces the measured reason ("Shorts creation is not available in
  WebFlix — YouTube's Shorts editor (incl. the 2026 AI editing family) is
  studio/app-side"), the entry keeps youtube.com's own disabled honest form
  (aria-disabled, never faking work), and the rail's honest-absence ledger
  comment gains the G14 record (the measured basis + the P23-B seam's
  read-side scope + the fake-affordance derivation).
- NO new surface is invented: no "AI edit" ⋯ item (youtube.com's measured
  sheet carries none), no local editor (cannot save to youtube.com — the
  fake-affordance law), no LLM-backed editor affordance.
- **Tests**: the pins in `tests/shorts-sound-rail.test.tsx` (the upgraded
  honest toast text + aria-disabled + zero editing affordance in the rail
  and the ⋯ menu).

## G15 — the defer-ledger review (re-derived, recorded)

- The re-derivation (the evidence pack above): the measured sheet's
  Captions/Playback-speed items are player-command-bound; the app's shorts
  player is the embed (`controls=0`, no host-page control seam); the native
  ladder exists only as the wall fallback — a two-faced control or a dead
  item, either way forbidden. Verdict: **STAYS DEFERRED** (needs the player
  ladder's own rung — a native primary shorts player — not a UI patch).
- The deliverable: the refreshed honest-absence note (the re-derived basis,
  dated this measurement) + the record in the lane WORKLOG entry + the
  defer ledger's row stays in the audit matrix untouched (the matrix is
  lead-owned).

# LAWS (non-negotiable)

- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint.
- Honest degradation only — never fabricated data, never a fake affordance,
  never a dead control, never an invented shape.
- One lane = one branch (wfx2/p25-podcasts-shortsai). Never touch main,
  never merge, never force-push, never `bun run build`.
- Commit + push at every milestone (the two-incarnation resilience law).
- The claims ledger docs/plans/wave-claims.md is LEAD-OWNED — do not edit.
- The lane record goes in WORKLOG.md (repo root), appended at the END, the
  house format (the P24-SEND entry is the reference). The closing line:
  "Branch: wfx2/p25-podcasts-shortsai pushed (N commits on base 8ad173b:
  …). Do not merge — the station reviews, gates, and merges."
- The PAT: [REDACTED:github_token] everywhere in records; the pre-push PAT
  scan over the full lane diff (pattern + value).

# VERIFICATION (exact numbers in the final report)

- `bun run lint` → 0 errors (the ONE pre-existing warning only)
- `bun run typecheck` → clean
- `bun run test` → 1884 + N new / 0 fail, zero regressions
