# M1 — Playback-proof instrument + measured verdict (Worker A, WFX2-M1-A)

Work order: WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1 (§4 M1 "Playback", §5 evidence contract, §6 acceptance row "VOD playback").
Instrument: `scripts/ops/tiktok-playback-proof.py` (browser-level; distinguishes REAL VOD playback from a merely-mounted iframe).
This file covers the **playback half of M1 only**. The deploy half is separately BLOCKED (operator `VERCEL_TOKEN` re-seed) and is not recorded here.

## 1. Environment of the measurement

| Item | Value |
|---|---|
| Pinned base | `main @ 6e4d3b28d4b9f7ce518589b1524f4efb3ac11f87` ("6e4d3b2 — docs(wfx2-m0): the main-interface reliability wave's M0") — verified via `git rev-parse HEAD` before the runs |
| Working tree | clean at start (only Worker A's new files added since; concurrent Worker C edits to `tests/tiktok-live-*.test.ts` are outside this lane and untouched here) |
| Browser | Chromium 1200 (`/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`), version 143.0.7499.4, headless, via Playwright (sync API) from `/home/z/.venv/bin/python` |
| Playwright | 1.57-era venv install (no new dependencies installed; package.json untouched) |
| OS | Linux sandbox (Debian-class, x86_64) |
| Network | sandbox **datacenter egress** — the known geo-walled network class of ADR 0004 ("bot-gates its whole web domain from datacenter egress … 302s to /hk/about"); the instrument was built to MEASURE this, not assume it |
| Viewport | 1280x800 desktop (default; `PROOF_VIEWPORT`/`WALK_VIEWPORT`-style override available), device_scale_factor=2 |
| Bases exercised | production default `https://webflix-2-0-tepa.vercel.app` and dev `http://localhost:3000` (server verified answering 200 before the run; the dev server was never restarted or killed) |
| Secrets | none read, none printed; every recorded URL is stripped to `scheme://host/path` by the instrument's `strip_query` sanitize law; no cookies/tokens/signed URLs in this file |

## 2. What the instrument measures (per surface)

1. **Network truth of the TikTok player from THIS network** — every `tiktok.com`-host response the viewer browser makes is captured via `page.on("response")`; each `/player/v1/<postId>` request chain is reconstructed hop-by-hop (per-hop status, final status, final URL, content-type). The instrument never fetches TikTok itself.
2. **iframe presence + count** — `tiktok.com/player` iframes sampled ~1/s through the run, plus the exactly-one law across UI-exposed navigation (the "Next short"/"Previous short" chevrons the feed renders; the 250 ms pause-then-unmount beat allows a transient 2; settled must be 1; >2 concurrent or >1 at rest is a violation).
3. **Host-side protocol observations** — console errors, page errors, the app's honest banners (`tiktok-feed-player-error`, `tiktok-feed-player-timeout`, `tiktok-feed-autoplay-blocked`, `tiktok-feed-starting`), the app's own `/api/tiktok/player-events` telemetry POSTs, and a mirror listener on the official postMessage protocol (`x-tiktok-player` messages), trusted exactly the way the app trusts them (event.origin `https://www.tiktok.com` AND event.source = a mounted player iframe). No app file was modified.
4. **The P103-mini-6 failure law** (copied from `mobile-375-walk.py`): origin 404/5xx = FAIL; designed live-lane (`/api/tiktok/live*`) 5xx = noise; external CDN gaps = noise; origin 400/401/403 = noise; requestfailed (incl. own-navigation `ERR_ABORTED`) = recorded noise. Page errors always violate.
5. **Horizontal overflow law** — `documentElement.scrollWidth - clientWidth` must be 0.

**Verdict machine (exactly three outcomes, honest by construction; 49 offline pins in `--selftest`):**
- `PLAYING` — only with onPlayerReady + onStateChange=1 + onCurrentTime progression (order-respecting, later-sample ≥ +0.5 s), all through the trusted protocol. iframe-mounted is NOT playing.
- `GEO-WALLED` — the player request left the `/player/v1/<id>` path onto a landing page (the ADR 0004 signature) or answered blocked (≥400) from tiktok.com. Signature recorded verbatim.
- `NO-PLAYER` — no iframe / app-rendered error or readiness-timeout banner / no trusted protocol evidence within budget, with the real page reason.
Precedence: PLAYING (full evidence) > GEO-WALLED (explains absence of play) > NO-PLAYER.

## 3. Exact commands and exit codes

```text
# selftest (offline, 49 pins; the sh shim execs /home/z/.venv/bin/python)
bash scripts/ops/tiktok-playback-proof.py --selftest
  → SELFTEST PASS — 49 pins hold (wall signature, failure law, progression, verdict machine, viewport). exit 0
/home/z/.venv/bin/python scripts/ops/tiktok-playback-proof.py --selftest
  → exit 0

# usage
bash scripts/ops/tiktok-playback-proof.py --help
  → prints usage (surfaces, env). exit 0

# PRODUCTION run (default base)
bash scripts/ops/tiktok-playback-proof.py
  → PASS — all 3 surfaces reached a verdict at 1280x800; 0px overflow; failure law + exactly-one law clean. exit 0

# LOCAL DEV run (server pre-checked with curl, never restarted)
curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/    → 200
WEBFLIX_BASE_URL=http://localhost:3000 bash scripts/ops/tiktok-playback-proof.py
  → PASS — same laws clean. exit 0

# regression guard (must still pass; file not modified)
/home/z/.venv/bin/python scripts/ops/mobile-375-walk.py --selftest
  → SELFTEST PASS — the failure law holds on every pin. exit 0
```

Instrument fix history (recorded for honesty): the first production attempt failed with an instrument bug (`Request.response` treated as a property; it is a method in the Playwright Python API) — all three surfaces returned honest "instrument error" states and the run was discarded; after the one-line fix (and a navigation-selector refinement so "Previous short" targets the *enabled* — active slide's — chevron) every surface re-measured cleanly in two full production runs and one dev run with identical signatures.

## 4. Routes exercised

| # | Requested surface | Landed URL (measured) | Role |
|---|---|---|---|
| 1 | `/shorts?source=tiktok` | unchanged | the 9:16 TikTok feed player (ADR 0013 shared Shorts shell) |
| 2 | `/tiktok/v/6718335390845095173` | `/shorts?source=tiktok&post=6718335390845095173` | compat deep link (@scout2015) — server-redirects into the shared feed (ADR 0013 §7); requested post spliced active |
| 3 | `/tiktok/v/7206561191609716014` | `/shorts?source=tiktok&post=7206561191609716014` | compat deep link (@melodizeai) — same law |

All three surfaces mount the SAME player (`TikTokFeedPlayer`, `src/components/tiktok/tiktok-feed-player.tsx`); the standalone `TikTokEmbedPlayer` host component is currently mounted by no route (verified by grep) — the deep-link redirect is the app's designed single-playback-UI law. Deep-link splice proven at mount level: surface 2's initial active iframe was `/player/v1/6718335390845095173`, surface 3's was `/player/v1/7206561191609716014`.

## 5. Per-surface results — PRODUCTION (https://webflix-2-0-tepa.vercel.app)

### VERDICTS (both real posts, every surface)

```
[GEO-WALLED] shorts-feed     — the tiktok.com player request left the player path
                               -> https://www.tiktok.com/hk/about (final status 200) — the ADR 0004 wall signature
[GEO-WALLED] deep-scout2015  — same signature
[GEO-WALLED] deep-melodizeai — same signature
```

### The measured geo-wall signature (the money evidence)

Every `/player/v1/<postId>` request the viewer browser made, on every surface, both posts, redirected identically:

```
player chain: 302 https://www.tiktok.com/player/v1/6718335390845095173 -> 200 https://www.tiktok.com/hk/about  [final 200 text/html]
player chain: 302 https://www.tiktok.com/player/v1/7206561191609716014 -> 200 https://www.tiktok.com/hk/about  [final 200 text/html]
```

Same wall for the client-side oEmbed poster lane (P89 R7) and TikTok's own in-landing-page subresource calls:

```
tiktok.com response: 302 https://www.tiktok.com/oembed (text/html) sig=redirect-wall
   (console: Access to fetch at 'https://www.tiktok.com/hk/about' (redirected from
    'https://www.tiktok.com/oembed?url=…/@scout2015/video/6718335390845095173'))
tiktok.com response: 200 https://www.tiktok.com/api/v1/web-cookie-privacy/config (text/html)
   (console: @tiktok-fe/web-cookie-banner init failed — TikTok-internal code riding the walled landing)
```

The observed wall path is exactly `/hk/about` — ADR 0004's measured datacenter-egress signature, now reproduced from the **viewer-browser lane** (the lane ADR 0004 predicted would be immune; from this sandbox network it is NOT: the wall applies to the browsing client too, not only to server-side egress).

### Host-side player-protocol observations (production)

- Protocol messages received: **zero** (all = {} / trusted = {}) on every surface. No `onPlayerReady`, no `onStateChange`, no `onCurrentTime` — the iframe is showing TikTok's `/hk/about` landing page, not a player.
- The app behaved honestly, as designed (P59-R4): after the 12 s readiness budget the feed rendered the readiness-timeout banner —
  `"The TikTok player didn't load from this network. This happens when TikTok blocks your region or network, or the post is unavailable. Open on TikTok"` —
  and reported exactly once per post to the dead-post ledger:
  `POST /api/tiktok/player-events {"postId":"6718335390845095173","code":null,"type":"READINESS_TIMEOUT"}` (same for 7206561191609716014 on its surfaces). No error banner ever fired (TikTok sent no `onPlayerError` — a 200 landing page carries no protocol at all).
- Console/page errors **from the app**: none. `pageerror` count = 0 on all surfaces. All captured console errors originate inside TikTok's own walled landing page (cookie banner, `mon.tiktokv.com` CORS) or are the walled `oembed` fetch — recorded noise, never app failures.
- Failure law: **no origin 4xx/5xx of any class** on any surface (feed API, player-events API, pages all healthy).

### Exactly-one law + navigation (production, UI-exposed chevrons only)

```
nav 'Next short':     beat samples=[(0.12,1) (0.3,2) (0.6,1) (1.2,1) (2.0,1)]
                      pre=[/player/v1/6718335390845095173] -> at-rest after=[/player/v1/7206561191609716014]
nav 'Previous short': beat samples=[(0.12,1) (0.3,2) (0.6,1) (1.2,1) (2.0,1)]
                      pre=[/player/v1/7206561191609716014] -> at-rest after=[/player/v1/6718335390845095173]
```

- Max concurrent iframes during navigation: **2** (the designed 250 ms pause-then-unmount beat: new slide mounts, old unmounts a beat later) — never 3+.
- At-rest count after every transition: **exactly 1**; the previous player's iframe is gone (unmount law holds), and the Previous transition restores the original post's iframe.
- 1-second-cadence samples through each run: always exactly 1.

### Overflow law (production)

`0px (sw=1280 cw=1280)` on all three surfaces, before and after navigation.

### Feed composition note (observed, no law attached)

The feed's slide order varied between production runs (one run opened on @melodizeai's post, a later run on @scout2015's). Server-side composition owns the order (curated + shelf recency); both observed orders satisfied every law. Recorded so nobody mistakes one run's order for a contract.

## 6. Per-surface results — LOCAL DEV (http://localhost:3000)

Identical verdicts and identical signatures — as expected, because the wall is a property of THIS sandbox network's egress, not of the app origin:

```
[GEO-WALLED] shorts-feed     — 302 /player/v1/6718335390845095173 -> 200 /hk/about [text/html]
                               302 /player/v1/7206561191609716014 -> 200 /hk/about [text/html]
[GEO-WALLED] deep-scout2015  — landed /shorts?source=tiktok&post=6718335390845095173; same chains; same verdict
[GEO-WALLED] deep-melodizeai — landed /shorts?source=tiktok&post=7206561191609716014; same chains; same verdict
```

Same honest host-side behavior (READINESS_TIMEOUT telemetry POST per post, timeout banner rendered), same exactly-one beat samples (1→2→1, settled 1), 0px overflow, zero page errors, zero origin 4xx/5xx. Deep-link splice mount proven on both deep surfaces (initial iframe = requested post).

## 7. Verdict interpretation and the honest classification

- **What is PROVEN (this network):** the WebFlix feed + deep-link surfaces mount exactly one official-player iframe per active slide; the deep-link redirect + splice works; navigation/previous-player unmount works; the app's honest walled-network state machine works end-to-end (banner + one-shot telemetry); zero overflow; zero app console/page errors; the origin failure law found nothing.
- **What is MEASURED as blocked (this network):** TikTok's embed player is unreachable from this sandbox's datacenter egress — `www.tiktok.com/player/v1/<id>` 302s to the `/hk/about` landing page (final 200, text/html) for **both** real public posts, on **both** app origins. Therefore `onPlayerReady`/`onStateChange=1`/`onCurrentTime` progression could NOT be observed, and by the verdict machine's construction no surface may be called PLAYING. iframe-mounted is not playing, and this report does not claim it.
- **What is NOT proven (any network):** actual VOD playback (ready + playing state + time/frame progression), hidden-tab pause, mute re-mount behavior, autoplay-denied (3002) tap-to-play recovery, and error recovery on a live player — none of these are observable behind the wall and were NOT exercised. They remain open acceptance-matrix rows.

## 8. BLOCKER — explicit statement

**M1 playback proof BLOCKED on external network proof — operator/independent viewer run on a supported network required; no proxy/video-byte workaround permitted.**

Operator actions required (per work order §4 M1 "Playback" items 3–4 and ADR 0014 D3/D6):
1. Run `bash scripts/ops/tiktok-playback-proof.py` (unchanged instrument, `WEBFLIX_BASE_URL` as needed) from a TikTok-served viewer network (residential/consumer egress in a TikTok-supported region, a real desktop browser with standard codecs). The instrument is exactly-one-command portable; its verdict machine will produce the PLAYING / GEO-WALLED / NO-PLAYER verdict with the same evidence quality.
2. Record the result in this milestone directory (network + region + browser per the evidence contract §5).
3. Any proxying, video-byte extraction, watermark removal, TikTok authentication or paid-API lane remains **forbidden** as a workaround (work order §7; ADR 0004 §1; ADR 0014 D6).
4. Independent of playback: the deploy half of M1 stays BLOCKED on the operator re-seeding `VERCEL_TOKEN` (2026-11-08 vault loss) — deployment provenance is a separate gate and is not claimed here.

## 9. Acceptance-matrix rows touched (§6)

| Row | Status on this evidence |
|---|---|
| VOD playback | **BLOCKED on external network proof** (geo-wall measured on both real posts; instrument + verdict machine delivered and pinned; operator viewer run required) |
| Active-player lifecycle | **PASS on this network** — exactly one active TikTok iframe at rest on every surface; navigation beat never exceeded 2 concurrent; previous player unmounted on Next and restored on Previous (prod + dev) |
| Mobile/desktop (this slice) | 1280x800: 0px horizontal overflow, zero page errors, zero origin failure-law hits on all surfaces (full viewport matrix remains M5's) |

## 10. Files delivered (Worker A lane only)

- `scripts/ops/tiktok-playback-proof.py` — the instrument (new; ~700 lines; sh-shim execs `/home/z/.venv/bin/python`; `--selftest` = 49 offline pins; `--help`; env `WEBFLIX_BASE_URL` / `PROOF_TIMEOUT_S` / `PROOF_VIEWPORT`|`WALK_VIEWPORT` / `PROOF_SETTLE_MS`).
- `evidence/wfx2-tiktok-main-interface-reliability/m1/EVIDENCE.md` — this file.
- Nothing else: no `src/` changes, no package.json changes, no test changes, no git commits, no deploy, no paid network calls (the only external traffic was the viewer-browser's own tiktok.com fetches, the free viewer lane).

## 11. Raw log excerpts (sanitized — paths only, no queries, no cookies/tokens)

Production run (`bash scripts/ops/tiktok-playback-proof.py`, exit 0), surface `deep-scout2015`:

```
--- surface deep-scout2015 (/tiktok/v/6718335390845095173) ---
  landed: https://webflix-2-0-tepa.vercel.app/shorts?source=tiktok&post=6718335390845095173
  verdict: GEO-WALLED
  reason: the tiktok.com player request left the player path -> https://www.tiktok.com/hk/about (final status 200) — the ADR 0004 wall signature
  ready=False playing_state_seen=False progression=False (time samples=0, first/last=None)
  protocol msgs (all/trusted): {} / {}
  iframes at rest: ['/player/v1/6718335390845095173']
  app banners: error=None timeout="The TikTok player didn't load from this network. …Open on TikTok" starting=False autoplayBlocked=False
  overflow: 0px (sw=1280 cw=1280)
  player lane signature: redirect-wall
    player chain: 302 https://www.tiktok.com/player/v1/6718335390845095173 -> 200 https://www.tiktok.com/hk/about  [final 200 text/html] sig=redirect-wall
    player chain: 302 https://www.tiktok.com/player/v1/7206561191609716014 -> 200 https://www.tiktok.com/hk/about  [final 200 text/html] sig=redirect-wall
  app telemetry: POST /api/tiktok/player-events {"postId":"6718335390845095173","code":null,"type":"READINESS_TIMEOUT"}
  nav 'Next short':     beat samples=[(0.12,1) (0.3,2) (0.6,1) (1.2,1) (2.0,1)] pre=[/player/v1/6718335390845095173] -> at-rest=[/player/v1/7206561191609716014]
  nav 'Previous short': beat samples=[(0.12,1) (0.3,2) (0.6,1) (1.2,1) (2.0,1)] pre=[/player/v1/7206561191609716014] -> at-rest=[/player/v1/6718335390845095173]
```

Local-dev run (`WEBFLIX_BASE_URL=http://localhost:3000 bash scripts/ops/tiktok-playback-proof.py`, exit 0), surface `deep-melodizeai`:

```
  landed: http://localhost:3000/shorts?source=tiktok&post=7206561191609716014
  verdict: GEO-WALLED
  player chain: 302 https://www.tiktok.com/player/v1/7206561191609716014 -> 200 https://www.tiktok.com/hk/about  [final 200 text/html]
  app telemetry: POST /api/tiktok/player-events {"postId":"7206561191609716014","code":null,"type":"READINESS_TIMEOUT"}
  nav 'Previous short': … at-rest=[/player/v1/7206561191609716014]   (exactly-one holds)
  overflow: 0px
```

Selftest tail:

```
SELFTEST PASS — 49 pins hold (wall signature, failure law, progression, verdict machine, viewport).
```
