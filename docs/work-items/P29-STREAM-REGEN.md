# P29-STREAM-REGEN — the self-healing googlevideo proxy (the production 502 cure)

Dispatched: 2026-10-20 (morning), by the resident TL station **for itself**
(direct execution — the worker channel stays idle post-P25; the lead-merges
law). Base: `186fd18` (origin/main — P28-HPV4 merged).

## The finding (the P28 post-merge production re-probe — the standing next step)

The P28 merge rode the vercel auto-deploy; the lane's standing post-merge
step is the production re-probe. It ran 2026-10-20 against
https://webflix-2-0-one.vercel.app and found the lane's code fully live:

- The production home feed renders (48 unique cards); the playback census
  through the live API: **42 healthy (formats ≥ 1) vs 6 walled** (Despacito
  kJQP7kiw5Fk, hK8POwUShVw, JET-JOXk8hk, -3-V-JdAJIo, zmGyfFlt14E,
  3e5spyNm_K0) — the operator's "some others" class, exactly as filed.
- The P28 host ladder live in production: the boot order read in-browser
  `[youtube-nocookie.com, youtube.com]` — the merged code is deployed.
- The P28 settled floor live in production: a card whose embed boots both
  die (the sandbox browser is bot-walled on embeds — the qoe beacons carry
  `Sign_in_to_confirm_you_re_not_a_bot`) degrades to the honest pill with
  **ZERO cycling storyboard frames** — the operator's exact complaint
  symptom is dead on the merged build.

And it found ONE NEW PRODUCTION-ONLY DEFECT — the reason this lane exists:

**`/api/stream` answered `502 {"error":"Upstream stream responded 403"}` on
5/5 probes.** The googlevideo `videoplayback` URLs are IP-bound: the
playback API (the function that minted the URL the browser holds) and the
stream proxy run as SEPARATE vercel functions whose egress IPs differ, so
the client-held URL answers 403 from the proxy's egress. The same URL
played fine from the single-egress dev server — which is exactly why
P26-HPV's end-to-end verification never saw it. The defect breaks the
hover preview's native lane AND the watch page's PlayerFallback swap for
every embed-walled-but-formatted video on production: the middle rung of
the honest ladder was 100% dead in production.

## The fix (the one axis that always matches: a URL generated and fetched by the SAME invocation)

`src/app/api/stream/route.ts` gains the self-healing pass:

- Clients append `&video=<id>&itag=<n>` to the proxied URL (the hover
  preview's `nativeSrc` + the watch fallback's `src` — both consumers).
- On an upstream **403** (the IP-bind/expiry signature) with a valid video
  id, the route re-runs the server-side playback chain (`getPlayback` —
  THIS function's egress), prefers the SAME itag when the fresh answer
  carries it (a Range resume must ride the same stream; else the
  nearest-360p law — the server twin of the client picker, muxed entries
  preferred so a watch fallback never lands on a silent stream), and
  streams THAT through the same passthrough pipeline.
- A per-instance regen cache (videoId → fresh URL, 10min TTL mirroring the
  chain's own WATCH_MS, invalidated by its own 403) keeps seek/Range
  storms from re-running the chain per request; a dead cached URL
  re-heals on the next request.
- The regen fetches only URLs from our own `getPlayback` output — never
  client input — still through the same googlevideo allowlist. A walled
  regen answers the honest `502 … (regen unavailable)`. No `video` param,
  an invalid video id, or a non-403 failure: the old law unchanged.

## The pins

`tests/playback-fallback.test.ts` +10 (the stream battery, driving the REAL
`getPlayback` chain through the `setUpstream` seam while stubbing the
route's googlevideo fetches):

1. the production shape heals end-to-end (dead client URL 403 → the
   chain's fresh URL streams 206, Range forwarded on BOTH attempts);
2. the itag-preference law (itag=22 requested and present → the 22 URL);
3. the nearest-360p fallback (itag=999 absent → the 360p URL);
4. the regen cache (a second request heals with ZERO extra chain runs —
   even with the playback cache cold);
5. the dead-cached-URL re-heal (the entry 403s → invalidated → the chain
   mints a NEW URL that serves);
6. the walled class heals honestly (502 + the regen note, never a loop);
7. no video param → the old 502, zero chain runs;
8. an invalid video id is ignored (never a proxy for arbitrary regen keys);
9. non-403 upstream failures never regen (the heal is the IP-bind
   signature's, not a generic retry);
10. an invalid itag param is ignored (the nearest-360p law still heals).

Plus the two consumer src pins re-pointed at the heal pair (the hover
battery: `NATIVE00001/itag=134`; the watch fallback battery:
`FMT00000001/itag=22`).

## The live verification (dev ladder :3105)

- **The forced-dead-url heal (the killer probe)**: the exact
  production-dead URL (IP-pinned to the vercel playback lambda
  54.164.133.198) + `&video=dQw4w9WgXcQ&itag=18` → the route healed from
  the dev egress's own chain → **200 with 3.36 MB of real video bytes**
  (the fresh pick: a nearest-360p webm — the dev egress's chain serves
  adaptive-only fuel, and the muted preview needs no audio; the client
  picker's own law treats video-only as first-class preview fuel).
- **The client wiring live**: the dQw4 card hovered with both embed hosts
  route-aborted → both boots die → the native lane arms → the browser
  fetched `/api/stream?url=<itag-243 webm>&video=dQw4w9WgXcQ&itag=243`
  → **206 (Media)**, the `hover-preview-video` element mounted, the
  preview chrome (mute + seek — the playback-proof gate) rendered, no
  pill, the embed mount gone. Evidence: `evidence/wfx2p29/dev-native-lane-playing.png`.

## Gates

`bun run test` = **1932 / 0** (base 1922 + 10 new: boot 824 + watch 637 +
liveshorts 150 + cutover 108 + auth 138 + community 34 + notifications 41),
`bun run lint` 0 errors / 1 pre-existing warning, `bun run typecheck`
clean, PAT scan clean.

## Files touched

- `src/app/api/stream/route.ts` — the self-healing pass (regen + cache + the server-side picker + the test seam)
- `src/components/video/video-hover-preview.tsx` — the native src's heal pair
- `src/components/player/player-fallback.tsx` — the watch fallback src's heal pair
- `tests/playback-fallback.test.ts` — the +10 regen battery
- `tests/hover-preview.test.tsx` / `tests/player-fallback.test.tsx` — the src pins
- `evidence/wfx2p29/dev-native-lane-playing.png` — the live proof
- this packet + `docs/plans/wave-claims.md` + `WORKLOG.md`

## Honest callouts

- The walled class (0 formats everywhere) still cannot play — the regen
  answers the honest 502 there; the P28 settled floor (pill + static
  thumbnail) remains the final degrade. The label-content wall and the
  SABR/PO-token rung-3 block stand as ledgered.
- The watch-page fallback's regen prefers the requested (muxed) itag; on
  the rare egress whose chain serves adaptive-only fuel, the fallback
  pick degrades to the nearest-360p law — an honest degraded rescue over
  a dead player.
- The mid-verification browser "wedge" was the ledgered kernel-OOM class
  again (two dev servers + browser under 4 GB) — mission-watch paused for
  the browser pass per the P28 protocol, restarted after; and a separate
  tooling fault (the agent-browser eval channel mangling expressions —
  the shell-layer `[h` byte-eating diagnosed via a file-roundtrip probe)
  forced the verification onto the CLI's non-eval surface (network log +
  DOM counts), which proved sufficient.
