# WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — M3 evidence (2026-11-04)

Commit under test: working tree on main @ 84d84cf + this rung's changes (pre-push).
Browser: headless Chromium via agent-browser, 1440x900 + 375x812, Linux sandbox.
Station: dev :3000 (db re-seeded this session — the M2 import row died with the
reset; the browser profile's curator cookie still resolves a live session,
writes ride the shadow-identity law as designed).

## Rung scope (the work order's M3: UX and source capabilities)

- Source-aware save/share: the rail's ⋯ More menu ships Save to my shelf
  (the per-item form of the M2 import), the session-local Not interested,
  the honest outbound Report on TikTok, and Copy TikTok link.
- Deep-link pass: TikTokCard + the search shelf Browse link open the shared
  Shorts experience at the canonical hrefs (no legacy `/tiktok/v/<id>` hop).
- The home TikTok shelf: responsive tiles near the home Shorts shelf,
  deep-linking every tile into the shared feed; graceful-hide everywhere.
- The old isolated page de-emphasized: the /tiktok hub leads with the
  "TikTok now lives in Shorts" hand-off (CTA → /shorts?source=tiktok).
- A11y: focus rings on every new control, motion-reduce guards, sr-only
  fallback text; the honest capability-map law updated (canReport for
  TikTok = the outbound posture — TikTok owns moderation of its content).

## Verified live (real browser)

1. HOME SHELF: `/` renders the TikTok shelf beside the Shorts shelf with the
   honest scope subtitle ("curated and community-imported posts"); 17 tiles
   (the reseeded universe — no fabricated count); every tile href is
   `/shorts?source=tiktok&post=<id>` (checked tiles[0] and tiles[16]);
   clicking tile[0] navigated to the shared feed AT that post.
2. THE ⋯ MENU: opening slide 1's More menu lists exactly
   ["Save to my shelf", "Not interested", "Report on TikTok",
   "Copy TikTok link"] — and ZERO like/dislike/comment/follow entries.
3. SAVE (signed-in, curated post): the click POSTed
   `/api/tiktok/import {url: <canonical>}` and answered the honest no-op —
   toast "Already in every viewer's TikTok feed"; DB row count unchanged
   (the curated law, live).
4. NOT INTERESTED: the active slide LEFT the viewing (12 → 11 slides,
   verified by count + text absence); session-local by design.
5. REPORT ON TIKTOK: opened a NEW TAB to the post's deep link
   (t2 = tiktok.com/hk/about — TikTok's own geo-landing; the outbound
   action itself is the honest posture in the walled sandbox).
6. M2 PATH REGRESSION THROUGH THE M3 STAMP OVERLAY: import
   (@scout2015/video/7419999999999999999 via the Add-TikTok dialog) →
   spliced first with chip "Only you"; the visibility FLIP re-rendered the
   chip to "Imported" + toast; the composed universe followed
   (rail 17→18; home shelf 0-then-18 — the 0 was the client fetch in
   flight); /api/tiktok/rail count 18; REMOVE un-listed everywhere
   (rail 17, DB rows 0). The unified viewer-stamp overlay re-renders
   flips/saves for EVERY row source (client splice, cursor pages, AND the
   server-composed seed) — the M2 seed-row stamp gap is closed.
7. OWNER MANAGE ON RELOAD: the public import rides the server-composed
   seed at its composition depth (row 18, beyond the 12 rendered rails —
   NOT a stamp gap; verified by the deep link, which splices it first and
   renders flip+remove on the owned row).
8. HUB DE-EMPHASIS: /tiktok leads with the hand-off banner
   ("TikTok now lives in Shorts — one vertical feed for every source.") +
   "Open in Shorts" CTA → /shorts?source=tiktok; the grid's first card
   deep-links straight to the feed at its post.
9. SEARCH: /search?q=scout — the TikTok shelf's Browse link is
   /shorts?source=tiktok; its cards deep-link the feed at each post;
   the no-matches law renders nothing (test-pinned).
10. YOUTUBE REGRESSION: the selector flip → /shorts (replace, scroll:false),
    25 YouTube slides render, YouTube chip selected.
11. RESPONSIVE: documentElement.scrollWidth == clientWidth (0px overflow)
    on /, /shorts?source=tiktok and /tiktok at 375x812.
12. CONSOLE: cleared + fresh reload of /shorts?source=tiktok → ZERO page
    errors and ZERO console errors (the mid-session error lines in the
    earlier capture were stale artifacts of a transient broken-compile
    window while editing, recompiled clean before any of the checks above).

## Gates (commands + exit codes)

- `bun run typecheck` → 0 errors (exit 0).
- `bunx eslint <10 touched files>` → 0 problems (exit 0).
- `bun run test:tiktok` → 124 + 14 = **138 pass / 0 fail** (111 → 125 → 138;
  +5 shorts-feed M3 pins, +4 card-deeplink, +4 home-shelf).
- `bun run test` (FULL battery, foreground-to-file /tmp/full-battery.log,
  exit 0) → **2929 pass / 0 fail** (2916 + 13); live lanes
  2/27/89/91/27/20/77/36/15/13/8/11/11/8/11 — the NINTH consecutive exact
  per-lane sequence.

## Test pins added (the M3 laws)

- tiktok-shorts-feed.test.tsx: the ⋯ menu's honest capability set and the
  zero-write-claims law INSIDE the menu; the guest Save AU-gate
  (no POST fires; the /signin?redirect= deep-link back); the signed-in Save
  riding the canonical URL + the owned stamp re-render; Not-interested
  removing the slide for the session; Report-on-TikTok opening the
  deep link.
- tiktok-card-deeplink.test.tsx: the card's canonical feed href; the
  outbound link stays user-initiated; the search Browse law; the honest
  absence on no matches.
- tiktok-home-shelf.test.tsx: the shelf renders the rail universe with the
  not-a-recommender subtitle; every tile deep-links; metadata-less posts
  render the honest fallback (no fabricated identity); the graceful-hide
  law (empty/error → nothing).

## Standing blocked point (unchanged, operator-gated)

Real in-sandbox TikTok playback stays geo-walled (the M1 record — the
player document redirects to TikTok's region landing). M3 changes no
playback surface; every affordance verified here rides the honest lanes.
The first real viewer-network playback proof remains with the production
deploy or any non-walled egress.

## Money gate

CLOSED — nothing money-shaped touched.
