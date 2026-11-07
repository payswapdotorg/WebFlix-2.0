# P100 — TikTok LIVE on WebFlix: the in-app live lane (view + interact without opening TikTok)

Date: 2026-11-07
Mandate (trace 1a1b4e6bab9cd1a5): "research the best way to integrate the tiktok live read/write such that users don't need to open tiktok to view and interact with tiktok live session / write a report on it / implement all suggestions of the report using a TDD approach"
Status: REPORT FIRST (the mandate's law) — the implementable set below closes in this wave, TDD; the operator-gated set is documented, not faked.
Gap ledger: **G24** — WebFlix renders TikTok VOD through the official Embed Player, but a LIVE session forces the user out of WebFlix: no live badge, no in-app live surface, no in-app interaction. This report closes the implementable rungs of G24.

---

## 1. The empirical ground (probes run this window, from the sandbox egress)

Every claim below was measured this session (curl + the Apify API with the operator's key). Nothing is assumed.

| # | Probe | Result | Verdict |
|---|---|---|---|
| E1 | `www.tiktok.com/oembed` (the established VOD lane) from the sandbox | `302 → /hk/about`, header `x-redirect-reason: www.tiktok.com_hk` (stable across attempts; region cookies don't help) | The SANDBOX egress is geo-gated off www.tiktok.com. A sandbox artifact — production (Vercel/AWS egress) answered oEmbed in P94–P99 live verification. The live lane must degrade honestly when an egress is gated; it must never assume reachability. |
| E2 | `webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=<bogus>` | `200` JSON: `{"data":{"message":"Request params error"},"extra":{...},"status_code":10011}` | The webcast API host is reachable and answers STRUCTURED JSON even for errors. With a valid room_id this endpoint returns the room info incl. `status` (2 = live, 4 = offline), `live_room_stats.user_count` and `stream_url` (`hls_pull_url` m3u8 / `rtmp_pull_url` flv) — the documented shapes (TikTok-Live-Connector's public protocol notes). |
| E3 | `webcast.tiktok.com/webcast/room/enter/` and `webcast/user/` | `403` (empty body), stable | Signing-gated (X-Bogus/msToken family). Not usable without a signing service. |
| E4 | Apify `unseenuser/tiktok-live-status-scraper` (~41k runs, 99.9% SUCCEEDED/30d), input `{"handles":[...]}` | EMPIRICAL output row: `{handle, unique_id, nickname, is_live, follower_count, verified, avatar_url, room_title, viewer_count, total_enter_count, like_count, started_at, cover_url, room_url, stream_urls, _metadata{fetched_at,...}}`. Captured a LIVE creator mid-probe: `lofigirl — is_live:true, viewer_count:278, "christmas lofi radio"`. Offline rows vary (recently-live rooms carry `viewer_count:1` + title; never-live rows carry nulls) | **The working read provider.** Batched status per handle, no TikTok login, egress-independent (Apify's own proxies), costs a fraction of a cent per run on the operator's free credit. `stream_urls` stayed null even for the live row — this actor does NOT yield stream URLs. |
| E5 | Apify `agentx/tiktok-live-downloader` (input `tiktok_url`) | Run TIMED-OUT on the free plan's default memory (heavy recorder-style actor) | Unsuitable on the operator's free tier. Recorded, not used. |
| E6 | Apify `maximedupre/tiktok-live-search-scraper` (input `{searchKeywords, resultType:"rooms"}`, the required `resultType` discovered via validation errors) | `[]` for "music" — no live rooms returned | LIVE discovery via search is unreliable → mass "who's live" discovery is OUT of this wave (residual §7). Status is per-known-handle only (channel pages + linked creators), which is also the politeness/cost law. |
| E7 | Chat transport (`wss://webcast.tiktok.com/webcast/im/push/…`) | Not attempted — documented requirement: signed request params via Euler Stream (TikTok-Live-Connector's signer); the operator has no Euler key | Chat READ from TikTok is operator-gated (§6). |

The Apify probe runs charged the operator's free credit a handful of cents (7 runs, each ≤ $0.05 class). This is the operator-supplied key doing its job; the implementation's cost law caps probe frequency (TTLs + in-flight dedupe, §4).

## 2. The landscape (what exists at all)

**Official TikTok APIs (developers.tiktok.com):** Display API (profile/video list for the authorizing user), Video API, Research API, oEmbed. **There is NO official LIVE endpoint** — no live status, no live stream URLs, no live chat. TikTok's live tooling exists only for TikTok Shop sellers and internal partners. The app's own prior verdict family ("API-impossible: TikTok writes / counts / hashtag / sound") extends to live status: the official surface simply does not exist.

**Unofficial read paths (what integrators actually use):**
1. **Web-page/webcast scraping**: `www.tiktok.com/@handle/live` HTML or `api-live/user/room` → room_id → `webcast.tiktok.com/webcast/room/info/` → status + stats + `stream_url` (HLS/FLV). Fragile: geo-gates (E1), signing walls (E3), ToS-gray.
2. **TikTok-Live-Connector** (the de-facto npm standard): resolves room, opens the webcast IM websocket for chat/gifts/views. Requires Euler Stream signing (free API key, usage-capped) since the signing walls landed. Server-hosted by nature (long-lived websocket) — a mini-service, not a serverless route.
3. **Third-party orchestration (Apify actors)**: proven this window (E4). Egress-independent, no login, batched, cheap, and the operator's key already exists in the vault.

**Write paths (interact ON TikTok — send chat/gifts):** officially impossible (no API; the pre-P36 YouTube broker lesson applies verbatim: mutations must never depend on one shared logged-in tab or a client-side secret). Unofficial cookie-driven writes violate TikTok ToS and are BANNED by the project's API-impossible law. **Verdict: TikTok-side writes stay honest outbound deep links, forever.**

**The "interact" closure — the design decision this report owns:** the interaction layer for a TikTok live on WebFlix is **WebFlix-native watch-party chat** (durable, signed-in, moderated by the app's own rules), NOT a TikTok-write pretense. Users watch the stream in-app and talk about it in-app without opening TikTok; TikTok-side actions (comment/gift on TikTok) remain explicit outbound links. This mirrors the house pattern: the Remix/Share/Report honest fallbacks, and the P94 About-tab statement ("no TikTok write is claimed or performed").

## 3. The architecture (the coherent plan)

```
viewer browser                     WebFlix server (serverless-safe)              TikTok/Apify
────────────────                   ───────────────────────────────               ───────────
/tiktok/{handle}/live ──GET──▶ /api/tiktok/live?handle= ──cache-hit──▶ status DTO
   │  poll ~6s while                 │ miss: 200 {live:null, probing:true}
   │  probing:true                   │        + after() ▶ probe worker
   ▼                                 │                                  ┌───────────────┐
 watch-party chat ◀─GET/POST─ /api/tiktok/live/chat/[room]              │ Apify actor   │
 (durable Prisma lane)             │ run ▶ poll ▶ dataset ▶ map ──────▶│ (E4, verified)│
                                   │ cache DTO (TTL by liveness)       └───────────────┘
 playback ladder:                  │
   hlsUrl → native hls.js          │ future lanes (operator-gated, §6):
   else → honest fallback panel    │  - webcast room/info refresh (needs room_id)
   + outbound TikTok links         │  - chat READ relay mini-service (needs Euler key)
```

Laws the design rides:
- **The upstream seam law** (lib/tiktok/upstream.ts): every tiktok.com byte flows through an injectable fetch seam. The Apify lane is NOT tiktok.com bytes — it gets its own mirrored seam (`lib/tiktok/live-upstream.ts`) so tests inject fixtures the same way.
- **The URL law** (urls.ts is the only tiktok.com string source): `tiktokWebcastRoomInfoUrl`, `tiktokLiveRoomUrl`, `parseTikTokLiveUrl` all land in urls.ts. api.apify.com URLs live in the live module (not tiktok.com — allowed).
- **The G20 law**: every handle enters through `normalizeTikTokHandle` (trim-then-strip, multi-sigil collapse) before it becomes a roomKey, a probe input, or a URL.
- **The honesty law**: probing is a first-class state (`live:null, probing:true`), never a fake offline; a failed provider is a 502/503 with a real reason; offline is real data (cached) — "she is not live right now" is an answer, not an error.
- **The money gate stays CLOSED** — the Apify lane is status/read-only metadata; nothing money-shaped is touched. Gifts stay an outbound TikTok link.

## 4. The read side (implementable, this wave)

**Provider ladder** (all fixture-driven TDD):
1. **Cache** (the existing `cached()` lane): TTL 30s for LIVE results, 300s for offline results (cost law: a probe costs real cents — an offline answer is cached 10× longer), in-flight per-handle dedupe (one probe per handle per process, `globalThis`-keyed like the hub seam).
2. **Apify status actor** (`APIFY_API_KEY` + `APIFY_LIVE_ACTOR_ID`, default `unseenuser/tiktok-live-status-scraper`): async run → poll → dataset → `mapApifyLiveRow` (the E4 shape, defensively mapped: missing fields → honest nulls). Absent key ⇒ the lane is disabled and the route says so (the connection-card doctrine: the 503 names the enable path).
3. **Webcast direct** (documented, contract-ready): `mapWebcastRoom` pins the `room/info` contract (status 2/4, `live_room_stats.user_count`, `stream_url.hls_pull_url` / `rtmp_pull_url`). It activates the moment any provider yields a room_id (the current actor doesn't — E4). Wiring it into the ladder without a room_id source would be dead wiring; the mapper + contract tests land now, the report records the activation condition.

**Playback ladder** (the live page):
1. A provider yielded `hlsUrl` ⇒ native in-app playback via hls.js (dynamically imported; the viewer's browser fetches the CDN bytes directly — the embed law's media twin: WebFlix servers never proxy media). CORS on TikTok's live CDNs is UNVERIFIED (no m3u8 could be captured on the free tier, §7) — the player therefore treats hls.js failure as a ladder rung, not a crash: error ⇒ rung 2.
2. No stream URL ⇒ the honest LIVE panel: status (LIVE chip, title, viewer count, started-at, cover), the outbound "Open on TikTok" link, and the full watch-party chat. This is the state users get today with the free-tier actor set — and it already satisfies "don't open TikTok to INTERACT".

## 5. The interact side (implementable, this wave)

**Watch-party chat** — a new durable lane keyed by the normalized handle (`roomKey`):
- Prisma `TikTokLiveChatMessage` (both schemas — the P99 parity law): `{id, roomKey, userId→User (shadow identity), clientMessageId, body, deletedAt?, createdAt}`, unique `(roomKey, userId, clientMessageId)` (the idempotency law), index `(roomKey, id)` for cursor paging. Tombstones, never deletions (the native-chat audit law).
- `lib/tiktok/live-chat.ts`: send (session-required, body ≤ 500 chars, idempotent duplicate returns the original row + `duplicate:true`, per-user rate limit via the existing `rateLimit`), list (cursor = last id, tombstoned rows render `removed`), delete own message (tombstone).
- `POST/GET/DELETE /api/tiktok/live/chat/[room]` — guest POST ⇒ 401 (the client renders the INLINE gate, the P96 law — never a hard /signin eject).
- Client: 4s cursor-poll while the live page is open (the /live discovery page's 20s pattern at chat freshness), optimistic append, the honest "messages are WebFlix-native — TikTok's chat is not readable here yet (operator-gated)" footnote.

**TikTok-side write affordances** (honest, outbound): "Comment on TikTok" / "Send a gift on TikTok" ⇒ `tiktokLiveRoomUrl(handle)` (the deep link) — clearly labeled as leaving WebFlix. Never a claimed write.

**Channel-page LIVE badge**: the channel view polls `/api/tiktok/live?handle=` while mounted; LIVE ⇒ badge + "Watch live" CTA to the in-app live page; probing/offline ⇒ nothing renders (honest absence).

## 6. The operator-gated set (documented, NOT built this wave)

| Lane | Blocker | Exact unblock |
|---|---|---|
| TikTok chat READ (TikTok's live chat mirrored in-app) | webcast IM websocket needs Euler Stream signing; no Euler key in the vault | Operator registers a free Euler key → run `TikTok-Live-Connector` inside a `mini-services/tiktok-live-relay` (socket.io, `XTransformPort` law), relay normalized events into the watch-party lane as `kind:"tiktok"` rows |
| Webcast room/info refresh (viewers/uptime at 5s granularity) | no provider currently yields `room_id` (E4) | Any provider that returns room_id (a future actor, or an Euler-signed connector run) — `mapWebcastRoom` + `tiktokWebcastRoomInfoUrl` are already contract-ready |
| Native HLS playback verification | no m3u8 captured on the free tier (E5); CDN CORS unverified | A live-room m3u8 sample (one cheap paid run on a beefier actor, or the relay lane above) — the ladder already treats CORS failure as a rung, so this can only IMPROVE behavior |
| Mass LIVE discovery ("who's live now") | E6: search actor returned nothing; politeness/cost forbids polling the universe | A reliable discovery provider; per-known-handle status (channel pages) is the shipped scope |

## 7. The TDD plan (tests land RED, then the code makes them GREEN)

| File | Pins (approx) |
|---|---|
| `tests/tiktok-live-urls.test.ts` | parseTikTokLiveUrl forms (`/@h/live`, `/live/@h`, `live.tiktok.com/@h`, query/encoding, vm-short honest null, room-id non-claim), `tiktokLiveRoomUrl`, `tiktokWebcastRoomInfoUrl`, internal `tiktokLiveHref`, G20 multi-sigil collapse through every live rung |
| `tests/tiktok-live-map.test.ts` | mapApifyLiveRow (the empirical live fixture + offline variants + malformed row honest nulls), mapWebcastRoom (documented live/offline/error/stream-url shapes), defensive field access |
| `tests/tiktok-live-service.test.ts` | cache TTLs by liveness, in-flight dedupe (one probe per handle), probing DTO, provider disabled ⇒ typed Unavailable, apify run→poll→dataset state machine against a scripted fake fetch, invalid handle ⇒ null |
| `tests/tiktok-live-route.test.ts` | GET contracts: 200 status / 200 probing / 400 invalid / 503 disabled / 502 upstream fail; Cache-Control no-store |
| `tests/tiktok-live-chat.test.ts` | send gates (guest 401, empty/too-long 400, idempotency duplicate:true, rate limit), list cursor + tombstones, delete-own, roomKey normalization (G20 through chat) |
| `tests/tiktok-live-ui.test.tsx` | the live page: LIVE panel vs offline panel vs probing, playback ladder (hls mock fail ⇒ fallback), chat panel (guest inline gate, optimistic append), outbound links labeled; channel-page badge render/hide |

Gates: `tsc --noEmit` 0 · `eslint .` 0/0 · the tiktok lane + FULL battery green · browser-verified locally (live page, chat send/receive as two sessions, badge honesty, 375px) · then deploy + LIVE-VERIFIED production probes + the ledger (wave-claims + WORKLOG) + push. Money gate untouched.

## 8. Residuals after this wave (documented, not papered over)

1. Chat READ from TikTok (operator-gated, §6) — the watch-party lane is deliberately shaped to absorb relayed TikTok events as `kind:"tiktok"` rows later.
2. `stream_urls` yields nothing on the free tier — native playback stays a ladder rung, verified by contract tests, dormant until a stream source exists.
3. Production egress differences (oEmbed gating E1) — the live lane never assumes www.tiktok.com reachability; the webcast mapper and the honest degrade paths cover the gated case.
4. The Apify lane's actor is a third-party dependency: the actor id is env-configurable (`APIFY_LIVE_ACTOR_ID`) so a swap is an env change, not a code change.
