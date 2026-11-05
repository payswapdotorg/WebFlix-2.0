# P96 — the profile-playback gap (G17) + the dialog eject (G18): closure evidence

The report: `docs/research/2026-11-05-p96-profile-playback-and-the-dialog-eject-report.md`
(fresh open-ended guest walk of the P95 production build — two new gaps found, closed in the
same wave, report-first).

## Gates

- tsc 0 · eslint 0/0
- tiktok lane 159/0 (was 149 — 24 new pins)
- FULL battery 2986/0 exit 0 (2962 + 24; foreground-to-file)

## Local verification (dev build, agent-browser, guest)

- `/shorts?source=tiktok&creator=scout2015` → the scope chip (`@scout2015 · channel · Clear`),
  the feed aria-label "TikTok feed by @scout2015", exactly one slide (scout's single post),
  exactly one official player iframe (the one-iframe law holds in scope).
  `scoped-feed-creator-chip.png`.
- Clear → `/shorts?source=tiktok` (the full 17-post feed).
- `/shorts?source=tiktok&creator=brittanypeachhh` (two cited posts) → two slides, one iframe;
  mobile 375×812: no horizontal overflow. `scoped-feed-375-two-posts.png`.
- `/tiktok/scout2015` → "Watch in Shorts" href `/shorts?source=tiktok&creator=%40scout2015`;
  the grid card's main link `/shorts?source=tiktok&post=6718335390845095173&creator=%40scout2015`
  (the scoped deep link); the creator link stays internal; the outbound stays.
- Guest Add-TikTok → the INLINE toast ("Sign in to add TikTok posts to your shelf" + Sign-in
  action), URL unchanged — the G18 eject is dead.
- The hydration warnings in the dev console are the pre-existing dev-mode ladder artifact
  (server-rendered fallback tiles vs the client thumbnail lane); production builds strip them
  (P95 verified 0 console errors on prod).

## Production verification (dpl_9j2VnTYNh6i1AScNGSJapu6dWwuA, sha b632e77, READY)

- Bundle markers in the served chunks: `tiktok-scope-chip` + `tiktok-channel-watch-scoped`.
- `/api/tiktok/feed?creator=brittanypeachhh` → 200, brittanypeachhh's real posts;
  `?creator=bad%20handle!` → 400 "Invalid TikTok handle"; `?creator=nobodyhere` → 200 honest
  empty.
- The scoped feed page renders the chip + "TikTok feed by @brittanypeachhh" (two regions) with
  exactly one player iframe.
- `/tiktok/brittanypeachhh` → the CTA + both cards' main links carry the scope
  (`prod-channel-scoped-cta.png`).
- The scoped card click-through lands on
  `/shorts?source=tiktok&post=7323004085043612959&creator=%40brittanypeachhh` with the chip up
  and her two posts in scoped order (`prod-scoped-deeplink-landing.png`).
- Guest Add-TikTok on prod → the inline toast, URL unchanged (G18 verified live).
- Fresh-load console: clean.
