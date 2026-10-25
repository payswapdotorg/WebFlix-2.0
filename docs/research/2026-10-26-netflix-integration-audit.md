# Netflix integration — audit + seamless-interface research (P51)

Date: 2026-10-26 · Lane: wfx2/p51-netflix-audit · HEAD audited: `31ceab0` (P50, == origin/main)
Task: "audit issues with the netflix integration · research ways to integrate netflix seamlessly into webflix in order to make it an interface for netflix.com's content · write a report · implement the suggestions."

Method: three parallel read-only audit lanes (playback chain, browse surfaces, data layer + docs), every finding re-verified against the code before it was accepted, then synthesized into the plan below. Findings cite file:line at HEAD.

---

## 1. Executive summary

The Netflix integration is architecturally sound — bounded endpoints, honest-degrade DTOs, poison-proof ingest ladder, a real test battery — but the audit surfaced **4 verified production-breaking/critical issues**, **9 high-value reliability/security gaps**, and a tail of polish. The most serious:

1. **PROD: the Continue Watching feature is dead on arrival in production** — `prisma/schema.postgres.prisma` never received the P49 `NetflixWatchEvent` model, and `vercel.json` pushes the postgres schema over the dev one on every deploy. Every `/api/netflix/progress` call 502s on Neon. (§3.3 F1)
2. **The cloud desktop self-destructs ~25 min into any long title** — the idle-TTL clock has no heartbeat while a video plays; only navigation refreshes it. (§3.1 A1)
3. **Anyone on the public deployment can take over the shared cloud Chrome** — the broker's status responses disclose `sandboxId`, which is all an attacker needs to reach the **unauthenticated CDP relay** on the sandbox's public host (HttpOnly Netflix cookies included). (§3.1 B1/B2)
4. **Operator credential fragments sit in two docs** — contradicting ADR 0002 §5's "never written to the repo" claim. (§3.4 E1)

None of this breaks the law set (bounded URLs, no fake rows, honest degrade); all of it is fixable in one hardening + polish lane (P51, implemented by this cycle — see §5).

---

## 2. What "an interface for netflix.com's content" means (research)

The original P42 research (`2026-10-24-netflix-integration-options.md`) established the honest asymmetry: no public API, no embeds, DRM on 100% of streams. ADR 0003 then accepted the operator-directed cloud-desktop playback lane. Re-deriving the option matrix against the P50 codebase, the integration stack is now four layers, and "seamless" has a concrete definition per layer:

| Layer | What seamless means | State at P50 | Gap |
| --- | --- | --- | --- |
| **L1 Catalog truth** | WebFlix knows what Netflix offers | Tudum Top-10 universe (~80 titles union, 8 bounded pools, 6h/24h TTL, per-country ranks) | Depth is structurally capped at the Top-10 universe; enrichment needs an operator-provided key (TMDB `with_watch_provider=8` documented as the lane). Staleness is silent to operators. |
| **L2 Browse UX** | Netflix-grade discovery inside WebFlix | Billboard, Top-10 rails, hover cards, kind tabs, 14-market aisle, in-hub search, title pages, My List, Continue Watching, global-suggest integration | SEO-blind (client-only title pages, no sitemap), a few stale-state papercuts, full-res art in thumbs |
| **L3 Playback** | The title plays in WebFlix | Cloud desktop stream + audio tap + bridge auto-sign-in + honest degrades | The two playback-chain holes (A1, A2) + restart races |
| **L4 Session** | The viewer's Netflix identity rides along | WebFlix Bridge cookie push with strict validation + candidate ladder | Public token disclosure (B3), no lockdown rung |

Research conclusion: the binding constraints are unchanged (DRM law, bounded upstream, honesty). The seamless-interface roadmap is therefore **not** "find more endpoints" — it is: (a) close the verified correctness/security holes so the existing four layers are trustworthy, (b) make the browse layer discoverable and self-consistent (SEO + state freshness), (c) keep enrichment/operator lanes documented for when keys exist. External option re-verification (TMDB tier state, Trakt/Netflix id coverage) is an operator rung — this sandbox has no general egress, and the repo's own measured record (2026-10-24) remains the newest ground truth.

---

## 3. Audit findings (all verified)

Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low. "Verified" = the auditor's claim was re-checked in code by this lane before acceptance.

### 3.1 Playback chain (watch lane + netflix-desktop broker)

- 🔴 **A1 — Desktop destroyed ~25 min into playback.** `mini-services/netflix-desktop/session.ts:19` `IDLE_TTL_MS = 25*60_000`; the keepalive (`:574-585`) compares `lastActivity`, which only navigation (`watch()`/`openPath()`/`ensure()` fast path) refreshes. The watch lane's 2.5 s poll (`view.tsx:207-220`) hits `/healthz`, which never touches activity → any title longer than ~25 min freezes mid-play. *Fix: `/healthz` heartbeats when a live stream is up (bounded by a max-lifetime cap); `release` semantics documented honestly.*
- 🟠 **A2 — "unreachable" phase is dead-on-arrival in the UI.** `session/route.ts:19-24` answers broker-down with 503 + `{phase:"unreachable"}`; the client's poll (`view.tsx:210`) does `if (!res.ok) return;` and throws the body away → the lane's honest unreachable state (already coded at `:774`) can never render; users see the eternal "Preparing Netflix…" instead. *Fix: the poll adopts a phase-bearing JSON body regardless of status.*
- 🟠 **A3 — Restart is unserialized.** `index.ts:84-87` fire-and-forgets `destroy()` (async, up to 8 s of pkill) while the UI immediately re-kicks (`view.tsx:472-482`); `ensure()` can adopt the dying sandbox or a late `resetLocal()` can null a fresh desktop (`session.ts:588`). App-side: no busy state on the button. *Fix: app-side busy gating now; broker-side serialization noted as operator hardening.*
- 🟠 **A4 — Param-change doesn't remount the lane.** `/netflix/watch/123 → /netflix/watch/live` keeps the old iframe + kick (`kickedRef` `view.tsx:174`; `page.tsx` renders the view without a key). *Fix: key the view by `rawId`.*
- 🟡 **A5 — Audio pipeline leaks + stale-ok.** `URL.createObjectURL` never revoked (`view.tsx:383`); mute toggle rebuilds MediaSource+socket (deps `[live, audioOn]` `:400-465`); no `disconnect`/`connect_error` handlers so `audioOk` stays true after the socket dies (`:423-429`). *Fix: revoke + socket-health downgrade now; keep-alive across mute.*
- ⚪ **A6 — Hygiene.** Unused `Download` import (`view.tsx:22`); `PHASE_STEPS[3]` dead config (`:902`); `retryAuth` ignores `res.ok` (`:484-491`); deeplink law violation — three inline `https://www.netflix.com/...` constructions (`view.tsx:592,804,857`) vs `deeplink.ts`'s "ONLY place" declaration.

### 3.2 Security (verified the whole disclosure chain end-to-end)

- 🔴 **B1 — `sandboxId` disclosed publicly.** `session.ts:101` puts it in `getStatus()`; `index.ts:45-51` spreads it into `/healthz` and `/session`; the app proxy (`watch/session/route.ts`) forwards it to every visitor; the UI never uses it. *Fix: stop disclosing (broker + defensive strip + pin).*
- 🔴 **B2 — Unauthenticated remote Chrome takeover.** The relay (`cdp-relay.ts`) binds `0.0.0.0:9223`, rewrites `Host:` to defeat Chrome's check (`--remote-allow-origins=*` `session.ts:73`), and is reachable on the **public** E2B host `9223-<sandboxId>.e2b.app` (`cdp.ts:106-118`) with no shared secret → DevTools-level control of the signed-in Chrome (HttpOnly cookies included). Requires B1's disclosure to be reachable by strangers. *Fix: per-boot relay token (request-head check + token-strip before forwarding; connector passes it on fetch and WS).*
- 🟠 **B3 — Watch routes unauthenticated/unthrottled; token public.** None of the seven `/api/netflix/watch/*` routes calls `rateLimit` (every other `/api/netflix/*` route does); `GET /api/netflix/watch/autoauth` hands the pairing token to any visitor (`autoauth/route.ts:14-25`); `POST /cookies` has no gate at all. In a public deployment any visitor can substitute the shared Netflix session with their own (valid!) cookies. *Fix now: rate limits + same-origin checks on every watch route, `0600` on the broker's secret files. Operator rung: viewer-identity gating for token/cookies routes (product decision — the pairing lane is the operator's tool).*
- ⚪ **B4 — Secret files 0644.** `/tmp/netflix-cookies.json` (`session.ts:20`), pairing token + bridge candidate (`ingest.ts:24-27`). *Fix: 0600.*

### 3.3 Data layer + prod

- 🔴 **F1 — Postgres schema missing `NetflixWatchEvent`.** `prisma/schema.postgres.prisma` (the one `vercel.json` pushes) ends its Netflix block at `NetflixMyListItem`; the dev schema (`schema.prisma:436-447`) has the P49 model + index. Prod `db.netflixWatchEvent.*` throws → 502. *Fix: sync the model + User relation + index; add a schema-parity drift-guard test so this class of gap can never silently recur.*
- 🟠 **F2 — Anonymous visitors ride the seeded demo identity.** `netflixViewerId` (`viewer.ts:32-33`) falls through to `resolveViewer`, whose demo fallback (`watch/session.ts:73-85`) resolves on prod (`seed-prod.ts` seeds @demo/@you) — signed-out visitors share one read+write identity on every personal Netflix surface, contradicting every "honest anonymous" comment. *Fix: the demo fallback ends at the Netflix seam — no header/cookie/session lane resolves → `""`.* (The routes' 401/honest-empty contract then becomes testable for real — the old "writes without identity → 401" pin asserted 200 with a comment explaining it couldn't.)
- 🟡 **F3 — Staleness is silent.** Pool fetch failures log nothing; `fetchedAt` is stamped at request time even for last-good data; the warmer doesn't know the `nf:` keyspace. *Fix now: loader-side warn logs. Operator rung: warmer entries + alerting.*
- 🟡 **F4 — Search scoring window.** `searchNetflixCatalog` scores after `take: 40` in rowid order (`catalog.ts:290-315`) — a common token can crowd out the best match; the mirror never prunes. *Fix: widen the candidate window (cheap on a bounded mirror).*
- ⚪ **F5 — TTL/doc drift.** Research §4 says hard TTL = "4× soft"; code is 8× / ~7× (`top10.ts:37-41`). README `:27-31` still describes the P42 deep-link-only posture. *Fix: corrections section + README refresh.*

### 3.4 Docs hygiene

- 🔴 **E1 — Credential fragments in docs.** `docs/research/2026-10-24-netflix-in-app-playback.md:56-58` and `docs/work-items/P43-NETFLIX-DESKTOP.md` carry the operator's account email / domain in plain text, contradicting ADR 0002 §5. *Fix: redact now; history purge + credential rotation = operator rung (git history retains old blobs).*
- ⚪ **E2 — Small drift.** `catalog.ts:176-178` documents a `myListResolved` field that doesn't exist; `netflix-card.tsx:116` labels all-time titles "Top 10"; the hub's `fetchedAt` note. *Fix where touched.*

### 3.5 Browse surfaces

- 🟠 **S1 — The SEO-valuable URLs are invisible.** `/netflix/t/[id]` ships static boilerplate metadata (`page.tsx:5`) with a client-only view; no `sitemap.ts` exists anywhere; robots points at nothing. *Fix: `generateMetadata` + sitemap + robots line.*
- 🟡 **S2 — Search kind tabs fight the 20-cap.** Tabs filter only the answered ≤20 set client-side; the API has no `kind` param (`search/route.ts:18-19`) — a TV tab can show 0 while TV matches exist past the cap. *Fix: server-side `kind=` (contract-additive), tabs drive it.*
- 🟡 **S3 — My List rail goes stale in place.** Removing a card from the rail leaves it visible until a hub refetch (`view.tsx:61-78`; Continue Watching already re-reads its truth). *Fix: `onChanged` → reload (the hook already supports it).*
- 🟡 **S4 — Zero HTTP caching on weekly-scale reads.** Hub/title/search GETs are `force-dynamic` with no `Cache-Control` while their data moves on 6h/24h TTLs. *Fix: `s-maxage=300, stale-while-revalidate` on the three read routes; my-list/progress stay dynamic.*
- 🟡 **S5 — Ranked-card broken-image bug.** `netflix-card.tsx:66-68` — the *condition* falls back to `posterUrl` but the `src` doesn't → ranked card with poster-but-no-backdrop renders `src=""`. *Fix: one-line fallback.*
- ⚪ **S6 — Polish tail.** Full-res 1200×675 art in 200px thumbs (next/image needs `remotePatterns` — operator rung); billboard dots lack `tabpanel` wiring; `t/[id]` dead 404-copy branch (`error.includes("404")` never true); `titlePageUrl`/`deepLinkUrl` DTO fields carried but unconsumed; hero My-List always starts unpressed. *Fix the cheap ones; note the rest.*

### 3.6 Verified-good (audited, no action)

The bounded 8-URL upstream + escape-aware parser + poisoning-guarded cache ladder (`cachedResilient` in-flight dedupe → SWR single-flight → `isEmpty` guard → last-good → honest null); the never-fake-rows law is test-pinned, not just declared; route contracts match the UIs field-for-field; per-viewer isolation works at the shadow-user rung; the ingest ladder's token timing-safe compare + candidate validation; the mirror never blocks pools; politeness is real (12 s timeout, 1 retry, cache-first).

---

## 4. Operator rungs (documented, not code)

1. **Rotate the exposed Netflix credentials** and consider history purge (old blobs survive file edits).
2. **Configure `E2B_API_KEY`** on the broker host (the keyed-snag wizard already guides this).
3. **Vercel env**: `NETFLIX_DESKTOP_URL` + `NETFLIX_DESKTOP_QUERY` (P47 runbook section).
4. **Prod probe**: after this cycle's deploy, `GET /api/netflix/progress` should answer 200 `{items:[]}` on Neon (F1 fixed in schema; `prisma db push` rides the deploy).
5. **Lockdown decision**: viewer-identity gating for the pairing-token/cookie routes (B3's full fix needs a product call: who may pair the bridge on a public deployment).
6. **Enrichment keys**: TMDB (`with_watch_provider=8`) for full-catalog depth when available.
7. **Warmer**: add the `nf:pool:*` keyspace to the cache-warming runbook + alerting on pool-failure logs.
8. **next/image**: add `dnm.nflximg.net` to `images.remotePatterns` for sized art.

---

## 5. Implementation plan (P51 — ships this cycle)

Ordered; each item carries its gate law (tsc clean · eslint 0e touched · test:netflix growing · full battery green · 375px no overflow):

1. **F1 + parity guard** — postgres schema sync + a test that walks every `model` in the dev schema and demands it in the postgres one.
2. **A1 heartbeat** — broker `/healthz` touches activity while a live stream exists, bounded by a max-lifetime cap; `release`'s grace semantics documented honestly.
3. **A2 503 honesty** — the poll adopts phase-bearing non-2xx bodies; UI pin renders the unreachable state from a 503.
4. **B1 sandboxId strip** — broker stops returning it; app proxy strips defensively; pin.
5. **B2 relay token** — per-boot secret; relay checks the request head (header or `token=` query), strips the param before forwarding; connector passes it; secrets at rest 0600 (B4).
6. **B3 throttling + same-origin** — every watch route rate-limited; POSTs reject cross-site origins; secrets files 0600.
7. **C1/F2 identity** — `netflixViewerId` drops the demo fallback; the 401/empty contract gets its real pin.
8. **A3/A4/A5** — restart busy-gating + view keyed by id + audio URL revocation and socket-health downgrade.
9. **S1** — `generateMetadata` on the title page + `sitemap.ts` + robots Sitemap line.
10. **S2/S3/S4/S5/S6** — `kind=` server filter + tabs drive it; My List rail reload; cache headers on the three read routes; ranked-card src fallback; badge honesty ("Top 10" vs "Most Popular"); dead-branch/import sweep where touched.
11. **F3/F4** — pool-failure warn logs; wider search scoring window.
12. **E1/E2/F5** — redactions + corrections + README playback-posture refresh.
13. **WORKLOG** + push.

Out of scope this cycle (documented above): viewer counting (multi-viewer sessions), broker-side restart mutex beyond busy-gating, image pipeline swap, enrichment lanes, acceptance.mjs extension.
