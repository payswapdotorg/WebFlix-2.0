# P52 — the deferred tail + the operator rungs that are code

Lane: wfx2/p52-deferred-tail · Parent: the P51 audit report (§4 operator rungs, §5 out-of-scope list)
Task: "go" — the audit cycle closed at P51; this lane picks up everything the report deferred that is CODE, in value order.

## Scope (from the P51 report)

The report's §5 explicitly deferred: broker-side restart mutex, the pairing-lockdown rung (B3's full fix), the warmer keyspace, the image pipeline, the acceptance extension. §4's rung list marked rungs 5/7/8 as "documented, not code". P52 implements all of them.

## 1. The broker restart mutex (A3, the broker-side half)

**P51 shipped the app-side busy-gating; the broker-side race stayed open**: the restart route fire-and-forgets `destroy()` while the UI re-kicks — `ensure()` could adopt a dying sandbox or a late `resetLocal()` could null a fresh desktop.

- `mini-services/netflix-desktop/mutex.ts` — a 30-line pure serial queue (FIFO, failure-isolated, `drain()`); dependency-free ON PURPOSE so the app battery can pin it directly.
- `session.ts`: `ensure()` and `destroy()` both funnel through the queue — a bootstrap can never interleave with a teardown, two teardowns never interleave. The restart route, idle TTL, and 4h lifetime cap all ride the same law.
- `tests/netflix-broker-mutex.test.ts` (4 pins, wired into `test:netflix`): strict FIFO under out-of-order completion, failure isolation, drain semantics, and the A3 shape itself (teardown fully precedes the next bootstrap).
- Live: broker restart → 202 `restarting` → serialized teardown → honest idle; no deadlock (verified in-sandbox).

## 2. The pairing-lockdown rung (B3's full fix — report §4 rung 5)

The product call the report left to the operator is now a FLAG, not a choice between code states:

- `NETFLIX_PAIRING_LOCKDOWN=1|true|yes` (absent/other = open — the default preserves the P46 pairing lane exactly).
- When set, `GET/POST /api/netflix/watch/autoauth` + `POST /api/netflix/watch/cookies` demand the signed-in identity (`netflixViewerId` — the P49/F2 identity law) and answer the house 401 `{"error":"unauthenticated"}` otherwise. Anonymous visitors stop reading the shared session's pairing token or substituting its cookies.
- The WebFlix Bridge is UNAFFECTED either way — it posts to the broker with its pairing token, never through these app routes.
- UI honesty: the watch lane's `fetchAutoAuth`/`rotateToken` adopt the 401 as the ANSWER (polling stops, never hammers), and the AutoAuthLane renders the honest locked note (`netflix-watch-autoauth-locked`) with a sign-in link instead of a spinning "loading…" token row. Existing P46 testids untouched.
- 6 pins in `netflix-watch-routes.test.ts` (lockdown on × anon → 401 + broker untouched, cookie paste 401, identity lane opens the gate, lockdown off = open tool, truthiness, rotate 401).

## 3. The warmer rides the Netflix pools (report §4 rung 7)

- `scripts/warm-cache.mjs` += `/api/netflix` + `/api/netflix?country=US`. One hub hit composes ALL 8 Tudum pools through the `nf:pool:*` keys (the per-market re-ranks ride the SAME 8 keys — no keyspace growth), so a Global warm buys every market's rails; the result line reports `rails=N ready=M`.

## 4. The image pipeline (report §4 rung 8 + §3.5 S6)

- `next.config.ts`: `images.remotePatterns` += `dnm.nflximg.net`.
- The five big-art surfaces swapped to `next/image` with real `sizes` + `fill`: the card (per-variant 150/170/200/232px hints), the billboard (100vw, first slide `priority` — the LCP image), the Continue-Watching card, the hand-off dialog banner, the title-page hero. The S5 fallback law (src rides the same fallback the condition checks) is preserved verbatim.
- The tiny pre-sized logo overlays stay plain `<img>` (nothing to optimize — measured, not lazy).
- Measured in-sandbox (CDN + Tudum are reachable live): full-res backdrop 113,941 B → optimizer 640px 16,181 B (−86%) / 384px 7,554 B (−93%).
- Test-side: the two next/image-rendering batteries grew `new dom.Window({ url: "http://localhost:3000" })` — a base-less happy-dom window (about:blank) cannot parse the RELATIVE `/_next/image` URLs the optimizer lane renders; the real document always has an origin, so the test window does too.

## 5. The acceptance gate watches the Netflix surfaces (P48's harness, extended)

- PAGES 14 → 17: `/netflix`, `/netflix/search`, `/netflix/t/82023496` (the title PAGE check pins the STABLE `— Netflix — WebFlix` suffix law via the new `titleEndsWith` option — the mirror title rotates, the suffix law doesn't).
- API 19 → 21: the hub rails CONTRACT (rails array; a failed pool DROPS OUT and the top-level `unavailable+unavailableReason` pair carries the honest degrade; every-rail-empty without `unavailable=true` = the fake-empty signature) + the anonymous progress contract (`items:[]` + source, never a fake row).
- NEW suite D "RAW — deployment truth" (3 checks): sitemap.xml served (`<urlset>`), robots.txt advertises it, and the hub read's cache contract — which accepts the TWO deployment truths (the route's `s-maxage=300, stale-while-revalidate` on self-hosted/proxied hosts, or Vercel's platform rewrite `max-age=0, must-revalidate` for force-dynamic handlers) and fails on cache-LOCKING lies (`no-store/no-cache/private`).
- Wall-honesty: the search channel check pins the channels-array CONTRACT and reports walled honest-empty without failing (the channel rail rides the walled InnerTube surface — the reason the warmer exists).
- `tests/acceptance-selftest.test.ts` count pins 38 → 46. Gates: selftest 46/46, LIVE 46/46 against webflix-2-0-one.vercel.app.

## Gates

tsc clean (app AND broker) · eslint 0 errors (1 pre-existing warning, untouched file) · `test:netflix` **139/0 across 11 files** (+10 pins) · full battery **2327/0 across 9 suites** · acceptance selftest **46/46** · LIVE **46/46** · browser-verified live: hub (80 cards, optimizer images rendering, logos raw by design), title page (real `<title>` + optimizer hero loaded), watch/live honest unreachable + error-state pairing panel, the lockdown locked note (no token element), mobile 375px **0px overflow** on hub/search/title/watch-live · evidence `evidence/p52/`.

## Out of scope (still documented)

Viewer counting (multi-viewer sessions — needs a product decision on semantics), TMDB enrichment (needs a key), the credential rotation + history purge (operator hands), `prisma db push` verification on the next Neon deploy (rung 4 rides the deploy itself).
