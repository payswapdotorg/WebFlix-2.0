# ADR 0013 — Shorts source boundary: one presentation, many providers

Date: 2026-11-03
Status: Accepted
Context: WFX2-TIKTOK-SHORTS-EXPERIENCE-1 (issue #3, work-order PR #4), base `5059db0`.
Supersedes: nothing. Extends ADR 0002 (multi-source law) and ADR 0004 (TikTok embed policy) to the Shorts surface.

## Decision

`/shorts` is ONE presentation experience with source adapters behind a frozen
boundary:

1. **Shared shell** (`src/components/shorts/shorts-feed-shell.tsx`) owns the
   presentation mechanics ONLY: the fill-the-shell height contract, the snap
   scroller, IntersectionObserver active-slide detection (threshold 0.6),
   keyboard ArrowUp/ArrowDown, desktop chevron callbacks, last-2-slides
   pagination trigger, the loading-more pill, and the loading/error/empty
   chrome. It knows nothing about YouTube or TikTok.
2. **Source adapters** own everything provider-specific:
   - **YouTube adapter** (`shorts-feed.tsx`): InnerTube routes
     (`/api/shorts*`), `ShortsPlayerSlot`, `ShortsEngagementRail`,
     `ShortsCommentsSheet`, the All|Live chips, per-short meta hydration.
   - **TikTok adapter** (`shorts/tiktok/*`): TikTok library routes
     (`/api/tiktok/*`), the official Embed Player active-slide controller
     (`tiktok-feed-player.tsx`), a source-specific action rail, and the
     source selector chips row.
   A source adapter MUST NOT import the other source's DTOs, player, or
   action routes. No TikTok id ever travels through a YouTube action route
   and vice versa.
3. **Feed item types stay provider-specific.** YouTube slides keep
   `ShortDTO`/`ShortMetaDTO`. TikTok slides use `TikTokVideoDTO`. The shared
   shell is generic over the item type; nothing is cast across the boundary.
4. **Source selection is URL state**: `/shorts` defaults to YouTube;
   `/shorts?source=tiktok` selects the TikTok feed;
   `/shorts?source=tiktok&post=<postId>` deep-links a specific post. The page
   reads `searchParams` server-side so back/reload/deep links render the
   right adapter on first paint.
5. **Capability map** (`src/lib/shorts/feed-contracts.ts`): each source
   declares which actions the UI MAY render. TikTok ships NO like/dislike/
   comment/follow capability (no approved documented write API — ADR 0004);
   its WebFlix-local actions (share the canonical URL, open on TikTok) and
   honest reporting are the only affordances until an official write API is
   approved. The UI renders actions FROM the map; it never hard-codes
   cross-source claims.
6. **TikTok playback law (extends ADR 0004)**: the official Embed Player
   stays the only transport. The feed controller additionally:
   - mounts the iframe ONLY on the active slide (previous posts unmount —
     the pause law holds by construction; hidden tabs get an explicit
     `pause` command through the documented protocol and a `play` on
     return);
   - sends host→player commands (`play`/`pause`) tagged
     `{ "x-tiktok-player": true, type }` with the narrowest targetOrigin
     (`https://www.tiktok.com`) — never `*`;
   - accepts player→host messages ONLY when BOTH `event.origin` is the
     TikTok player origin AND `event.source` is the mounted iframe's
     contentWindow;
   - autoplays muted (`autoplay=1&force_muted=1` — the documented param
     name per the 2026-10-28 embed-player docs; the pre-2026-10-28 name
     was `muted`), surfacing TikTok's own native volume control for unmute;
     a 3002 AUTOPLAY_ERROR shows the tap-to-play recovery overlay;
   - keeps the honest error / readiness-timeout surfaces of
     `tiktok-embed-player.tsx` (12s budget, one-shot telemetry).

## Consequences

- `ShortsFeed` (YouTube) is refactored ONTO the shell with a behavior-
  identical DOM (the source-scan pins, testids and geometry stay); the
  YouTube regression gates are the referee.
- `/shorts` becomes request-shaped (server-read `searchParams`); its hourly
  ISR is dropped — the page is a thin wrapper and all data stays
  client-fetched from force-dynamic routes (no change to the data law).
- `/tiktok/v/[id]` remains compatible by REDIRECTING into the shared
  experience (`/shorts?source=tiktok&post=<id>`); the hub stays as
  discovery. Old links keep working; there is still no second playback UI.
- The TikTok feed is cursor-paginated over the curated library (the same
  `{ items, nextCursor }` shape law as the YouTube feed) with a deep-link
  splice: a valid `post` param resolves through `getTikTokVideo` (honest DTO
  either way) and leads the feed, so ANY canonical post deep-link works
  before import (M2) lands.
- URL construction for tiktok.com stays centralized in `src/lib/tiktok/
  urls.ts` (the ADR 0004 §1 law).
