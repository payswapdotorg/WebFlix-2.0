# WFX2-A-S — LIVE + SHORTS evidence & report

**Lane:** `wfx2/waveA-live-shorts` (base: main @ 601489f) · **Worker:** WFX2-A-S
**Sandbox egress: youtube.com WORKS from this build session** (HK egress; every call below hit the real youtube.com through the running app on port 3001). Design probes + live sanity were run against real youtube.com; NO `player` endpoint was ever called (verification log §14 law).

## Live sanity (curl through `bun run dev`, real upstream)

| Call | Result |
|---|---|
| `GET /api/videos/gCNeDWCI0vo/livechat` (poll 1, bootstrap) | **200 — 69 messages** (66 text + banner + system + …), `mode: live`, `pollMs: 10000`, `participants: 1`, `nextToken` present → `evidence/wfx2as/lc-poll1.json` |
| `GET /api/videos/gCNeDWCI0vo/livechat?token=<poll1.nextToken>&mode=live` (poll 2, immediate) | **200 — 0 messages** (empty incremental frame, nextToken advanced) → `lc-poll2.json` |
| Same token re-polled after waiting 12s (> timeoutMs) | **200 — 1 NEW real message** (`@rise9827 — knee drill , supplications`) → `lc-poll3.json` — the live flow genuinely streams |
| `GET /api/videos/gCNeDWCI0vo/live-status` | **200 — `isLive: true, concurrentViewers: 5627, "5,627 watching now", likesText "768K", pollMs 5000`** → `live-status.json` |
| `GET /api/videos/nfhDuOHMp0A/livechat/replay` (NASA ended live, full mode) | **200 — 45 replay messages** with `videoOffsetTimeMsec` 0→15588, `isReplay: true` → `replay-full.json` |
| `…/livechat/replay?offsetSec=100` (offset mode) | **200 — 13 messages, `seek: {mode: offset, calls: 30, reached: true}`** (bounded linear walk) → `replay-offset100.json` |
| `…/livechat/replay?offsetSec=600` | 200 — `reached: false, calls: 40` (walk bound hit at ~10 min of stream depth — see limitations) → `replay-offset600.json` |
| `GET /api/shorts` (seed) | **200 — 25 REAL shorts** (titles + views from the real search response, e.g. `qiXMm-nP6bs — WILD Broken Chair Prank! 🤯 — 341M views`), `nextCursor` present → `shorts-seed.json` |
| `GET /api/shorts?cursor=<seed.nextCursor>` (page 2) | **200 — 24 more shorts** (`PCyfwetT6vg`, `arz3t--LCI4`, …) + nextCursor → `shorts-page2.json` |
| `GET /api/shorts/<seed[0].id>` | **200 — title/likes (802)/views/commentsCount ("66 Comments") + 20 REAL comments** with authors + timestamps → `shorts-meta.json` |

## Guards

- `bun install` — fresh install OK
- `bun run lint` — **clean** (exit 0)
- `bun run typecheck` — **clean** (exit 0)
- `bun test` (full chain `test:boot && test:watch && test:liveshorts`) — **157 pass / 0 fail** (40 + 59 pre-existing + 58 new lane tests)

## New lane tests (58, FIXTURES ONLY — no live network in tests)

- `tests/livechat-mapping.test.ts` (23): real Al Jazeera fixture → 66 text msgs + banner + system mapped; authors/bodies/badges; ids unique; pollMs=10000; nextToken present; participants=1; skipped-actions debug counts (9 placeholders); HAND-WRITTEN synthetic Super Chat (amountText/amountMicros/currency USD/tier color #0f9d58, member badge + memberSince), Super Sticker, member milestone, ticker action, moderator+verified badge mapping; session discovery from synthetic-shaped-from-real next() fixtures (live: token + isLive + 6027 viewers; ended: op2w0w replay token family); replay wrapper mapping (videoOffsetTimeMsec + liveChatReplayContinuationData advance).
- `tests/shorts-mapping.test.ts` (17): REAL search_lofi → 25 shorts-shelf lockups mapped (id/title/viewsText/thumbnail), sequenceParams extraction, accessibilityText splitter; synthetic-shaped reel sequence → entries + cursor (sequenceParams TOP-LEVEL body law); REAL comments_dQw4 → 20 comments (@YouTube first, 963 replies, hearted+pinned, countText "2,457,856 Comments", next token); getShortMeta via stubbed fetcher (2 upstream calls exactly; failure → null; comments failure degrades to metadata-only).
- `tests/liveshorts-api.test.ts` (18): route handlers with upstream mocked via global fetch patch — livechat bootstrap (next + get_live_chat, exactly 2 upstream calls, request body shapes verified), ended-live bootstrap → replay endpoint, no-chat → chatAvailable:false, token advance (1 upstream call, mode passthrough), live-token-400 → auto-fallback to replay, upstream failure → 502; replay route full mode / live video → 409 / no chat → 404 / offset walk (bounded, `seek` reported); live-status (updated_metadata request carries videoId + mimeType; isLive/viewers/likes/pollMs; error → isLive:false); /api/shorts seed (search + reel sequence, sequenceParams top-level) + cursor page (1 call); /api/shorts/[id] (full meta + comments; invalid id 400; unknown 404).

## Fixtures added (all marked in-file)

| File | Nature |
|---|---|
| `livechat_paid_synth.json` | **HAND-WRITTEN** minimal Super Chat / Super Sticker / member-milestone / ticker / badge shapes (real Al Jazeera fixture has no paid items) |
| `livechat_replay_synth.json` | **SYNTHETIC-BUT-SHAPED-FROM-REAL** get_live_chat_replay capture (NASA ended stream; first 8 replayChatItemActions + both continuations) |
| `next_livechat_session_synth.json` / `next_livechat_ended_synth.json` | **SYNTHETIC-BUT-SHAPED-FROM-REAL** minimal next() responses (live + ended variants; token from `livechat_session_aljazeera_meta.json`) |
| `reel_sequence_synth.json` | **SYNTHETIC-BUT-SHAPED-FROM-REAL** reel_watch_sequence response (4 entries + continuationEndpoint) |
| `updated_metadata_synth.json` | **SYNTHETIC-BUT-SHAPED-FROM-REAL** updated_metadata response (real captured values) |

Pre-existing REAL fixtures used: `livechat_aljazeera.json`, `search_lofi.json`, `next_dQw4.json`, `comments_dQw4.json`, `livechat_session_aljazeera_meta.json`.

## Deviations & limitations (honest)

1. **`request_payload_examples.json` does NOT contain the reel/reel_item_watch or updated_metadata payload shapes** promised by the task (it only holds like/like, like/removelike, browse). Payloads were derived from live design probes (documented above) and standard InnerTube conventions. Evidence of the correct shapes is in the code comments + this file.
2. **REPLAY endpoint discovery**: ended lives expose a `reloadContinuationData` token (op2w0w… family) that **400s on get_live_chat** but works on **`live_chat/get_live_chat_replay`** (the task assumed a liveChatReplayContinuationData discovery shape — the real web uses the replay endpoint). Implemented + verified.
3. **Replay seek**: the task's base64-proto offset params are NOT derivable from public shapes — probed exhaustively: `params` field on get_live_chat_replay is ignored; byte-patched continuation tokens (shorter AND same-length varint patches) are either 400 (length change) or silently ignored (same length). **Implemented instead:** two KNOWN modes (full-from-start + live-edge) plus offset mode as a **bounded server-side linear continuation walk** (max 40 upstream calls ≈ first ~10 minutes of stream depth per request; `seek: {calls, reached}` reported honestly in every response). Deep seeks into multi-hour streams require repeated client requests walking forward (each call advances ~15.5s of stream time).
4. **`reel_item_watch`** returns `REEL_ITEM_WATCH_STATUS_BAD_REQUEST` logged-out (playerParams are session-bound). Not used — per-short metadata comes from `next()` exactly as the task specifies.
5. **`/api/shorts` cursor pages return bare ids** (the real reel sequence carries no metadata in entries; the embedded `unserializedPrefetchData.playerResponse` is stripped logged-out). The shorts client hydrates each short via `/api/shorts/[id]` as it becomes active — real data end-to-end.
6. **Shorts likes**: logged-out `next()` strips `likeCountEntity` ("unset…"); the like count is recovered from the accessibility label ("like this video along with N other people" — verified 801/802 live). With `YT_COOKIES` set, the likeCountEntity path is also parsed.
7. **updated_metadata `dateText`** only appears when YouTube pushes an `updateDateTextAction` (it did, live: "Started streaming on Mar 9, 2023"); otherwise null (documented in code).
8. **Shorts comments**: first page only (no further-comments endpoint in this lane); the sheet notes "More replies on YouTube" honestly.
9. **Top chat filter**: client-side naive approximation (repeated-body/empty/system suppression) — documented in code that YouTube's true top-chat filter is server-curated.
10. **Chat posting**: input rendered but disabled with tooltip "Sign-in actions arrive with the broker lane" — NOT implemented (broker = A-W lane), per instructions.
11. **Watch-page `currentTimeSec` wiring**: the current WFX2-W player writes progress into `timeRef` only; the LiveChatPanel receives `currentTime` state (set on share-dialog open today). Replay advance is therefore first-frame-only until the A-W player wires `onProgress → setCurrentTime` (one-line change; hook degrades gracefully). Documented in the worklog + the panel contract.

## Files touched (for the lead's merge)

**New (mine):**
- `src/lib/youtube/livechat.ts` — live chat client + mappers + replay walk + updated_metadata parser + rate limit/cache
- `src/lib/youtube/shorts.ts` — reel client + seed/sequence mappers + getShortMeta (+ comments walk)
- `src/app/api/videos/[id]/livechat/route.ts` — poll route (bootstrap + token advance + replayOffsetSec)
- `src/app/api/videos/[id]/livechat/replay/route.ts` — replay modes (full / offset / live-edge)
- `src/app/api/videos/[id]/live-status/route.ts` — updated_metadata route
- `src/app/api/shorts/route.ts` — REWRITTEN to the live feed (old DB demo route replaced)
- `src/app/api/shorts/[id]/route.ts` — per-short meta + first comments page
- `src/hooks/use-live-chat.ts`, `src/components/watch/live-chat-panel.tsx`, `src/components/watch/live-chat-message.tsx`
- `src/components/shorts/shorts-feed.tsx`, `shorts-player-slot.tsx`, `shorts-engagement-rail.tsx`, `shorts-comments-sheet.tsx`
- `src/app/shorts/page.tsx` — REWRITTEN (thin page + feed)
- `tests/livechat-mapping.test.ts`, `tests/shorts-mapping.test.ts`, `tests/liveshorts-api.test.ts` + 6 fixtures in `tests/fixtures/yt/`
- `.env.example` (YT_COOKIES + SHORTS_SEED_QUERY), `evidence/wfx2as/*`

**Edited (shared surface, minimal):**
- `src/components/watch/watch-page.tsx` — TWO insertions only: the `dynamic` import of LiveChatPanel + one conditional block `{detail && !theater && (<LiveChatPanel …/>)}` before `<RelatedRail>` inside the related-videos aside.
- `package.json` — scripts: added `test:liveshorts`, chained into `test`.

**Not touched (per lane rules):** `src/components/watch/youtube-player.tsx` (doesn't exist yet), `src/lib/broker.ts`, `mini-services/`, A-B's future `src/lib/youtube/innertube.ts` (my files are self-contained; helper names distinct: `callLiveChat`, `callLiveChatReplay`, `callNextForChat`, `callUpdatedMetadata`, `callReel`, `callSearchForShorts`, `callNextForShort`).

## ShortsPlayerSlot contract (for A-W / lead at merge)

`src/components/shorts/shorts-player-slot.tsx` exports `ShortsPlayerSlot({ videoId, active, posterUrl? })`. The component owns the 9:16 geometry/rounded clipping; today it renders a plain `youtube.com/embed` iframe fallback (muted autoplay-safe, playsinline, loop). At merge, A-W's `youtube-player.tsx` slots in here: `active` maps to its imperative play/pause; the fallback iframe is replaced. Documented in the file's JSDoc.
