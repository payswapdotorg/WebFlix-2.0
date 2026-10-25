# P50-NETFLIX-SEARCH-PAGE — the in-hub Netflix search + the country aisle

Phase: P50
Operator instruction: "work further on integrating netflix videos" → "go"
Status: SHIPPED (commit recorded in WORKLOG)

## The gap

Netflix's own nav carries two browsing affordances WebFlix's Netflix hub
lacked:

1. **Search** — until P50 the only Netflix search surfaces were the global
   topbar suggest (≤3 badge rows, P49) and the shelf riding the YouTube
   search page (P42). There was no place to *search Netflix inside the
   Netflix hub* — the most basic native surface.
2. **Country** — the pools carry per-country ranks (~93 markets ride along
   on every Tudum fetch), but the hub's chips exposed only Global + US.

## Part A — `/netflix/search` (the search page)

- `src/app/netflix/search/{page,view}.tsx` — ISR shell + client view, the
  house pattern. The query lives in the URL (`/netflix/search?q=…`):
  shareable, and the box initializes from it (the topbar suggest and the
  YT-search shelf can land here with `q` already set).
- **Debounced live search** (300 ms) — Netflix's own box searches as you
  type; the commit goes through `router.replace` (scroll preserved), the
  form submit and the clear button commit immediately.
- Results render as `NetflixCard`s (the same hover-expand cards the hub
  rows use — the Play sibling stays the direct in-app watch link
  `/netflix/watch/<id>`), with a count line and the DTO's honest scope note
  ("Netflix's official Top 10 & Most Popular universe…").
- **Kind tabs** (All / Movies / TV Shows) filter the ANSWERED set
  client-side — the hub sub-nav's contract, applied to search results.
- **Honest states only**: empty query → the prompt (what this searches);
  no matches → the honest empty note naming the scope and pointing at the
  hub + Netflix Live; upstream trouble → the error line; loading → the
  skeleton grid. Never a fake row.
- `useApi(null)` when the query is empty — the search API is not hit at all
  until there is something to search.

## Part B — the hub's native nav (P50 additions)

- **Search entry**: a magnifier toggle in the sticky sub-nav
  (`netflix-subnav-search-toggle`) expanding into an inline box
  (`netflix-subnav-search-input`); Enter commits to `/netflix/search?q=…`
  and the box closes and clears. Escapes nothing — it is a plain form.
- **The country aisle**: 14 chips (Global, US + GB, IN, BR, DE, FR, JP,
  KR, MX, ES, IT, AU, CA) — the markets Tudum tracks. The row scrolls
  horizontally (`no-scrollbar overflow-x-auto`) so 375 px stays at 0 px
  horizontal overflow. Flipping a chip re-queries `/api/netflix?country=X`
  exactly as the old two-chip row did (no API change — `railForPool`
  already re-ranked per country); rails carry the `· GB` country tag.
- **The honest empty aisle**: when a country/kind cut has no published rows
  (`!loading && rails.length === 0`), the hub renders
  `netflix-empty-rails` — "No Top 10 rows for this view right now … the hub
  stays honest rather than showing fake rows." (No live market is empty
  today — all 12 answered 3–6 rails — the state is battery-pinned for the
  day Netflix's own side leaves a cut empty.)

## Gates

- tsc clean · eslint 0 errors on every touched file (the one pre-existing
  warning in `tests/search-layout.test.tsx` is untouched and pre-dates
  P50).
- test:netflix **122/0** across 9 files (+7: the search-page battery
  `tests/netflix-search-page.test.tsx` — prompt/no-query, ?q= init + API
  URL, kind-tab filtering of the answered set, honest empty, URL commit via
  the house value-tracker sequence, clear button, the Play-sibling watch
  links; and +3 hub pins: a new market chip re-queries with its country
  code, the empty-aisle note, the sub-nav search commit — the existing
  chips-count pin moved 2 → 14).
- Full battery **2310 pass / 0 fail** across 9 suites.
- LIVE (sandbox, browser-verified): `/netflix/search` prompt → typed
  "doing" → URL committed → 1 real card (Doing Life) with the Play link
  `/netflix/watch/82023496` → garbage query → the honest empty note (note:
  multi-token queries honestly match per-token, so "zzqqxx no such title"
  answers 6 real titles — recall, not a bug); `/netflix/search?q=us` → 20
  real titles with art; the hub's magnifier → "doing" → Enter →
  `/netflix/search?q=doing`; United Kingdom / Japan chips → localized
  rails render with the `· GB` / `· JP` tags; mobile 375 px → 0 px
  horizontal overflow on both pages. Evidence: `evidence/wfx2p50/`.

## Ops note (the display-ghost lesson)

During P50's opening the session chased a phantom "torn declaration"
(`const andoffOpen…`) that appeared in EVERY bash-channel display of
`netflix-hero.tsx` and `netflix/t/[id]/view.tsx` — while tsc, the tests,
node/bun reads, and the Read tool all said the files were fine. Root
cause: **the bash tool's output channel eats `[h` sequences** (an output
sanitizer artifact) — hex dumps through node proved the on-disk bytes were
`const [handoffOpen…` all along, and the blob hash equality
(`hash-object == HEAD == origin/main`) proved the repo, HEAD, and GitHub
were healthy. Law: when a bash display shows impossible source
corruption, verify with `node -e` hex of the exact line + blob-hash
equality before touching anything. No fix commit was needed; the working
tree was never broken.

## Residuals

- The search answers the Top-10 mirror universe (unchanged scope from
  P42/P49) — a TMDB/uNoGS key would widen it (P43 lane).
- The sub-nav search box is a commit-into-the-page affordance (Enter),
  not a live dropdown — the global topbar suggest remains the
  typeahead surface (by design: two different destinations).
