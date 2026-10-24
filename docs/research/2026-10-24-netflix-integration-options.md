# Netflix integration — research record (P42-NETFLIX-SOURCE)

Date: 2026-10-24 · Station: the resident TL station · Lane: wfx2/p42-netflix-source
Task: "make webflix-2.0 the main interface for netflix.com the way it is for youtube.com — browsable and playable seemingly natively, without breaking existing features."

## 1. The honest asymmetry (why Netflix ≠ YouTube at the transport layer)

WebFlix's YouTube engine lives on three legal-for-us transports: the public InnerTube
JSON endpoints, SSR page parses, and the official embed/data APIs. Netflix offers
NONE of these for video:

| Capability | youtube.com | netflix.com |
| --- | --- | --- |
| Public data API | InnerTube (unofficial but public-keyed) + official Data API | none public |
| Official embed player | yes (IFrame API) | no — embeds blocked (`X-Frame-Options`/CSP `frame-ancestors`) |
| Per-title deep link | `youtube.com/watch?v=` | **yes — `netflix.com/watch/<videoId>`** (used by Netflix's own app intents + partner TV UIs) |
| Stream extraction | partial (plain-URL googlevideo formats on some clients) | **impossible + illegal** — Widevine/PlayReady/FairPlay DRM on 100% of streams; DMCA §1201 anti-circumvention |
| Catalog metadata | rides the read APIs | only what Netflix itself publishes (Tudum Top 10) |

## 2. Evaluated and REJECTED approaches (with reasons)

1. **Browserbase / remote-browser streaming of a logged-in Netflix session.**
   The operator's suggestion. Rejected on four independent grounds:
   - **ToS**: Netflix's terms prohibit automated access, credential sharing outside the
     household, and any public performance of content. Streaming a rented browser's
     view of Netflix into WebFlix is all three at once.
   - **Detection**: Netflix actively fingerprints datacenter egress, headless/VM
     browsers, and Widevine L3-in-VM playback; the standard result is error
     **M7353-5101** ("unblocker/proxy detected") and account strikes. A service that
     breaks every other week and endangers the operator's account is not a feature.
   - **Quality**: Widevine L1 (hardware) is required for 1080p+; a VM screenshot-stream
     tops out at L3 quality with added seconds of remote-browser latency — strictly
     worse than the deep-link handoff below.
   - **Licensing**: Netflix's content licenses authorize playback inside Netflix's own
     apps only. WebFlix showing Netflix video = unlicensed public display.
2. **DRM stream extraction** (EME/CDM interception, widevine decryptors, "Netflix
   downloaders"): DMCA §1201 + EU DSM Art. 3 anti-circumvention. Never.
3. **Operator-credential automation** (logging in as the operator with a script):
   account risk (Netflix suspends shared/automated accounts), credential-leak surface
   (the password was shared in chat — **rotate it**), zero technical upside over the
   deep-link pattern. Not used; not stored anywhere in the repo.
4. **Scraping netflix.com title/search pages**: `netflix.com/robots.txt` is
   `User-agent: * / Disallow: /` (verified 2026-10-24). Respected — no /title/ or
   /search fetches anywhere in the implementation.
5. **Third-party catalog APIs** (uNoGS/RapidAPI, TMDB watch-providers, Watchmode):
   all require keys the operator has not provided (TMDB is free but registration-bound).
   Documented as a future enrichment lane (P43 candidate): TMDB discover
   `with_watch_provider=8` gives full-catalog browse if a key ever lands. Not a blocker.

## 3. The APPROACHED approach: Netflix's own public Top 10 data + official deep links

**What Netflix itself publishes** (verified live from this station, 2026-10-24):
the Tudum "Top 10 on Netflix" site (`netflix.com/tudum/top10`) server-renders a
normalized GraphQL cache at `netflix.reactContext.models.graphql` containing, per
title: `videoId` (the Netflix ID), title, short synopsis, release year, maturity
rating, poster/boxart/story-art URLs (`dnm.nflximg.net`), weekly rank, weekly hours
viewed, weekly views, cumulative weeks in Top 10, isPlayable, and **per-country
ranks for ~93 countries**.

**The pool matrix** (each URL returns the same SSR shape; 20 entities = Global pool
+ geo pool; per-country rails derive from `countryRanks`):

| Pool | Path | Category |
| --- | --- | --- |
| weekly EN films | `/tudum/top10/` | ENGLISH_MOVIES (weekEndDate set) |
| weekly EN series | `/tudum/top10/tv` | ENGLISH_SERIES |
| weekly non-EN films | `/tudum/top10/films-non-english` | NONENGLISH_MOVIES |
| weekly non-EN series | `/tudum/top10/tv-non-english` | NONENGLISH_SERIES |
| all-time EN films | `/tudum/top10/most-popular` | ENGLISH_MOVIES (weekEndDate null) |
| all-time EN series | `/tudum/top10/most-popular/tv` | ENGLISH_SERIES |
| all-time non-EN films | `/tudum/top10/most-popular/films-non-english` | NONENGLISH_MOVIES |
| all-time non-EN series | `/tudum/top10/most-popular/tv-non-english` | NONENGLISH_SERIES |

Live captures: weekly EN films = "Animals" #1 (93-country presence); all-time films =
"KPop Demon Hunters" #1; all-time series = "Wednesday S1" #1, "Squid Game S1/S2".
The exact JS-string-escape (`\'`, `\\`, `\uXXXX`) is handled by the parser in
`src/lib/netflix/top10.ts`; the fixture `tests/fixtures/netflix/top10-films.html`
pins the shape.

**Playback = the official deep-link handoff** — the same pattern Apple TV, Google
TV, and every legitimate aggregator uses: browse/search/detail inside WebFlix, the
Play button opens `https://www.netflix.com/watch/<videoId>` (new tab; the Netflix
player is Netflix's own). In-app REAL playback stays available for discovery via the
existing YouTube lane (official trailers through WebFlix's own player).

## 4. Compliance posture (the honest-degrade doctrine, applied to a second source)

- Read-only, UNAUTHENTICATED, bounded URL set (the 8 pool pages). No crawl, no
  search-page fetches, no title-page fetches, no cookies, no accounts.
- Everything rides the existing `cached()` Upstash adapter (soft TTL 6h weekly /
  24h all-time; last-good 4× the soft TTL), so Netflix sees at most a handful of
  fetches per pool per day no matter how many viewers browse the hub.
- Any upstream failure degrades honestly: rails drop out, `unavailable: true` +
  reason surface in the DTO; the UI shows a notice, never fake rows.
- Playback hands OFF to Netflix (we send them the viewer); no DRM is touched.

## 5. Residuals / follow-ups

- Catalog depth = the Top-10 + Most-Popular tracked universe (~140 titles, refreshed
  weekly by Netflix). Full-catalog browse/search needs TMDB/uNoGS keys (§2.5).
- Per-title extras (cast, episode lists) are not in the Top 10 payload; a bounded,
  robots-respecting enrichment source is a P43+ item.
- `scripts/acceptance.mjs` (live 38-check harness) not extended this lane — the
  netflix surface rides the hermetic battery; live acceptance is the operator's rung.
