# 2026-09-29 — Live YouTube verification log (all claims probed from this session)

All probes ran from the lead sandbox (egress HK, 8.212.10.159) with the logged-in operator session (yaslencatty@gmail.com — browser login completed 03:50Z, no captcha). Fixtures in `tests/fixtures/yt/` (sanitized: no cookies/tokens).

## InnerTube read endpoints (server-side, unauthenticated or cookie-auth)

| # | Endpoint | Result |
|---|---|---|
| 1 | `search {query:"lofi"}` | 200, 711KB, videoRenderer items ✓ |
| 2 | `search {query:"lofi hip hop"}` + cookies | 200, 984KB ✓ |
| 3 | `browse {browseId:"FEwhat_to_watch"}` | 200, 111KB (works auth + no-auth) ✓ |
| 4 | `browse {browseId:"FEsubscriptions"}` | 200, 16KB — valid but empty-state for this account (3 quiet subs); SSR parse of /feed/subscriptions returns 95 items ✓ |
| 5 | `browse {browseId:"FEtrending"}` | **400** — trending is SSR-only; SSR parse works (1.9MB ytInitialData) ✓ |
| 6 | `browse {browseId:"FEshorts"}` / `FEexplore` | 400 — shorts use `reel/reel_watch_sequence` (captured from browser) ✓ |
| 7 | `browse {browseId:"UCuAXFkgsw1L7xaCfnd5JJOw"}` (channel) | 200, 958KB ✓ |
| 8 | `browse {browseId:"FEhistory"}` + auth | 200, 28KB (endpoint valid; content via SSR parse: 2.8MB) ✓ |
| 9 | `next {videoId}` | 200, 400–511KB: video metadata + related + autoplay + comments continuation + conversationBar when live ✓ |
| 10 | Comments: `next {continuation:<comment-item-section token>}` | 200, 263–282KB, 20 commentEntityPayloads ✓ |
| 11 | Live chat: `next → conversationBar.liveChatRenderer.continuations[0].reloadContinuationData.continuation` → `live_chat/get_live_chat` | 200, 121KB, 66 liveChatTextMessageRenderer, timeoutMs=10000, advancing continuation (Al Jazeera live stream gCNeDWCI0vo) ✓ |
| 12 | `notification/get_notification_menu` + `get_unseen_count` | 200 (empty account → 0 items, endpoint valid) ✓ |
| 13 | Autocomplete `suggestqueries-clients6.youtube.com/complete/search` | 200 ✓ |
| 14 | `player {videoId}` | **DEGRADED**: after a burst of calls the datacenter IP got bot-flagged — `LOGIN_REQUIRED "Sign in to confirm you're not a bot"` / `UNPLAYABLE`. Earlier single calls returned videoDetails. → `player` is OFF-LIMITS server-side; metadata via `next`; playback via client embeds. ⚠ |
| 15 | SSR parse `/feed/trending`, `/feed/subscriptions`, `/feed/history` (cookies) | ytInitialData extracted: 1.9MB / 1.7MB (95 items) / 2.8MB ✓ |

## Write endpoints (session actions)

| # | Action | Path | Result |
|---|---|---|---|
| 16 | `subscription/subscribe` {channelId} | direct, SAPISIDHASH classic | **200 server-side** (round-trip: feed reflected, then unsubscribed) ✓ |
| 17 | `subscription/unsubscribe` | direct | 200 ✓ |
| 18 | `like/like` {videoId, params} | direct replay | **401 "must be signed in"** — tried: classic hash, 1P/3P variants, fresh cookies, fresh params, videoId-swapped template params, triple `SAPISIDHASH/…/SAPISID1PHASH/…/SAPISID3PHASH …_u` header + `X-Youtube-Bootstrap-Logged-In: true`. The browser uses an opaque `_u` attestation derivation → like is broker-tier. ⚠ |
| 19 | Like via broker (page-context click in logged-in browser) | broker | **WORKS 100%** (like → aria-pressed flips → unlike reverts) ✓ |
| 20 | Like params protobuf | decoded | `{1:{1:videoId}, 2:{}, 6:{1:<unix-sec>, 2:<hash>}}` for like; unlike uses field3/field5 variants — videoId is templatable (swap verified byte-level) |

## Auth scheme facts

- Session cookies: full set harvested (`SAPISID`, `__Secure-1PAPISID`, `__Secure-3PAPISID`, `SID`, `LOGIN_INFO`, …). All three SAPISID values are identical.
- Classic `Authorization: SAPISIDHASH <time>_<sha1(time SAPISID origin)>` works for subscribe-tier.
- Like-tier requires the new triple scheme with an underived `_u` hash → broker executes it.
- `__Secure-3PSIDTS` rotates; broker browser always has fresh ones.
- YouTube request bodies to youtubei are gzip-compressed (CDP shows encoded bytes; decode = `latin-1 → gzip.decompress`).

## Browser-captured payloads (fixture `request_payload_examples.json`)

- `browse {browseId:"FEsubscriptions"}` (plain, no params)
- `reel/reel_item_watch`, `reel/reel_watch_sequence` (shorts)
- `player`, `updated_metadata` (live metadata polling)
- `like/like` + `like/removelike` (full params)

## Ground rules distilled for workers

1. Never call `player` from server code or tests. Metadata = `next`.
2. Tests use fixtures only (`tests/fixtures/yt/`). Live calls only in running app routes (cached, rate-limited).
3. Live chat polling cadence comes from the response's own `timeoutMs` (typically 10000ms).
4. Comments continuation token lives at `contents.twoColumnWatchNextResults.results.results.contents[].itemSectionRenderer[sectionIdentifier="comment-item-section"].contents[0].continuationItemRenderer.continuationEndpoint.continuationCommand.token`.
5. Live chat continuation: `contents.twoColumnWatchNextResults.conversationBar.liveChatRenderer.continuations[0].reloadContinuationData.continuation`.
6. Trending/subscriptions/history = SSR parse (`var ytInitialData = ({...});</script>` regex), always with cookie auth for personalization.
7. YouTube is the source of truth — no WebFlix-side mirrors of user data.
