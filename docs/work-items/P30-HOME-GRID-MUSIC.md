# P30-HOME-GRID-MUSIC — the home-grid density + interleave pattern + music destination lane

Dispatched: 2026-10-20 (afternoon), by the resident TL station **for itself** (direct
execution — the worker channel stays idle post-P25; the lead-merges law). Base:
`93e6eee` (origin/main — P29-STREAM-REGEN merged).

## The operator's report (verbatim)

> the long format video boxes need to be bigger such that 3 fit in one row (check
> youtube.com for reference)
> the music page also looks different from the music page on the music page on the
> reference site (youtube.com)
> the home page should be:
> one row of long format video boxes
> one row of long format video boxes
> one row of short video boxes
> one row of long format video boxes
> one row of short video boxes
> one row of long format video boxes
> one row of long format video boxes
> one row of continue watching
> one row of long format video boxes
> ... (infinite scrolling)

## The reference measurements (live, 2026-10-20)

- **youtube.com/music** probed live from this egress (agent-browser, 1512×850):
  resolves to the Music channel surface — the channel-style header (the banner
  art strip, the overlapping circular avatar, the name, the Home/Posts tab row)
  + THE SHELF FAMILY of SQUARE lockups (playlist covers measured 249px, 1:1,
  rounded, title + "N songs"-style meta beneath — never the regular 16:9 home
  grid; shelves measured as `ytd-rich-section-renderer`s with ~4 covers visible
  per viewport).
- The **3-per-row density** is the operator's explicit number ("bigger such
  that 3 fit in one row"); the previous grid's `2xl:grid-cols-4` tier showed
  4-up on wide viewports — that tier is retired so the desktop density caps at
  THREE bigger boxes at every width.

## The deliverables

1. **The 3-up grid** (`src/components/home/recommended-grid.tsx` +
   `home-feed.tsx`'s skeleton): the long-format grid is
   `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — no 4-up tier anywhere. At
   1512px the cards measure ~397px wide (vs ~300px at the old 4-up): bigger
   boxes, exactly 3 per row.

2. **The operator's interleave pattern** (`src/components/home/home-feed.tsx`):
   rows 1-2 (6 cards) → SHORTS row 3 → row 4 (3 cards) → SHORTS row 5 →
   rows 6-7 (6 cards) → the continue-watching rail (row 8) → THE GROWING GRID
   (row 9 onward, the infinite-scroll feed) → the sentinel directly beneath —
   the P27 law held together with the new rhythm (appended pages still land
   BELOW the user's viewport). The TWO shorts rows split the feed's short deck
   at its midpoint (12 shorts → 6 + 6): the second row shows NEW tiles, never
   a repeat (the duplicate-shelf disease stays dead). The because-you-watched
   and trending rails are GONE from the home page — the operator's composition
   has neither, and neither does youtube.com's home (trending keeps its own
   destination at /trending; the /api/home DTO still carries both fields for
   other consumers). A category filter hides BOTH shelves (youtube.com's own
   law — shorts ride the unfiltered home only), collapsing the five long rows
   into one 15-card opening grid.

3. **The music destination** (`/music`, the podcasts-destination pattern):
   - `src/app/music/page.tsx` — the ISR shell (revalidate 3600, chrome static,
     data client-fetched from the dynamic route by law).
   - `src/app/music/view.tsx` — the measured reference's shape: the
     channel-style header (the warm-family gradient banner — no indigo/blue,
     the house law — the overlapping circular avatar disc, the "Music" name,
     the subtitle, the Home tab row with aria-current), the publicMode honest
     line, and THE SHELF FAMILY: one shelf per Music seed query, square (1:1)
     lockups (200-264px, center-cropped covers, rounded-xl, duration/LIVE/
     members badges, title + channel + views·age beneath) riding the SAME
     `useHoverPreview` ladder as every other card (`[data-thumb-anchor]`).
     NO sentinel and NO chips — the one-page law the podcasts destination set
     (zero continuation exists; neither affordance is fabricated).
   - `src/lib/youtube/music-destination.ts` — the compose: one REAL search
     first page per Music seed query (`EXPLORE_CATEGORY_SEEDS.Music` — the
     ONE seed table, so the destination and the category compose can never
     drift; each page rides the EXISTING per-query cache the category pool
     reads), kept PER SHELF (the shelf titles are the seed queries
     themselves, sentence-cased — never invented), type=video, non-shorts,
     de-duplicated ACROSS shelves (a card renders once on the page — the
     first shelf that found it keeps it), 12 tiles per shelf; a failed query
     degrades honestly (that shelf empty); only when EVERY query fails does
     the compose throw (the route's honest 502).
   - `src/app/api/music/route.ts` — the rate-limited dynamic route (the
     podcasts route's sibling), `source: "search"`, `publicMode`.
   - `src/lib/categories.ts` — `categoryDestination("Music")` → `/music`
     (the same dedicated-destination law as Podcasts: the sidebar, the
     explore hub — whose Music card now carries destination copy — and the
     category chip row all route there; the composed
     `/explore/category/Music` grid stays reachable; the HOME chip keeps
     filtering home (`/?category=Music`) — youtube.com's home chip stays on
     home).

## The verification (station-run)

- **Gates**: `bun run test` = **1948/0** (base 1932 + 16 new: the music
  destination battery +14 — the header/shelves/lockups/honest-edges view pins
  + the compose pins through the mocked `getSearchVideoPage` seam — the
  home-feed-order battery re-pinned +1 net, categories +1; boot 840 + watch
  637 + liveshorts 150 + cutover 108 + auth 138 + community 34 +
  notifications 41), lint 0 errors / 1 pre-existing warning, tsc clean, PAT
  scan clean.
- **Dev-ladder live verification** (`:3105`, the lane branch): the home read
  in-browser — the section order EXACTLY the operator's pattern (grid →
  Shorts shelf → grid → Shorts shelf → grid → grid-growing → sentinel; the
  continue-watching rail honestly empty in public mode — no session, no
  history), the grid counts [6, 3, 6, 9], **3 columns at 1512px with 397px
  cards**, the two shelves [6, 6] tiles DISJOINT with different first tiles;
  the golden path scrolled end-to-end — MAIN scrolled to the bottom → the
  sentinel fired → the tail grid 9→21 cards (12 new, the limit) with the new
  titles at the BOTTOM and the scrollHeight extending 4186→5598 while the
  opening blocks stayed exactly [6, 3, 6]; the music page read in-browser —
  the banner + avatar + Home tab + publicMode line, the three shelves
  ("Music videos" 12 / "New music" 7 / "Live music" 12 — real seed-order
  titles, real videos) with **264×264 square lockups**, no sentinel, no
  chips; ZERO page/console errors on both surfaces. Evidence:
  `evidence/wfx2p30/{home-pattern-3up-two-shelves,music-destination-square-shelves}.png`.
- The browser pass ran with mission-watch paused (the ledgered OOM protocol);
  it was restarted after.

## Files touched

`src/components/home/home-feed.tsx` (the pattern + the rail removal + the
skeleton), `src/components/home/recommended-grid.tsx` (the 3-up cap),
`src/app/music/page.tsx` + `src/app/music/view.tsx` (NEW — the destination),
`src/app/api/music/route.ts` (NEW — the route),
`src/lib/youtube/music-destination.ts` (NEW — the compose),
`src/lib/types.ts` (MusicShelfDTO + MusicDestinationDTO),
`src/lib/categories.ts` (the Music destination routing),
`src/app/explore/view.tsx` (the hub's Music destination card copy),
`tests/home-feed-order.test.tsx` (the re-pinned order battery),
`tests/music-destination.test.tsx` (NEW — the 14-pin destination battery),
`tests/categories.test.ts` + `tests/explore-layout.test.tsx` +
`tests/yt-discovery.test.ts` (the destination pins re-pointed),
`package.json` (test:boot gains the music battery), `evidence/wfx2p30/`
(the two proofs), `docs/work-items/P30-HOME-GRID-MUSIC.md` (this packet),
`docs/plans/wave-claims.md` (the ledger row), `WORKLOG.md` (the lane record).
