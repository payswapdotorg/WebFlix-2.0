# P26B-HPV3 — the walled-floor lane (the operator's 2026-10-19 re-file)

Dispatched: 2026-10-19 (afternoon), by the resident TL station **for itself** (direct
execution — the ring-down worker channel is idle since the P25 merge this morning;
the lead-merges law). Base: `e2de5c9` (origin/main — P25-PODCASTS-SHORTSAI merged).

## The operator's report (verbatim)

> the preview is not working properly
> it's showing a slideshow for some videos and working properly for others

The same symptom family as the 2026-10-18 report that spawned P26-HPV → P26-HPV2
(the hover preview's walled class). Production is current (verified: `/podcasts`
200, P24's route 405), so this is the REMAINING class, not a stale deploy.

## The diagnosis (all live-measured 2026-10-19)

1. **The production home-grid census** (51 videos): 20 carry ZERO native fuel
   (the hero Despacito `kJQP7kiw5Fk` + the entire 12-video Luis Fonsi rail +
   4 shorts + 3 compilations) — storyboards only. When the operator's browser
   also embed-walls those (oEmbed: all 51 are EMBEDDABLE; the embed wall is
   youtube.com's third-party bot wall), the hover preview falls to the
   storyboard slideshow. That is the report.
2. **The 13-client matrix** (sandbox egress): the walled class answers
   LOGIN_REQUIRED/ERROR to every client probed (WEB, IOS, ANDROID, MWEB,
   WEB_EMBEDDED_PLAYER, TVHTML5_SIMPLY_EMBEDDED_PLAYER, ANDROID_VR, TVHTML5,
   ANDROID_MUSIC, IOS_MUSIC, ANDROID_CREATOR; WEB_REMIX 404,
   MEDIA_CONNECT_FRONTEND 403). No client rung unlocks label content from a
   datacenter egress. Controls: dQw4 → IOS 22 / ANDROID 24 / ANDROID_VR 23
   plain video formats.
3. **The softeners don't flip the wall**: bpctr/has_verified/CONSENT cookie —
   no flip on the sandbox's LOGIN_REQUIRED watch pages. A client-side fetch
   rung is edge-blocked (foreign Origin → HTTP 403) and unverifiable — not wired.
4. **The code-level starvation (the fixable disease)**: the rung-1
   first-usable-wins loop stopped at ANY usable answer — including
   STORYBOARDS-ONLY — starving the IOS/ANDROID plain-format rungs on
   storyboards-only cells (the exact regression the P26-HPV2 STS note feared).

## The deliverables

1. **The formats-first hunt** (`src/lib/youtube/streams.ts`): formats-bearing
   answers win immediately; storyboards-only answers are the remembered
   fallback and never stop the hunt (rung 1's full chain → the watch-page rung
   → the broker rung). A healthy primary client still costs exactly ONE
   request (pinned).
2. **ANDROID_VR as the seventh ticket**: the real Quest 3 device shape, chained
   after ANDROID — the 2026-10-18 measurement's named-but-unwired winner
   (re-measured today: OK + 23 plain formats for dQw4).
3. **The walled-floor pill** (`src/components/video/video-hover-preview.tsx`):
   a FINAL floor (embed dead + native lane dead/unarmed + fetch settled)
   renders "Preview unavailable" (VideoOff + the honest title) in the playing
   lanes' own Preview-pill geometry — the honest degrade over the silent
   fake-play slideshow the operator read as a broken preview. Never during a
   lane's boot, never on a healthy embed, never on an armed/playing native
   lane, never on the reduced-motion design lane (all pinned).

## The honest limits

The label-content wall itself STANDS (13 clients + watch page + broker dead
from datacenter egresses; the classic decipher is gone; SABR/PO-token
attestation remains the ledgered rung-3 honest block). This lane buys COVERAGE
(the starvation fix + the seventh ticket) and HONESTY (the floor says it is a
floor) — it does not pretend to cure the wall.

## Gates

`bun run test` 1917/0 (base 1907 + 10 new in the existing suites —
playback-fallback +4, hover-preview +6, zero new test files) · lint 0 errors /
1 pre-existing warning · `tsc --noEmit` clean · PAT scan clean · live ladder
verified on the dev server (embed lane playing; native lane playing at 360p
through `/api/stream` with the embed network-blocked; the pill on a real
walled feed video; evidence in `evidence/wfx2p26b/`).
