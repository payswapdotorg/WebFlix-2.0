# M2 EVIDENCE — LIVE honesty hardening audit (until-approved state)

Worker: C (WFX2-M2-C) · Window: 2026-11-08 · Pinned base: `6e4d3b2` (branch main, clean tree at start)
Work order: `docs/plans/work-orders/WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1.md` §4 M2 (items 1–7) + §5 evidence contract
Policy frame: ADR 0014 **D2 (OPERATOR-GATED, closed)** — zero actor runs, zero spend; D6 money gate CLOSED.

**Spend statement:** ZERO Apify API calls, ZERO actor runs, ZERO spend this window. The only network egress was two read-only public storefront GETs of the actor pages (no token, no run — see §5). No fixture test touches the network: every test rides the injected `setTikTokLiveProbeUpstream()` seam (the lane law, `src/lib/tiktok/live-upstream.ts`).

**Scope of edits this window (frozen lane respected):**
- `tests/tiktok-live-service.test.ts` — +1 fixture test (401 mapping class).
- `tests/tiktok-live-route.test.ts` — +2 fixture tests (route-level quota-503 surfacing; single-lane provider recovery / circuit re-open).
- `evidence/wfx2-tiktok-main-interface-reliability/m2/EVIDENCE.md` — this file.
- NO source changes in `src/lib/tiktok/live*.ts` or the LIVE routes: the M2.4 audit found the server-side laws present and correct (see §1); no in-lane bug met the RED-first bar. One real requirement gap was found OUTSIDE the frozen edit lane and is escalated, not patched (§1 row f, §6).

---

## 1. The M2.4 compliance audit (work order §4 item 4, a–g)

Classifications: **IMPLEMENTED+TESTED** · **IMPLEMENTED-UNTESTED** · **MISSING** (compound classifications are spelled out).

| # | Requirement (M2.4) | Classification | Evidence (file:line) |
|---|---|---|---|
| a | No actor launches/retries when provider errors are exhausted/disabled | **IMPLEMENTED+TESTED** | Gate lives at the scheduling layer: `src/app/api/tiktok/live/route.ts:121` (stale refresh scheduled only when `!isTikTokLiveProbeBackedOff && !isTikTokLiveProbeInFlight`), `:139` (cold probe only when not in flight); `src/app/api/tiktok/live/board/route.ts:80-88` (warm refresh gated), `:115` (cold gated), `:111-114` (backoff → error, no probe). The machine itself has no internal retry: one run POST per probe — `src/lib/tiktok/live.ts:411-487` (`runActorDataset`), failure records the 60s backoff `:511-518` (single), `:838-848` (board). Tests: `tests/tiktok-live-route.test.ts:254-273` (no refresh mid-backoff), `tests/tiktok-live-board.test.ts:573-609` (backed-off lane never re-probes), NEW `tests/tiktok-live-service.test.ts:356-386` (401 class: exactly ONE run attempt, no internal retry). |
| b | Circuit breaker open for exhausted/disabled provider errors | **IMPLEMENTED+TESTED** | The 60s failure backoff IS the open circuit. Quota class: `src/lib/tiktok/live.ts:436-446` (measured `403 platform-feature-disabled` → typed 503 human sentence), any failure earns the marker `:516`; during the window every read throws the REAL error: peek `:341-353`, SWR entry `:367-380`; board marker `:742-768`, set `:839-846`. Tests: `tests/tiktok-live-service.test.ts:294-326` (P103-mini-4 sentence + backoff recorded), NEW route-level surfacing `tests/tiktok-live-route.test.ts:293-329` (the 503 + sentence reaches the HTTP client; probing DTO on the first hit is the measured prod rhythm), board `tests/tiktok-live-board.test.ts:490-516` + `:536-571`. |
| c | One failed attempt cannot be re-scheduled repeatedly by concurrent requests/polling (in-flight dedupe + backoff) | **IMPLEMENTED+TESTED** | In-flight coalescing: `src/lib/tiktok/live.ts:395-403` (status), `:639-647` (playback), `:830-849` (board), globalThis-keyed maps `:298-314`, `:568-584`, `:702-714`; route gates `route.ts:121,139`; board gates `board/route.ts:80-88,115`. Tests: `tests/tiktok-live-service.test.ts:126-142` (concurrent probes → ONE fetch sequence), `tests/tiktok-live-route.test.ts:147-157` (second probing GET does not double-probe), `tests/tiktok-live-board.test.ts:176-182` (concurrent boards → one run), `tests/tiktok-live-playback.test.ts:165-171`. |
| d | Clear unavailable/disabled state — not an offline result | **IMPLEMENTED+TESTED** | `live:null + probing:true` is a first-class DTO (`src/lib/tiktok/live.ts:59-75,100-110`); offline (`live:false`) is only ever a REAL provider row (`:200-226`, `is_live !== true`); the lane answers typed 503 unconfigured (`route.ts:130-138`), 502/503 backoff errors (`:111-119`), quota 503 sentence (via `live.ts:436-446`); board: probing `board/route.ts:62-64,118`, unconfigured 503 `:98-106`, real failure `:111-114`. The UI renders the API's error verbatim, never a fake offline (`src/app/tiktok/[handle]/live/view.tsx:130-142`). Tests: `tests/tiktok-live-route.test.ts:127-134,136-145`, `tests/tiktok-live-service.test.ts:194-204,294-326`, NEW `tests/tiktok-live-route.test.ts:293-329`, `tests/tiktok-live-board.test.ts:205-213,536-571`, UI `tests/tiktok-live-ui.test.tsx:308,633`. |
| e | WebFlix-native watch-party chat only where a real room context exists | **IMPLEMENTED+TESTED** | `src/lib/tiktok/live-chat.ts:9-19` (the lane is WebFlix-native, keyed by normalized creator handle; TikTok's own live chat is NOT mirrored — operator-gated relay), roomKey G20 gate `:100-106` (invalid room = 400, never a silently different room), send gates `:113-137`; route session gates: `src/app/api/tiktok/live/chat/[room]/route.ts:44-46` (401 send), `:49-55` (429 burst cap), `:76-91` (owner-only delete); chat mounts ONLY on the room surface keyed by the handle (`src/app/tiktok/[handle]/live/view.tsx:290-292`). Tests: `tests/tiktok-live-chat.test.ts` (guest 401 send, G20 400s, idempotent `(roomKey,userId,clientMessageId)`, tombstones), UI `tests/tiktok-live-ui.test.tsx:353`. |
| f | Stale LIVE badges never shown as current without a labeled stale timestamp | **PARTIAL — data layer IMPLEMENTED+TESTED; badge label MISSING (outside frozen lane, escalated)** | Data layer (my lane): the SWR DTO marks every served-stale answer `stale:true` and carries the real `fetchedAt` (`src/lib/tiktok/live.ts:69-75`; `route.ts:124-128`; `board/route.ts:92-96`); the board merge folds fresh-only live answers — a stale cache answer never claims liveness (`live.ts:804-822`). Tests: `tests/tiktok-live-route.test.ts:214-232`, `tests/tiktok-live-board.test.ts:266-305,354-368`, UI keep-mounted `tests/tiktok-live-ui.test.tsx:333-351`. **The gap:** the badge views render LIVE for any `live===true` with NO stale label — `src/components/tiktok/tiktok-live-badge.tsx:16-37` and `src/app/tiktok/[handle]/live/view.tsx:172-179` (room stats line `:184-191` shows `started …` / `via …` but never `fetchedAt`/stale age; repo grep: zero `.tsx` renders `fetchedAt`). Those view files are NOT in this window's frozen edit lane (`src/lib/tiktok/live*.ts`, `src/app/api/tiktok/live/**`, `tests/tiktok-live-*.test.ts`) — escalated to the TL (§6). |
| g | No TikTok-native chat/gifts/comments claimed | **IMPLEMENTED+TESTED** | `src/app/tiktok/[handle]/live/view.tsx:270-286` — "Interact on TikTok" outbound links ("Comment on TikTok", "Send a gift on TikTok") with the verbatim disclaimer "WebFlix never writes to TikTok on your behalf"; `src/lib/tiktok/live-chat.ts:17-19` (no TikTok write claimed or performed); the badge CTA rides the IN-APP route (`src/components/tiktok/tiktok-live-badge.tsx:29-35` → `tiktokLiveHref`), not TikTok. Tests: `tests/tiktok-live-ui.test.tsx:392-398` (outbound honestly labeled), `:602` (scope statement visible), the whole chat battery proves the only writes are WebFlix-native rows. |

## 2. M2.6 fixture-gap map (work order §4 item 6)

Every class is fixture-driven (injected transport), zero network, zero spend.

| Fixture class (work order) | Status before this window | Evidence |
|---|---|---|
| 401/403/quota-exhausted mapping | quota-403 tested; 403-generic tested; **401 untested → ADDED** | quota-403: `tests/tiktok-live-service.test.ts:294-326` (P103-mini-4 human sentence, status 503, backoff recorded). 403-generic (no `platform-feature-disabled` body → honest 502): `tests/tiktok-live-board.test.ts:536-556`. **NEW 401:** `tests/tiktok-live-service.test.ts:356-386` — typed 502 could-not-start, NO fabricated quota sentence (that sentence stays exclusive to the measured 403 class), backoff recorded, exactly ONE run attempt. |
| Actor timeout | tested | poll-cap exhaustion → honest 502 "did not finish in time": `tests/tiktok-live-service.test.ts:144-155`; FAILED/ABORTED/TIMED-OUT rung: `:157-171` (FAILED pinned; same typed branch at `live.ts:468-470`). |
| Malformed/default-creator result | tested | malformed rows never throw: `tests/tiktok-live-map.test.ts:109-121`; identity mismatch → null: `:86-90`; the default-creator trap (R3a) → null: `tests/tiktok-live-playback.test.ts:110-112`; dataset without the requested handle → 502: `tests/tiktok-live-service.test.ts:173-182`. |
| Missing stream URL | tested | webcast live room without `stream_url` → `stream:null`: `tests/tiktok-live-map.test.ts:175-182`; playback row with no usable streamUrls → null: `tests/tiktok-live-playback.test.ts:121-131`; UI honest fallback rung: `tests/tiktok-live-ui.test.tsx:324`. |
| Provider recovery | board tested; **single-lane untested → ADDED** | board: recovered run clears the marker `tests/tiktok-live-board.test.ts:518-534`. **NEW single lane:** `tests/tiktok-live-route.test.ts:338-366` — break → inside-window 502 with no re-probe → window expiry consumes the marker on read (no throw) → recovered run answers fresh 200 (no stale, no probing). |
| Concurrent requests | tested | `tests/tiktok-live-service.test.ts:126-142`, `tests/tiktok-live-route.test.ts:147-157`, `tests/tiktok-live-board.test.ts:176-182`, `tests/tiktok-live-playback.test.ts:165-171`. |
| Circuit break/re-open | break tested (both lanes); re-open tested on board; **single-lane re-open untested → ADDED** | break: `tests/tiktok-live-service.test.ts:274-283`, `tests/tiktok-live-route.test.ts:254-273`, `tests/tiktok-live-board.test.ts:490-516`; re-open (board): window expiry → probing again `:536-571`; **NEW single-lane re-open:** `tests/tiktok-live-route.test.ts:338-366`. |
| Budget cap | **NOT-APPLICABLE-YET (deliberately not built)** | Work order gates budget controls on M2.5 "If a provider is approved…"; ADR 0014 D2 keeps the provider gate CLOSED (no approved provider, no budget). Building caps now would be spend-gated work ahead of its own precondition. Recorded for the operator: caps (per-run/per-day caps, max handles, TTL floors, in-flight dedupe, error backoff, circuit-open duration, spend counters, kill switch, safe default-off) become the FIRST implementation task on D2 approval. Note: in-flight dedupe, error backoff, circuit-open duration and TTL floors ALREADY exist and are tested (rows a–c above + the TTL laws at `live.ts:122-148`). |
| Stale-data labeling | tested (data layer) | `tests/tiktok-live-route.test.ts:214-232` (stale served + `stale:true`), `tests/tiktok-live-board.test.ts:266-305` (stale board), `:354-368` (stale never claims liveness in the merge), `tests/tiktok-live-ui.test.tsx:333-351` (room stays mounted). Residual: the badge-view label — see §1 row f. |

**RED-first statement:** the three new tests were written to close COVERAGE gaps of behavior that proved correct on first run (green) — the audit found no in-lane requirement actually missing or broken on the server side, so no source fix met the RED-first bar. The one genuinely missing requirement piece (row f's badge stale label) lives in view files outside the frozen lane and was NOT touched; it is escalated (§6).

## 3. Gates and exact test results (shared worktree, pinned DATABASE_URL by the scripts)

| Command | Result | Exit |
|---|---|---|
| `bun run test:tiktok` | **293 pass / 0 fail across 21 files** + second batch (`tests/tiktok-imports.test.ts`) **14 pass / 0 fail** = 307 pass / 0 fail (was 290 + 14 before this window; +3 new) | 0 |
| `DATABASE_URL=file:../db/watch-test.db bun test --isolate tests/tiktok-live-route.test.ts tests/tiktok-live-service.test.ts` | 28 pass / 0 fail (118 expect calls) — includes the 3 new tests | 0 |
| `bun run typecheck` | clean (tsc --noEmit) | 0 |
| `bun run lint` | clean (eslint .) | 0 |

New tests (names as they appear in the runners):
1. `tests/tiktok-live-service.test.ts` — "a 401 run start maps to the typed 502 could-not-start law and earns the backoff (no quota-sentence fabrication)".
2. `tests/tiktok-live-route.test.ts` — "M2 — the quota-death 503 + human sentence surfaces through the route (probe → backoff → honest error)".
3. `tests/tiktok-live-route.test.ts` — "M2.6 — provider recovery: the expired backoff re-opens the lane and a recovered run answers fresh".

Full-battery runs are the TL's (not run here, per dispatch).

## 4. Provider decision table (SKELETON for the operator)

Recorded honestly. The ONLY measured price datapoints allowed are the two P103 records: **~$0.0042/answered handle** (≈ $0.021 per 5-item run, measured off the actor's `maxTotalChargeUsd: 0.020899`) and the **$5 monthly free-plan credit** (the credit that died mid-cycle 2026-11-07 → 2026-12-06). Everything marked *unknown* is unknown — invented nothing.

| Provider / path | LIVE status capability? | Reliability | ToS / policy exposure | Privacy / data handling | Retention | Latency | Price per handle/run |
|---|---|---|---|---|---|---|---|
| Official TikTok APIs (Display / Video / Research / oEmbed) | **NO general LIVE status API found** in P100 research — "There is NO official LIVE endpoint — no live status, no live stream URLs, no live chat" (`docs/research/2026-11-07-p100-tiktok-live-in-app-report.md:28`); live tooling exists only for TikTok Shop sellers/internal partners | n/a for LIVE (no surface) | LOWest exposure (official) **but** ADR 0014 D1 product/competition gate is CLOSED and separate | Governed by TikTok Developer Terms; D1 record does not exist yet | Per ADR 0014 D5 principles | unknown (no LIVE surface) | unknown (no LIVE surface to price) |
| Apify status actor `unseenuser~tiktok-live-status-scraper` (env NAME `APIFY_LIVE_ACTOR_ID`; value never recorded here) | YES — the empirically verified lane (P100 probe E4); the prod lane today, quota-dead | Measured: died mid-cycle when the $5 credit exhausted (P103-mini, 2026-11-08); batch mode empirically DROPS rows (P102-R3: 5 of 16 answered; the actor's own free-trial cap message) | **UNAPPROVED** — third-party community actor; the P100 report itself labels the class "ToS-gray"; ADR 0014 D2 gate CLOSED. Work order M2 item 3's terms review (Apify General + Actor Terms + the actor's own policy) is NOT done — do not assume platform terms authorize the underlying collection | **unknown** — the actor's own privacy/data-handling statement not yet read/verified | WebFlix side: status cached 30s (or `TIKTOK_LIVE_STATUS_TTL_MS` clamp 30s–1h), offline 300s; no TikTok media bytes stored | 20–35s per run (measured, P102 probes) | **MEASURED ~$0.0042/handle** (~$0.021 per 5-item run); **$5/month free credit** (P103 records) |
| Apify playback actor `automation-lab~tiktok-live-room-stream-urls` (env NAME `APIFY_LIVE_STREAM_ACTOR_ID`) | YES — resolves hls/flv CDN URLs (P102 probes R3/R3a) | Near-free compute; measured input-contract trap (ignores wrong-shaped input keys, answers its default creator — the identity guard makes that honest) | Same **UNAPPROVED / D2-closed** status; same unverified-terms residual | **unknown** | Signed CDN URLs expire by design — never stored; stream info cached 120s (`TIKTOK_LIVE_PLAYBACK_TTL_MS`) | 20–35s measured | ~$0.00006/run (0.0003 CU, un-monetized — P103 record) |
| TikTok-Live-Connector (npm) + Euler Stream signing | YES — room resolve + webcast IM websocket (chat/gifts/viewer events) | unknown — long-lived websocket, server-hosted mini-service (not serverless); Euler key usage-capped | ToS-gray + third-party signing dependency; **UNAPPROVED**; D2 applies | **unknown** | **unknown** | unknown (websocket stream latency unmeasured) | unknown (Euler free-tier caps unknown) |
| Direct webcast scrape (`webcast.tiktok.com/webcast/room/info/`) | YES — documented payload shape (P100 probe E2) | Fragile — geo-walls and signing walls measured (P100 probes E1/E3) | ToS-gray; **UNAPPROVED**; direct collection by WebFlix would be first-party exposure, worse than the actor question | **unknown** | **unknown** | unknown | no third-party price; WebFlix infra cost unmeasured |

## 5. Actor-page reading (read-only storefront GETs, no tokens, no runs)

Fetched this window via `curl` (HTTP GET, public pages, no API token — allowed by the dispatch; zero spend):

- `https://apify.com/unseenuser/tiktok-live-status-scraper` → **HTTP 200**. Page title: "TikTok Live Monitoring API - Status, Stream URLs, No Login · Apify". Meta description: "Check if any TikTok creator is live now. Returns room title, viewer count, and stream URLs. Built for TikTok live monitoring, brand alerts, and dashboards." Page text contains a "0.004"-shaped figure (corroborates, but does NOT replace, the P103-measured ~$0.0042/handle — the measured record stays the cited datapoint).
- `https://apify.com/automation-lab/tiktok-live-room-stream-urls` → **HTTP 200**. Page title: "TikTok LIVE Status & Stream URL Scraper · Apify". Meta description: "Check supplied TikTok creators for current LIVE status, room IDs, viewer counts, host metadata, and public FLV, HLS, or RTMP stream URLs without login."

Deliberately NOT done: no terms/policy summaries were synthesized from these pages. The Apify Actor Terms / General Terms / actor-level privacy review (work order M2 item 3) remains OPEN — it needs the operator/legal read, not a scraper's skim.

## 6. The exact operator decision still required

**ADR 0014 D2 (verbatim gate, still CLOSED):** until the operator explicitly approves the exact provider, actor, terms, data handling, budget and limits — no actor runs are launched or retried, no credit is purchased, no new provider is wired. Concretely, the operator must choose ONE of:

1. **Keep the lane closed** (current default). The product stays honest: LIVE surfaces answer the typed 503/502 human sentences (quota sentence measured and pinned), never "everyone offline". No code action needed; the tests shipped this window are the proof of the honest state.
2. **Approve a provider** (name the actor/vendor, accept its terms, record the D2 decision + the M2 item-3 terms review, and set the budget). On approval, M2.5 becomes due as the FIRST implementation task: per-run/per-day caps, max handles, TTL floors, error backoff + circuit-open duration tuning (already present), operator-visible spend/usage counters, a kill switch, and a safe default-off — before the first paid call (ADR 0014 D6).

Interim facts the operator should weigh: the lane's death was ECONOMIC (the $5 free credit at ~$0.0042/handle); `TIKTOK_LIVE_STATUS_TTL_MS=300000` (already set production-only, P103-mini) stretches survival ~10× when the credit resets (cycle ends 2026-12-06) or the plan is upgraded; the money gate stays CLOSED until D2 is decided.

## 7. Blockers / escalations for the TL

1. **(M2.4-f) Badge stale label missing in views** — `src/components/tiktok/tiktok-live-badge.tsx` and `src/app/tiktok/[handle]/live/view.tsx` render the LIVE badge for stale answers with no stale/fetchedAt label (DTO already carries `stale:true` + `fetchedAt`, tested). Both files are OUTSIDE Worker C's frozen edit lane this window — TL to assign (one-line label + a UI pin in `tests/tiktok-live-ui.test.tsx` style would close row f completely).
2. Budget caps (M2.5) remain unimplemented BY DESIGN — gated on the D2 decision (§2, row "budget cap").
3. The M2 item-3 legal/terms review (Apify General + Actor Terms + actor privacy policy + applicable TikTok terms) is open and belongs to the operator/legal read; this evidence records only what was verifiably fetched (§5).

## 8. TL RESOLUTION (post-delivery integration, same window)

Escalation §7.1 (row f) is CLOSED by the TL under the shared-integration-files law:

- `src/components/tiktok/tiktok-live-badge.tsx`: the badge container now carries `data-stale` ("true"/"false"); when `stale === true` the pill turns amber (bg-amber-600), drops the pulse, and a `TikTokLiveStaleNote` — "stale · as of <formatRelativeDate(fetchedAt)>" — rides beside it (`data-testid="tiktok-live-badge-stale"`).
- `src/app/tiktok/[handle]/live/view.tsx`: the stage pill carries the SAME law (data-stale + amber/no-pulse + the note, `data-testid="tiktok-live-stale-note"`); the note component is the badge file's export — one source of truth, two consumers.
- Pins (RED-first, verified red against the unfixed files before the fix, then green): view-level stale-stamp law (`tests/tiktok-live-ui.test.tsx` — the stale answer arrives via the SWR queue, the note + `data-stale="true"` + the room still mounted); badge-level stale law; badge-level fresh law (no stamp, `data-stale="false"`).
- Gates re-run on the shared tree after the fix: typecheck 0 · lint 0/0 · `bun run test:tiktok` 310/0 (304 + Worker C's 3 + the stamp's 3) · official segmented battery `bun run test` **3135 pass / 0 fail, exit 0**.
- Deploy state: this fix is APP code on origin/main; the production deploy rung stays BLOCKED on the operator's `VERCEL_TOKEN` re-seed (the standing vault loss) — recorded honestly, no prod claim made.
