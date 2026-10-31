# ADR 0005 — WebFlix LIVE media provider: LiveKit (interactive stage), Phase 1

**Status:** ACCEPTED (Phase 1 vertical slice proven 2026-10-31)
**Decided by:** TL, under [issue #2](https://github.com/payswapdotorg/WebFlix-2.0/issues/2)
**Work order:** [WFX2-LIVE-PLATFORM-1](../plans/work-orders/WFX2-LIVE-PLATFORM-1.md) §5
**Supersedes:** none. **Related:** ADR 0004 (TikTok stays a separate connector).

## Context

Phase 1 requires a real, first-party live transport: a host publishes camera+mic
from a browser on HTTPS, a separate viewer watches in another browser, and
end/reconnect state reconciles without phantom LIVE rooms. The work order
mandates a provider-neutral adapter (`src/lib/live/provider.ts`) so the choice
is revisitable without touching routes or renderers.

Candidates per the work order: **LiveKit** (WebRTC SFU for the interactive
stage), **Cloudflare Stream WebRTC** (WHIP/WHEP audience delivery, GA
2026-10-27), **Mux LL-HLS** (fallback distribution), Vercel WebSockets for
event fan-out (GA 2026-10-20).

## Decision

**Phase 1 pins LiveKit as the interactive-stage provider.** The adapter
boundary stands; only `src/lib/live/livekit-adapter.ts` is LiveKit-specific
(server-only).

## Evidence (measured 2026-10-31, not assumed)

1. **Credentials were already provisioned in production**: the Vercel project
   `webflix-2-0` carries `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
   (verified via the Vercel API). The sandbox spike used the same project.
2. **Spike acceptance §5.1 — host publish**: real browser host on
   `http://localhost:3000` (Chromium 143 via CDP, fake camera/mic) completed
   preflight → `POST /api/live-rooms` → `POST /api/live-rooms/[id]/sessions`
   → `LiveKitRoom` connect → **publishing** (console shows Connected +
   "Publishing", mic/cam toggles). Evidence: `evidence/wfx2-live-platform-1/host-console-live.png`.
3. **Spike acceptance §5.2 — independent viewer + real frames**: a second
   isolated browser session (own cookie jar, own registered account) joined
   through `/live/[roomId]` → `POST /api/live-rooms/[id]/token` → subscribe:
   `videoWidth 640 × videoHeight 360, readyState 4, currentTime 11.3→13.35`
   (real advancing frames — not a poster frame). Evidence:
   `evidence/wfx2-live-platform-1/viewer-room-live.png`.
4. **Spike acceptance §5.4 — scoped authorization**: the viewer's token is
   subscribe-only (grantsForRole law); the viewer UI has no publish
   affordances and a direct `POST /api/live-rooms/[id]/end` from the viewer
   answers **403**. Non-hosts cannot mint publisher tokens (the route mints
   viewer rung only; guest rung arrives with Phase 3 invites).
5. **Spike acceptance §5.5 — end/webhook reconcile idempotency**: host
   End-live → provider `deleteRoom` → session `ended`/`endReason host` →
   room `ended` (DB-verified; no phantom LIVE room), the viewer room
   reconciled to Ended on its poll, and the webhook receiver proved
   fail-closed: tampered body 401, unsigned 401, foreign-secret 401, valid
   signed event 200 `{reconciled:false}` (unknown room), replay idempotent.
6. **Why not Cloudflare Stream WebRTC for Phase 1**: it would add a second
   provider (WHIP ingest + WHEP playback) with its own delivery billing
   (started 2026-10-15) before the room lifecycle model is proven; the
   LiveKit path reached the full vertical slice with zero additional vendor
   setup. Revisit when audience-scale distribution (100+ concurrent viewers
   per room) is a measured requirement — the adapter boundary is the cheap
   seam for that move, and composed-stage egress → Cloudflare Stream input
   remains the documented Phase 6 option.
7. **Cost basis (rate card at decision time, to re-verify before Phase 6)**:
   LiveKit Cloud Free/Pro per-participant-minute egress pricing applies to
   SFU forwarding; a 30-minute host + 4 guests + N subscribers costs
   5×30 source-minutes + N×30 subscribe-minutes of egress. Recorded here as
   the Phase 6 budget input, not a production billing claim.

## Consequences

- Tokens are minted server-side only (`src/lib/live/rooms.ts`), TTL 2h host /
  1h viewer, room-scoped, least privilege (`grantsForRole`); the renderer
  holds a token only in memory; no secret enters client bundles (the adapter
  module is server-only and imports no client code).
- Webhook delivery: LiveKit Cloud delivers to the URL configured in its
  dashboard; until `/api/livekit/webhook` is registered there, the host-path
  teardown fully reconciles state and the webhook is the independent backstop
  (its fail-closed behavior is proven above).
- Provider absence is an honest state: routes answer `503
  provider-not-configured` and both UIs explain it — no fake success.
- The adapter interface (`mintToken/destroyRoom/roomExists/parseWebhook`) is
  the seam for adding Cloudflare Stream or Mux later; ADR-0006 would record
  any Phase 6 distribution move with its own measurements.
