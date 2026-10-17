dispatched: 2026-10-17 by resident-TL (replay era), base 4601ba6

## Dispatch packet (verbatim, 2026-10-17 — the binding parameters; the
## lane PAT is redacted per the never-commit law, the P23-B precedent)

WORK ORDER — WebFlix 2.0 lane REA-2 "player-family" (dispatched 2026-10-17 by the resident TL station, replay era; authorship basis = the REA evidence sweep of logged-in youtube.com, 2026-10-17)

ROLE
You are a senior full-stack engineer on WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite + a youtube-broker mini-service for authenticated YouTube writes). You implement ONE lane end-to-end: code + tests + gates. You push your branch; the LEAD reviews, re-runs gates, and merges. You never touch main.

SETUP (exact)
1. git clone https://x-access-token:<REDACTED: the lane push PAT — never committed, per the work order law>@github.com/payswapdotorg/webflix-2.0.git webflix && cd webflix
   (the token above is a push-capable PAT granted for this lane; NEVER echo it, commit it, or paste it in reports)
2. git checkout -b wfx2/rea-player-family 4601ba6   # base = main @ 4601ba6 (post P23 re-dispatch ledger)
3. bun install
4. FIRST COMMIT — record this packet verbatim: mkdir -p docs/work-items && cp <this prompt text> docs/work-items/REA-2.md with a "dispatched: 2026-10-17 by resident-TL (replay era), base 4601ba6" header; commit it.
5. Baseline gates must reproduce BEFORE you start: bun run lint (0 errors, 1 pre-existing warning at tests/search-layout.test.tsx:52), bun run typecheck (clean), bun run test (1508 pass / 0 fail across the 7 groups).
6. Dev server (for your own visual checks): bun run db:push && bun run db:seed, then bun run dev. Tests need no dev server — they carry their own DATABASE_URL.

TASK — youtube.com remaining-feature gaps G18 + G20 (NEW rows beyond the 2026-10-15 audit matrix; found by the REA evidence sweep of logged-in youtube.com on 2026-10-17 and verified absent in this repo's codebase)

G18 END SCREENS + INFO CARDS (verified gap: no endscreen/card implementation anywhere in src/):
- Station evidence (REA a11y capture of the watch page, yt-watch.json): youtube.com's player shows interactive elements at video end (the end-screen stack: video cards, subscribe elements, links) and in-video info cards (the (i) family) — configured by the creator per video.
- WebFlix's player is the YouTube IFrame embed: the IFrame API exposes NO endscreen/card payload (no getEndscreen; cards data unavailable). Implement the parity surface HONESTLY:
  - END behavior: at video end, render the "up next" experience youtube.com's embed actually shows (the autoplay next card / the related rail's top item with countdown if autoplay is on) — this IS the embed player's real observable behavior on youtube.com; browser-measure the embed's end state this run and match it.
  - CARDS: the honest-degradation family governs — if the embed exposes nothing, DO NOT fabricate a card overlay; instead ensure the player's (i) affordances degrade cleanly (no dead buttons). Record the limitation in the WORKLOG entry (the honest-absence ledger pattern, cf. shorts-engagement-rail.tsx header).
- Any signal the IFrame API does expose (getVideoData etc.) may back a "video info" affordance IF youtube.com's embed shows one — measured, not invented.

G20 LIVE POLLS + PREDICTIONS DISPLAY (verified gap: live chat renders messages + superchat stamps, but NO poll/prediction surfaces):
- Station evidence: youtube.com's live chat renders poll items as an interactive poll card pinned/rising in the stream (vote options with percentages after vote), and predictions as an overlay event with join/status states. The live chat API items carry pollRenderer/prediction payloads.
- Implement DISPLAY of poll and prediction items in WebFlix's live chat (src/components/live/ + the live-chat seam): the poll card in youtube.com's chat layout (options, vote state if the write seam exists — voting is an authenticated write via the youtube-broker pattern; add an honest vote kind IF your browser-measurement shows the real seam is implementable, otherwise display-only), and the prediction overlay display.
- Honest-degradation law: display-only where writes are not implementable; NEVER fake vote success.

LAWS (binding, from docs/plans/2026-10-15-parity-audit.md + wave-claims.md)
- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint ever.
- Every youtube.com behavior you implement must be browser-measured by you this run (the Wave-A law) — record what you measured in the WORKLOG entry.
- Snapshot-commit after setup; commit + PUSH the branch at every milestone (resilience law).
- One lane = one branch. Claims ledger (docs/plans/wave-claims.md) is lead-owned — do not edit it; your WORKLOG.md entry documents the lane (append a section, --- separator, the house format).
- Union-merge awareness: P23-A (player overlay: stats-for-nerds) and P23-B (watch Ask panel) ride the same base and touch the player/watch surfaces — keep your changes lane-scoped: end-of-video behavior in the player host layer's end-state handling, poll/prediction in the live-chat family; do NOT drive-by refactor the share dialog, shorts, or feed surfaces.

VERIFICATION (all three, exact numbers recorded)
- bun run lint  → expect 0 errors (pre-existing warning may remain)
- bun run typecheck → clean
- bun run test → expect 1508 + YOUR new tests pass / 0 fail. Zero regressions.

FINAL REPORT — post it INLINE in this chat as your last message, starting with the exact line "COMPLETION REPORT — REA-2 player-family":
- Branch wfx2/rea-player-family @ <head sha> (<n> commits on base 4601ba6); the push confirmation
- Files changed (count + list with one-line purpose each)
- Gate table: battery pass/fail total + per-group, lint, typecheck — the REAL numbers from your final run
- G18/G20 per-item: done / partial / honest-degraded, with the youtube.com measurements you took (what you saw on the real site)
- Known limits (honest)
Then push the branch: git push https://x-access-token:<REDACTED: the lane push PAT — never committed, per the work order law>@github.com/payswapdotorg/webflix-2.0.git wfx2/rea-player-family
