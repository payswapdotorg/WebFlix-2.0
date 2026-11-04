# P88 — the client preview lane (thumbnails + hover-play)

**Date:** 2026-11-04 · **Commit:** 6aaa912 · **Production:** dpl (webflix-2-0-jlfpitvmc) READY, sha 6aaa912be96e2c7030b6affa59fa69afcd33778c == origin main

## The lane

- **Thumbnails** ride the honest ladder: server oEmbed cache → viewer-side oEmbed hydration
  (TikTok's keyless endpoint answers `access-control-allow-origin: *` — measured 2026-11-04, the
  same viewer-side official lane the Embed Player rides) → the fallback tile. In-view gated
  (IO, 300px rootMargin), concurrency-bounded (max 3), sessionStorage+memory cached at the
  server lane's 6h TTL, `embed_product_id` foreign-row guard mirrored. Server values always win;
  only nulls fill.
- **Hover-play** mirrors the YouTube shorts-tile contract: 450ms dwell, fine pointers only
  (coarse taps deep-link into the shared feed), then ONE official Embed Player iframe —
  `autoplay=1&force_muted=1&loop=1&rel=0&music_info=0&description=0&controls=1` (the audited
  documented params, TikTok's own controls) — unmounted on mouse-leave (the pause-then-unmount
  law; at most one preview alive on a page).

## Production verification (agent-browser, headless Chromium)

- Home: 17 tiles render; the sandbox is TikTok-geo-walled so hydration honestly fails → 17
  fallback tiles (the designed degrade; real non-walled viewers get the CDN thumbnails).
- `matchMedia("(pointer: fine)")` is FALSE in pointerless headless → the gate correctly refuses
  preview (the coarse-pointer law proving itself in the wild).
- With a verification-only matchMedia patch (fine pointer simulated): mouseover → dwell →
  **preview iframe mounts** with the official player URL (screenshot:
  `prod-p88-preview-mounted.png`); mouseout (with a flush delay) → **0 preview iframes**.
- Zero console errors throughout.

## Tests

tiktok lane 138 → **145/0** (5 shelf + 2 card tests: hydration fill, foreign-id honest absence,
dwell mount with param assertions, dwell-cancel, coarse-pointer refusal, card hydration,
card mount/unmount); full battery **2929 → 2936/0**; typecheck + lint zero problems.
