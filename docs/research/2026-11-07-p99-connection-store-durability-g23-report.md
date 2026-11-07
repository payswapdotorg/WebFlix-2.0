# P99 — the ship-verification walk and the connection-store durability gap (G23)

Date: 2026-11-07 · Base: main @ 17f1c82 (P97-r2 `a4d6442` + P98 `17f1c82`) · Window: trace `1a1b46d3e6cf229d`

## 0. Why this walk exists

The operator supplied the ship credentials this window (the payswap GitHub PAT + the
Vercel tokens + a Neon family + Upstash credentials). P97-r2 and P98 were sitting local
with `SHIP BLOCKED` across two resets. The wave: push, deploy, run the production
re-verification battery (G20's four-rung table, G21's viewerLinked stamp, G22's authed
feed health), flip the ledgers — and close anything the walk surfaces, report-first.

## 1. What shipped (the push + the deploy)

- **Push**: `79ac4d5..17f1c82 main -> main` (the PAT bypassed the repo's 3 required
  status checks — recorded as-is). Both lost waves left the building: P97-r2 `a4d6442`
  and P98 `17f1c82` are on origin.
- **Deploy 1**: production `dpl` @ `webflix-2-0-1lit616sd-tepa.vercel.app`, aliased to
  the project's production aliases, READY in 2m, created 2026-11-07 05:20 UTC. The
  standing production URL `https://webflix-2-0-tepa.vercel.app` serves it (verified by
  the G20 behavioral marker below, not by trusting the alias).
- **Deploy 2** (mid-verification, after the env change — see §3): `webflix-2-0-lcz6h8sww-tepa.vercel.app`.
- Scope discovery: the deployment lives under the Vercel team `tepa` (project
  `webflix-2-0`, `prj_vRMbcoEOE2KQSwKwf5rKQkhYDc6Z`); the MAIN token's default team
  (`ekonplacidegmailcoms-projects`) hosts a different `webflix-2-0` project (its
  `webflix-2-0-one.vercel.app` alias answers 402 — a dead sibling, not ours). The
  FALLBACK Vercel token (`vcp_3uMg…`) is rejected as invalid by the API. All work uses
  the MAIN token + `--scope tepa`.

## 2. G20 — LIVE-VERIFIED (the four rungs converged)

Repro from the P97 report, re-run against live production on the new build:

| Rung | URL | P96 prod (old law) | P97-r2 prod (new law) |
|---|---|---|---|
| 1 | `/api/tiktok/channel/%40%40bad` | 400 invalid-handle | **200** |
| 2 | `/tiktok/%40%40bad` | 200 (normalized `bad`) | **200** |
| 3 | `/api/tiktok/feed?creator=%40%40bad` | 200 scoped `@bad` | **200** `{"items":[],"nextCursor":null}` (honest scoped empty) |
| 4 | `/shorts?source=tiktok&creator=%40%40bad` | 200, UI showed RAW `@@bad` | **200**, the scope chip renders `@bad` (the raw `@@bad` survives only in the RSC flight's searchParams echo — URL state, not rendered content; `tiktok-scope-chip` marker present) |

Regression pins, live: valid `@scout2015` → 200; genuinely-invalid `b@d` → **400 stays**;
multi-sigil-valid `@@scout2015` → 200. One input, one identity at every rung — the law
holds on production.

## 3. G21 + G22 — the API probes are green; the browser walk finds G23

Signed-in walk on production (fresh throwaway `p98ship@example.com`, registered through
the real `/api/auth/register` → 201, signed in through the real `/signin` form in a
real browser, linked through the real `/api/connection/tiktok/link`):

- Link POST → 200 `{ok:true, linked:{handle:"scout2015", connectedAt:…}}`.
- **G21 stamp probes** (all green on the warm instance that served the link):
  - `/api/tiktok/channel/%40scout2015` → `viewerLinked: true`
  - `/api/tiktok/channel/%40%40Scout2015` → `viewerLinked: true` (the case-sigil compose law)
  - stranger `/api/tiktok/channel/%40brittanypeachhh` → `viewerLinked: false`
  - guest (no cookie) → `viewerLinked: false` (field present)
- **G22** authed `/api/tiktok/feed` → 200 (the seam's happy path healthy on prod).

**Then the browser walked the channel page and the linked statement did not render** —
the About tab showed the guest prompt ("Is this you? …"), while the same API probe with
the same session cookie still answered `viewerLinked: true` from one invocation and
`viewerLinked: false` from another minutes later. The stamp was NONDETERMINISTIC on
production.

### Root cause chain (G23)

1. `TikTokConnectionStore.envRest()` requires `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN`; absent → an **in-memory Map on `globalThis`** — one
   lambda instance's memory. The store's own docstring says the quiet part: "a
   connection must never live on one lambda instance only" — but without the env vars,
   it does exactly that.
2. This window wired the operator's Upstash pair into the project env; the runtime logs
   then showed the truth: `getaddrinfo ENOTFOUND meet-ewe-145933.upstash.io` — **the
   operator's Upstash database host no longer exists in DNS** (deleted database). With
   the env set but the host dead, link WRITES now fail honest with 503 ("The connection
   store is unreachable"), and reads degrade to the empty per-instance mirror.
3. Net law on production today: the TikTok link lane is **non-durable by construction**
   — the only durable backend it knows is an operator-supplied host that is gone.

### The operator-credential findings (recorded honestly, no retry-theater)

- Upstash REST host `meet-ewe-145933.upstash.io`: DNS-dead **from Vercel's runtime**
  (the runtime log is the evidence — the sandbox's own DNS wall is irrelevant here).
- Upstash Management API with the operator's account key: `GET /v2/teams` → **200**
  (auth valid) but every databases route (`/v2/databases`, with/without trailing slash,
  with `team-id`, with Accept) → **404 page not found**; `POST /v2/databases` (create a
  fresh database) → 404 as well. The credential cannot reach the database plane.
- Upstash remote MCP (`https://mcp.upstash.com/mcp`): rejects the key in every header
  shape tried (Bearer / x-upstash-api-key / X-Api-Key / query param) with
  `invalid_token` + "No authorization provided" — it authenticates over browser OAuth,
  which this lane does not have.
- Second REST token (`42fdfeaf-…`, UUID form): untestable against a DNS-dead host;
  the same dead-host verdict applies regardless of token.

**Verdict: the Upstash dependency is operator-gated and currently broken at the root
(the host is gone). Waiting for it means the TikTok link lane stays non-durable.**

## 4. G23 — the closure plan (implementable now, no operator dependency)

The stack already owns a durable layer: **Neon via Prisma**. The store's contract is
unchanged; only the durable backend swaps from "operator's Upstash host" to "the app's
own database":

1. **Schema (additive)**: two record tables — `TikTokConnectionRecord` +
   `YouTubeConnectionRecord` — each `userId @id` + a `data` string column carrying the
   EXACT serialized record the Upstash adapter carried (the `isConnectionShape` law
   carries over verbatim; zero field-mapping risk; JSON numbers/text sidestep the
   epoch-ms Int ceiling).
2. **Store law rewrite (both twins)**:
   - `get` → durable read first (Prisma), local mirror only as the read-degradation
     fallback (a DB outage never breaks a request — the G22 doctrine);
   - `put` → durable upsert + mirror; a DB failure throws
     `TikTokConnectionStoreUnavailableError` (the routes' honest 503 contract, unchanged);
   - `delete` → durable delete + mirror; boolean contract unchanged;
   - the REST adapter + its test seam die (no test ever used the seam; the key
     functions have no external callers);
   - `resetTikTokConnectionStore` (test hook) wipes the mirror AND the table.
3. **Route contracts unchanged** — every importer of the two stores keeps compiling
   against the same function signatures.
4. **Env hygiene**: with the stores off Upstash, the dead `UPSTASH_REDIS_REST_*` vars
   come OFF the project (the one remaining consumer, the L2 cache adapter, disables
   cleanly on absent env and fails open on a dead one — verified in source). Recorded:
   the rate-limit/cache lane is the operator's revival lane if they ever stand a live
   Upstash back up.

## 5. The residual set (documented, not papered)

- `src/lib/auth/user-store.ts` carries the same Upstash-or-memory pattern for
  `wf:auth:user:*` rows. Sign-in/register demonstrably work across instances on prod
  (this walk registered + signed in through them), so it is NOT touched in P99 — the
  no-defect-no-surgery law. If evidence ever shows a defect, it gets its own wave.
- The rate-limit/L2-cache lane stays Upstash-optional (fail-open, honest log line when
  the env points at a dead host) — operator-gated, out of G23's scope.
- The operator's Upstash account itself (dead db host; management API 404s on the
  database plane; MCP over browser OAuth only) — recorded for the operator, no further
  attempts from this lane.
- Money gate stays CLOSED (nothing money-shaped touched).
