# WebFlix 2.0 — Post-Roadmap Hardening Lanes P6–P10-OPS (retro documentation)

Recorded 2026-10-05 by lane **P11-DOCS** (documentation-only; zero code changes).
Base at documentation time: `225eba0` (main).

The 2026-09-29 live roadmap closed on 2026-10-02 — G1–G6 achieved, phases 1–5
delivered, **1034 root tests**, production verified (`docs/plans/wave-claims.md`
"PHASE 5 claims SETTLED"; commit `1d23126`). After that close, five hardening
lanes ran as **commit-history lanes**: they were never claimed in the
wave-claims ledger and never documented in `docs/plans/` — the only records are
the commits themselves, fragments in `WORKLOG.md`, and `docs/ops/`. This file
closes that gap: one section per lane, each with scope, key commits, the
acceptance evidence recorded in history, and production impact. Everything below
is justifiable from the cited commits and docs; nothing is speculative.

Lane naming in history: P6/P7 merged with `WFX2-P6-*` / `WFX2-P7-*` subjects
from `wfx2/p6-*` / `wfx2/p7-*` branches; P8/P9 from `wfx2/p8-yt-parity-gaps` /
`wfx2/p9-broker-read`; P10-OPS landed directly on main — its head commit
(`225eba0`) is the only P10-labeled commit, and the commits in its window
(the `harden:` commit and the deploy-trigger chores) are recorded below with
their own subjects as history states them.

## P6 — production data layer + parity hardening (2026-10-02 → 2026-10-03)

**Scope — six sub-lanes, merged in order DATA → HP → IS → CR → CH → UP:**

- **P6-DATA** — the production data layer on Neon Postgres: `prisma/schema.postgres.prisma` (the postgres twin, swapped in by the Vercel buildCommand — dev/tests keep SQLite untouched), `prisma/seed-prod.ts` (idempotent minimal prod seed: the `@demo`/`@you` fallback viewers) + `db:seed:prod`, `vercel.json` buildCommand, the `DATABASE_URL` env created on the Vercel project (Neon schema pushed + seeded, 2 users).
- **P6-HP** (`wfx2/p6-hover-preview`) — hover previews that actually play: the raw `<video src=videoUrl>` (dead by design — a watch PAGE url) replaced with the real YouTube IFrame player through the shared `loadYouTubeIframeApi` singleton (one muted chromeless player, reused forever; `loadVideoById` per hover, pause-not-destroy, per-video onError scoping).
- **P6-IS** (`wfx2/p6-infinite-scroll`) — infinite scroll actually infinite on both surfaces: rung-3 opaque cursor envelopes in `src/lib/youtube/cursors.ts` (base64url JSON — pool-offset windows through the one cached merged pool, then live search-continuation paging per seed query, honest null end; rungs 1–2 keep native browse tokens, discriminated by shape); `/api/search` gains `?cursor=`; the search view scrolls infinitely (IntersectionObserver sentinel, dedupe-by-id, honest end marker).
- **P6-CR** (`wfx2/p6-comments-replies`) — comments render for every viewer + working replies: `resolveViewer` total (DB failure → the honest anonymous viewer, never a 500), the watch page renders CommentsSection with a null viewer (logged-out parity), the three-rung write chain (direct SAPISIDHASH `create_reply` → broker → the honest LOCAL WebFlix store: shadow Video/Channel rows, `wf-<id>` author bridge, shadow-parent anchors under moderation "shadow" — an FK anchor that never renders), the read-path merge (local top-level prepends on page 1 with `local:true` disclosure; local replies nest first-wins by thread root), +24 root tests.
- **P6-CH** (`wfx2/p6-channel-parity`) — channel page YouTube-parity: sort chips wired end-to-end (chip-bar parse → tab route `?chip=` continuation → aria-pressed chip row UI; per-token cache entries), the doubled-@ handle fix at the mapper (`bareChannelHandle` at every ChannelPageDTO build site), completed header composition (live subscriber text passthrough, verified badge, video count, description row with the …more affordance).
- **P6-UP** (`wfx2/p6-upload-studio`) — the studio upload wizard + topbar CREATE pill: drag-drop target, Details/Video elements/Checks/Visibility steps with header chips, the step-gate law, XHR upload progress (real progress events only), honest local checks, visibility save driving `/api/upload/stage` → `/api/upload/execute`; + CREATE dropdown (Upload video / Go live / New post with honest absence). Interrupted-worker recovery pattern recorded in history: WIP commits (`95e8000`, `ada1254`) carried by the lead and completed per contract.

**Key commits:**

| sha | subject (abbreviated) |
|---|---|
| `9c04090` | WFX2-P6-DATA: the production data layer on Neon Postgres (…every Prisma route 500'd. Boot gate 345 pass) |
| `6244eca` | Merge WFX2-P6-DATA: postgres schema twin + Vercel buildCommand swap + minimal prod seed |
| `57df487` | WFX2-P6-DATA fix: drop the invalid $schemaNote key (vercel.json schema rejects unknown properties — deploy dpl_Fa2x ERROR'd) |
| `70bd1b6` | WFX2-P6-HP: hover previews that ACTUALLY PLAY (…test:watch 333 pass (326+7), test:boot 345 pass) |
| `f9411d2` | Merge WFX2-P6-HP |
| `17cef18` | WFX2-P6-IS: infinite scroll actually infinite on both surfaces (…test:boot 364 (345 baseline + 19) / test:cutover 103 pass) |
| `461aa36` | Merge WFX2-P6-IS |
| `ae61f08` / `18a580f` / `0073c11` | WFX2-P6-CR WIP → complete (lead-finished after worker interruption) → postgres-twin sync (test:watch 353 / test:boot 345 / test:auth 98 — all green) |
| `569c80a` | Merge WFX2-P6-CR: comments render for every viewer + working replies |
| `21de2a4` | WFX2-P6 merge fix-up: comment-local-rung.test.tsx typecheck green (the CR lane shipped 7 latent tsc errors; typecheck 0 errors; test:watch 360/0) |
| `95e8000` / `2eeab1f` | WFX2-P6-CH WIP → channel page YouTube-parity (test:boot 364/0, test:watch 326/0, test:cutover 103/0) |
| `1deb4e4` | Merge WFX2-P6-CH |
| `ada1254` / `21c8fd3` | WFX2-P6-UP WIP → finish (eslint 0 changed+full repo; typecheck 0; test:boot 345/0; test:watch 354/0 (+28 new); test:auth 98/0) |
| `5e9481a` | Merge WFX2-P6-UP: the studio upload wizard + topbar CREATE pill |

**Acceptance evidence (as recorded in history):**

- P6-DATA: "Boot gate 345 pass" (`9c04090`); the deploy-blocking `vercel.json` schema error fixed (`57df487`, deploy `dpl_Fa2x`).
- P6-HP: "eslint 0, typecheck 0, test:watch 333 pass (326+7), test:boot 345 pass" (`70bd1b6`).
- P6-IS: "test:boot 364 (345 baseline + 19) / test:cutover 103 pass" (`17cef18`).
- P6-CR: "test:watch 353 / test:boot 345 / test:auth 98 — all green" (`18a580f`, +24 root tests); the merge fix-up closed the typecheck gap the lane's own gates had missed ("typecheck 0 errors; test:watch 360/0", `21de2a4`).
- P6-CH: "test:boot 364/0 (baseline 345); test:watch 326/0; test:cutover 103/0; liveshorts/auth/community/notifications all 0-fail" (`2eeab1f`).
- P6-UP: "eslint (changed files + full repo) 0 errors; typecheck 0 errors; test:boot 345/0; test:watch 354/0 (+28 new); test:auth 98/0" (`21c8fd3`).
- Net on main across P6: **1034 → 1134 pass / 0 fail** (both totals recorded: 1034 at the phase-5 close in `docs/plans/wave-claims.md`; 1134 as the P7-CH baseline in `WORKLOG.md` — boot 383 / watch 388 / liveshorts 110 / cutover 103 / auth 98 / community 34 / notifications 18).

**Production impact:** the production DB outage closed — production had NO `DATABASE_URL`, every Prisma route 500'd (`/api/watch/session` → viewer null → the comments section never rendered; `/api/me` 500; playlists/history/notifications/queue dead); the Neon twin heals every DB-backed route. The remaining interface gaps closed to youtube.com parity: hover previews play, the default feed and search scroll beyond one page (the browse wall had landed the default feed on `composeSearchVideos` which always returned `nextCursor: null` — one page, then dead), comments render for anonymous viewers with a working local reply rung, channel sort chips/handle/header parity, and the upload wizard + CREATE pill.

## P7 — broker 2026 DOM refresh + membership + watch analytics (2026-10-03)

**Scope — four deliveries:**

- **P7-BR** (`wfx2/p7-broker-refresh`, commit `aa2a27a`, merged `c9ba1ed`) — the youtube-broker 2026 DOM compat refresh: `userGesture`-configurable evaluates, authenticated InnerTube POST (SAPISIDHASH page-context), `ytd-comment-view-model` selectors, realClick for `ytSpecButtonShapeNextHost`, the 2026 confirm-dialog locator. (History records this as "the prior lead session's lane, completed by review".)
- **P7-CH** (`wfx2/p7-channel-membership`, commit `510ba4c`, merged `9cedeb6`) — the channel Membership tab + Join-sheet tier completion: real tiers from the shared memberships-panel walk (`getChannelJoin` — one walk, one cache entry: the tab and the sheet can never diverge), the Membership tab placed between community and about (gated on the channel's own tab list AND `joinable`), per-tier "Join on YouTube" CTAs with the honest checkout note, and the fake in-app Join button (→ /account) REMOVED. The full lane record (baseline, survey, design decisions, honest-state matrix) is `WORKLOG.md`'s P7-CH worklog.
- **P7 heal** (direct on main, `41aa6a9`) — the session-home cure: ONE cookieless browse retry (a valid session walls the browse API from datacenter egress — the fresh `YT_COOKIES` made production `/api/home` 502 while the expired jar had been server-side-ignored) + the honest-empty-rail law (a rail's failure is never the feed's failure).
- **P7-AN** (`wfx2/p7-watch-insights`, commit `b9cb56e`, merged `1601fe2` + the harden `4f7e3f3`) — the watch analytics depth: `WatchDailyStat` daily aggregation from the autosave path (the delta law — the ping never touches it), `/api/watch/insights` + `/you/insights` (recharts 28-day zero-filled series, totals, top videos, the honest no-backfill note), watched-map + WATCHED overlays (history rail, related rail) + the watch page's honest watched line. The harden: a malformed-JSON body on `/api/watch/watched-map` is a 400 (never the generic 500) — the live curl-quoting trap caught in production verification.

**Key commits:**

| sha | subject (abbreviated) |
|---|---|
| `aa2a27a` | P7 broker refresh: 2026 YouTube DOM compat + trusted-click ladder |
| `c9ba1ed` | Merge WFX2-P7-BR: the youtube-broker 2026 DOM compat refresh (…105/105 broker tests green) |
| `510ba4c` | WFX2-P7-CH finish: the channel Membership tab + Join-sheet tier completion |
| `9cedeb6` | Merge WFX2-P7-CH: …(r43ch delivery: merge-base 5e9481a, one commit, in-scope, +17 tests green) |
| `41aa6a9` | WFX2-P7 heal: the session-home cure — the cookieless browse retry + the honest-empty-rail law; full suite 1154 green clean-env |
| `b9cb56e` | WFX2-P7-AN finish: watch analytics depth |
| `1601fe2` | Merge WFX2-P7-AN: the watch analytics depth (…19 new tests, suite 1173 green clean-env) |
| `4f7e3f3` | WFX2-P7-AN harden: malformed-JSON body on watched-map is a 400; +1 test |
| `db9c204` | chore: retrigger production deploy for the P7-AN merge (API-deploy bucket quota-limited) — empty deploy-trigger commit |

**Acceptance evidence (as recorded in history):**

- P7-BR: "105/105 broker tests green" (`c9ba1ed`).
- P7-CH: `WORKLOG.md` records the lane end-to-end — baseline **1134 pass / 0 fail** (pre-edit), final **1151 pass / 0 fail** (boot 383 → 400, +17 tests: 9 channel-tabs + 8 channel-page; every other script byte-identical), typecheck clean + lint clean; the merge records "+17 tests green, merge-base `5e9481a`, one commit, in-scope, identical environmental sets vs main".
- P7 heal: "full suite 1154 green clean-env" (`41aa6a9`, +3 fixture tests in `tests/session-home-heal.test.ts`).
- P7-AN: "19 new tests, suite 1173 green clean-env" (`1601fe2`); the harden adds "+1 test (truncated JSON)" (`4f7e3f3`) → 1174.

**Production impact:** Tier-2 broker writes survive YouTube's 2026 DOM (comment view-models, confirm dialogs, the 2026 button host — comments/likes/subscriptions/playlists writes keep landing); the production `/api/home` 502 from the fresh `YT_COOKIES` is cured (home rails restored via the cookieless retry); channel Membership surfaces honestly (real tiers, no faked payment); watch history analytics + insights become real user-visible surfaces.

## P8 — YT-parity production fixes (2026-10-04, branch `wfx2/p8-yt-parity-gaps`)

**Scope — three fixes merged together:**

- **comments** (`1b5e373`) — fix 2026 replies pages: `appendContinuationItemsAction` + bare `commentViewModel` shapes, top-level page-2+ pagination; a live-captured fixture (`tests/fixtures/yt/comments_replies_dQw4.json`, ~3000 lines) drives the tests.
- **playback** (`f62bf63`) — the embed bot-wall fallback chain: probe → native `<video>` via the `/api/stream` proxy → the blocked-card (never a dead player); storyboard hover preview; IOS player-client chain (`src/lib/youtube/streams.ts`, `INNER_TUBE_PLAYER_CLIENT` env); `player-fallback.tsx`, `youtube-player.tsx`, the playback-client + player-host wiring; playback/player tests wired into the standing suite.
- **broker** (`7e04607`) — public-gateway client compat: `BROKER_QUERY` (`XTransformPort=3055`) + the `x-session-id: webflix-producer` header composed by `brokerEndpoint` on every request (the FC gateway's hard laws, covered by `tests/broker-client.test.ts`), plus the ops runbook — the "Broker gateway wiring (production)" section of `docs/ops/vercel-env.md` with the sanity probes.

**Key commits:**

| sha | subject (abbreviated) |
|---|---|
| `1b5e373` | comments: fix 2026 replies pages (appendContinuationItemsAction + bare commentViewModel) + top-level page-2+ pagination; live-captured fixture |
| `f62bf63` | playback: embed bot-wall fallback chain (probe → native video via /api/stream proxy → blocked-card), storyboard hover preview, IOS player-client chain; wire playback/player tests |
| `7e04607` | broker: public-gateway client compat (BROKER_QUERY + x-session-id producer header); ops runbook |
| `c715a20` | Merge wfx2/p8-yt-parity-gaps: production fixes — comment replies, playback embed-wall fallback + hover preview, broker gateway wiring |
| `960fed6` | chore: retrigger production deploy for the p8 merge (c715a20) — API-deploy bucket still quota-limited (reset ~01:52Z Oct 5) — empty deploy-trigger commit |
| `2aec4ba` | chore: retrigger deploy (broker public ingress + nextauth secret) — empty deploy-trigger commit |

**Acceptance evidence:** the lane's commit subjects are one-liners — no per-lane gate count is recorded for P8 in the history. The recorded evidence is: (a) the lane's tests are wired into the standing battery (the `package.json` test-list union from `f62bf63` — `playback-fallback.test.ts` and `player-fallback.test.tsx` ride `test:watch`; `yt-mappers` +80 / `broker-client` +79 test lines); (b) the recorded suite totals bracket the lane — 1174 after the P7-AN harden (`4f7e3f3`) → 1237 at the P10-OPS head (`WORKLOG.md`), the +63 spanning P8 + P9 + the P10-window harden commit; (c) the production deployment moments are recorded by the deploy-trigger chores (`960fed6`, `2aec4ba`).

**Production impact:** 2026-format comment replies render and paginate in production; playback survives the IFrame embed bot-wall with a real fallback ladder (native video through the stream proxy, then an honest blocked card); the broker becomes reachable through the sandbox's public FC gateway (the `x-session-id` + `XTransformPort` laws), un-blocking Tier-2 writes from Vercel egress — the wiring documented as "Verified end-to-end 2026-10-01 (2-b step 2)" in `docs/ops/vercel-env.md`.

## P9 — broker read path + YouTube connection UI (2026-10-04, branch `wfx2/p9-broker-read`)

**Scope — two commits merged together:**

- **broker read path** (`06fbc57`) — the broker's read rung: a fetch action (broker-side page-context reads), channel fallback (brokered pages for walled handles — `src/lib/youtube/channels.ts`), playback rung 3 (broker-watch in `src/lib/youtube/streams.ts`), the `isTestUpstream` guard; mini-service types/executor/server extended.
- **connection UI** (`7aeeae3`) — the YouTube connection status in Settings: server-side broker health probe (`/api/connection/youtube`), the Settings connection section, offline-aware action error prompts on the write surfaces (subscribe button, comment composer/row, action row, channel result card), the `use-youtube-connection` hook + `connection-client` (matches both offline variants, rejects everything else).

**Key commits:**

| sha | subject (abbreviated) |
|---|---|
| `06fbc57` | broker read path: fetch action + channel fallback (brokered pages for walled handles) + playback rung 3 (broker-watch); isTestUpstream guard |
| `7aeeae3` | connection UI: YouTube connection status in Settings (server-side broker health probe), offline-aware action error prompts |
| `b6ce8a0` | Merge wfx2/p9-broker-read: broker read path — walled-channel fallback + playback unlock + YouTube connection UI |
| `54a64c9` | chore: retrigger deploy (broker read path + connection ui) — empty deploy-trigger commit |

**Acceptance evidence:** as with P8, the commit subjects are one-liners — no per-lane gate count is recorded for P9 in the history. The recorded evidence is: (a) the lane's tests ride the standing suite (`mini-services/youtube-broker/broker.test.ts` +63 lines, `broker-client` +114, `channel-wall` +123, `playback-fallback` +80, `settings-system` +229 — all in the battery that stands at 1237/0); (b) the production deploy moment recorded by `54a64c9`; (c) the bracketing recorded totals 1174 → 1237 shared with P8 and the P10-window harden (above).

**Production impact:** walled channel handles gain a read rung (the @handle scrape 404 wall gets brokered pages — the honest 200-degrade instead of a naked 502 family); playback gains the broker-watch rung (an unwalled logged-in tab can serve the stream); users see the real YouTube connection status and honest offline prompts on every write surface instead of opaque failures.

## P10-OPS — broker route restoration + re-arm automation (2026-10-04 → 2026-10-05)

**Scope** (per `WORKLOG.md`'s P10-OPS section, `docs/ops/vercel-env.md`'s "2026-10-05 — broker route status", and `scripts/rearm/README.md`):

- The lane goal: restore production Tier-2 writes (the production `BROKER_URL` pointed at the named tunnel `webflix-broker.flauz.app`, which had no DNS record and no connector — all broker-backed actions were dead) and make the broker chain self-healing; reconcile the ops docs with the real route.
- The bridge: a cloudflared **quick tunnel** fronts the broker (ephemeral `*.trycloudflare.com` URL → the sandbox broker on `:3055`); the provisioned CF API token is read-only for tunnels, so the named tunnel could not be armed from the sandbox (restoration path + required token scopes recorded in the runbook).
- The harden commit (`8e81a19`, direct on main): playback empty-degrade never cached (the `isEmpty` guard in `streams.ts`) + the broker tab-liveness pre-check with auto-revive (`executor.ts`).
- The re-arm tooling (`scripts/rearm/`, committed sanitized — secrets read at runtime from `/home/z/.payswap-env`, never in the repo): `rearm.sh` (idempotent chain re-arm: Xvfb `:99` → Chrome CDP `:9222` → broker `:3055` → tunnel; fail-closed without `BROKER_SECRET`), `rearm_watchdog.sh` (the 120s self-healing loop + prod-sync auto-deploy through the 3-way chain: v13 API `gitSource` POST → deploy hook → empty-commit push), `cf_tunnel.py` (the named-tunnel creator, blocked on token scopes), `verify_login.py`, and the README runbook (rotation handling, the Vercel 100-deploys/day quota law, the sandbox-local-only files `youtube_login.py` / `harvest_cookies.py` that are never committed).
- Ops docs reconciliation: the "2026-10-05 — broker route status" section of `docs/ops/vercel-env.md` (quick-tunnel route live; named-tunnel restoration path; deploy-trigger chain; fresh `YT_COOKIES` re-harvested 2026-10-05), the P10-OPS entry in `WORKLOG.md`, and the README Tier-2 line.

**Key commits:**

| sha | subject (abbreviated) |
|---|---|
| `8e81a19` | harden: playback empty-degrade never cached (isEmpty guard) + broker tab-liveness pre-check with auto-revive |
| `1ebceca` | chore: retrigger deploy (hardening) — empty |
| `6fd653d` / `56779f8` / `fbbc59b` | chore: retrigger deploy (named tunnel url ×3) — empty |
| `3cd5c6f` | chore: retrigger deploy (broker route: live public tunnel) — empty |
| `3010300` / `071df2d` | chore: retrigger deploy (broker route cutover ×2) — empty |
| `225eba0` | P10-OPS: broker route restoration — re-arm tooling + self-healing watchdog + ops docs reconciliation (scripts/rearm/*, docs/ops/vercel-env.md, WORKLOG.md, README.md; +410 lines, zero code) |

(The ten `chore: retrigger deploy` commits in the window are empty by design — they are the deploy-trigger mechanism itself, the third rung of the 3-way chain documented in `scripts/rearm/README.md`; their subjects narrate the route restoration: named-tunnel attempts → live public tunnel → cutover.)

**Acceptance evidence (as recorded in history):**

- `WORKLOG.md` P10-OPS: "Gates at this commit: lint/typecheck green, **1237/1237 tests pass**" — recorded at `225eba0`, the current base.
- The route itself live-verified, recorded in the same section: "public healthz ok; DOM-verified write through the public route."
- Re-verified at documentation time (this lane's own gates, run at base `225eba0` before any edit): lint 0 / typecheck 0 / **1237 pass / 0 fail** (boot 413 / watch 447 / liveshorts 110 / cutover 108 / auth 107 / community 34 / notifications 18) — matching the recorded total.

**Production impact:** Tier-2 writes (comments, likes, subscriptions, playlists, history management) restored end-to-end through the public quick-tunnel route; the chain self-heals — the 120s watchdog re-arms every layer (Xvfb → Chrome CDP → login → broker → tunnel) and auto-republishes the URL on rotation (env PATCH + the 3-way deploy-trigger chain), which matters because quick-tunnel URLs are ephemeral; the honest limits are recorded, not hidden: the named tunnel needs a CF API token with Tunnel:Edit + DNS:Edit (NEEDS OPERATOR), the GitHub↔Vercel git integration is disconnected (push deploys dead; deploys flow through the watchdog chain), and the Vercel free-plan quota (100 API deployments/day) must never be hammered.

## Recorded test-count trajectory (the evidence chain)

| Record point | Total tests | Recorded at |
|---|---|---|
| Phase-5 close (roadmap complete) | 1034 / 0 | `docs/plans/wave-claims.md` "PHASE 5 claims SETTLED"; `1d23126` |
| P6 net (post-P6 baseline) | 1134 / 0 | `WORKLOG.md` P7-CH baseline (merge-base `5e9481a`) |
| P7-CH final | 1151 / 0 | `WORKLOG.md` P7-CH (boot 383→400) |
| P7 heal | 1154 / 0 | `41aa6a9` ("full suite 1154 green clean-env") |
| P7-AN | 1173 / 0 → 1174 / 0 | `1601fe2` ("suite 1173") + `4f7e3f3` ("+1 test") |
| P8 + P9 + P10-window harden | +63 (no per-lane counts recorded) | bracketed: 1174 → 1237 |
| P10-OPS head `225eba0` | 1237 / 0 | `WORKLOG.md` P10-OPS ("1237/1237 tests pass") |

## Sources

- `git log --oneline -100` at base `225eba0` (the lane commit history) + the per-commit messages and stats cited above — the gate counts live in the commit subjects/bodies (`9c04090`, `70bd1b6`, `17cef18`, `18a580f`, `21de2a4`, `2eeab1f`, `21c8fd3`, `41aa6a9`, `1601fe2`, `4f7e3f3`, `9cedeb6`, `c9ba1ed`, and the P8/P9/P10 commits).
- `WORKLOG.md` — the P7-CH lane worklog (baseline 1134/0 → 1151/0, the honest-state matrix) and the P10-OPS entry (the restoration narrative, 1237/1237).
- `docs/plans/wave-claims.md` — the 2026-10-02 Phase-5 settle (1034 root tests, "ROADMAP COMPLETE", production verified 19:39Z) — the pre-P6 baseline.
- `docs/ops/vercel-env.md` — the broker gateway wiring section (added by P8's `7e04607`) and the "2026-10-05 — broker route status" section (added by P10-OPS's `225eba0`).
- `scripts/rearm/README.md` — the re-arm chain, the 120s watchdog + prod-sync, rotation handling, and the known ops constraints (added by `225eba0`).
- `README.md` — the live architecture (Tier 0/1/2) and the gates.
- `docs/plans/2026-09-29-live-roadmap.md` — the roadmap these lanes hardened after (G1–G6, waves A/B/C, phases 1–5).
- Remote branch names (`wfx2/p6-*`, `wfx2/p7-*`, `wfx2/p8-yt-parity-gaps`; the P9 merge names `wfx2/p9-broker-read` — no remote branch by that name remains at base) — the lane branch namespace.
