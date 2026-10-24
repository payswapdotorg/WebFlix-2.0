# ADR 0002 — Multi-source policy: how a second video source (Netflix) enters WebFlix 2.0

Status: Accepted (2026-10-24)
Supersedes: nothing. Extends the single-source assumptions of ADR 0001.
Related: docs/research/2026-10-24-netflix-integration-options.md, docs/work-items/P42-NETFLIX-SOURCE.md

## Context

WebFlix 2.0 was built as a YouTube interface: every read surface (home, search,
trending, watch, channels, comments) assumes youtube.com's InnerTube transport and
the official IFrame player. The operator's next goal is the same relationship with
netflix.com — browsable and playable "seemingly natively" — without breaking any
existing surface, and without exposing the operator or the project to legal/account
risk.

Netflix, unlike YouTube, exposes no data API, blocks embedding, and DRM-protects
every stream (Widevine/PlayReady/FairPlay). Browser-automation streaming
(Browserbase-style), credential automation, and stream extraction were evaluated and
REJECTED — see the research record for the four independent grounds (ToS,
detection/M7353-5101, Widevine L1 quality floor, licensing).

## The decision

1. **Playback policy — hand-off, never rip.** Netflix titles play through Netflix's
   own official deep link (`https://www.netflix.com/watch/<videoId>`), the same
   integration pattern Apple TV / Google TV / JustWatch use. WebFlix owns browse,
   search, detail, and the library data; Netflix owns the player and the stream.
   In-app real playback for a Netflix title is offered only through the existing
   YouTube lane (official trailers via WebFlix's YouTube player). No DRM-protected
   byte ever passes through WebFlix. This is codified in
   `src/lib/netflix/deeplink.ts` — the only file that may construct a Netflix URL.
2. **Read policy — Netflix's own public Top 10 data.** The Tudum Top 10 pages are
   fetched UNAUTHENTICATED (no cookies, no accounts, no operator credentials), only
   as the bounded 8-URL pool matrix, always through `src/lib/netflix/upstream.ts`
   (injectable seam) and the shared `cached()` Upstash adapter (soft TTL 6h/24h +
   last-good), so egress volume stays at a handful of fetches per pool per day.
   `netflix.com/robots.txt` (`Disallow: /` for generic agents) is respected: no
   /title/, /search/, or /watch/ page fetches — deep links are outbound links a
   USER clicks, never fetched by WebFlix.
3. **Provenance law.** Every Netflix DTO carries an honest `source`
   (`netflix-top10` | `netflix-most-popular` | `netflix-catalog` | `last-good` |
   `""`) and an `unavailable`/degrade flag with a reason — the same doctrine as
   `HomeFeedDTO.source`. The UI renders the notice, never fake rows.
4. **Source-adapter shape (the first second source).** `src/lib/netflix/*` mirrors
   the youtube module's seams (own upstream seam, own mappers, own `nf:*` Upstash
   keyspace) and never imports youtube lib code — except the trailer handoff, which
   is a CLIENT-side reuse of the public `/api/search` route. `VideoDTO` stays
   YouTube-owned; Netflix titles carry their own `NetflixTitleDTO`. Prisma gains
   ADDITIVE tables only (`NetflixTitle` catalog mirror/search index,
   `NetflixMyListItem` per-user list); existing models are untouched.
5. **Credential policy.** No Netflix credentials are read, stored, or sent by any
   code path — not in env vars, not in the DB, not in the broker. (Operator note:
   the password shared in chat should be rotated; it was never written to the repo.)
6. **Non-interference.** All youtube surfaces, routes, DTO shapes, and tests stay
   byte-identical; integration points are additive only: a sidebar row, a search
   shelf that renders only when the Netflix catalog answers, and new `/netflix*`
   routes + `/api/netflix/*` handlers.

## Compliance

- DMCA §1201 / EU DSM Art. 3: no circumvention anywhere — playback is Netflix's own
  player over Netflix's own deep link.
- Netflix ToS: no automated viewing, no credential use, no public performance; the
  deep-link hand-off sends viewers TO Netflix, the direction its licensing wants.
- robots.txt: honored strictly for netflix.com (research record §2.4).
- Rate impact: ≤ 8 pool fetches per soft-TTL window globally when Upstash is
  configured (shared L2), per-instance otherwise (dev).

## Security

- No secrets introduced (zero new env vars this lane).
- Upstream fetches are server-side only through the injectable seam; the client
  never talks to netflix.com except via user-initiated outbound navigation.
- My List is session-gated by the existing WebFlix identity resolution
  (`resolveViewer`), not by anything Netflix-side.

## Live acceptance status

- Data layer verified against LIVE tudum captures from this station (2026-10-24):
  all 8 pools answer 200 with the documented SSR cache shape; weekly EN films #1
  "Animals" (videoId 81757047), all-time films #1 "KPop Demon Hunters", all-time
  series #1 "Wednesday: Season 1".
- Hermetic battery: `bun run test:netflix` (parser, routes, UI) rides
  `tests/fixtures/netflix/top10-films.html`.

## Consequences

- Netflix surface depth = the Top-10 universe Netflix itself tracks (~140 titles,
  refreshed weekly); full-catalog browse awaits a TMDB/uNoGS key (research §2.5).
- If Netflix walls this station's egress, the hub degrades to last-good → honest
  unavailable notices — never a silent fake.
- The source-adapter seams (upstream, DTO provenance, `nf:*` keyspace) are the
  template any future source (Disney+, Prime…) must follow.
