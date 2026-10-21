# P35-LIKE-STATE — the state read-back lane (the reload persistence + the cold-start retry)

**Date:** 2026-10-21
**Branch:** `wfx2/p35-like-state`
**Dispatch (verbatim):** "like still doesn't work and when it does, reloading undoes it"

## The two root causes (both verified against the code + the live wire)

### 1. "reloading undoes it" — the app never read the rating back

`src/lib/youtube/watch.ts` bootstrapped the watch page's viewer state with:

```ts
like: null, // like state is broker-tier (A-W lane)   ← a stale pre-P33 comment
savedWatchLater: false,                                ← hardcoded
```

P33 wired the WRITES (direct-first like/subscribe/comment/watch-later) but
never the READ-BACK. So a successful direct like updated YouTube's servers
(durable!), the UI toggled optimistically — and every reload re-bootstrapped
`like: null` → the button reverted. Same class for the save button
(`savedWatchLater: false`) and the shorts rail ("no per-user rating READ for
shorts" — its own comment admitted it).

youtube.com itself renders your rating on watch load from the `next`
response's entity mutations — VERIFIED LIVE 2026-10-21: the public `next`
for `jNQXAC9IVRw` answers

```json
frameworkUpdates.entityBatchUpdate.mutations[].payload.likeStatusEntity
  = { "key": "EgtqTlFYQUM5SVZSdyA-KAE%3D", "likeStatus": "INDIFFERENT" }
```

(key = URL-encoded base64 embedding the videoId; LIKE/DISLIKE when signed
in). The app already fetches that exact response WITH the session cookies —
it just never parsed the entity.

### 2. "like still doesn't work" — the cold-start 400 + the raw network throw

The P33 wire-probe evidence itself recorded it: round 1 → HTTP **400**
"Request contains an invalid argument" (even with valid templated params),
rounds 2-3 → deterministic. `rateVideo` had NO retry on the 400 class and NO
catch around the raw `fetch` — so a cold-start 400 (every fresh serverless
lambda pays it) failed the direct tier → the broker fallback → broker down →
502 error toast. On the retry click (now warm) it worked — the operator's
exact "when it does" experience. A transient network throw was worse: it
escaped as a raw exception (a 500, not even the honest 502).

## The deliverables

1. **`likeStatusFromResponse`** (`src/lib/youtube/watch.ts`, exported — the
   shorts mapper reuses it): walks the `next` entity mutations, decodes the
   URL-encoded base64 key, matches the videoId, maps LIKE→"like",
   DISLIKE→"dislike", INDIFFERENT/absent/mismatch → null. Never a guess.
2. **`mapWatchMetadata`**: `state.like` now parses from the SAME response
   (session-gated — public mode stays null, never a fabricated state).
3. **`savedWatchLater` bootstrap** (`getVideoDetail`): a fresh
   `playlistContains("WL", videoId)` rides beside the cached meta (parallel,
   one hop) — the save button bootstraps from the server-side truth. Honest
   false on failure/no-session; the toggle's own fresh re-read + ensure
   semantics absorb a wrong false (never a double-add).
4. **The cache invalidation law** (the coherence piece):
   `cacheInvalidate(key)` added to the cache engine (L1 delete + in-flight/
   revalidating cleanup + best-effort L2 DEL — never throws);
   `invalidateWatchCache(videoId)` exported from watch.ts (the
   `yt:watch:{id}` key now has ONE source of truth). Fired after EVERY
   successful like-family write (direct AND broker — both change YouTube-side
   state) and after subscribe/unsubscribe when the caller passes its videoId
   (the watch page threads it: SubscribeButton → /api/subscriptions →
   proxySubscribe → invalidate). The next bootstrap re-fetches `next` WITH
   cookies → the fresh likeStatusEntity + subscribeButton → the state
   SURVIVES the reload.
5. **`rateVideo` hardening**: ONE retry on exactly the cold-start 400 class
   and on transient network throws (like/removelike are idempotent set
   semantics — a retry can never double-apply); the SAPISIDHASH timestamp
   refreshes per attempt; 401/403 (the session class) fail immediately and
   honestly; a per-attempt 8s abort budget; network failures return
   `{ok:false, status:0, error:"network error"}` — never a raw exception.
6. **The shorts rail**: `ShortMetaDTO.yourLike` parsed from the per-short
   `next` entity (session-gated); the rail bootstraps + reconciles from it
   (the ActionRow adjust-during-render pattern; once you've acted, your state
   is the freshest truth). The "no per-user rating READ for shorts" era ends.

## The honest residual

- **Dislike** stays broker-tier (no captured wire — P33's law); its state
  read-back rides the same entity parse when the broker family writes
  succeed (the invalidation fires there too).
- The **broker-only mode** (no YT_COOKIES, broker up): like writes work
  through the broker tab, the invalidation fires, and the read-back parses
  the fresh entity from the re-fetched `next` — which in broker-only mode is
  a PUBLIC fetch (no session cookies) → likeStatusEntity answers INDIFFERENT
  → the button still reverts. The direct session is the main-interface
  doctrine's answer (the settings card says exactly this); the broker tier
  remains the fallback, not the primary.
- **L2 invalidation reach**: the DEL clears the shared Upstash layer; other
  serverless instances' L1 copies age out at the 10-minute TTL at worst.

## The gates

- **2020/0** (base 1995 + 25):
  - yt-mappers +14: the entity parse battery (the real fixture INDIFFERENT,
    the live-probed key shape, LIKE/DISLIKE mutations, absent/mismatched/
    corrupt keys, the session gating both ways) + the WL bootstrap battery
    (the env gate with ZERO browse calls, contains/miss via the lockup
    walker, the honest-failure degrade) + the invalidation seam pin.
  - youtube-direct +6: the cold-start 400 retry (400→200 ok, 400×2 honest
    exhaustion), the 401 never-retries pin, the network-throw retry + the
    never-a-raw-exception pin, the timestamp-refresh-between-attempts pin.
  - action-routes +2: the direct-like success drops the primed
    `yt:watch:{id}` entry; the broker-tier success drops it too.
  - shorts-mapping +3: the public-mode null, the session+LIKE "like", the
    real-fixture INDIFFERENT null.
- tsc clean; lint 0e/1 (pre-existing warning); oxfmt applied.
