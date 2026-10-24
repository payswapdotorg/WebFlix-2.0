# P42-NETFLIX-SOURCE

Status: in-flight (2026-10-24) · Lane branch: `wfx2/p42-netflix-source`
Operator ask: "add netflix.com as a second source — videos browsable and playable
seemingly natively from WebFlix, without breaking any existing feature."
Research: `docs/research/2026-10-24-netflix-integration-options.md`
Policy: `docs/adr/0002-multi-source-netflix-policy.md`

## Scope

1. **Data layer** (`src/lib/netflix/*`)
   - `upstream.ts` — injectable fetch seam (`setNetflixUpstream`), mirroring the
     youtube seam; all netflix egress goes through it.
   - `types.ts` — `NetflixTitleDTO`, `NetflixRailDTO`, `NetflixHomeDTO`,
     `NetflixTitlePageDTO`, `NetflixSearchResultsDTO`, `NetflixPoolKey`, all with
     the provenance `source` field.
   - `top10.ts` — the 8-URL pool matrix, the `netflix.reactContext.models.graphql`
     SSR-cache parser (JS-string-unescape → Relay cache → entities), mappers to
     `NetflixTitleDTO` (incl. `countryRanks` map), per-pool `cached()` keys
     (`nf:pool:<key>`, soft TTL 6h weekly / 24h all-time, hard TTL 4×) + Prisma
     upsert mirror (`NetflixTitle`) feeding search.
   - `catalog.ts` — home composition (8 rails: weekly/all-time × films/series ×
     EN/non-EN, Global + US views where ranks exist), `getNetflixTitle(id)`
     (pool → DB mirror fallback), catalog search (`netflixSearch`), honest
     degradation flags.
   - `deeplink.ts` — the ONLY Netflix URL constructor:
     `netflixWatchUrl(id)` / `netflixTitleUrl(id)`.
2. **Prisma** — additive `NetflixTitle` (mirror + search index; `countryRanks`
   stored as `CC:rank` CSV — SQLite carries no list primitives) and
   `NetflixMyListItem` (per-user list, `@@id([userId, netflixId])`); `User`
   relation field added.
3. **Routes** (all `force-dynamic`, `rateLimit`-gated, honest 429/404/502)
   - `GET /api/netflix` → `NetflixHomeDTO` (8 rails; Global + US variants where
     the pool carries country ranks).
   - `GET /api/netflix/title/[id]` → `NetflixTitlePageDTO` (title + where-it-ranks
     + same-pool related + viewer `myList` state).
   - `GET /api/netflix/search?q=` → `NetflixSearchResultsDTO` (DB mirror search;
     honest note about the Top-10 universe scope).
   - `GET|POST|DELETE /api/netflix/my-list` → viewer-gated via `resolveViewer`
     (anonymous reads return an honest empty list; writes require an identity).
4. **UI** (Netflix-branded dark surface, red accents)
   - `/netflix` hub: hero (top weekly global title, backdrop + logo), rails with
     Netflix-style rank badges, Global/US country chips, My List rail.
   - `/netflix/t/[id]`: backdrop hero, metadata row (year, maturity, kind,
     weeks-in-Top-10, hours viewed), where-it-ranks chips, Play hand-off dialog
     (`play-handoff.tsx` — the ADR's playback policy, in copy + behavior),
     "Watch trailer" through the existing YouTube lane (`/api/search` + WebFlix
     `/watch`), My List toggle, "More like this" (same-pool neighbors).
   - Sidebar: "Netflix" row in `MAIN_NAV` (`TvMinimalPlay` icon) — additive.
   - Search: `NetflixSearchShelf` rendered additively on `/search` (only when the
     catalog answers; Netflix badge; deep links through the hub).
5. **Tests** (hermetic; new `test:netflix` suite wired into `bun run test`)
   - `tests/netflix-top10.test.ts` — parser/mappers on the real-shape fixture
     (unescape, entity→DTO, pool matrix, malformed-HTML honesty).
   - `tests/netflix-routes.test.ts` — home/title/search/my-list routes over the
     fixture upstream + throwaway DB (round-trip, 404, degrade).
   - `tests/netflix-ui.test.tsx` — hub renders rails + rank badges; hand-off
     dialog names Netflix honestly; My List toggle.
   - Fixture: `tests/fixtures/netflix/top10-films.html` (real captured shape).

## Non-goalties (this lane)

- No playback of Netflix video inside WebFlix (ADR 0002 §1 — permanent).
- No Netflix credentials/cookies anywhere (ADR 0002 §5 — permanent).
- No /title//search page scraping (robots — permanent unless Netflix relaxes).
- Full-catalog browse/search (TMDB/uNoGS) — P43+ when a key exists.

## Gates

lint 0e · tsc clean · `bun run test` battery green (existing 8 suites + netflix).
Live spot-check of the hub + a title page + hand-off from the dev instance.
