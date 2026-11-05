# P95 — production deployment verification (the unrecorded tail, verified)

The P95 build (sha `0ee0180`) was deployed to production as `dpl_56jZTUKkFuVNQjVkyzQvcJBfBddZ`
(READY 2026-11-05T15:08:39Z, tepa scope) — but the ledger closed before that deploy was
verified. This wave (P95-DEPLOY-VERIFY, docs-only) closes the loop. No product code changed.

## Deployments ledger (Vercel v6 API, tepa team `team_1u4lGvQcgPhzGRBm0G0Qstrj`)

| deployment | sha | readyState | ready at (UTC) |
|---|---|---|---|
| dpl_56jZTUKkFuVNQjVkyzQvcJBfBddZ | 0ee0180 (P95) | READY | 2026-11-05T15:08:39Z |
| dpl_9sGAraiK8fJbZE9mDGT1aKfoX5hr | 0615239 (P94) | READY | 2026-11-05T13:56:03Z |
| dpl_5K8qERKYJPcrUsm5iJLsPG3b6S5t | 65354e4 (P93) | READY | 2026-11-04T21:02:02Z |

Live origin: `https://webflix-2-0-tepa.vercel.app`

## Bundle markers (served chunks, curl)

| marker | proves | verdict |
|---|---|---|
| `webflix:shorts:muted` | P90 mute persistence shipped | ✓ present |
| `no-referrer` | P88/P89 referrerPolicy shipped | ✓ present |
| `oembed` | P89 oEmbed hydration ladder shipped | ✓ present |
| `allow-popups-to-escape-sandbox` | P94 G3 sandbox hardening shipped | ✓ present |
| `ZAI_API_KEY environment variable` | P95 G8 ask-note shipped | ✓ present |
| `No description` | P95 G10 honest empty line shipped | ✓ present |

## Live probes (curl)

- `/api/tiktok/channel/scout2015` → 200, the derived DTO: handle `scout2015`, avatar
  candidate `https://unavatar.io/tiktok/scout2015`, profileUrl outbound, real `postCount: 1`,
  honest nulls (nickname/banner/title), `universeSize: 17`, the video row with the official
  player embedUrl + deep link. `note: null` (no degrade).
- `/tiktok/scout2015` → 200. `/tiktok/@scout2015` → 200 (handle normalization).
- `/api/connection/tiktok` (guest) → 401 `{"error":"unauthenticated"}` — the session law.

## Agent-browser walk (guest, production P95 build)

- Channel page `/tiktok/scout2015`: H1 `@scout2015`, stats line `@scout2015 · 1 post on
  WebFlix`, outbound `Follow on TikTok` → tiktok.com, `Watch in Shorts` link, the
  Videos|About tab strip, the grid with the post card (creator line + `Open on TikTok`),
  the About tab's provenance disclosure ("derived from the posts already riding WebFlix's
  shelf… no follower totals, no bio, no verified badge"), the Handle/Posts/Profile
  description list, and the `Connect your TikTok account in Settings` pointer.
  Screenshot: `prod-tiktok-channel-videos-tab.png`.
- Shorts → TikTok source tab: `Add a TikTok post` affordance, feed regions for
  @scout2015 / @melodizeai / @bsmachinist / @brittanypeachhh, the engagement rail
  (Unmute · Save to my shelf · Share — copy the TikTok link · Open on TikTok · More
  actions), and the ONE-iframe law: exactly one `TikTok player` iframe mounted on the
  in-view card; after hovering the second card the single iframe is on post
  `7206561191609716014` (it MOVED — the pause-then-unmount law holds on prod).
  Screenshot: `prod-tiktok-shorts-rail.png`.
- Mute persistence: Unmute flip → `localStorage['webflix:shorts:muted']` set → reload →
  value survives; the source tab is remembered in the URL (`/shorts?source=tiktok`).
- Internal channel navigation: the feed card's creator line
  (`Open @scout2015's TikTok channel on WebFlix`) navigates to `/tiktok/scout2015`
  (title `@scout2015 — TikTok on WebFlix`).
- Mobile 375×812 on the channel page: no horizontal overflow.
  Screenshot: `prod-tiktok-channel-375.png`.
- Zero page errors; zero console errors.

## The sandbox artifact, documented (not a defect)

Immediately after a fresh `/shorts?source=tiktok` load, the channel link's click point is
covered by the player's `tiktok-feed-starting` pending cover (`absolute inset-0 z-20`,
the white-boot-flash guard). The cover drops when the official player reports `ready` or
at the 12s readiness timeout (`TIKTOK_PLAYER_READY_TIMEOUT_MS`) — after which the link
clicks through. Inside the egress-walled sandbox the handshake was slow, so the cover
held through the first click attempt; the timedOut path dropped it and the navigation
then verified. A real user's cover drops on `ready` (typically sub-second).
