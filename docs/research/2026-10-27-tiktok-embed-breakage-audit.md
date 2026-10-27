# TikTok Embed Breakage — Audit, Gap Research, and Remediation (P59)

**Date:** 2026-10-27 (re-landed same day after a sandbox reset; all measurements re-taken fresh)
**Trigger:** operator report — *"the tiktok embeddings are not working"*
**Scope:** `/tiktok` hub, `/tiktok/v/[id]` playback, `/api/tiktok/*`, `src/lib/tiktok/*`
**Standing law:** ADR 0004 (the Embed Player lane) is NOT abandoned — it is correct; the breakage lived in the *universe*, the *metadata honesty*, and the *silent failure UX*.
**Predecessors:** `2026-10-26-tiktok-integration-options.md` (P58 research), ADR `0004-tiktok-embed-policy.md`

---

## 1. Executive summary

The user-facing symptom — "embeddings not working" — decomposes into three measured defects compounding each other:

1. **G1 — Hollow universe.** Production served **exactly one** post (`universeSize: 1`), TikTok's 2019 docs-example video. One card, no thumbnails, no handles → the hub *looks* dead regardless of whether the player works.
2. **G2 — Walled metadata lane.** TikTok's keyless oEmbed 302-redirects both the sandbox egress **and Vercel's AWS egress** (measured live in production's own DTO). Every card rendered `author: null, title: null, unavailable: true` — with no factual handle to fall back on.
3. **G3/G4 — Silent failure UX.** If the single post's player failed client-side (dead 2019 post, region-walled viewer), the page showed a **silent black box**: no timeout banner, no error, no outbound link. "Not working" with zero explanation.

The embed architecture itself (official `player/v1` iframe, locally built URL, postMessage error protocol) measured **correct and current** against TikTok's docs — the gaps are curation, honesty, and telemetry, all closed in-repo with zero new credentials (§5).

---

## 2. Measured evidence (2026-10-27)

| # | Probe | Result |
|---|-------|--------|
| E1 | `GET https://webflix-2-0-one.vercel.app/api/tiktok/rail` | `universeSize: 1`; the single DTO carries `author: null`, `title: null`, `unavailable: true`, source `tiktok-curated` |
| E2 | `curl https://www.tiktok.com/@scout2015/video/6718335390845095173` (sandbox, HK egress) | `302 → https://www.tiktok.com/hk/about` (the datacenter wall) |
| E3 | `curl https://www.tiktok.com/oembed?url=…` (sandbox) | same `302 → /hk/about`; production's DTO independently reports the endpoint unreachable from Vercel's AWS egress |
| E4 | `curl https://www.tiktok.com/player/v1/6718335390845095173?…` (datacenter egress) | `302 → /hk/about` too — **datacenter** IPs cannot even fetch the player URL; only the **viewer's residential browser** can. This is why the embed lane was designed viewer-side (ADR 0004 §1) |
| E5 | Player contract (developers.tiktok.com, embed-player) | `player/v1/<id>` + `music_info/description/rel/controls/timestamp/closed_caption` params CURRENT; `onPlayerError { errorCode, errorType }` protocol current (1001/2001/3001/3002) |
| E6 | Harvest probe (HN Algolia open API) | **99 real cited `@user/video/<id>` URLs** recoverable from public citations — a legitimate curation source requiring no credentials and no guessing |

**Why the user saw "not working":** one null-metadata card (E1) whose 2019-era player may 1001 (dead post) or never become ready (E4's wall applies to *their* network/region in some geographies) — and the P58 UI had no readiness timeout, so any of those paths rendered a silent black frame below a bare "Loading TikTok's player…" line. Nothing on the page ever *explained itself*.

---

## 3. The gaps

| ID | Gap | Consequence |
|----|-----|-------------|
| **G1** | Universe = 1 docs-example post | The hub cannot look alive even when everything works; a single dead post = a dead-looking product |
| **G2** | oEmbed walled on every egress WebFlix controls | Cards render as anonymous null rows; search has nothing to match |
| **G3** | No liveness learning loop | A dead post stays on the shelf forever; nobody knows which curated ids died |
| **G4** | No readiness timeout in the player host | Region-walled viewers / dead posts = silent black box; support burden lands on the operator's DMs |
| **G5** | Metadata enrichment needs residential egress | Out of scope for in-repo fixes (needs Apify residential run or Data API keys) — documented as operator-gated, never self-implemented (no scraping/proxying per P58 decision) |

---

## 4. Options considered for closing the gaps

- **Chosen — R1 cited-URL curation (G1):** harvest REAL post URLs from public citations (HN Algolia open API). Reproducible, credential-free, zero guessed ids (the ADR-0004 law holds: every id appeared verbatim in a cited URL). 99 harvested → 16 selected in harvest order + TikTok's docs example = 17.
- **Chosen — R2 curator-metadata fallback (G2):** when oEmbed walls, a cited post STILL renders an honest card carrying its **factual `@handle` from the citation** (plus a URL-law author link), `source: "tiktok-curated"`, `unavailable: false`, **titles/thumbnails never fabricated**. Provenance stays distinguishable from oEmbed data.
- **Chosen — R3 player-telemetry death ledger (G3):** the viewer's browser is the only witness of a dead post, so it reports once; the server records **only the lethal 1001-family** for a soft 48h TTL on the shared cache adapter. 2001/3xxx/timeouts are poison-guarded (`recorded: null`) — one bad network must never blank the shelf for everyone.
- **Chosen — R4 readiness timeout + honest banner (G4):** a 12s readiness budget; a never-ready player flips an explicit banner ("didn't load from this network… region… **Open on TikTok**"), cleared by a late `onPlayerReady`; real errors beat the timeout; every terminal state reports once per (post, kind).
- **Chosen — R5 fresh-clone hygiene:** `postinstall` boots the `netflix-desktop` sub-install so a fresh clone typechecks green (the reset exposed this).
- **Chosen — R6 battery extension:** law test pins `curated.ts` + `dead.ts`; URL law gains `tiktokAuthorUrl`; the fallback ladder, the poison guards, the timeout banner, and the one-shot telemetry are all pinned by tests.
- **Rejected:** server-side liveness pings (impossible — E4's wall); scraping TikTok HTML (ToS + the P58 decision); blockquote.js remote script (injection surface, rejected in P58); auto-deleting dead posts from the ledger after one report (poison risk — a 48h soft TTL with lethal-only writes is the honest balance).

---

## 5. Implemented (this phase, commit re-landing 99bd876's scope)

| Rec | Artifact | Note |
|-----|----------|------|
| R1 | `src/lib/tiktok/curated.ts` | 17 cited entries (`{postId, author}`), docs example first; ledger at `scripts/ops/tiktok-curated-citations.json`; `TIKTOK_CURATED_IDS` still overrides wholesale |
| R2 | `curatedFallbackDTO` in `src/lib/tiktok/library.ts` | cited handle + `tiktok-curated` provenance when oEmbed walls; rail/search provenance reflects what actually served |
| R3 | `src/lib/tiktok/dead.ts` + `POST /api/tiktok/player-events` | lethal-only writes, 48h soft TTL (`tt:dead:*`), 1KiB body cap, URL-law id validation, rate-limited, `no-store` |
| R4 | `TikTokEmbedPlayer` | 12s readiness timer (`TIKTOK_PLAYER_READY_TIMEOUT_MS`, injectable for tests), honest timeout banner + outbound link, error-beats-timeout, late-ready clears, one telemetry report per (post, kind) via effect-reset refs |
| R5 | `package.json` postinstall | `cd mini-services/netflix-desktop && bun install` |
| R6 | tests | `tiktok-dead.test.ts` new; law/library/routes/urls/ui extended — **66 TikTok tests, full battery 2,403/0, tsc 0, eslint 0** |

**Verification ladder:** injected-upstream unit ladder (fallback ladder, poison guards, telemetry) → route battery → full 10-suite battery → post-deploy production browser check (`/tiktok` renders 17 cards with handles; `/tiktok/v/<id>` shows the honest banner when the viewer is walled).

---

## 6. Operator-gated paths (unchanged from P58, restated for the record)

1. **Extend the universe without a deploy:** set `TIKTOK_CURATED_IDS` (comma-separated post URLs or bare ids, cap 40) on Vercel → the env overrides the 17-entry default.
2. **Restore rich metadata** (titles/thumbnails): needs residential egress — an Apify TikTok oEmbed/scrape actor run on a schedule, or TikTok Data API keys. WebFlix will ride the honest fallback until one of those is provisioned.
3. **The dead ledger is server-memory/Upstash-backed:** with no Upstash env set, records live per-instance for up to 48h — fine for telemetry; wire the Upstash env when the instance is rebuilt to share it across lambdas.

## 7. What did NOT change (the non-interference law)

- YouTube lanes: zero imports from `@/lib/tiktok` into `src/lib/youtube` (law-tested).
- Netflix lanes: full `test:netflix` 149/0; the shared Upstash cache adapter remains the only infrastructure seam.
- The URL law: `urls.ts` remains the sole tiktok.com URL constructor (now including author profiles).
