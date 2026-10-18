# P24-SEND — the monetize-send family (G8–G12)

dispatched: 2026-10-18 (late evening) by resident-TL (ring-down era — the station's
local worker channel; base e1e8ba5; scope G8–G12, the parity audit's P24 wave).

## THE WORK ORDER (verbatim)

You are the ring-down worker for WebFlix 2.0 lane P24-SEND (the monetize-send
family, audit gaps G8–G12). Your Task ID is 37. This is a REAL implementation
lane in a REAL repository — you write code, run real gates, and push a real
branch.

FIRST (mandatory, before anything else): read /home/z/my-project/worklog.md
(the shared station worklog — especially the LAST THREE entries: Task 33 the
P26-HPV2 verification record, Task 36 the reconciliation cycle + addendum).
Read the P26-HPV2 packet (docs/work-items/P26-HPV2.md) and REA-3B.md for the
format; docs/plans/2026-10-15-parity-audit.md for the audit rows (G8–G12);
WORKLOG.md (the repo's) for the record style; docs/plans/wave-claims.md for
the lane ledger.

CONTEXT: the platform's worker ring is unreachable (the chats API family is
edge-blocked with 405 since 2026-10-16), so this lane dispatches through the
station's local worker channel. The git mirror IS the program truth. THE
PRODUCT: WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App
Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite) reading real
youtube.com data via the innertube API. Current main @ e1e8ba5 (REA-3B
merged; baseline gates: lint 0e/1w, tsc clean, tests 1860/0 across the 7
groups 787+605+147+108+138+34+41). The operator's STANDING DIRECTIVE:
"make sure the matched features are implemented as on youtube.com" and
"figure out remaining features from youtube.com and implement them".

THE SCOPE (the audit's P24 rows):
- G8 Super Chat / Super Thanks / Super Sticker SEND — display exists; sending does not.
- G9 Membership JOIN purchase flow — tier selection + join completion.
- G10 Go live flow — the CREATE menu's "Go live" rung.
- G11 Premiere create — schedule a premiere in the upload visibility step.
- G12 "Don't recommend channel" — feed/shorts control + undo.

# THE STATION'S LAWS (every one is load-bearing)

1. **Honest measurement before implementation.** Measure youtube.com from
   this sandbox egress (plain HTTPS fetches; the repo's innertube seams show
   how — src/lib/youtube/). G12's control and the CREATE menu are partially
   measurable logged-out; the paid families (G8/G9) are login/payment-walled
   — measure the DISPLAY surfaces that are reachable, honest degradation for
   the walled writes.
2. **The invented-shape law (the REA-3 F4 precedent).** If youtube.com's real
   shape for a control cannot be measured from this egress, a GUESSED shape
   is forbidden — the honest move is "honestly absent" + a parity-debt ledger
   entry. Refusing to fabricate is a DELIVERABLE.
3. **The payment-walled honest-stop.** WebFlix has NO payment rail and must
   NEVER fabricate one. For G8/G9 the app-side truth: display parity for the
   surfaces that exist + the write seams ONLY where a real measured API seam
   exists; otherwise honest-absent with the honest reason rendered in the UI
   (the honest-degradation family — the unavailable/loginRequired split and
   HistoryUnavailableNote patterns) + the parity-debt ledger.
4. **Tests go in the EXISTING suites — zero new test files.** Every fix
   pinned as new tests inside the existing test files, fixtures-only where
   measurement is walled.
5. **Never touch main. Never merge. Never force-push.** One feature branch;
   TL2 merges it. No `bun run build` in the station project — in the REPO
   the real gates run (lint/typecheck/test).
6. **PAT discipline.** The GitHub PAT lives at
   /home/z/my-project/download/recovery/github_pat.txt — read into a shell
   variable ONLY at push time; NEVER echoed, NEVER committed, NEVER pasted
   into any file. In this packet and every record: [REDACTED:github_token].
   Before the final push: a PAT scan over the full lane diff
   (git diff origin/main...HEAD) — clean by pattern AND by value.
7. **Port discipline.** The station owns :3000. The repo's dev server runs
   on :3105 ONLY. Never bind 3000; never kill processes you don't own; never
   touch /home/z/my-project/src (the station's console) or the other mirror
   (/home/z/my-project/db/repo-mirror).

# THE STATION EVIDENCE PACK (measured 2026-10-18 late evening, this sandbox
egress — re-run the probes yourself; they are the binding baseline)

All probes: plain curl (Chrome UA) + ytInitialData parse + innertube POSTs
with the repo's own WEB client shape (clientVersion 2.20260925.08.00).

- HOME FEED logged-out: https://www.youtube.com/ → 200, 957KB, the walled
  empty shell (richGridRenderer + feedNudgeRenderer only — ZERO video
  renderers; the same flattening REA-3B measured on /feed/trending). The
  innertube browse FEwhat_to_watch (WEB and MWEB clients) answers the SAME
  empty nudge shape. → the home-feed card menus are NOT measurable logged-out
  from this egress.
- SEARCH cards logged-out (innertube search "technology review"): 17
  videoRenderers, each menu = "Add to queue" + "Share" ONLY — no
  recommendation-personalization items.
- WATCH page logged-out (dQw4w9WgXcQ → 200, 1.4MB): the related rail is the
  2026 lockupViewModel shape (20 lockups, NO menu data in the served HTML —
  the ⋯ menus lazy-load; /youtubei/v1/get_video_menu 404s at the probed
  path). The only feedbackEndpoint tokens in the page belong to promo/survey
  buttons, not recommendation controls. NO Super Thanks / Join / sponsor
  shapes anywhere in the logged-out watch page.
- SHORTS reel sequence logged-out (search seed → reel_watch_sequence with
  sequenceParams → 200, 118KB): actionBar = like / comments / share / remix
  / the sound pivot; the topbar ⋯ sheet (listViewModel) = Description / Save
  to playlist / Captions / Full screen / Audio Track / Playback speed /
  Report / Send feedback — NO "Not interested" / "Don't recommend channel"
  (the personalization family is login-scoped on youtube.com).
- /live logged-out (https://www.youtube.com/live → 200, 1.6MB): the LIVE
  BROWSE hub — 60 real live videoRenderer cards (zh-HK egress locale),
  each menu = Add to queue / Save to playlist / Download. NO go-live CTA
  anywhere logged-out (the CREATE menu itself is login-walled: the logged-out
  topbar carries only settings ⋮ + Sign in).
- @mkbhd channel page logged-out: 200, 3MB, the pageHeaderViewModel — the
  actions row carries ONLY the Subscribe button (the "Sign in to subscribe"
  modal); NO Join button in the public page from this egress (the Join
  renderer + getMembershipsPanelCommand are operator-session reads).
- CONCLUSION (the honest measurement basis): the recommendation-
  personalization menu family ("Not interested" + "Don't recommend channel"
  + undo), the CREATE menu, Super Thanks, and the membership join panel are
  all LOGIN-SCOPED on youtube.com — logged-out measurement cannot pin their
  shapes. The repo's own not-interested seam (the broker DOM drive on the
  logged-in operator tab, text-anchored with honest failures that dump the
  observed DOM) is the PRECEDENT this lane rides for G12's write. No .env in
  the mirror — the operator session is not configured here; nothing rides
  unmeasured session reads.

# SETUP (exact — all repo commands from /home/z/my-project/db/repo-mirror-wfx2)

1. cd /home/z/my-project/db/repo-mirror-wfx2
2. git fetch origin main --quiet; git rev-parse origin/main → MUST be
   e1e8ba5… (else STOP: the stale-brief replay law — re-read the new main's
   ledger entries and rebase the plan honestly).
3. git checkout -b wfx2/p24-send origin/main
4. THIS packet committed first:
   "docs(work-item): P24-SEND packet — ring-down dispatch 2026-10-18 by resident-TL, base e1e8ba5, the monetize-send family"
5. Baseline gates BEFORE any edit (record the real numbers): bun run lint →
   0 errors / 1 pre-existing warning (tests/search-layout.test.tsx:52);
   bun run typecheck → clean; bun run test → 1860 pass / 0 fail across the
   7 groups. If the baseline does NOT reproduce, STOP and report honestly.
6. Dev server (only if needed): PORT 3105 ONLY —
   DATABASE_URL=file:../db/webflix2.db bunx next dev -p 3105 > /tmp/wfx2-dev.log 2>&1 &
7. Push (PAT never echoed): PAT=$(cat /home/z/my-project/download/recovery/github_pat.txt)
   && git push "https://$PAT@github.com/payswapdotorg/webflix-2.0.git" wfx2/p24-send:refs/heads/wfx2/p24-send

# THE WORK — family by family (order G12 → G10 → G8 → G9 → G11; the reason:
G12 is the only family whose WRITE has a real seam precedent to ride — the
broker's not-interested DOM drive — so it lands first; G10 is a bounded
display fix on an existing menu seam; G8/G9/G11 are the payment/studio-walled
honest-degradation families, verified and disclosed rather than invented)

## G12 — "Don't recommend channel" + the undo family (the real write lane)

- The broker: a new kind `dont-recommend-channel` (the not-interested
  precedent's exact pattern: the operator tab on youtube.com home, find the
  video's card, kebab, click the menu item BY TEXT ANCHOR —
  /don.t recommend (this )?channel/i — verify the card removal or the undo
  toast; every failure honest with the observed DOM dumped, never an
  invented success). PLUS a shared undo kind `feedback-undo` — the drive
  clicks the VISIBLE Undo button on youtube.com's feedback toast
  (text-anchored, honest failure 'undo-toast-not-found' when the window
  closed). Registered in ACTION_KINDS + the executor routing +
  requiredUrl (youtube.com home), exactly like not-interested.
- The app-side client + routes: src/lib/broker.ts kinds;
  proxyDontRecommendChannel + proxyFeedbackUndo in action-proxy.ts;
  POST /api/dont-recommend-channel {videoId}; POST
  /api/dont-recommend-channel/undo; POST /api/not-interested/undo (the
  existing family gains its undo sibling — youtube.com's own family carries
  undo on BOTH feedback actions).
- The UI: the feed card's ⋯ menu gains "Don't recommend channel" (after Not
  interested — youtube.com's own adjacency); the shorts ⋯ menu gains it (the
  honest-absence note updates — the seam now exists); after EITHER feedback
  write the app toast carries an UNDO action (youtube.com's own family:
  "Video removed · UNDO" / "We won't recommend this channel anymore · UNDO")
  which drives the undo route; honest failure surfaces honestly ("the undo
  window on YouTube has closed"); a successful undo un-hides the card.
- Tests (existing files only): the route contracts in tests/action-routes;
  the broker client wiring in tests/broker-client; the video-card menu +
  undo in the existing card-rendering suite; the shorts rail menu in
  tests/shorts-sound-rail; create no new test files.

## G10 — the CREATE menu's "Go live" rung

- The measured truth: youtube.com's CREATE menu is login-walled from this
  egress; its "Go live" rung opens the Live Control Room (the creator's
  stream-setup surface), NOT a live-video browse page. WebFlix has no
  streaming-ingestion surface and the control room's DOM is unmeasurable
  (the invented-shape law forbids guessing a broker drive).
- The honest fix (the Join-sheet precedent generalized to a menu rung): the
  rung stays in the menu (youtube.com's own rung family), routes EXTERNALLY
  to youtube.com's own live surface (https://www.youtube.com/live — the
  measured real URL), carries the honest reason (the tooltip + the menu
  comment), and the parity-debt ledger records the full go-live flow's needs
  (measured studio DOM shapes + an ingestion surface). /explore/live stays
  reachable from the Explore hub (its honest home).
- Tests: the create-menu pins update (the external href + the honest
  form + noopener/noreferrer).

## G8 — Super Chat / Super Thanks / Super Sticker SEND (payment-walled)

- The honest-stop law: NO payment rail, EVER. Display parity exists (the
  live-chat panel maps + renders paid messages — pinned by the livechat
  suites). The send affordances (the $ entry, the purchase panel) honestly
  absent.
- The deliverable: the honest reason rendered in the UI (the
  honest-degradation family) — the signed-in live-chat composer area carries
  the paid-send disclosure (role=note): the paid interactions are displayed
  read-only; purchases happen on YouTube's checkout. The replay + guest
  states keep their existing honest forms.
- The parity-debt ledger: the Super Thanks watch-page display (needs a
  logged-in watch capture to map the DTO honestly — the logged-out watch
  page carries none of its shapes), the Super Chat/Sticker send seams
  (youtube.com's paid checkout — never in WebFlix's scope).
- Tests: the disclosure pinned in tests/livechat-send (the signed-in live
  state renders it; replay hides it; the guest gate hides it).

## G9 — Membership JOIN purchase flow (payment-walled)

- The current state (verified this run): the Join button (joinable), the
  tier sheet (real tiers through the operator session; signinRequired in
  public mode), each tier's "Join on YouTube" CTA (the real channel join
  page, bare handle, _blank + noopener), the honest checkout note, the
  Membership tab riding the same walk — ALL shipped by WFX2-P7-CH and
  ALREADY PINNED by tests/channel-page.test.tsx (the "Join on YouTube" CTA
  test, the honest-absence tests, the signin gate test).
- The verdict to record: MATCHES in the payment-walled honest form — tier
  selection + join completion happen on YouTube's checkout (the honest-stop
  law); WebFlix renders the real tiers and never fakes a purchase. No code
  change needed unless a bounded delta is found; re-verify and record.

## G11 — Premiere create (studio-walled)

- The upload wizard's Visibility step is the app's real publish drive (the
  broker's upload-execute kind — measured studio dialog shapes: the
  visibility radios by text, the publish button, the confirmation dialogs).
  youtube.com's Visibility step ALSO schedules premieres; the studio's
  scheduling controls (the date/time picker + the premiere toggle) were
  NEVER measured — the invented-shape law forbids guessing a drive, and a
  local date-picker that cannot schedule anything is a fake affordance.
- The deliverable: the honest-absent disclosure IN the Visibility step
  (role=note): youtube.com schedules premieres in this step; WebFlix's
  publish drive sets public/unlisted/private; the premiere schedule must be
  set on YouTube (the studio's own controls) after publishing. Plus the
  parity-debt ledger entry (a logged-in studio capture of the Visibility
  step's scheduling controls is the seam a future lane needs).
- Tests: the disclosure pinned in tests/upload-wizard (the Visibility step
  renders the note; the three visibility cards unchanged).

# LAWS (non-negotiable)

- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint.
- Honest degradation only — never fabricated data, never a fake affordance,
  never a dead control, never a fabricated payment.
- One lane = one branch (wfx2/p24-send). Never touch main, never merge,
  never force-push, never `bun run build`.
- Commit + push at every milestone (the two-incarnation resilience law).
- The claims ledger docs/plans/wave-claims.md is LEAD-OWNED — do not edit.
- The lane record goes in WORKLOG.md (repo root), appended at the END, the
  house format (the P26-HPV2/REA-3B entries are the reference).
- The PAT: [REDACTED:github_token] everywhere in records; the pre-push PAT
  scan over the full lane diff (pattern + value).

# VERIFICATION (exact numbers in the final report)

- bun run lint → 0 errors (the ONE pre-existing warning only)
- bun run typecheck → clean
- bun run test → 1860 + N new / 0 fail, zero regressions
