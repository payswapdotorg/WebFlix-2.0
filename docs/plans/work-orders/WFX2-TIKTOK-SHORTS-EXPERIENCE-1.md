# WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — TL Work Order

**Status:** Ready for implementation  
**Date:** 2026-11-03  
**Base:** origin/main 5059db036d45913c705a41762823218382c303c3  
**Policy:** docs/adr/0004-tiktok-embed-policy.md  
**Research:** docs/research/2026-10-26-tiktok-integration-options.md and docs/research/2026-10-27-tiktok-embed-breakage-audit.md

## Objective

Make TikTok videos a first-class source inside WebFlix Shorts. The user should be able to open Shorts, switch between YouTube and TikTok, and swipe/scroll through a continuous full-height vertical feed. The active TikTok post plays in the official TikTok Embed Player; previous/offscreen posts pause or unmount. Discovery, import, search, home shelves, saved items and deep links must feel like one coherent WebFlix product.

Do not rewrite or regress YouTube Shorts. Reuse its proven feed experience, not its source-specific playback or action APIs.

## Verified starting state

TikTok is currently a separate 17-post curated grid and one-post page:

- src/app/tiktok/view.tsx renders a multi-column card grid.
- src/app/tiktok/v/[id]/view.tsx renders one embed with metadata underneath.
- src/components/tiktok/tiktok-card.tsx uses fixed w-[160px] sizing even inside the responsive grid.
- src/components/tiktok/tiktok-embed-player.tsx handles readiness/error messaging, but is not driven by the Shorts active-slide lifecycle.
- src/lib/tiktok/curated.ts contains 17 factual curated posts.
- src/lib/tiktok/library.ts uses keyless oEmbed, with a truthful curated fallback.
- src/lib/tiktok/urls.ts owns TikTok URL parsing/building.
- src/app/api/tiktok/* exposes rail, search, single-post and player-event routes.
- oEmbed has been measured blocked from WebFlix's Vercel egress. Missing metadata is a known constraint.

The proven YouTube Shorts reference is src/components/shorts/shorts-feed.tsx, shorts-player-slot.tsx and shorts-engagement-rail.tsx. It already provides full-height snap scrolling, IntersectionObserver active-slide detection, cursor pagination, lazy metadata hydration, keyboard controls, and active-player isolation.

Other useful files: src/app/shorts/page.tsx, src/lib/youtube/shorts.ts, src/components/home/shorts-shelf.tsx, src/components/search/tiktok-search-shelf.tsx.

Tests to inspect and extend include tests/tiktok-ui.test.tsx, tiktok-library.test.ts, tiktok-urls.test.ts, tiktok-routes.test.ts, tiktok-dead.test.ts, shorts-shelf.test.tsx, shorts-wall-fallback.test.tsx and shorts-mapping.test.ts.

## Product and UX contract

1. Add a clear source selector inside /shorts: YouTube Shorts and TikTok. YouTube remains the default. Preserve source in URL state, e.g. /shorts?source=tiktok. Back, reload and deep links must work.
2. The old /tiktok/v/[id] route must remain compatible but open the shared Shorts TikTok experience at that post. /tiktok becomes a supporting discovery/import/collection landing page, not the only way to watch.
3. TikTok uses the same feed geometry and behaviors as YouTube: full app-shell height, 9:16 player stage, snap, touch/wheel, keyboard up/down, IntersectionObserver active slide, cursor pagination, dedupe, error/loading/empty states and bounded in-memory content.
4. Only one TikTok iframe should be active at a time. Previous posts must pause/unmount; hidden tabs, route changes and lost visibility must stop playback. Do not mount every feed item as an iframe or pre-load an unbounded list.
5. The active player is visually dominant. Preserve TikTok's own attribution, creator identity, description and music information. Do not obscure native player controls with WebFlix overlays.
6. Show creator, caption, music, counts and thumbnail only when verified metadata provides them. Missing fields remain missing; no fabricated values.
7. Add real WebFlix actions: local save/watch-later, WebFlix collection, copy/share canonical TikTok URL, WebFlix hide/not-interested and WebFlix report. TikTok-native actions must use official player capabilities or open TikTok.
8. Never show a WebFlix action that claims to have liked, commented, followed or reposted on TikTok unless an approved documented API actually performs the write. Do not call YouTube action routes with TikTok IDs. Use a typed source capability map.

## Player and policy requirements

Keep playback on TikTok's official Embed Player; build its URL only through src/lib/tiktok/urls.ts. No scraping, private endpoints, stream extraction, downloads, media proxying, cookie reuse, no-watermark services or rendering remote oEmbed HTML.

The current player needs to become an active-slide controller:
- Send official play/pause messages as the slide becomes active/inactive.
- Support user-gesture play/unmute and truthful autoplay-denied fallback.
- Handle onPlayerReady, onStateChange, onCurrentTime, onMute, onVolumeChange and onPlayerError.
- Pause when document is hidden or the feed route/source changes.
- Clean up iframe, event listeners and timers on unmount.
- Validate both event.origin and event.source against the intended TikTok origin and current iframe contentWindow before trusting player messages.
- Use the narrowest valid targetOrigin for outbound messages; avoid wildcard.
- Prevent duplicate telemetry under rerenders/StrictMode.

Parameter audit is mandatory: current official Embed Player docs were updated 2026-10-28 and list autoplay, loop, controls, progress_bar, play_button, volume_control, fullscreen_button, timestamp, music_info, description, rel, native_context_menu, closed_caption and force_muted. The current code exposes/builds a muted parameter; verify against the current contract and use documented behavior. Do not assume autoplay always works: 3002 AUTOPLAY_ERROR must show an explicit tap-to-play recovery. Measure desktop and mobile behavior before freezing defaults. TikTok also documents per-domain usage limits, so keep iframe loads bounded.

## Content/discovery strategy

### A. Canonical URL import — first delivery path

Let a signed-in WebFlix user paste a canonical post URL such as https://www.tiktok.com/@creator/video/1234567890123456789.

- Validate with parseTikTokVideoUrl; reject arbitrary hosts and malformed IDs.
- Persist post ID, canonical URL, factual author if present, submitting user, time and provenance.
- Deduplicate by post ID.
- Support private user saves and curator-authorized public discovery additions.
- Use the official embed for playback. Use oEmbed when reachable; when blocked, retain only factual URL-derived identity and a truthful minimal card.
- Do not invent title, thumbnail or metrics.
- Existing parser rejects vm.tiktok.com short links because they need a network hop. Keep canonical-link requirement unless a reviewed supported resolution mechanism is added; explain it in the UI.

### B. Curated library

Keep the 17 factual seed entries and provenance. Add curator-managed public entries from submitted canonical URLs, with dedupe, remove/unpublish, provenance, visibility and review state. Environment overrides should be bootstrap/configuration, not the only content-management method. Do not publish a user's private import globally without authorization.

### C. Official Display API — optional and approval-gated

TikTok Display API exposes user info, video list and video query for an authorized creator. The video.list scope reads a consenting user's public videos; it is not a global For You/trending/arbitrary-user feed API. Current TikTok onboarding requires an approved developer app, Login Kit and TikTok API product, user.info.basic and video.list scopes, and explicit end-user authorization.

If the operator confirms approval and credentials:
- Implement OAuth state validation, secure token storage, refresh/revoke/disconnect and consent.
- Fetch only the connected creator's posts with documented cursor/max_count.
- Persist stable IDs and metadata, not expiring signed cover URLs as permanent assets.
- Refresh cover metadata via official query endpoint (up to 20 IDs per request).
- Never expose access/refresh tokens to the browser or logs.
- Keep API provider optional. Do not block URL import/shared feed on unapproved API access.

Label this content as a connected creator's videos. Never label it global For You.

### Search and home

Retain current TikTok search integration but expand its indexed library. Add a responsive TikTok short-video shelf near the existing home Shorts shelf. Deep-link all cards/search results to the selected post in the shared feed. Keep honest empty states. Do not present the 17-post seed as a personalized recommender.

## Architecture

Preferred: shared Shorts feed shell with a discriminated source-aware feed item. Keep YouTube and TikTok adapters separate:
- Shared shell: viewport, snap, active slide, keyboard, pagination, URL state and feed chrome.
- YouTube adapter: existing InnerTube routes, player slot and action rail stay intact.
- TikTok adapter: TikTok library/API routes, official Embed Player slot and capability map.
- Shared design primitives are fine; provider-specific DTOs, player protocols and actions remain separate.

Do not cast TikTok data into YouTube ShortDTO or rewrite ShortsFeed wholesale. Extract/share the shell incrementally and prove TikTok playback in it before a broad refactor.

If persistence changes, review both SQLite and PostgreSQL schemas/migration laws. New user-saved/curated models must exist in both schemas and have parity tests. Scope private items by user on the server. Curator writes require authorization. Do not store provider tokens in plaintext.

Keep /shorts defaulting to YouTube. Preserve all existing YouTube API semantics and current TikTok routes. URL construction/parsing stays centralized in src/lib/tiktok/urls.ts.

## Dispatch — TL + three workers

TL owns shared contract, UX direction, database/ADR decisions, integration and acceptance. First pin base SHA, read docs/plans/wave-claims.md, record baseline typecheck/lint/YouTube Shorts/TikTok/full tests, check for overlapping claims and freeze interfaces/file ownership.

| Owner | Assignment | Exclusive focus |
|---|---|---|
| TL | Contract, shared feed integration, review and acceptance | Shared shell/DTO/ADR and merge |
| Worker 1 | TikTok active-slide player adapter | Player host/slot, URL params, postMessage lifecycle and player tests |
| Worker 2 | Library ingestion/discovery APIs | URL import, persistence/curation, dedupe, pagination, Display API approval spike |
| Worker 3 | Shorts/TikTok UX | Source selector, responsive feed, cards, metadata/action rail, TikTok landing/import and visual tests |

Workers must not edit shared shell/DTO files concurrently. TL freezes interfaces and assigns exact files in the claims ledger. If Display API is not approved, Worker 2 completes URL import and curated pagination; OAuth is a gated follow-up, not a blocker.

## Delivery sequence

### M0 — Audit and contract freeze
Pin origin/main, read claims ledger, record current baselines, inspect feed/auth/persistence, verify TikTok app approval status, freeze typed source/feed/action/player contracts and create an ADR for the shared presentation/provider boundary.

### M1 — Real TikTok Shorts vertical slice
Acceptance:
1. /shorts?source=tiktok loads a real public post through the official Embed Player.
2. It occupies the actual Shorts 9:16 active slide.
3. User swipes to a second real post.
4. Previous player pauses/unmounts; only new active post plays.
5. URL/back/reload/keyboard/mobile touch work.
6. Ready, autoplay-denied, invalid-post and timeout states recover honestly.
7. Existing YouTube Shorts behavior is unchanged.
At least one successful real viewer-browser playback is required; fixtures alone do not pass.

### M2 — Content library and import
Canonical URL paste/import, private saves, curator-public collection rules, dedupe, cursor pagination, honest metadata fallbacks, legacy deep links, home and search integration.

### M3 — UX and source capabilities
Responsive source selector, creator/caption/music attribution, source-aware WebFlix save/share actions, honest TikTok outbound actions, accessibility/safe areas/focus/reduced motion, and de-emphasize the old isolated page except as a compatibility deep link.

### M4 — Optional Display API
Only after operator verifies app approval, credentials, redirect domains and scopes. Implement OAuth/token lifecycle, connected creator profile/recent feed, pagination, scheduled refresh, cover URL refresh and disconnect/revocation. No global For You claim.

### M5 — Hardening
Cross-browser playback, embed load/domain budget, player cleanup and hidden-tab pause, retry/pagination, import moderation/rate limits, all source regressions, and production deployment plus deployed-SHA verification once the Vercel team block is resolved.

## Acceptance matrix

| Area | Proof |
|---|---|
| Source selector | YouTube default; TikTok deep-linkable and survives reload/back |
| Real playback | Separate browser plays a public TikTok post inside shared Shorts |
| Active-player law | One active iframe; previous pauses; offscreen media silent |
| Feed mechanics | Snap, swipe, wheel, keyboard, pagination and dedupe |
| Data | URL import validates host/ID; duplicate IDs dedupe; missing metadata honest |
| Attribution | Creator/description/music preserved when supplied; outbound original link works |
| Actions | No TikTok like/comment/follow claims without official write capability |
| Player protocol | Origin+source validated; lifecycle events handled; user-gesture recovery works |
| Search/home | Deep-links to selected item; hides gracefully with no results |
| Responsive | No horizontal overflow at 375, 390, 768 and 1440px |
| YouTube regression | Shorts playback/actions/comments/sound/Live filter/pagination remain green |
| Operations | Player latency/errors observed; embed volume bounded; no secrets/media bytes logged/stored |
| Release | Exact SHA, test commands/results, browser/OS, screenshots and production commit recorded |

Store evidence under evidence/wfx2-tiktok-shorts-experience/<milestone>/. Each record identifies commit SHA, browser/OS/viewport, provenance, commands/exit codes, posts played/failed, player states/events, active iframe count, screenshots/console errors and gated/unsupported behavior.

## Quality gates

- bun run typecheck
- bun run lint
- Relevant TikTok and shared Shorts/URL/route tests.
- Full repository battery: bun run test.
- Real browser acceptance on desktop Chromium and mobile Safari/Chrome or documented equivalent.
- At least one real viewer-side TikTok Embed Player success; mocks/fixtures cannot replace it.
- YouTube regressions compared with pre-change baseline.
- PostgreSQL parity if persistence changes.
- No extraction, undocumented endpoints, fabricated metadata, dead controls or hidden failure states.

## Non-goals

- Re-create TikTok's proprietary For You algorithm.
- Build TikTok-wide public search/trending via scraping or undocumented APIs.
- Download TikTok videos or bypass official player.
- Write TikTok likes/comments/follows/reposts without approved documented capability.
- Re-create TikTok monetization/gifting.
- Build a second independent playback UI that diverges from WebFlix Shorts.

The existing Vercel team resource-creation block is a release constraint. Continue code, tests and browser work, but do not claim production deployment until deployed commit is independently verified.

## Official references (reviewed 2026-11-03)

- https://developers.tiktok.com/docs/en/embed-player — official iframe URL, params, postMessage protocol, errors and per-domain limits; updated 2026-10-28.
- https://developers.tiktok.com/docs/en/display-api-overview — user profile/recent videos/query; authorized creator content, not global discovery.
- https://developers.tiktok.com/docs/en/display-api-get-started — Login Kit/API approval, scopes, authorization, pagination and cover refresh.
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list — paginated recent public videos for authorized user.
- https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query — metadata refresh for authorized user, up to 20 IDs.
- https://developers.tiktok.com/docs/en/tiktok-api-scopes — read-only video.list versus publishing scopes.

**Definition of done:** TikTok videos are no longer trapped in a 17-item grid and isolated one-post page. They are a first-class, source-aware experience in WebFlix Shorts, backed by the official TikTok player, real cursor-fed content, user/curator import, honest capabilities and browser-proven active-slide playback, while existing YouTube Shorts remains intact.
