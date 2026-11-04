# P89 — the research record + the hardening lane (R5–R8)

**Date:** 2026-11-04 · **Report:** `docs/research/2026-11-04-tiktok-thumbnail-hover-play-research.md`
**Operator ask:** research the best way to give the TikTok videos thumbnails like the YouTube
shorts — report it, implement every suggestion in it.

## What the research established

- The option space (O1–O8 acquisition, H1–H3 hover transport) with measured evidence E1–E7 —
  see the report §3–§4. The decisive fact is unchanged from P88 and re-measured here: TikTok's
  keyless oEmbed answers `access-control-allow-origin: *` even on the geo-walled 302, so the
  viewer's browser is the vantage that works. Scraping/proxy/frame-extraction/next-image stay
  rejected for the ADR 0004 reasons; the Display API and an import-time metadata sidecar stay
  operator-gated futures.
- Four hardening gaps the audit surfaced became R5–R8 and are IMPLEMENTED in this lane:
  - **R5** — every TikTok thumbnail `<img>` now rides `TikTokThumbnailImage`:
    `referrerPolicy="no-referrer"` (the feed poster's law became the single law).
  - **R6** — an expired signed CDN URL (they carry expiry params) `onError`s into the honest
    fallback tile / minimal card / hidden poster — never a broken-image glyph.
  - **R7** — the FEED slide poster (under-layer + starting cover) hydrates through the same
    client oEmbed lane when the server DTO is null — the YouTube slides' posterUrl parity; the
    caption/attribution law is untouched (server-verified fields only).
  - **R8** — `preconnectTikTok()` warms BOTH connections to the player/oEmbed origin (the CORS
    lane for the hydration fetch, the classic lane for the preview iframe), once per page-load,
    on hydration intent and hover intent. The string rides `TIKTOK_PLAYER_ORIGIN` (the URL law).

## Gates

- typecheck 0; eslint 0 on all touched files; **tiktok lane 148/0** (+3: shelf R6, card R6,
  feed R7 — the P88 hydration pins grew the R5/R8 assertions); **full battery 2939/0**,
  foreground-to-file, exit 0.
- The URL law test caught the first preconnect draft (a tiktok.com literal outside urls.ts) —
  fixed by riding `TIKTOK_PLAYER_ORIGIN`; the law does its job.

## Browser verification (local dev, agent-browser)

- Home: 17 tiles; after scrolling the shelf into view the hydration gate fires → **both
  preconnect links in the head** (`[cors]` + classic — the R8 live proof); 0 thumbnails and 34
  fallback surfaces (the sandbox is TikTok-geo-walled — the designed degrade; real viewers get
  the CDN images).
- Hover (verification-only fine-pointer patch): mouseover → dwell → **1 preview iframe** with
  the official tile URL; mouseout → **0** (screenshots: `hover-preview-mounted.png`,
  `home-shelf-fallback-tiles.png`).
- `/shorts?source=tiktok&post=6718335390845095173`: 12 slides, **exactly 1** player iframe, no
  fabricated posters, console clean.
- `/tiktok` hub: 17 cards. Mobile 375×812: 0 px horizontal overflow.
