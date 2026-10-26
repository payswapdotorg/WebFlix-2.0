# TikTok integration — research record (P58-TIKTOK-SOURCE)

Date: 2026-10-26 · Station: the resident TL station · Lane: wfx2/p58-tiktok-source
Task: "research ways to embed TikTok videos to WebFlix without breaking any of the
existing features — write a report, then implement the suggestions in that report."

Governing law: **ADR 0002 (multi-source policy)** — the source-adapter seams it
codified for Netflix are the template any future source must follow. This record
applies them to a source with the OPPOSITE transport reality of Netflix: where
Netflix blocks embedding and DRM-walls playback, TikTok **officially invites**
third-party embedding — in-app playback is legal without any credential.

## 1. The honest asymmetry, part two (TikTok ≠ Netflix ≠ YouTube)

| Capability | youtube.com | netflix.com | tiktok.com |
| --- | --- | --- | --- |
| Public data API | InnerTube + official Data API | none public | **official oEmbed (keyless)**; Data API v2 needs an approved developer app + user tokens; Research API is academic-gated |
| Official embed player | yes (IFrame API) | **no — blocked** (frame-ancestors) | **yes — Embed Player, officially supported** (`www.tiktok.com/player/v1/<postId>`), plus legacy blockquote.js (deprecated per docs) |
| In-app playback legality | yes | impossible + illegal (DRM/§1201) | **yes** — the direction TikTok's own Share → Embed flow points; attribution (creator, description, music) is built into the player |
| Per-title deep link | `watch?v=` | `watch/<videoId>` | `@<user>/video/<postId>` (+ `vm.tiktok.com` short links) |
| Catalog/feed metadata without keys | yes | only Tudum Top 10 | **no public feed API** — oEmbed answers per-URL only |
| Stream extraction | partial | illegal | ToS-violating (downloader/ripper ecosystem) — excluded |

Official documentation captured live from this station 2026-10-26
(`developers.tiktok.com/docs/en/embed-player`, last updated **2026-10-22**;
`/docs/en/embed-videos`; `/docs/en/embed-creator-profiles`):

- **Embed Player** — `https://www.tiktok.com/player/v1/{postId}` iframe.
  14 documented query params: `controls, progress_bar, play_button,
  volume_control, fullscreen_button, timestamp, loop, autoplay, music_info,
  description, rel, native_context_menu, closed_caption, muted` (all 0/1).
  Host⇄player `postMessage` protocol tagged `"x-tiktok-player": true` —
  host→player: `play, pause, seekTo, mute, unMute, navigateTo`; player→host:
  `onPlayerReady, onStateChange (-1 init/0 ended/1 playing/2 paused/3
  buffering), onCurrentTime, onMute, onVolumeChange, onImageChange,
  onPlayerError`. Error codes: **1001 INVALID_VIDEO, 2001 SERVER_ERROR,
  3001 PLAYBACK_ERROR, 3002 AUTOPLAY_ERROR**.
  **Usage limits**: per-embedding-domain request-volume caps, temporary
  unavailability, auto-resume — benign at WebFlix scale (tens of embeds).
- **oEmbed** — `GET https://www.tiktok.com/oembed?url=<video-url>`, no key,
  oEmbed.com spec; documented example returns `version, type:"video", width,
  height, html (a player/v1 iframe), provider_url, provider_name:"TikTok",
  embed_product_id (= postId), embed_type`; real-world responses add
  `title, author_name, author_url, thumbnail_url, thumbnail_width/height`
  (parser treats everything beyond `embed_product_id` as optional).
- **Embed Creator Profiles** — official profile embed (stats + up to 10 recent
  videos); private/underage accounts refuse embedding by design.
- The docs' own deprecation note: "Embed Videos will be deprecated soon.
  Existing integrations will migrate automatically. We recommend using
  **Embed Player** for new integrations." → blockquote.js is out.

**Egress reality (measured from this station, 2026-10-26):** every
`www.tiktok.com` path — `/oembed`, `/player/v1/<id>`, `/embed/v2/<id>`, even
`/robots.txt` — answers this datacenter's HK-geolocated egress with
`302 Found (TLB) → https://www.tiktok.com/hk/about`. TikTok bot-gates the
whole domain from this IP. Two consequences, one per lane:

1. **The embed lane is immune to our egress wall**: the iframe is fetched by
   the VIEWER's browser, never by WebFlix's servers. What is walled here is
   the station's own network, not the integration.
2. **The oEmbed metadata lane degrades honestly** when `tiktok.com` is
   unreachable from the server egress (this sandbox: walled; production
   Vercel AWS egress: verified live post-deploy, see §5). The shared
   `cached()` adapter (soft TTL 6h/24h + last-good) absorbs the flakiness —
   the same ladder the Netflix pools run.

## 2. Evaluated and REJECTED approaches (with reasons)

1. **Stream extraction / downloader APIs** ("no-watermark download",
   ssstik-style rippers, third-party MP4 CDNs): TikTok ToS violation, copyright
   infringement, watermark circumvention (the watermark IS the attribution the
   ToS wants). Never — same family as Netflix DRM extraction.
2. **Scraping tiktok.com web surfaces** (trending, tag pages, profile pages):
   `robots.txt` itself is unreachable from the station egress (302→/hk/about) —
   compliance cannot even be VERIFIED, let alone asserted; the web app is
   aggressively bot-gated; the shape churn risk is the worst of any surface.
   Rejected under ADR-0002 §2's read policy.
3. **Data API v2 (Display API)**: requires an approved developer application,
   the operator's TikTok account binding, and user access tokens for anything
   beyond public-info queries. A real lane — but operator-gated, and nothing in
   this task needs it (embedding is keyless). Documented as a follow-up.
4. **Research API**: academic/NGO-gated. Out of scope by definition.
5. **Apify TikTok scraper actors** (the operator's Apify account is live —
   `prestigious_peanut`): the bounded-harvest analog of the Tudum pools would
   work, but actor runs cost credits (FREE plan = $5/mo), output schemas vary
   per actor, and the curated-embed lane needs NO harvest to function. Kept as
   a documented future pool source (gated on the operator), not an implementation
   dependency.
6. **Legacy blockquote.js embed (Embed Videos)**: officially deprecated;
   migration is automatic per docs — skip the legacy form entirely.

## 3. The APPROACHED approach: official Embed Player + keyless oEmbed + a curated, bounded library

1. **Playback = TikTok's own official Embed Player.**
   `https://www.tiktok.com/player/v1/<postId>` iframes, built by exactly one
   file (`src/lib/tiktok/urls.ts` — the law mirrors `netflix/deeplink.ts`).
   WebFlix owns browse, curation, the hub, and the error surface; TikTok owns
   the player, the stream, and the attribution. No TikTok byte is proxied,
   cached, or extracted — the iframe is the integration.
2. **Metadata = keyless oEmbed through the Netflix seams.** Server-side only,
   via an injectable upstream seam (`src/lib/tiktok/upstream.ts`), cached
   through the shared Upstash `cached()` adapter (soft TTL 6h/24h + last-good,
   own `tt:*` keyspace), DTO carries honest provenance
   (`source: "tiktok-oembed" | "tiktok-curated" | "last-good" | ""`,
   `unavailable` + reason). Everything beyond `embed_product_id` is optional —
   a minimal documented-shape answer still renders an honest card.
3. **Library = curated + bounded + env-overridable.** TikTok publishes no feed
   API, so the hub's universe is a small curated seed list in-repo,
   overridable by `TIKTOK_CURATED_IDS` (comma-separated post URLs or bare
   postIds — deduped, capped at 40). No Prisma tables in v1 (no user data, no
   mirror — there is nothing bounded-pool-shaped to mirror yet). The global
   search shelf rides the curated list ONLY (render-when-answers law).
4. **Integration points — additive only (ADR-0002 §6):**
   - sidebar row `/tiktok` (the third source's hub);
   - `/tiktok` hub — ISR shell + client view (the `/netflix` pattern): curated
     grid, honest empty/degraded states;
   - `/tiktok/v/<postId>` — the in-app playback page: Embed Player iframe +
     player-error banner (1001/2001/3001/3002 surfaced honestly) + attribution
     from cached oEmbed + outbound `Open on TikTok`;
   - `/api/tiktok/rail` + `/api/tiktok/video/<postId>` — the two read routes
     (rate-limited like their Netflix siblings);
   - global search results gain a TikTok shelf AFTER the Netflix shelf —
     renders only when the curated library matches, never blocks YouTube
     answers;
   - `next/image` untouched: TikTok thumbnails ride unpredictable signed-CDN
     hosts, so v1 cards use plain `loading="lazy"` `<img>` (no
     remotePatterns churn; documented residual).
5. **Player errors are data.** `onPlayerError` renders an honest banner
   (invalid video / TikTok server error / playback failure / autoplay blocked)
   instead of a silent black frame; the outbound deep link stays.
6. **Non-interference pins** (the lane law, enforced by tests): the tiktok
   module never imports youtube business logic (the shared Upstash cache
   adapter is infrastructure, the same exception the netflix module already
   rides); every pre-existing suite must pass byte-identical.

## 4. Compliance posture

- **Embedding is the licensed path**: TikTok's Share → Embed flow and the
  official Embed Player docs exist precisely for this; creator + description +
  music attribution ship inside the player; outbound links point back to
  tiktok.com.
- **No credentials, no scraping, no extraction, no key circulation**: the v1
  lane introduces ZERO new secrets (oEmbed is keyless) and adds at most one
  optional env var (`TIKTOK_CURATED_IDS`).
- **Rate impact**: oEmbed is fetched at most once per postId per soft-TTL
  window (shared L2 when Upstash is configured; per-instance in dev), plus the
  per-domain player limits TikTok itself applies.
- **Private/underage/private-later accounts**: refuse embedding by TikTok's
  own design — surfaced via the player error banner, never worked around.

## 5. Residuals / follow-ups

- **Prod oEmbed verification**: this station's egress is walled for tiktok.com
  (measured); the lane ships honest-degrade-first, and the post-deploy step
  verifies the keyless oEmbed answer from production egress (`/api/tiktok/video/…`
  on the deployed site).
- **Feed depth**: the curated list is the honest v1 universe. A TikTok pool
  (Apify actor through the broker, or Data API v2 if the operator registers an
  app) can later replace the seed with a bounded harvest — the seam layout
  (`upstream.ts`, `library.ts`) anticipates it.
- **Creator Profile embeds** (official) are a natural hub upgrade once a
  curated-author list exists.
- **next/image enrichment**: add TikTok CDN `remotePatterns` only if the
  operator wants optimized thumbnails (domain zoo churn, signed URLs expire).
- **Shorts-adjacent UX** (vertical rail, autoplay countdown): the Embed Player
  postMessage API (`onStateChange`, `seekTo`, `mute`) supports it later without
  contract changes.

## Corrections

- (none yet — P58 fresh record)
