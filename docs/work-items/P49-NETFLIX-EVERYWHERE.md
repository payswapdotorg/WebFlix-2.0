# P49 — NETFLIX EVERYWHERE: Continue Watching + the global suggest lane

Date: 2026-10-27 · Follows P48 · ADR 0002 remains the law.

## The directive

"work further on integrating netflix videos."

## The read

After P42–P48 the Netflix surface was complete but BOUNDED: you had to
already be on `/netflix` (or the `/search` shelf) to discover titles, and
the hub forgot you the moment you left — Netflix's two most familiar
personal/discovery behaviors were missing:

1. **Continue Watching** — the signature personalized row.
2. **Netflix in the global search box** — the one surface every visitor
   touches first.

Both work TODAY with zero external prerequisites (no E2B key, no bridge
session), which is exactly what the integration phase needed next.

## Part A — Continue Watching (honest-local play memory)

- **Prisma** `NetflixWatchEvent` (additive): `userId`, `netflixId`,
  `lastPlayedAt`, `playCount`; FK User + NetflixTitle (cascade);
  `@@id([userId, netflixId])`; `@@index([userId, lastPlayedAt])`.
  SQLite carries the same shape to Neon untouched.
- **`src/lib/netflix/progress.ts`** — `recordWatch` (mirror-row upsert
  first — the FK law, the same move My List makes — then the event
  upsert: a replay BUMPS playCount and refreshes lastPlayedAt, never
  stacks rows), `listContinueWatching` (newest-first, joined titles),
  `removeWatch`.
- **HONESTY LAW**: `playCount` is literally "you pressed play N times".
  The streamed player exposes NO playback position to WebFlix → NO
  percent-watched, NO fabricated red progress bar. The rail's meta line
  says "Last watched … · played N×" and the UI test pins the ABSENCE of
  a `<progress>` element.
- **`/api/netflix/progress`** — GET (anonymous → honest empty),
  POST `{netflixId}` (401 anon, 400 malformed, 404 outside the tracked
  universe), DELETE `?netflixId=` (the rail's remove affordance).
  Rate-limited, force-dynamic, the my-list envelope shapes.
- **WHO writes**: the watch lane's session kick (every entry/restart —
  fire-and-forget with `keepalive`, a failed write never blocks
  playback; the Live lane records nothing), and the hand-off dialog's
  deep-link click (watching on netflix.com is still a play).
- **The rail** (`src/components/netflix/continue-watching-rail.tsx`):
  Netflix's own placement (first personalized row, right under the
  billboard/sub-nav, before My List). Cards link STRAIGHT into the
  in-app watch lane (`/netflix/watch/<id>`, "Resume X in WebFlix"),
  hover shows the round Play, the X removes from the row (Netflix's own
  "Remove From Row"), the row re-reads its truth after removal and the
  last card leaving takes the rail with it. Anonymous/empty → absent,
  never a placeholder.

## Part B — Netflix in the global search suggest

- **`/api/search/suggest`** — ADDITIVE only: the `suggestions` string[]
  contract stays byte-identical (the P3 pins hold untouched); a `netflix`
  array rides beside it — up to 3 scored mirror matches
  (`netflixId`, `title`, `releaseYear`, `kind`) from the new lean
  `catalog.suggestNetflixTitles` (same scoring law as the catalog
  search + currently-ranking titles boosted). Fresh per request (cheap;
  the live ranks stay first), wrapped so Netflix trouble can never
  delay or break the YouTube suggest.
- **The dropdown** — `SuggestRow` gains a `netflix` variant rendered as
  the red N badge + "On Netflix" label (aria-label "X — on Netflix").
  Committing a badge row navigates STRAIGHT to `/netflix/t/<id>` via the
  new `onNetflixCommit` (absent → graceful fallback to the search page,
  where the Netflix shelf answers anyway), and never pollutes the
  recent-searches store (a title is not a search).
- **THE DESTINATION LAW** (measured live): the badge rows dedupe only
  against themselves and the staleness guard (`netflixRowMatches`) —
  NEVER against YouTube texts. The word-overlap case is real: YT's own
  autocomplete for "doing" contains "doing life", and hiding the badge
  row behind it would hide the DESTINATION (the search page vs the
  title page are different targets), not a duplicate.
- **Topbar** passes `onNetflixCommit` → `router.push(/netflix/t/<id>)`.

## Part C — the identity law (the live-measured gap)

First live pass caught a real integration gap: the Netflix local lanes
resolved identity through the watch-lane `resolveViewer` only (headers /
wfx2_uid / demo fallback). A signed-in WebFlix user who never opened a
YouTube watch page had NO wfx2_uid → anonymous → 401 on every local
write even while signed in (the dev DB no longer carries a demo row to
mask it). Fix: **`src/lib/netflix/viewer.ts`** —
`netflixViewerId(req)`:

1. `getSessionUser` (the same NextAuth JWT decode every gated route
   uses) → `ensureShadowUser` (the local-comment rung's shadow-user
   bridge) → the account's own prisma User id;
2. else the legacy `resolveViewer` lanes (wfx2_uid / header / demo
   fallback);
3. else "" (honest anonymous).

Threaded through ALL Netflix-personal surfaces: progress (GET/POST/
DELETE), my-list (GET/POST/DELETE), and the title page's My-List state.
Per-user isolation is now real for Netflix rows (the signed-in user's
list/plays are their own — the P36 isolation law, Netflix edition),
pinned by the minted-JWT battery pin.

## Gates

- tsc clean · eslint 0 errors on every touched file.
- test:netflix **112/0** (+18: the progress battery 12 incl. the
  signed-in shadow-user rung + the suggest-lane pins + the rail UI pins
  + the `lastPlayedLabel` law).
- Full battery **2300 pass / 0 fail** (9 suites).
- LIVE (sandbox, signed-in browser): play kick → POST 200 → the rail
  renders on the hub ("Continue Watching", Resume link, honest meta);
  remove → DELETE → the rail leaves; second title recorded playCount 2;
  suggest badge row renders ("Doing Life — on Netflix" beside the YT
  suggestions) and commits to `/netflix/t/82023496`; rows land under the
  signed-in account's shadow user (`wf_85b58a68`); mobile 375px → 0px
  horizontal overflow.

## Residuals

- The rail records play INTENTS (lane entry / handoff click); real
  in-player position stays unknowable until Netflix exposes it to the
  desktop session (never, honestly — the DRM player is a black box).
- The suggest lane's Netflix depth is the Top-10 mirror universe (the
  P42 scope note stands) — a TMDB/uNoGS key would widen it (P43 lane).
- Prod (Neon) needs the additive table: `prisma db push` against
  DATABASE_URL rides the deploy (same as P42's two tables).
