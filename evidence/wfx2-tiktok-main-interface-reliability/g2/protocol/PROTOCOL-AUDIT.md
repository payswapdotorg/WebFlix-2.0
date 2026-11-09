# WFX2-G2 protocol audit — the player event protocol, source-verified (Worker-B lane)

Base `e0c8c63`. Read-only source audit; no code changed (any defect found would leave this wave per §5 — none was: the protocol handling is complete and honest).

## The embed URL builder (local, no oEmbed render)

- `src/lib/tiktok/urls.ts` L108 `tiktokPlayerEmbedUrl(postId, opts)` — validates the id against `POST_ID_RE` (L109-111) and builds `https://www.tiktok.com/player/v1/<id>?music_info&description&rel&controls…` from documented params locally (L112+). WebFlix never fetches the remote oEmbed html (ADR 0004 §1/§5).

## The standalone embed player (the wall-facing lane)

- `src/components/tiktok/tiktok-embed-player.tsx`:
  - L26-30 `HostMessage` — the documented tag `x-tiktok-player: true` + `type` + `value`.
  - L123-138 `onMessage` — consumes **`onPlayerReady`** (L127: clears the timer, sets ready) and **`onPlayerError`** (L131-137: maps via `describeError` to the honest banner vocabulary).
  - L39-55 `describeError` — the shared error vocabulary (1000-1099 embed-privacy, 2000-2099 provider, 3002 autoplay-block, 3000-3099 player) — the ONE vocabulary the feed host shares (ADR 0013).
  - L59 `TIKTOK_PLAYER_READY_TIMEOUT_MS = 12_000`; L143-150 the readiness timer — error beats timeout, a late ready clears the banner; the timeout reports telemetry `{postId, code: null, type: "READINESS_TIMEOUT"}` (L147).
  - L98-114 `report()` — ONE telemetry report per (post, kind); `POST /api/tiktok/player-events`, best-effort, never surfaced to the viewer.
  - L201-214 the iframe — `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"` (P94-c1: pins the embed out of top-level navigation — the wall-page hijack vector), the official allow list, `loading="lazy"`.
  - Honest absence: L216-220 `tiktok-player-loading` only while `!ready && !error && !timedOut`.

## The feed player host (the surface the deep links splice into)

- `src/components/tiktok/tiktok-feed-player.tsx`:
  - L209 the same `x-tiktok-player: true` gate;
  - L212 `onPlayerReady` → ready; L217 `onPlayerError` → the shared vocabulary; **L233 `onStateChange`** (the state number, L85 comment: −1 init / 0 ended / 1 playing / 2 paused / 3 buffering — the documented YouTube-style mapping) and **`onCurrentTime`/`onMute`/`onVolumeChange`** recorded as handled-ignored channels (L242 comment) — i.e., the FEED host consumes the playing-state channel the standalone embed does not need.
  - L81 outbound commands post back `{x-tiktok-player: true, type}` with `TIKTOK_PLAYER_ORIGIN` as the narrowest targetOrigin — the documented two-way protocol.

## The telemetry route (server side)

- `src/app/api/tiktok/player-events/route.ts` L18-58: rate-limit (L20) → 1KiB cap, declared + actual (L23-30) → JSON parse (L31-36) → `isTikTokPostId(postId)` + int-or-null code (L37-45; the 400 `{"error":"Invalid player event"}` shape the discriminator probe hits) → `code: null` answers `{recorded:null}` WITHOUT writing (L46-50, the P59-R4 non-lethal law) → lethal codes only call `recordDeadPost` (L51) → 502 wrapper honest (L55-58).

## Audit conclusion

The protocol implementation is complete against the documented TikTok embed contract: mount (iframe, official origin), ready, error, playing-state (feed host), current-time (feed host, observed channel), one-shot honest telemetry, and a 12s readiness budget with an honest banner. **The G2 BLOCKED — NETWORK result is NOT an instrumentation gap**: the instrument (`scripts/ops/tiktok-playback-proof.py`) mirrors the origin-trusted message bus independently of the app and would observe `onPlayerReady`/`onStateChange=1`/`onCurrentTime` progression if TikTok served the player. FAIL — INSTRUMENTATION is ruled out by source: every §3 event has an exact, located handler.
