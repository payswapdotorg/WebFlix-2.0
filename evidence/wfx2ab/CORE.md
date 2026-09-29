# WFX2-A-B — LIVE CORE evidence (InnerTube read layer + data swap)

**Lane:** `wfx2/waveA-core` (base `main` @ 601489f) · **Repo:** payswapdotorg/webflix-2.0
**Scope:** `src/lib/youtube/*` typed client library + live swap of the read routes (search / suggest / videos / home / trending / channel / watch / comments / related) — real youtube.com data, existing UI shapes preserved.

---

## 1. Guards (exact commands + outputs)

| Command | Result |
|---|---|
| `bun install` | `Checked 873 installs across 941 packages (no changes) [36.00ms]` |
| `bun run lint` | `$ eslint .` → exit 0 (clean) |
| `bun run typecheck` | `$ tsc --noEmit` → exit 0 (0 errors, source + tests) |
| `bun run test` (boot phase) | `141 pass / 0 fail — Ran 141 tests across 6 files` |
| `bun run test` (watch phase) | `59 pass / 0 fail — Ran 59 tests across 7 files` |
| **Total** | **200 tests, 0 failures** (baseline was 99; this lane added 101 net) |

New/rewritten test files (fixtures only — `bun test` never touches youtube.com; live calls happen only inside the running app's routes, cached + rate-limited):
- `tests/yt-mappers.test.ts` — 80 tests (search_lofi → 45 cards; next_dQw4 → watch metadata + 26 related + autoplay + comments token; comments_dQw4 → 20 CommentDTOs + reply tokens + Top/Newest sort tokens; home_feed nudge → empty rails; ssr_trending → 38 videos/18 shorts; ssr_subscriptions → 95 items; channel_rickastley → header + 59 videos + 20 shorts; duration/view-count/age parsing tables; filter params table; SSR regex; JSONP autocomplete)
- `tests/yt-routes.test.ts` — 23 tests (route handlers with the upstream mocked to fixture bytes via the test-only `setUpstream()` seam in `innertube.ts`; asserts the actual InnerTube request bodies, filter params, continuation cursors, SSR fetches)
- `tests/home-api.test.ts` — rewritten fixture-backed (7 tests; the old 9 seed-DB assertions no longer applied once the routes went live)

## 2. Live sanity check (ran `next dev -p 3100` with the repo's env; sandbox egress CAN reach youtube.com)

Captures in this folder (`live-*.json`, arrays trimmed to first 3 items; **untrimmed data was live at capture time**):

| Endpoint | HTTP | Bytes | Result |
|---|---|---|---|
| `GET /api/search?q=lofi` | 200 | 27,598 | Real search results (live streams flagged `isLive`, "N watching" passthrough) |
| `GET /api/videos/dQw4w9WgXcQ` | 200 | 3,504 | Rick Astley watch metadata — views **1,821,187,782** (exact), likes **19,427,647** (exact, from a11y), full description, channel block |
| `GET /api/trending` | 200 | 30 | `{"category":"All","videos":[]}` — see honest note below |
| `GET /api/search/suggest?q=lofi` | 200 | 223 | Real autocomplete (JSONP → clean array) |
| `GET /api/watch/dQw4w9WgXcQ` | 200 | 22,408 | Aggregate: metadata + 20 live comments (total **2,457,866** — ten more than the recorded fixture, i.e. genuinely live) + 12 related |
| `GET /api/videos/dQw4w9WgXcQ/comments` | 200 | 18,894 | 20 comments/page, pinned first, sort tokens working |
| `GET /api/videos/dQw4w9WgXcQ/related` | 200 | 6,578 | Live related rail with durations/views/ages |
| `GET /api/channel/@RickAstleyYT` | 200 | 26,276 | Handle resolved via SSR channel page → browse UC… → header (4.55M subscribers) + 30 videos + 12 shorts |
| `GET /api/home` | 200 | 269 | Empty-but-valid rails — see honest note below |

**Honest note on home + trending (no `YT_COOKIES` in this worker sandbox):** live probing during development showed YouTube's 2026 server now returns the "Try searching to get started" feed-nudge to **logged-out** requests for both `browse FEwhat_to_watch` and SSR `/feed/trending` (the recorded fixtures — captured with the operator session — contain the full 54-item trending grid and prove the mapping: `tests/yt-routes.test.ts` maps the trending fixture into a full rail). With `YT_COOKIES` set (the deployment runs single-tenant with the operator session), both surfaces light up with real personalized data. Public mode degrades gracefully: valid JSON shapes, empty rails, no seed fallback. The fixture-backed tests cover the full-data path; the live captures in this folder cover the public-mode path. Also verified live from this sandbox: search, suggest, next (watch/comments/related/autoplay), and channel browse all work **without** cookies.

## 3. Filter params derivation (ground truth)

The encoding was derived from the recorded filter menu in `tests/fixtures/yt/search_lofi.json` (`searchFilterRenderer.navigationEndpoint.searchEndpoint.params` — the response ships every option's real param string), then **verified live** by sending built params to the real endpoint and checking the returned result sets:

```
SearchParam { 1: varint sort (1=rating, 2=date, 3=views)              2: Filters {
    1: varint upload_date (1 hour · 2 today · 3 week · 4 month · 5 year)
    2: varint type (1 video · 2 channel · 3 playlist · 4 movie · 9 shorts)
    3: varint duration (2 over20 · 4 under3 · 5 mid) } }
```

Live-verified combos (query "news"): `video+hour` → only minutes-old videos; `video+week` → ≤7-day results; `video+long` → only ≥20-minute videos; `views+video+week` → view-count-ranked week window; `shorts+today` → short-form fresh items. Single-filter params match the fixture strings byte-for-byte (`EgIQAQ==`, `EgIQCQ==`, `EgIIAg==`, `EgIYBA==`, `CAM=` …) — see the 23-case table in `tests/yt-mappers.test.ts`.

Note: YouTube's current filter UI only offers Relevance/Popularity sorts; `sort=date` (top-level field 1 = 2) and `sort=rating` (= 1) are the legacy enum values — the endpoint accepts them (200) and they are sent as-is; ranking treatment is YouTube's choice.

## 4. Deviations from the packet (all honest-data preserving)

1. **`durationSec` is `null` on watch metadata** — the `next` response carries no length for the current video (verified in fixture + live; `microformat` contains no `playerMicroformatRenderer` in 2026 responses). Cards/related/trending/channels DO carry real durations. The client player owns watch duration (A-W's IFrame lane).
2. **`dislikes: 0`** — YouTube no longer exposes dislike counts anywhere in these responses.
3. **`heartedByCreator: false` on live comments** — the current comment payload exposes only the heart *tooltip* affordance on every comment (`heartActiveTooltip`), not the actual heart state; no honest signal exists in this response format.
4. **`createdAt` is derived** from the real relative-age text (`"16 years ago"` → approx ISO) for sortability; the exact passthrough rides `publishedText`. Where no date exists (shorts cards, live items), `createdAt` is `null` and the UI renders the passthrough only.
5. **Home/trending public mode** — see the honest note in §2. With a session, shelves map per the packet (hero = first big item, shorts shelf, becauseYouWatched from a real shelf title, continue-watching from history SSR).
6. **Channel `createdAt: null`** — join dates live on the About tab (Wave B). The channel page UI now hides the Joined row when null.
7. **Search `channels[]`** — the sanitized `search_lofi` fixture contains no `channelRenderer`, so fixture tests assert the empty-array case; the mapper is implemented against the verified live shape (handle quirk: the handle lives in `subscriberCountText`, the subscriber text in `videoCountText` — confirmed against the live response).
8. **`POST /api/videos/[id]/comments` (comment creation) left on the seed path** — writes are Tier-2 (broker lane A-W); only the read path was swapped per this lane's scope.
9. **Autocomplete host** — used `suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt` (the verified endpoint from the research log §13; the fixture's JSONP body parses with the documented wrapper `window.google.ac.h(...)`).

## 5. Merge notes for the lead

**Files added** (all under `src/lib/youtube/` unless noted): `upstream.ts` (injectable fetch seam + `setUpstream`), `innertube.ts` (client: gzip-safe JSON, browser headers, X-Youtube-Client-Name/Version, cookie auth, timeout + single retry w/ jitter; re-exports `setUpstream`), `ssr.ts` (`fetchYtInitialData` + the verified regex), `session.ts` (`YT_COOKIES` provider, `hasSession()`), `cache.ts` (`cached(key, ttl, fn)` in-memory TTL + in-flight dedupe + fixed-window rate limiter — Upstash-ready seam), `filters.ts` (protobuf `params` builder), `mappers.ts` (`walkTree`, videoRenderer/richItem/lockupViewModel/gridVideo/compactVideo/shortsLockup → VideoDTO; channelRenderer; playlistRenderer; channel pageHeader), `comments.ts` (continuation walking + Top/Newest sort tokens + replies), `related.ts`, `autoplay.ts`, `suggest.ts`, `watch.ts` (next → watch metadata incl. exact like count via a11y), `feeds.ts` (home shelves / trending SSR / pagination cursors / history), `channels.ts`, `search.ts`; routes `src/app/api/search/suggest/route.ts` + `src/app/api/videos/[id]/comments/[commentId]/replies/route.ts`; tests `tests/yt-mappers.test.ts`, `tests/yt-routes.test.ts`; `.env.example`.

**Files swapped (route bodies):** `api/search`, `api/videos`, `api/home`, `api/trending`, `api/channel/[handle]`, `api/videos/[id]`, `api/videos/[id]/comments` (GET only), `api/videos/[id]/related`, `api/watch/[id]`.

**Files adapted (UI keeps rendering, responsive untouched):** `lib/types.ts` + `lib/watch/types.ts` (VideoDTO: `durationSec: number|null`, `createdAt: string|null`, + `viewsText`/`publishedText`/`badges`/`likeCountText`/`subscriberCountText` passthroughs; CommentDTO + `publishedText`/`likesText`), `lib/format.ts` + `lib/watch/format.ts` (null-tolerant formatters + `displayViews`/`displayPublished` preferring passthroughs), `lib/watch/chapters.ts` (nullable duration), `components/video/video-card.tsx` (duration badge hidden when null, avatar fallback initial, passthrough display), `components/watch/{related-rail,description-box,watch-page,comment-row,seek-bar}.tsx`, `components/home/{hero-card,shorts-shelf,trending-side-list,home-feed}.tsx` (live-mode empty-state copy replacing the seed-remnant message), `app/{search,trending,channel/[handle],history,studio}/page.tsx` (display guards), `tests/{home-api,comments,progress-transcript}.test.ts` (fixture-backed rewrite / null-safe casts), `package.json` (test:boot includes the new files).

**Route shape changes the UI must know:**
- `GET /api/search` — same `SearchPageDTO`; new optional query params `sort|uploadDate|duration|type`.
- `GET /api/search/suggest?q=` — **new** `{ query, suggestions: string[] }`.
- `GET /api/videos` — same `{ videos, nextCursor }`; `nextCursor` is now an opaque InnerTube continuation token (was `views:id` keyset).
- `GET /api/home` — same `HomeFeedDTO`; `recommendedCursor` is a continuation token; `trending` stays `[]` (no such shelf in the real home response; the page's Trending link owns that surface); `continueWatching` only with a session.
- `GET /api/trending` — same shape; category maps to the real `/feed/trending/{music,gaming,movies,…}` pages.
- `GET /api/channel/[handle]` — accepts `@handle` or `UC…`; `createdAt` may be `null`.
- `GET /api/videos/[id]` — same `VideoDetailDto`; `state.like` is always `null` (broker tier); `resumeSec` null (client-local memory — A-W lane).
- `GET /api/videos/[id]/comments` — same `CommentsPageDto`; 20/page; `sort=top|new` uses the real sort tokens; `parentId` + cursor serve reply threads; comment DTOs carry `repliesToken` and a `replyNextCursor: ""` sentinel meaning "fetch page 1 via parentId".
- `GET /api/videos/[id]/comments/[commentId]/replies?cursor=` — **new** `{ items, nextCursor }`.
- `GET /api/videos/[id]/related` — same `{ items, nextCursor }` (cursor = secondaryResults continuation when present).
- `GET /api/watch/[id]` — same `WatchPageDTO` aggregate.

**Env:** `YT_COOKIES` (session, never committed — `.env.example` documents it), `INNERTUBE_API_KEY` (optional override; defaults to the public WEB key).

**Standing laws honored:** no `player` endpoint anywhere in code or tests (grep-verified); fixtures-only tests; no `git push`; TypeScript strict; honest data (every DTO field maps a real response field — no invented numbers).
