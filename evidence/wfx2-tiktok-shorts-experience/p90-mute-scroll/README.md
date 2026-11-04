# P90 — the mute button, the shelf scroll affordance, and the thumbnail state

**Operator report (verbatim):**
1. "the mute on/off button on shorts/tiktok is not available"
2. "the horizontal list of shorts/tiktok videos is not scrollable on the home page"
3. "tiktok videos still don't show thumbnails"

## What shipped

### 1. The Shorts mute control (both sources)
- `src/components/shorts/shorts-mute.tsx` — ONE shared preference store
  (module-level, default MUTED per the autoplay laws, localStorage-persisted
  at `webflix:shorts:muted`, broadcast to every mounted mirror), the
  `ShortsMuteButton` (the top slot of BOTH engagement rails — YouTube's
  ShortsEngagementRail and TikTok's TikTokFeedRail), and
  `sendYouTubePlayerCommand` (the IFrame API JSON envelope through the
  narrowest origin — the `sendTikTokCommand` mirror).
- YouTube transport: `ShortsPlayerSlot` mounts with `enablejsapi=1` +
  `mute=<preference>` (lazy useState mount-read, src frozen — a live flip
  NEVER reloads the iframe) and translates flips into live
  `mute` / `unMute` + `setVolume(100)` commands.
- TikTok transport: the Embed Player documents NO mute command (the outbound
  protocol is play/pause only), so `TikTokFeedPlayer` re-mounts with the
  documented `force_muted` param flipped (key/mountKey = `post:muted`) —
  the click is the user gesture; the restart is the honest cost. The
  reset identity is (post, muted) — the boot cover re-arms per flip.

### 2. The home shelf scroll affordance
- `src/components/home/shelf-scroller.tsx` — the netflix-rail chevron law
  generalized: hover-revealed paging buttons (a 0.85-viewport step,
  smooth), disabled at the edges, keyboard reachable, hidden below `sm`
  (native swipe stays the coarse gesture), `no-scrollbar overflow-x-auto`
  untouched (the no-page-overflow law holds).
- Edge states re-measure on mount-layout/resize/content changes
  (ResizeObserver), not only on scroll.
- Rides BOTH home shelves: `ShortsShelf` + `TikTokShelf`.

### 3. Thumbnails — the P89 fix is the fix; it is not deployed yet
- The production deployment runs the **P88 build** (6aaa912 lineage): its
  tile/card imgs hotlink TikTok's signed CDN URLs WITH a cross-site
  `vercel.app` Referer — the CDN referer-gates them → broken images, and
  P88 had no `onError` fallback → "thumbnails don't show".
- **P89 (local, unpushed) already fixes exactly this**: R5
  `referrerPolicy="no-referrer"` on every TikTok img (TikTokThumbnailImage)
  + R6 expired/broken-URL honest fallback + R7 feed-poster hydration.
- The P90 pass re-verified the lane end-to-end locally: the in-view gate
  fires, both R8 preconnects land, hydration attempts ride the CORS-open
  oEmbed, and the sandbox's geo-walled egress degrades honestly to the
  fallback tile (34 surfaces, 0 broken glyphs). Deploying P89+P90 is the
  thumbnail delivery — blocked only on the operator's credential vault
  (see the push note).

## Battery
- Full `bun run test`: **2954 pass / 0 fail**, exit 0 (baseline 2939 + 15
  new pins: 11 in the new `shorts-mute` lane, 2 in the new
  `shelf-scroller` lane, 2 shelf integration pins).
- `tsc --noEmit` clean; `eslint .` clean (0 errors, 0 warnings).

## Browser-verified (agent-browser, local dev)
- Home 1440×900: both shelves render with the chevron pairs; TikTok row
  scrollWidth 4392 / clientWidth ~800 → max scroll 3592; right-chevron
  click pages exactly one viewport step (0 → 1021); edge states flip on
  scroll (left enables, right disables at the end).
- `/shorts?source=tiktok`: 12 slides, EXACTLY 1 iframe (the law survives
  the re-mount), src `force_muted=1` → click → re-mount WITHOUT
  `force_muted` + boot cover re-armed + label flip + localStorage `0` →
  click again → `force_muted=1` restored + localStorage `1`.
- `/shorts` (YouTube): the mute button rides every slide's rail; the
  sandbox's YouTube egress walls the embed (the P22-C honest fallback card)
  — the transport is pinned by the lane tests (13 pins).
- Home 375×812: page overflow **0px**; chevrons `display:none` below sm.
- Console clean; screenshots: `home-shelf-chevrons.png`,
  `tiktok-feed-mute-button.png` (the mute button visible at the rail's top
  slot over the feed player).

## Honest degrades (sandbox-only)
- TikTok thumbnails: the oEmbed hydration is geo-walled from the datacenter
  egress (E1) — 0 hydrated thumbs + 34 honest fallback tiles locally; the
  client lane works for real viewers (CORS-open, measured E2).
- YouTube feed embeds: the sandbox probe walls → the P22-C fallback card.
- Neither is a P90 regression; both are the documented posture.
