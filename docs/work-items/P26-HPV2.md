# Work Item P26-HPV2 — the hover-preview native lane, rung 2: unlock the walled video class

You are the ring-down worker for WebFlix 2.0 lane P26-HPV2 — the hover-preview native lane, rung 2: unlock the walled video class. Your Task ID is 33. This is a REAL implementation task — write real code, run real commands, commit and push a real branch.

FIRST (mandatory): read /home/z/my-project/worklog.md (the shared station worklog — understand what previous agents did, especially the last two entries: Task 30 the station cycle and Task 31 the REA-3 lane). The repo you work in is at /home/z/my-project/db/repo-mirror-wfx2 — a full clone of https://github.com/payswapdotorg/webflix-2.0 with node_modules ALREADY installed. Do NOT clone anything.

# CONTEXT

The platform's worker ring is captcha-walled, so this lane dispatches through the station's local worker channel (you). The station (your dispatcher) reviews your branch afterward and merges it — you NEVER touch main, NEVER merge, NEVER run `bun run build`.

THE PRODUCT: WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite). Current main @ d2b7e64 contains: the P23 wave (G1–G7), REA-1 (G16/G17/G19), REA-2 (G18/G20), P26-HPV (the hover preview native lane), REA-3 (parity sweep F1–F4). Unit battery at base = 1822 pass / 0 fail across 7 groups (763+594+147+108+138+34+38).

THE OPERATOR'S REPORT (verbatim, 2026-10-18 — the standing defect this lane continues): "the preview feature should play the video normally from within the box once you hover over it / it is not currently doing that for all videos, some videos are playing normally from within the box when hovered over, and others are just showing slideshows of pictures from the video / that is not how youtube.com does it".

P26-HPV already armed the native <video> lane (embed death → pickPreviewStreamFormat → /api/stream proxy → muted autoplay, 8s zombie guard). THE RESIDUAL the station measured on 2026-10-18 (production, webflix-2-0-one.vercel.app/api/videos/<id>/playback):
- dQw4w9WgXcQ → source=player, 22 plain-url formats → hover PLAYS ✓
- jNQXAC9IVRw → source=watch-page, 1 plain-url muxed itag18 → hover PLAYS ✓
- kJQP7kiw5Fk (the Vevo/music class) → source=watch-page, **0 streamFormats**, 2 storyboard levels → hover = STORYBOARD SLIDESHOW ✗ — the bug class that persists.

# STATION EVIDENCE PACK (measured 2026-10-18, this sandbox egress + production; re-run these probes yourself to confirm — they are your binding baseline)

1. **The innertube `player` endpoint is a PER-(video, client) LOTTERY, not a flat wall.** Measured with plain POST to https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8 (Content-Type: application/json):
   - dQw4w9WgXcQ + IOS client (clientName IOS, clientVersion 20.10.4, deviceMake Apple, deviceModel iPhone16,2, osName iPhone, osVersion 18.3.2.22D82, userAgent "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)") → status=OK with 19 PLAIN-URL formats (no ciphering at all).
   - dQw4w9WgXcQ + WEB → UNPLAYABLE. + TVHTML5_SIMPLY_EMBEDDED_PLAYER (v2.0) → ERROR.
   - kJQP7kiw5Fk + TVHTML5 / MWEB / WEB_EMBEDDED_PLAYER / ANDROID → LOGIN_REQUIRED ("Sign in to confirm you're not a bot") or ERROR.
   - jNQXAC9IVRw + IOS → LOGIN_REQUIRED.
   → Widening the client chain adds cheap lottery tickets; each rung is measurable live.

2. **The watch-page embedded response (rung 2) carries the Vevo class with OK status but signatureCipher'd formats.** dQw4w9WgXcQ's watch page from THIS sandbox: ytInitialPlayerResponse.status=OK, formats=[itag18 signatureCipher] + 26 adaptiveFormats (nearly all ciphered, several with NEITHER url NOR signatureCipher — useless entries), storyboards spec present. The production playback DTO for kJQP7kiw5Fk proves the same shape from Vercel egress (storyboards arrive, formats all filtered). parsePlayback at src/lib/youtube/streams.ts skips any format without a plain `url` — that skip is exactly the residual bug.

3. **The cipher is REAL and the classic decipher function is GONE from the current player JS.** The ciphered itag18 entry: s=<~140 char scramble>, sp=sig, url=<IP-bound googlevideo URL (bound to THIS sandbox's egress — a perfect live testbed)>. Measured: raw url → HTTP 403; url+&sig=<raw s> → 403; url+&sig=<reversed s> → 403 — a genuine decipher is required. The player JS for build 0229cd64 (watch page references it as a RELATIVE url: /s/player/0229cd64/player_ias.vflset/en_US/base.js — note assets.js was EMPTY in the embedded player response; extract the JS url from the page's script references) was fetched and searched: the classic decipher family (a function whose body starts X=X.split("") followed by reverse/splice/swap ops, or the helper object with those methods) is ABSENT from player_ias en_US, player_ias zh_HK, AND player_es6 builds (all 2.6–3.0 MB; the only .reverse() sites are generic array utilities). WHERE the decipher lives NOW is this lane's bounded research question (candidate directions listed below).

4. **The /api/stream proxy** (src/app/api/stream/route.ts) allowlists *.googlevideo.com with Range passthrough — deciphered URLs flow through it unchanged.

# SETUP (exact — all commands from /home/z/my-project/db/repo-mirror-wfx2)

1. cd /home/z/my-project/db/repo-mirror-wfx2
2. git checkout -b wfx2/p26-hpv2 d2b7e64    # base = main @ d2b7e64
3. FIRST COMMIT — the packet: save THIS work order verbatim to docs/work-items/P26-HPV2.md with the token references redacted as [REDACTED:github_token] wherever they appear. Commit: git add docs/work-items/P26-HPV2.md && git commit -m "docs(work-item): P26-HPV2 packet — ring-down dispatch 2026-10-18 by resident-TL, base d2b7e64, the walled-class unlock".
4. Baseline gates BEFORE any edit (record the real numbers): bun run lint → expect 0 errors / 1 pre-existing warning (tests/search-layout.test.tsx:52); bun run typecheck → clean; bun run test → expect 1822 pass / 0 fail across the 7 groups. If the baseline does NOT reproduce, STOP and report the deviation.
5. Dev server for visual/live checks — PORT 3105 ONLY (port 3000 is the station's console; NEVER bind it, NEVER kill processes you don't own, NEVER plain `bun run dev`): bun run db:push && bun run db:seed; DATABASE_URL=file:../db/webflix2.db bunx next dev -p 3105 > /tmp/wfx2-dev.log 2>&1 & — poll http://localhost:3105 until 200.
6. The GitHub PAT for pushing: [REDACTED:github_token]. Push with: git push https://[REDACTED:github_token]@github.com/payswapdotorg/webflix-2.0.git wfx2/p26-hpv2 — the PAT is NEVER committed, NEVER printed in logs/WORKLOG (redact as [REDACTED:github_token]).

# THE WORK — three parts, in priority order

## Part 1 (must land): widen the rung-1 client chain

src/lib/youtube/streams.ts: `playerClientChain()` currently = [configured (default WEB), IOS]. Add more client rungs (each a lottery ticket against the per-video wall), in a sensible order — suggested additions with their real context shapes:
- TVHTML5_SIMPLY_EMBEDDED_PLAYER (clientVersion "2.0", hl en, gl US, plus the thirdParty context {embedUrl: "https://www.youtube.com"} — the historical embed-player shape),
- MWEB (2.20260925.08.00),
- WEB_EMBEDDED_PLAYER (1.20260925.01.00),
- ANDROID (20.10.38, androidSdkVersion 30, osName Android, osVersion 11, userAgent "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip").
Each rung reuses the EXISTING first-usable-wins loop (a rung that answers a usable payload wins and the loop stops; walled/empty answers cost one request each, answered FAST). Keep the env override law intact (INNER_TUBE_PLAYER_CLIENT selects the primary). ALSO: consider extracting the watch page's signatureTimestamp (the `sts` value embedded in the page HTML / the player config) and passing playbackContext.contentPlaybackContext.signatureTimestamp on the player calls — a valid STS is the page's own credential shape and historically softens the wall; MEASURE whether it changes any lottery cell, and keep it only if it measurably helps (honest either way).

## Part 2 (bounded investigation — the cipher solve): find where the decipher lives NOW

Goal: turn the watch-page rung's signatureCipher'd formats into plain, LIVE-VERIFIED urls. The station measured the classic function is gone from the base.js builds — your job is the bounded hunt:
- Enumerate ALL player JS references on the watch page HTML (script srcs; the base.js you know, but also any www-player.js / player_ias module splits / separate "core" modules), fetch and search each for the decipher family under BOTH classic and modern shapes (arrow functions, `const` bindings, class methods, `String.prototype` monkeypatches; the ops family is split→[reverse|splice|swap|charAt-based mutations]→join).
- Check whether the decipher now arrives as a SEPARATE script only loaded for playback (the page's lazy chunks), or as WASM, or whether the modern page instead EXCHANGES the cipher server-side (the player's /youtubei/v1/player re-call with the page's own context+tokens returns fresh plain urls — if so, replicate THAT call's shape: the page's visitorData + STS + playbackContext; measure it).
- Whatever you find implementable: implement it server-side (Node vm or a pure-TS interpreter of the extracted ops — NO client-side execution, NO generic eval), with the extracted-function cache keyed by the player-JS url.
- **The live-verification law: a deciphered URL counts as UNLOCKED only after a server-side range probe (Range: bytes=0-1000) against the googlevideo host returns HTTP 200/206.** The URLs are IP-bound to THIS sandbox egress — probe from here, through the same transport /api/stream uses (or a direct server-side fetch in a scratch script — dev-time probes only, NEVER in tests).
- HONEST STOP CONDITION: if the mechanism turns out to require BotGuard/PO-token attestation or is not found in implementable form within this lane, STOP Part 2 there and write the honest ledger: what you hunted, what you eliminated (with evidence), and what the class needs. Part 1 must still land. NEVER surface an unverified deciphered URL into streamFormats.

## Part 3: wire the unlocks into the chain + tests

- parsePlayback stays the single reader; whatever Part 1/2 unlock flows into the existing streamFormats surface (the video-only hasAudio:false preview fuel law stays).
- Tests: FIXTURES-ONLY (the repo's law — no network in tests). Bank sanitized REAL captures as fixtures (e.g. the real watch-page player response fragment for dQw4w9WgXcQ, a real base.js fragment if you found the decipher family, real client-context payloads) and ADD tests to the EXISTING suites (tests/playback-fallback.test.ts, tests/hover-preview.test.tsx, tests/player-fallback.test.tsx — no gratuitous new files): the new client rungs' contexts, the chain order, the cipher parsing (s/sp/url), the decipher application on the fixture, the honest degrade when the decipher is unavailable, the STS pass-through if kept.
- The hover UX laws do NOT regress: the embed gate (EMBED_NO_READY_MS/EMBED_PLAYING_MS), the native gate (NATIVE_NO_PLAY_MS), the storyboard companion, ken-burns last resort, reduced-motion storyboard-only.

# LAWS (non-negotiable)

- Never touch main, never merge, never `bun run build`. Branch only, push at every milestone (the two-incarnation resilience law — your context may die; the pushed branch is your lifeline).
- Honest measurement everywhere: record what you ACTUALLY measured (commands + outcomes) in the WORKLOG entry; claims without measurements are violations.
- The PAT: never committed, never echoed (redact in the packet and WORKLOG).
- Kill only processes you own (your dev server); port 3105 only.
- No new API seams beyond the ones named; no speculative features; matched features follow youtube.com's real behavior.

# THE REPORT

When done: (1) append your entry to /home/z/my-project/worklog.md — Task ID: 33, Agent: full-stack-developer ring-down worker — P26-HPV2, the full per-part record (what was measured, what landed, the honest coverage matrix: for each of the three station probe classes — dQw4w9WgXcQ / jNQXAC9IVRw / kJQP7kiw5Fk — what the DEV-SERVER playback route now returns and why; final gates: lint/typecheck/test real numbers). (2) Final commit + push of the branch. (3) Return a completion summary: branch SHA, commits count, gates, the coverage matrix, the honest ledger for anything not solved.
