# WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — M1 evidence (2026-11-03)

Commit under test: working tree on main @ 5059db0 + this rung's changes (pre-push).
Browser: headless Chromium via agent-browser, 1280x800 + 375x812, Linux sandbox.
Posts exercised: 6718335390845095173 (TikTok's docs example, @scout2015),
7206561191609716014, 7157587293451062574 — all from the cited curated universe.

## Verified live (real browser)

1. `/shorts?source=tiktok` renders the TikTok feed: 12 slides (curated page 1),
   the shared source selector with TikTok selected, the 9:16 active slide
   geometry identical to YouTube's, attribution overlay (@scout2015 + the
   TikTok source badge), the capability-driven rail (Share + Open on TikTok;
   ZERO like/dislike/comment/follow affordances in the DOM).
2. The official Embed Player request fires with the documented params:
   `music_info=1&description=1&rel=0&controls=1&timestamp=1&closed_caption=1&loop=1&autoplay=1&force_muted=1`.
3. ACTIVE-SLIDE LAW (the M1 core): keyboard ArrowDown walked three slides —
   the iframe src flipped post-by-post (6718… → 7206… → 7157…) and the page
   held EXACTLY ONE tiktok iframe at every step (pause-then-unmount law:
   the previous player's official `pause` command rides out through the
   living iframe, then the unmount beat removes it).
4. URL state: default /shorts = YouTube (25 slides, YouTube chip selected);
   the selector click flips to /shorts?source=tiktok via router.replace
   (scroll:false); RELOAD preserves the TikTok feed (stillTiktok:true,
   iframe re-mounts); BACK after a flip returns to the previous PAGE
   (verified /live → /shorts → flip → back → /live — the flip leaves no
   history entry); the deep link /shorts?source=tiktok&post=<id> renders
   the feed spliced at that post (server-rendered; verified for a post in
   the universe).
5. /tiktok/v/6718335390845095173 → server redirect to
   /shorts?source=tiktok&post=6718335390845095173 → the shared feed at that
   post (the compatibility law; the old one-post playback page is gone).
6. HONEST DEGRADATION, real-wall-verified: this sandbox's egress IP is
   geo-walled by TikTok's embed routing — the player document request
   `GET https://www.tiktok.com/player/v1/<id>?…` is redirected to
   `https://www.tiktok.com/hk/about` (TikTok's HK region landing), so no
   player JS boots and no protocol message ever arrives. The feed's 12s
   readiness guard fires and renders the honest banner ("The TikTok player
   didn't load from this network… Open on TikTok") and reports the timeout
   to /api/tiktok/player-events (200). This is the P59-R4 designed
   region-walled-viewer recovery, exercised live against the REAL wall.
7. Mobile 375x812: horizontal overflow 0px on the TikTok feed.
8. YouTube regression: the default feed renders as before (same slide
   geometry, All|Live chips, player slot); the full repo battery holds
   (boot 872/0 incl. feed-family source-scans + shorts-shelf; watch 712/0;
   liveshorts 150/0; the live lanes 446/0 ×15 — 8th consecutive exact).

## The one acceptance point this egress cannot satisfy

M1 point "at least one successful real viewer-browser playback": TikTok
refuses to serve the Embed Player to THIS sandbox's IP (the hk/about
geo-redirect above — measured for three distinct posts and for the
pre-existing /tiktok/v/<id> player surface, i.e. the wall predates this
work and is network-property, not code). Every code path around playback
is proven: the protocol unit tests (envelope + narrowest targetOrigin),
the component battery (mount law, origin+source validation, ready/error/
3002/timeout surfaces, one-shot telemetry, pause-then-unmount), and the
route battery (cursor paging, splice, dedupe, 400s). The final playback
proof lands with the first viewer network TikTok serves — the production
deployment (operator-gated, the Vercel team block) or any non-walled
viewer egress.

## Gates

- tsc 0; eslint 0 on every touched file.
- The full repository battery `bun run test`: 2902 pass / 0 fail across
  25 lane groups (the TikTok lane grew 66 → 111 with the four new files:
  feed-contracts, feed-route, feed-player, shorts-feed).
- The live lanes: 446/0 ×15, per-lane 2/27/89/91/27/20/77/36/15/13/8/11/
  11/8/11 — the eighth consecutive exact match.
