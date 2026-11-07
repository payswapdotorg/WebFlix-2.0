# P102 — In-app TikTok LIVE playback + live navigation (the operator's report, closed)

Date: 2026-11-07 · Window: P102 (trace 1a1b6dbe11457d79) · Base: main @ fd72043
Mandate: the standing "go" — the operator reported: **"I can't view tiktok lives from webflix"** and asked to **"navigate through tiktok lives like I can on tiktok.com."**

---

## 0. The operator's two gaps, named

| Gap | What the operator experiences | The structural cause (measured) |
|---|---|---|
| **G26 — in-app playback** | A live room opens (LIVE badge, real stats) but the video area says "Watch the stream on TikTok" — no in-app video. | The playback ladder's rung 1 (native hls.js, `TikTokLivePlayer`, P100) is **fully built and contract-tested but dormant**: the status provider (`unseenuser/tiktok-live-status-scraper`) returns `stream_urls: null` for every row (re-measured this window, probe R1). The DTO's `stream` field stays null forever, so the ladder always drops to the honest fallback rung. |
| **G27 — live navigation/discovery** | There is no way to browse "who is live now" or move between live rooms in-app, the way tiktok.com's LIVE tab and its swipe navigation work. | P100 shipped per-known-handle status only; the discovery probe (E6) concluded "live SEARCH discovery unreliable" — and this window re-measured it (probes R4/R5): the live-search actor answered **0 rows across two probes** ("lofi", "music", `resultType: "rooms"`). |

## 1. The empirical ground (every claim measured this session, operator's key, real cents)

| # | Probe | Input | Result |
|---|---|---|---|
| R1 | status actor re-probe (lofigirl, LIVE at 191 viewers) | `{"handles":["lofigirl"]}` → run `nCG1D8NXdU0IKeyZw` | SUCCEEDED; the full row: `is_live: true`, title, viewers, started_at, cover — **`stream_urls: null`**. The playback residual is real, not an artifact of the earlier window. |
| R2 | store search "tiktok live / stream / url" | Apify store API | 14 actor candidates; the two purpose-built ones: `automation-lab/tiktok-live-room-stream-urls` ("TikTok LIVE Status & Stream URLs", 2255 runs) and `maximedupre/tiktok-live-search-scraper` (3156 runs). |
| R3 | **playback actor** (`automation-lab~tiktok-live-room-stream-urls`) | `{"usernames":["lofigirl"]}` → run `fPCgH9zPzhAztVgPe` | **THE UNLOCK**: resolved **lofigirl herself** — `isLive: true, viewers: 193, roomId: 7704607314401184534`, and three stream URLs: `flv HD1`, **`hls default → https://pull-hls-f16-tt04.tiktokcdn.com/.../index.m3u8?...`** (signed CDN, `expire≈1795279…` ≈ two weeks), `rtmp`. Exactly what ladder rung 1 (`hls.js`) consumes. |
| R3a | the wrong-creator trap on R3's actor | `{"handle":…}`, `{"username":…}`, `{"users":…}`, `{"liveUrls":…}` (4 shapes) | The actor **ignored every one** and resolved its hard-coded default (`weathernewslive`, 6566 viewers) — the P100 input-body bug class, reproduced 4×. The README names the real key: **`usernames` (plural)**. The implementation pins `{"usernames":[…]}` and carries an identity guard so a default-row answer can never play the wrong creator. |
| R4 | discovery actor (`maximedupre~tiktok-live-search-scraper`) | `{"searchTerms":["lofi"],"resultType":"rooms"}` and `["music"]` | **0 rows both times** (runs `vz2gHRD42DZejabpG`, B2). E6's verdict re-measured: live-search discovery is unreliable. |
| R5 | store-wide schema reads | `/v2/acts/…` for 4 further candidates | None publish `inputSchema` via the API; probing them blind would burn cents with no contract. Recorded as candidates, not taken. |
| R6 | the R3 HLS URL from the SANDBOX egress | `curl` the `index.m3u8` | **504 from the Akamai edge** (`errors.edgesuite.net`) — the same sandbox egress discrimination class P100 documented for `www.tiktok.com` (302 → /hk/about). **This does not predict viewer experience**: playback runs in the *viewer's* browser against `tiktokcdn.com` directly — the WebFlix media-twin law (servers never proxy media). Viewer-side truth is verified in the prod browser walk (below), with the ladder's honest fallback as the failure path. |
| R7 | the activation surface audit (code) | repo inspection | The DTO already carries `TikTokLiveStreamInfo {hlsUrl, flvUrl}`; `hls.js@^1.7.4` is a dependency; `TikTokLivePlayer` is complete (dynamic import, every failure → `onUnavailable`); the view ladder already renders rung 1 **iff** `status.stream.hlsUrl` arrives. The ONLY missing piece was a provider that yields the URL. |

## 2. Verdicts

1. **G26 closes with the second provider.** Chain `automation-lab/tiktok-live-room-stream-urls` (input `{"usernames":[handle]}`) behind the status answer: when status is LIVE, resolve the playback row, map `streamUrls` (hls by `format === "hls"`, flv by `format === "flv"`), fill the DTO's `stream`. The identity guard (row `username` must equal the requested handle) makes the R3a trap class honest: a default-row answer resolves to "no row for @handle" — never a wrong creator's stream.
2. **The cost law extends, it doesn't change.** The playback probe runs ONLY when a viewer is actually looking at a LIVE room (the route composes it after a live status; offline rooms never spend a playback probe). Playback answers cache 120s (a signed URL outlives the room's status cache 30s; the room can change, so the playback answer is re-probed on the room's cadence — the player's own error → fallback rung covers any expiry mid-watch).
3. **G27 closes honestly at the universe's edge.** TikTok's LIVE-tab discovery is API-unreliable (R4/E6, measured twice this window). The honest closure is **navigation over the tracked universe**: the curated 16 + public import authors — ONE batched status run (`{"handles":[…]}` — the status actor's array contract, already pinned) answers the whole board for the cost of a single actor run. The board feeds:
   - a **`/tiktok/lives` hub** (static route; no collision — the G20-style ambiguity "a creator literally named lives" is the standard Next.js static-wins law, accepted and documented): the currently-live grid (cover, title, viewers, creator) with the honest scope statement;
   - **prev/next room navigation on every live room page** (buttons + ←/→ keys — the desktop adaptation of TikTok's swipe), cycling the currently-live list deterministically (handle-ascending order, wrap-around).
4. **Nothing is faked.** No fabricated "popular lives" list, no discovery actor thrown at prod without a contract, no playback claim without the fallback rung standing behind it.

## 3. The TDD closure plan (all suites land RED first)

| Suite | Pins |
|---|---|
| `tests/tiktok-live-playback.test.ts` (new) | `mapApifyPlaybackRow`: the identity guard (the wrong-creator row answers null), hls-by-format, flv-by-format, `resolutionError` rows → null, malformed rows → honest nulls; the state machine: the `{"usernames":[…]}` input-body pin (R3a's class), run→poll(cap)→dataset→map on the injected transport, coalescing, the 60s failure backoff, the 120s TTL; the composition: live status + cached playback → `stream` filled; offline status → NO playback probe spent (the cost-law pin). |
| `tests/tiktok-live-board.test.ts` (new) | the batch probe: one run for N handles (the `{"handles":[…]}` body pin), per-row identity selection, missing rows answered honestly, invalid handles dropped pre-run, the 30s board TTL, coalescing. |
| `tests/tiktok-live-route.test.ts` (extend) | the route composes playback (probing stream DTO while the playback probe flies); the board route's 200/503/502/400 contracts. |
| `tests/tiktok-live-ui.test.tsx` (extend) | the hub grid renders live rooms and honestly omits offline creators; prev/next cycling (order law + wrap); keyboard arrows; the "resolving the stream" note while `streamProbing`; the ladder activation (rung 1 mounts on `hlsUrl`, failure drops to the fallback — existing law re-pinned against the new composition). |
| the standing law batteries | the tiktok import/URL/module laws hold (no `@/lib/youtube` imports in `lib/tiktok`, no literal fallbacks in the view, the G20 law on every new handle surface). |

## 4. Residuals (documented, not papered over)

- **Sandbox egress cannot verify the HLS bytes** (R6) — viewer-side playback is verified on prod with a real browser; if a viewer's network also refuses TikTok's CDN, the ladder's fallback rung answers honestly.
- **Discovery beyond the tracked universe stays closed** (R4/E6) — TikTok's LIVE-tab breadth is not API-honest today; the board's scope statement says so in the UI.
- The playback actor publishes no input schema (R5) — the `{"usernames":[…]}` contract is pinned by tests against the injected transport, and the identity guard makes any contract drift answer honestly rather than play the wrong room.
- Chat READ (Euler key), webcast refresh (now has `roomId` candidates from the playback rows — still dormant), mass discovery — unchanged, operator-gated (P100 §6/§7).

Money gate: the probes above spent the operator's Apify credits (~6 runs, cents) under the standing mandate; no money-shaped product surface is touched.
