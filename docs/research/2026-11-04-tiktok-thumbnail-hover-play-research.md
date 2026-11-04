# TikTok thumbnails + hover-play — the research record

Date: 2026-11-04 · Lane: P89 (research + hardening) · Builds on: P88 (`6aaa912`, the preview lane)
Operator ask: "the tiktoks should have thumbnails as well and should play on hover just like the
youtube shorts" — researched here, reported here, implemented per the report's recommendations.

## 1. Executive summary

The YouTube shorts shelf shows a **static thumbnail** on every tile and **plays a muted preview
on hover** (450 ms dwell → the official player). TikTok parity needs the same two capabilities,
but TikTok's metadata cannot simply be fetched the way YouTube's is: every egress WebFlix
controls (the sandbox datacenter AND Vercel's AWS) is geo-walled off TikTok's web domain, so the
server lane usually answers `thumbnailUrl: null`.

The researched answer — and what now ships — is a **three-rung honest ladder** plus an
**official-player hover contract**:

1. **Server oEmbed cache** (`lib/tiktok/library.ts`) — serves when an egress reaches TikTok.
2. **Viewer-side oEmbed hydration** (`components/tiktok/tiktok-preview-client.ts`, P88) —
   TikTok's keyless oEmbed endpoint answers **CORS-open** (`access-control-allow-origin: *`,
   measured 2026-11-04 even on the geo-walled 302 — the policy is edge-wide on that path), so
   the VIEWER's browser — a residential, non-walled vantage — fetches the exact metadata the
   server lane would have. This is the same official, keyless, viewer-side lane the Embed
   Player itself rides. It fills **only** what the server left null.
3. **The honest fallback tile** — when both rungs fail, the tile names the source and never
   fabricates an identity (the P59-R2 law).

Hover-play rides the **official Embed Player** (`tiktok.com/player/v1/<id>`) with the audited
muted-autoplay params (`autoplay=1&force_muted=1&loop=1&rel=0`), fine pointers only, a 450 ms
dwell, and unmount-on-leave — the same contract as the YouTube tile, at most one preview alive.

**Hardening implemented in this lane (R5–R8):** `referrerPolicy="no-referrer"` on every tile
thumbnail, `onError` → honest fallback when an expired signed CDN URL 404s, feed-slide poster
hydration through the same client lane (YouTube slides already poster while booting), and a
`preconnect` to `www.tiktok.com` on tile surfaces.

## 2. Constraints any solution must satisfy

- **ADR 0004 (TikTok embed policy):** official lanes only — the Embed Player + keyless oEmbed;
  **no scraping**, no TikTok media-byte extraction/proxying, no fabricated metadata, every
  `tiktok.com` string built through `lib/tiktok/urls.ts`, honest provenance on every DTO.
- **ADR 0013 (shorts source boundary):** one Shorts experience; TikTok stays behind its adapter;
  the shared shell never learns provider details.
- **The honesty laws:** a missing thumbnail renders the fallback tile; a mismatched oEmbed
  answer (`embed_product_id` ≠ requested id) is treated as absence; titles/handles are never
  invented; degraded states stay visible.
- **The egress reality (measured):** `www.tiktok.com` 302s datacenter requests to `/hk/about`
  (`x-redirect-reason: www.tiktok.com_hk`); the server lane's oEmbed cache can be empty for its
  whole 6 h soft-TTL window on a walled egress.

## 3. Measured evidence

| # | Measurement | Result |
|---|---|---|
| E1 | `GET tiktok.com/oembed?url=…` from the sandbox datacenter (bare + browser UA) | `302 → https://www.tiktok.com/hk/about`, `x-redirect-reason: www.tiktok.com_hk` — the geo-wall (re-measured 2026-11-04; first measured P58) |
| E2 | The same response's CORS headers | **`access-control-allow-origin: *` ships on the oEmbed path even on the walled 302** — the CORS policy is edge-wide on that path, so a non-walled viewer's browser can read the JSON cross-origin (the P88 discovery; re-measured this lane) |
| E3 | `GET tiktok.com/embed/v2/<id>` and `player/v1/<id>` from the datacenter | Both `302 → /hk/about` — the embed lane is ALSO viewer-side-only (consistent with the player working for real viewers; P59B + re-measured) |
| E4 | Production `/api/tiktok/rail` DTO | `thumbnailUrl: null` on walled egresses (Vercel AWS walled too — P58 G2), `author` still factual for cited posts (P59-R2) |
| E5 | The in-repo YouTube contract | `ShortsTile` renders a plain `<img src={short.thumbnailUrl}>` and mounts the official player after `useHoverPreview`'s **450 ms** dwell (`video-hover-preview.tsx` `DWELL_MS = 450`) |
| E6 | The feed player's poster lanes | `TikTokFeedPlayer` already paints `item.thumbnailUrl` under the embed and inside the "starting" cover — but both go black when the server DTO is null (gap → R7) |
| E7 | TikTok thumbnail URLs (documented shape, not measurable from a walled egress) | Signed CDN URLs (`*.tiktokcdn.com`) carrying expiry parameters — they are **not permanent assets**; a cached URL can 404 later (gap → R6) |

## 4. The option space

### Thumbnail acquisition

| Option | Verdict | Reason |
|---|---|---|
| **O1 — Server-side keyless oEmbed** (ADR 0004 §2) | **Shipped** (the ladder's rung 1) | The documented, licensed metadata lane; works whenever an egress can reach TikTok; cached 6 h soft / 24 h hard + last-good. On WebFlix's egresses it usually walls — necessary but not sufficient. |
| **O2 — Viewer-side oEmbed hydration** | **Shipped in P88 (the decisive rung)** | The endpoint is keyless AND CORS-open (E2), so the viewer's residential browser is the vantage TikTok does not wall. Mirrors every server law: URL built through the URL law, `embed_product_id` foreign-row guard, 6 h TTL (memory + sessionStorage), in-view gated, concurrency-bounded (max 3), fills only server-nulls. |
| **O3 — TikTok Display API / Data API** (`video.cover_image_url`) | Operator-gated future | Requires app approval + tokens (the M4 rung — skipped by the work order). Would upgrade rung 1 server-side for all viewers with zero viewer fetches. Parked until credentials exist. |
| **O4 — Scraping** (web endpoints, mobile API, Apify actors) | **Rejected** | ADR 0004's no-scraping law; robots.txt unverifiable from walled egresses; ToS exposure; brittle. |
| **O5 — Server-side thumbnail byte proxy** | **Rejected** | Same law (proxying media/metadata bytes WebFlix was not served is the scraping adjacency P59 rejected); signed URLs expire anyway; adds bandwidth for zero honesty gain. |
| **O6 — Frame extraction** (canvas / ffmpeg on the video) | **Rejected / infeasible** | Requires the media bytes (TikTok's property — the extraction is scraping); the player iframe is cross-origin-opaque. |
| **O7 — next/image optimization of thumbnails** | **Rejected (law ratified)** | ADR 0004 §4 plain-`img` law: TikTok thumbnails ride unpredictable signed-CDN hosts, so `remotePatterns` churn is endless and the optimizer's cache of expiring URLs buys stale-404 risk. The YouTube shorts shelf itself uses a plain `<img>` — parity is literal. |
| **O8 — Import-time metadata sidecar** (persist `thumbnailUrl` at import when the server lane answers) | Future candidate, not implemented | The DB stores only `postId + authorHint` today; the DTO composes at read time. A sidecar changes the schema and only helps when the import-time egress can reach TikTok (currently it cannot). Honest to park. |

### Hover-play

| Option | Verdict | Reason |
|---|---|---|
| **H1 — Official Embed Player iframe, muted-autoplay params** | **Shipped in P88** | `autoplay=1&force_muted=1&loop=1&rel=0` — audited against the 2026-10-28 embed-player docs (`force_muted` is the documented start-muted name). Muted autoplay is browser-permitted; TikTok's own controls ride the iframe so unmute stays native. |
| **H2 — postMessage play on a pre-mounted player** | Rejected for tiles | Keeps media alive offscreen between hovers (the offscreen-media law violation); the one-alive law is cleaner with a fresh iframe per dwell + unmount on leave. (The feed's controller keeps postMessage play/pause — that is the full-bleed surface's own law, untouched.) |
| **H3 — native `<video>` with extracted media** | **Rejected** | Media-byte extraction = scraping (ADR 0004). |

### The parity contract (YouTube ⇄ TikTok)

| Contract element | YouTube shorts tile | TikTok tile (P88 + this lane) |
|---|---|---|
| Thumbnail source | server DTO (`thumbnailUrl`) from YouTube's CDN | the ladder: server DTO → viewer oEmbed hydration → fallback tile |
| `<img>` form | plain `<img loading="lazy">` | plain `<img loading="lazy">` + `referrerPolicy="no-referrer"` (R5) |
| Dwell | 450 ms (`DWELL_MS`, shared constant) | 450 ms (the same constant's value) |
| Pointer gating | hover only exists on fine pointers | `matchMedia("(pointer: fine)")` gate; coarse taps deep-link into the feed |
| Preview transport | official YouTube player, muted | official TikTok Embed Player, `autoplay=1&force_muted=1&loop=1&rel=0` |
| One-alive law | preview pauses/stops on leave | iframe unmounted on leave (pause-then-unmount); at most one preview per page |
| Tap behavior | opens the shorts surface | deep-links `/shorts?source=tiktok&post=<id>` |
| Feed poster | `posterUrl` while the player boots | poster lanes exist; hydrated through the client lane when server-null (R7) |

## 5. Recommendations

| # | Recommendation | Status |
|---|---|---|
| R1 | The three-rung thumbnail ladder (server oEmbed → viewer oEmbed hydration → honest fallback tile); server values always win, hydration fills only nulls | **Shipped P88** (`tiktok-preview-client.ts`) |
| R2 | Hydration discipline: in-view gate (IntersectionObserver, 300 px rootMargin), max-3 concurrency, 6 h TTL in memory + sessionStorage | **Shipped P88** |
| R3 | The `embed_product_id` foreign-row guard mirrored client-side — a mismatched answer is absence, never a rendered foreign row | **Shipped P88** |
| R4 | The hover contract: 450 ms dwell, fine pointers only, ONE official Embed Player iframe with the audited muted params, unmount on leave | **Shipped P88** |
| R5 | `referrerPolicy="no-referrer"` on EVERY TikTok thumbnail `<img>` (the feed poster already carried it; the home-shelf/card tiles did not) — request-level hygiene against referer-gated CDN edges, consistent with the feed | **Implemented this lane** |
| R6 | Expired-signed-URL resilience: `onError` on a thumbnail `<img>` drops the broken image and restores the honest fallback tile (E7 — signed CDN URLs expire; the 6 h metadata TTL can outlive them) | **Implemented this lane** |
| R7 | Feed-slide poster hydration: when the server DTO has no `thumbnailUrl`, the feed player's poster/starting-cover hydrates through the same client oEmbed lane (E6 — YouTube slides already poster while booting; the walled-TikTok black cover was the last non-parity face) | **Implemented this lane** |
| R8 | `preconnect` to `www.tiktok.com` on tile surfaces — the first hydration fetch skips DNS+TLS handshakes | **Implemented this lane** |
| — | Operator-gated future: Display API server lane (O3) once approved; import-time metadata sidecar (O8) if egress reality changes; `TIKTOK_CURATED_IDS` env extension (no-deploy universe growth) | Parked, unchanged |

## 6. Gates

- typecheck + eslint clean; the tiktok lane's pins extended for R5–R8 (referrer policy, error
  fallback, poster hydration, preconnect); full battery foreground-to-file.
- The money gate stays CLOSED (nothing money-shaped touched).
