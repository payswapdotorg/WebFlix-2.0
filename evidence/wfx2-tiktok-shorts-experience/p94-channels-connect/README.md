# P94 — TikTok channels + connect + hardening (production evidence)

Deploy: dpl_9sGAraiK8fJbZE9mDGT1aKfoX5hr, READY, sha 0615239 (P94) on https://webflix-2-0-tepa.vercel.app

- prod-channel-page.png — /tiktok/scout2015 live: H1 @scout2015, stats "1 post on WebFlix", outbound Follow on TikTok → tiktok.com/@scout2015, the card's creator link riding the INTERNAL /tiktok/scout2015 (G1 closed).
- prod-feed-sandbox.png — /shorts?source=tiktok: the feed iframe carries sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" (G3 closed; read live from the DOM).
- prod-studio.png — /studio: the honest in-app "Your videos" surface (G5 closed).
- API probes: /api/tiktok/channel/scout2015 → the derived DTO (handle, avatar candidate, real postCount); /api/connection/tiktok → 401 guest (the session law); /tiktok/@scout2015 → the same page (handle normalization).
- Bundle-marker matrix (18 /shorts chunks): sandbox literal 1, webflix:shorts:muted 1, tiktok-shorts-creator 1, tiktok-shorts-rail-save 1, no-referrer 1, oembed hydration 1 — P89/P90/P94 all in the served build.
