# WFX2-B-W — SEARCH FILTERS + TRENDING CATEGORIES + DISCOVERY POLISH evidence

**Lane:** `wfx2/waveB-discovery` (base `main` @ 7b72d70) · **Repo:** payswapdotorg/webflix-2.0
**Scope:** the full search filter UI (real YouTube filter semantics), search-page parity (corrections, result counts, channel/playlist/shorts result cards), trending category pages (Now/Music/Gaming/Movies), in-channel search, sidebar EXPLORE wiring + the /explore hub + the Live surface + the public playlist page.
**Sandbox:** this worker CAN reach youtube.com (public mode). Live captures below were taken through the running app (`next dev -p 3100`, env `DATABASE_URL=file:../db/webflix2.db`) and through direct InnerTube probes (`live-upstream-*-probe.ts` scripts, reproducible).

---

## 1. Guards (exact commands + outputs)

| Command | Result |
|---|---|
| `bun install` | `856 packages installed [3.93s]` |
| `bun run lint` | `$ eslint .` → exit 0 (clean) |
| `bun run typecheck` | `$ tsc --noEmit` → exit 0 (0 errors, source + tests) |
| `bun run test:boot` | **195 pass / 0 fail** (141 pre-existing + 54 new `tests/yt-discovery.test.ts`) |
| `bun run test:watch` | 89 pass / **17 fail — PRE-EXISTING on the base commit** (verified by stashing my diff and re-running on clean 7b72d70: identical 89/17; the failures are cross-file env pollution in `youtube-direct`/`broker-client` tests — they pass when those files run alone. Not touched by this lane.) |
| `bun run test:liveshorts` | 58 pass / 0 fail |

**Total: 359 tests (305 base + 54 new), 0 failures attributable to this lane.**

New test file: `tests/yt-discovery.test.ts` (54 tests — the filter composition table, URL↔state round-trips, trending categories incl. chip extraction, search-parity mappers, /api/search filter routes, in-channel search, the Live surface, the playlist page, EXPLORE destinations). Fixtures only — the upstream is mocked via the `setUpstream()` seam; `bun test` never touches youtube.com.

New REAL fixtures recorded from live youtube.com (public mode, sanitized by construction — no cookies were sent):
`search_misspelled.json` (showingResultsForRenderer + 20 results), `search_live.json` (20 live streams w/ LIVE badges + watching counts), `search_playlists_lofi.json` (20 playlist lockups), `search_channels_lofi.json` (21 channelRenderers), `channel_search_rickastley.json` (the channel Search tab, query "never"), `playlist_browse_lofi.json` (browse VL…, 50 lockups) + `trending_chips_synth.json` (explicitly marked _synthetic_ — parser-shape test only; see §4).

## 2. Live sanity — filters visibly change the result set (via the running app)

Captures: `live-search-*.json` (arrays trimmed to the first 3 items; **untrimmed data was live at capture time**).

| Endpoint | Result-set change (proof the filter reached YouTube) |
|---|---|
| `/api/search?q=news` (baseline) | 29 results: ABC/BBC news broadcasts, "5 hours ago" …; `About 1,327,192,495 results` |
| `+type=video&date=hour` | **different set**: "Streamed 46 minutes ago", "Streamed 16 minutes ago" — minutes-old videos only |
| `+sort=views&date=week&type=video` | view-ranked week window (CAMSBAgDEAE= — A-B's live-verified combo) |
| `?q=lofi&duration=long` | all multi-hour items (42825s, 13964s, …) |
| `?q=lofi&duration=medium` | all 3–20-minute items (1140s, 1151s, …) |
| `?q=lofi&type=playlist` | 12 playlist cards ("Japanese Lofi for Coding…", "52 videos", real collection thumbnails) |
| `?q=lofi&type=channel` | channel cards w/ description + subs (Lofi Girl, Lofi Girl - Topic, …) |
| `?q=live&live=1` | 20/20 `isLive` results with real watching counts ("282 watching", "1,666 watching") |
| `?q=rick astely never gonna` | `correction {kind: showingResultsFor, correctedQuery: "rick astley never gonna", originalQuery: "rick astely never gonna"}` + `About 3,839,629 results` (the fixture recorded 3,839,607 — live drift = genuinely live data) |

Upstream-level probes (reproducible scripts in this folder):
- `live-upstream-filter-menu.txt` — the REAL current filter menu, captured live: Type (Videos `EgIQAQ==`, Shorts `EgIQCQ==`, Channels `EgIQAg==`, Playlists `EgIQAw==`, Movies `EgIQBA==`), Duration (**Under 3 minutes `EgIYBA==`, 3 - 20 minutes `EgIYBQ==`, Over 20 minutes `EgIYAg==`**), Upload date (Today `EgIIAg==`, This week `EgIIAw==`, This month `EgIIBA==`, This year `EgIIBQ==`), Features (Live `EgJAAQ==`, 4K, HD, …), Prioritize (Relevance, Popularity `CAM=`).
- `live-upstream-param-probes.txt` — the composed **live+today** param (`EgQIAkAB`) → 20/20 LIVE results; the **verbatim** param (`QgIIAQ==`, the flag the real "Search instead for" link sends — recorded in `search_misspelled.json`'s `originalQueryEndpoint.searchEndpoint.params`) → no `showingResultsForRenderer` in the response, i.e. autocorrection is skipped.
- **Bug found + fixed by this live check:** the Live feature filter is `SearchParam.Filters{8:1}` (`EgJAAQ==` = bytes `12 02 40 01`), NOT field 4 — the first implementation used field 4 (`EgIgAQ==`) and the live menu comparison caught it.

## 3. Live sanity — trending categories + discovery surfaces

| Endpoint | Behavior |
|---|---|
| `/api/trending?category=Now` | SSR `/feed/trending` → in public mode YouTube redirects it to the What-to-Watch nudge (0 items) → the honest search-backed fallback: real popular-this-week videos (`source: "search"`); with the operator session (deployment) the recorded grid maps through (fixture-proven: 38 videos → `source: "trending"`) |
| `?category=Music\|Gaming\|Movies` | real per-category popular-this-week rails (see `live-trending-*.json` — distinct result sets per category) |
| `/api/live` | 24 real live streams (live-scoped query set × Features→Live filter, merged + deduped), all `isLive`, real watching counts |
| `/api/channel/@RickAstleyYT/search?q=never` | 24 results, **all from Rick Astley's own channel** (channel-scoped — the browse search-tab mechanism, §5) |
| `/api/playlist/PLKF…` | the real playlist: "Japanese Lofi for Coding 💻✨", Sorameji Lofi, 52 videos, 44,726 views, real description |

agent-browser verification (screenshots in `screens/`): search filter panel (all 4 groups, single-select, Clear all), playlist result cards + applied-filter chip, trending category chips (Now/Music/Gaming/Movies) + the Music rail, the Live page (LIVE badge + watching counts), the explore hub, channel search results replacing the tabs, the playlist page. Sidebar EXPLORE links verified by click: Music → `/trending?category=Music`, Live → `/explore/live`, News → `/search?q=News&type=video`. Zero runtime errors on every page (checked per-page with `agent-browser errors`).

## 4. Trending-categories mechanism — the honest derivation

The packet's assumption ("the ssr_trending fixture carries the chipBarRenderer with each category's endpoint params") is **factually wrong**, verified two ways:
1. The recorded `ssr_trending.json` is a **FEwhat_to_watch capture** (its chips are `STYLE_HOME_FILTER` continuation tokens for the home feed; its single tab is `FEwhat_to_watch`) — youtube.com's 2026 /feed/trending redirects to the home feed even for the recorded session.
2. Live probing from this sandbox (public mode): `/feed/trending` **and** its semantic category paths (`/feed/trending/music|gaming|movies`) all serve the What-to-Watch nudge (no chips, no grid, `FEwhat_to_watch` tabIdentifier); `browse FEtrending` → 400 (matches research log §5); `browse FEtrending + bp params` → 400.

Mechanism shipped (`src/lib/youtube/trending-categories.ts`):
- Category set: **Now / Music / Gaming / Movies** (the real youtube.com /feed/trending categories).
- Primary path: SSR parse of the real category URLs (`/feed/trending` + the semantic `/feed/trending/{music,gaming,movies}` paths — the classic real youtube.com category URLs). `extractTrendingChips()` parses the chip-bar bp params from a live trending response when present (`?bp=` preferred over the semantic path); on the logged-out page there are none (verified live) → the semantic paths carry the mechanism. The chip parser is tested against `trending_chips_synth.json` (explicitly marked synthetic — the real chipCloudChipRenderer+browseEndpoint shape; the parser is shape-generic and uses whatever params the live page carries).
- **Public-mode enrichment:** when the SSR category page yields 0 videos (the nudge — live-verified), the rail fills with real search-backed data: `search {query: category, sort: views, uploadDate: week, type: video}` (popular this week per category). The response's `source` field ("trending" | "search") lets the page label the path honestly ("Popular this week — the live category grid needs the YouTube session (public mode).").

## 5. In-channel search — the honest derivation

The packet's suggested encoding `b64{2: query, 6: 8}` was probed live (`live-upstream-channel-search-variantA-probe.ts`): `browse {browseId, params: b64{2:query,6:8}, query}` returns the channel page with an **EMPTY** Search tab. The real mechanism (found by reading the channel response's own tab list, `live-upstream-channel-searchtab-endpoint-probe.ts` + verified `live-upstream-channel-search-verified-probe.ts`):
```
browse {browseId: "UC…", params: "EgZzZWFyY2jyBgQKAloA", query: "<term>"}
```
- The params is the channel's own **Search expandableTabRenderer** endpoint params (`EgZzZWFyY2jyBgQKAloA` — same tab-param family as the Videos tab `EgZ2aWRlb3PyBgQKAjoA`; channel-agnostic, live-verified on Rick Astley's channel).
- `channelSearchTabParams()` extracts it from the channel response's own tab list (the honest path); the live-verified constant is the fallback — the same pattern A-B used for the videos tab.
- Verified: query "never" on UCuAXFkgsw1L7xaCfnd5JJOw → 24 results, every one Rick Astley's own video (channel-scoped ✓).

## 6. Live surface mechanism — what was chosen and why

Chosen: **the Features→Live search filter (`params: EgJAAQ==` = SearchParam.Filters{8:1}, the exact option YouTube's own filter menu ships) applied to a live-scoped query set** — `["live", "news live", "gaming live", "music live"]` — merged, de-duplicated, `isLive`-checked. Each query is cached separately at the search TTL.

Why not the alternatives (all probed/verified): `search {params: live}` with an empty query is unreliable (the endpoint requires a query — the packet itself notes this); `browse FElive`/`browse FEexplore` → 400 (research log §6; `/explore` SSR → 410 Gone, probed); the trending live shelf is session-gated (public /feed/trending is the nudge). The chosen mechanism returns 20/20 real live streams with LIVE badges + watching counts from public mode, works in every mode, and rides A-B's existing cached search path.

## 7. Deviations from the packet (all honest-data preserving)

1. **Duration labels** — the packet says "Under 4 minutes / 4-20 minutes"; the REAL current YouTube menu (recorded in `search_lofi.json` + captured live, `live-upstream-filter-menu.txt`) says **"Under 3 minutes / 3 - 20 minutes / Over 20 minutes"** (field3 = 4/5/2). The UI ships the real labels; `medium` (field3=5) was added to A-B's builder so the 3-option group composes.
2. **Sort group** — the packet lists the classic 4 options; the current real menu only offers Relevance/Popularity (`CAM=`). All 4 ship as tasked: "View count" = the current Popularity param; Upload date/Rating are the legacy enums (endpoint-accepted, A-B's CORE.md §3 note).
3. **"Last hour"** — not in the current recorded menu (it starts at Today) but the param (`EgIIAQ==` = Filters{1:1}) is real and the hour+video combo was A-B live-verified; it ships per the packet.
4. **Trending category mechanism** — see §4 (the fixture chipBar assumption was factually wrong; semantic category paths + live chip extraction when present + public-mode search enrichment).
5. **Channel-search params** — see §5 (the `b64{2:query,6:8}` encoding returns an empty Search tab; the Search-tab params + query is the real mechanism).
6. **URL keys** — the page URL uses `?q=&sort=&date=&type=&duration=` (packet format); the route accepts `uploadDate` as the A-B-era alias (both tested).
7. **New public surface added:** `/playlist/[id]` (+ `/api/playlist/[id]`) — the packet's playlist-result cards need a real destination ("playlist page link"); B-B owns the PERSONAL `/playlists` page, this is the public VL… browse page (documented for the merge).
8. **A-B file edits (additive, merge-noted):** `filters.ts` (+`medium` duration, +`live`/`verbatim` flags), `search.ts` (playlists/correction/count in SearchResults; channel cap 3→6 mixed / 24 for type=channel), `types.ts` (+PlaylistLiteDTO, SearchCorrection, optional fields), `feeds.ts` (untouched), `yt-routes.test.ts` (1 assertion updated: the trending default category "All"→"Now" per the real category set).

## 8. Merge notes for the lead

**Files added:** `src/lib/youtube/search-filters.ts`, `search-parity.ts`, `trending-categories.ts`, `channel-search.ts`, `live-surface.ts`, `playlist.ts`; routes `src/app/api/channel/[handle]/search/route.ts`, `src/app/api/live/route.ts`, `src/app/api/playlist/[id]/route.ts`; pages `src/app/explore/page.tsx`, `src/app/explore/live/page.tsx`, `src/app/playlist/[id]/page.tsx`; components `src/components/search/filter-panel.tsx`, `channel-result-card.tsx`, `playlist-result-card.tsx`; tests `tests/yt-discovery.test.ts`; fixtures (real): `search_misspelled.json`, `search_live.json`, `search_playlists_lofi.json`, `search_channels_lofi.json`, `channel_search_rickastley.json`, `playlist_browse_lofi.json`; fixture (synth, marked): `trending_chips_synth.json`; evidence `evidence/wfx2bw/` (this folder).

**Files edited (additive):** `src/lib/youtube/filters.ts`, `src/lib/youtube/search.ts`, `src/lib/types.ts`, `src/lib/categories.ts` (+`categoryDestination`), `src/app/api/search/route.ts`, `src/app/api/trending/route.ts`, `src/app/search/page.tsx` (rewrite), `src/app/trending/page.tsx` (category chips), `src/app/channel/[handle]/page.tsx` (search-this-channel), `src/components/app/sidebar.tsx` (EXPLORE wiring + hub link), `tests/yt-routes.test.ts` (1 assertion), `package.json` (test:boot + the new file).

**Coordination surface:** the channel page (B-S deepens tabs) — my edit adds the magnifier + search-results mode around the existing tabs, structured to union cleanly. The `/api/search` response is strictly additive (new optional fields). B-B's personal playlists routes are untouched.

**Standing laws honored:** no `player` endpoint anywhere (grep-verified); fixtures-only tests; no `git push`; TypeScript strict; honest data (every DTO field maps a real response field).
