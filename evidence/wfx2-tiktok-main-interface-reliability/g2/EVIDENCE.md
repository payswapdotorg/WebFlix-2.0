# WFX2-G2 — Supported-Network TikTok VOD Playback Proof — EVIDENCE (TL final)

**Work order:** WFX2-G2-SUPPORTED-NETWORK-PLAYBACK-PROOF-1 (commit `c01a493a437e9062c9c6526b95505681e225d00d`, branch `architect/wfx2-g2-supported-network-playback-proof`)
**Terminal classification: BLOCKED — NETWORK** (both measured lanes; §4 of the work order). This is a valid work-order completion per §4; no playback is claimed.

## 1. Pinned identity (§2 preflight, all verified live this window)

| Item | Value | How verified |
|---|---|---|
| Pinned main SHA | `e0c8c63efb5d58214a0c89d5697cd1a1fd7ed89c` | `git rev-parse main origin/main` == merge-base == tip; `git status --porcelain` EMPTY |
| Tested production SHA | `1dda689106b6013153d68d3e81bc601f7e661848` | Vercel deployment API (below) |
| Deployment ID | `dpl_2ZbgPM5PQK6E6jCx8QS98SCsjGtE` | `GET /v13/deployments/get?url=webflix-2-0-8m3rhrp2k-tepa.vercel.app&teamId=team_1u4lGvQcgPhzGRBm0G0Qstrj` (authorized token) |
| Deployment URL | `https://webflix-2-0-8m3rhrp2k-tepa.vercel.app` | API `url` field; answered HTTP 200 on `/shorts?source=tiktok` at test time |
| Production alias mapping | project `webflix-2-0` (prj_vRMbcoEOE2KQSwKwf5rKQkhYDc6Z) under team `tepa` (team_1u4lGvQcgPhzGRBm0G0Qstrj); public alias `https://webflix-2-0-tepa.vercel.app` serves the same build | API-verified project→team→domain; the recorded deployment URL + the public alias both serve the pinned build; the personal-scope `webflix-2-0` project (prj_QY8…) and the old `webflix-2-0-one` alias were independently ruled out (different project id; `a4c1905` = P65-era, answering 402) |
| readyState / target | READY / production | deployment API |
| Query time (UTC) | 2026-11-09 ~08:1x–08:3xZ | this window |

The current docs commit's Vercel status reported `Account is blocked` (operator's note; the personal-scope project answers 402 — recorded). Per §2.3 this status was NOT treated as a reason to alter the production deployment; the tepa-team deployment above is independent of it.

## 2. Viewer network and browser (§3.2 — sanitized, coarse)

- **Network class: sandbox datacenter egress** (the same egress class the M1 wave measured; no IP recorded).
- **Region evidence, coarse only:** the wall redirect target `https://www.tiktok.com/hk/about` (the ADR 0004 signature) — recorded as the measured signature, NOT as a claim about the viewer's location.
- **Browsers:** desktop lane = headless Chromium via Playwright 1.57.0 at 1280×800; mobile lane = headless Chromium via Playwright 1.57.0 at 375×812 (EMULATION — per §3.3 it supplements and does NOT replace a real mobile device).
- **Real mobile device run: NOT EXECUTED — blocked by the same network wall** (a real device is the operator's action below; the emulation lane's GEO-WALLED verdicts transfer to it as expectation, not as a substitute result).

## 3. The two public TikTok VOD posts (§2.5)

| Post | Public post ID | Creator handle | App surface |
|---|---|---|---|
| A | `6718335390845095173` | `@scout2015` | `/tiktok/v/6718335390845095173` (compat deep link → shared feed splice) + the `/shorts?source=tiktok` feed |
| B | `7206561191609716014` | `@melodizeai` | `/tiktok/v/7206561191609716014` |

Both are real public VOD posts carried by the app's curated data (the same ids the M1 dispatch instrument ships as surfaces 2/3). The viewer network never reached the player content, so post-content claims (title/description) are NOT recorded — only the ids/handles the app itself spliced.

## 4. Measured result — desktop lane (1280×800, prod)

Command: `bash scripts/ops/tiktok-playback-proof.py` (default `WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app`). Exit 0 (all surfaces reached a verdict; GEO-WALLED is data, not an instrument failure). Full sanitized log: `desktop/RUN-LOG.md`.

Per-surface verdicts — ALL **GEO-WALLED**:
- the `/player/v1/<id>` request chain: **302 → `https://www.tiktok.com/hk/about` (final 200 text/html)** for BOTH post ids, on all three surfaces — the ADR 0004 wall signature, fresh this window;
- zero trusted protocol events anywhere (no `onPlayerReady`, no `onStateChange`, no `onCurrentTime` — the player never served);
- the app's honesty measured live: the readiness-timeout banner rendered (`"The TikTok player didn't load from this network…"`) and the telemetry POST fired exactly once per post — `{"postId":"7206561191609716014","code":null,"type":"READINESS_TIMEOUT"}` (the P59-R4 seam works end-to-end on prod);
- **the single-player law measured CORRECT under the wall**: exactly-one iframe at rest across all samples; the next/prev navigation beats sampled `(0.12,1),(0.3,2),(0.6,1),(1.2,1),(2.0,1)` — the documented transient-2-during-unmount-then-mount beat, settled at 1 in both directions (`Next short`, `Previous short`);
- overflow 0px; the failure law clean (external tiktok.com noise classified per the P103-mini-6 law).

## 5. Measured result — mobile-emulation lane (375×812, prod)

Command: `PROOF_VIEWPORT=375x812 bash scripts/ops/tiktok-playback-proof.py`. Exit 0. Verdicts: **GEO-WALLED ×3, identical signature** (`/player/v1/<id>` → 302 → `/hk/about`), honest banners, 0px overflow ×3. Record: `mobile/MOBILE-EMULATION-RUN.md`. §3.6's hidden-tab pause/resume and mute lifecycle are NOT measurable without a served player — recorded as unmeasured, not as pass.

## 6. The §3 minimum proof per post — item-by-item state

| Minimum proof item | Post A (`6718335390845095173`) | Post B (`7206561191609716014`) |
|---|---|---|
| real public post ID + exact deployed SHA | recorded (this file §3 + §1) | recorded |
| official embed iframe origin + mounted | mounted (`https://www.tiktok.com/player/v1/<id>` requested; content walled) | same |
| player-ready event | **NOT OBSERVED** (wall) | **NOT OBSERVED** |
| playing-state event | **NOT OBSERVED** | **NOT OBSERVED** |
| ≥5s advancing current-time samples | **NOT OBSERVED** | **NOT OBSERVED** |
| visible frames changing | **NOT OBSERVED** (no player content served; screenshots would capture the honest banner, not video) | **NOT OBSERVED** |
| no second active iframe / competing playback | MEASURED CLEAN (the mount law held on all beats) | MEASURED CLEAN |

No item was weakened and no alternate acceptance was invoked: the player was never served, so the standard stays unmet — BLOCKED, not FAIL-PLAYER, not PASS.

## 7. Classification (§4)

**BLOCKED — NETWORK.** TikTok does not serve the official player on the available network: every `/player/v1/<id>` request is redirected off the player path onto `/hk/about` (the §4 definition's exact case: "including a redirect to an informational/about page"). Both posts, both lanes, one signature, measured fresh 2026-11-09.

**Considered and rejected alternatives (recorded, not attempted):** an E2B-hosted run was considered as a different egress point and rejected WITHOUT spend — §3.1 requires a network "known to load TikTok's official public embed"; cloud-sandbox datacenter pools are the same egress class the wall targets, the qualification is unmet, and a speculative operator-credit spend on an unqualified network contradicts the work order's spend-protection posture. No proxies, no scraped routes, no extraction attempted (§1.1).

## 8. The exact operator action required

Run ONE command from a viewer network known to load TikTok's public embed (residential broadband or real mobile carrier; NOT a datacenter pool):

```
WEBFLIX_BASE_URL=https://webflix-2-0-tepa.vercel.app bash scripts/ops/tiktok-playback-proof.py
```

- desktop lane (default 1280×800); then `PROOF_VIEWPORT=375x812 bash scripts/ops/tiktok-playback-proof.py` for the mobile-emulation supplement;
- then §3.3–3.7 by hand on a real mobile device (the instrument's protocol evidence + two stills/screencast per post satisfy §6's frame proof);
- deliver the exit-0 log + verdict block. Expected on a supported network: PLAYING verdicts (ready + playing + currentTime progression through the origin-trusted postMessage bus) — or an honest FAIL-PLAYER/NO-PLAYER, which is equally valid data.

The instrument needs only a browser and the public production URL: no secrets, no auth, no cookies, no extraction (it observes only what the viewer browser fetches).

## 9. Sanitization statement

No cookies, authorization headers, tokens, signed URLs, account identifiers, or viewer IP addresses are recorded anywhere in this evidence tree (scanned: `bearer|authorization|set-cookie|password|ghp_|vcp_|napi_|apify_api` = 0 hits in both committed run logs). Only public URLs, statuses, and app-generated telemetry shapes are recorded.
