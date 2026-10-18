# REA-3 — parity-sweep (families F1–F4)

dispatched: 2026-10-18 by resident-TL (ring-down era — the station's local worker channel; base 2c036b4, re-based after the P26-HPV merge; scope F1–F4, F5–F8 reserved for the follow-up lane)

## THE WORK ORDER (verbatim, token redacted per the never-commit law)

You are the ring-down worker for WebFlix 2.0 lane REA-3 "parity-sweep" (families F1–F4). Your Task ID is 31. This is a REAL implementation task — write real code, run real commands, commit and push a real branch.

FIRST: read /home/z/my-project/worklog.md (the shared station worklog) to understand what previous agents did. Also note: the repo you work in is at /home/z/my-project/db/repo-mirror-wfx2 — a full clone of https://github.com/payswapdotorg/webflix-2.0 with node_modules ALREADY installed and the prisma client ALREADY generated. Do NOT clone anything.

# CONTEXT

The platform's worker ring is captcha-walled, so this lane dispatches through the station's local worker channel (you). The station (your dispatcher) reviews your branch afterward and merges it — you NEVER touch main, NEVER merge, NEVER run `bun run build`.

THE PRODUCT: WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite). Current main @ 2c036b4 already contains: the P23 wave (G1–G7: Clip, Stats-for-nerds, Ask-AI, sound disc, Remix honest form, trending region), REA-1 (G16 seeded Shuffle + queue panel, G17 /hashtag/[tag], G19 mix family), REA-2 (G20 live polls display, G18 honest-absence ledger), P26-HPV (hover preview native lane). Unit battery at base = 1802 pass / 0 fail.

THE OPERATOR'S DIRECTIVE (verbatim, 2026-10-17): "make sure the matched features are implemented as on youtube.com". This lane = verify the audited-as-covered surfaces actually match youtube.com's logged-in state, fix the bounded deltas, report the structural ones honestly.

MEASUREMENT BASIS (the ring-down reality): the station's logged-in youtube.com evidence pack, measured 2026-10-17, embedded below. The platform wall prevents your own logged-in re-measurement this run; the pack is your BINDING baseline. You MAY curl public youtube.com pages for supplementary reads (dev-time probes only, NEVER in tests). Record honestly in the WORKLOG entry that the measurement basis is the station pack (ring-down lane).

STATION EVIDENCE PACK (measured on logged-in youtube.com, 2026-10-17):
- HOME: chip ladder includes dynamic chips — "New to you", "Mixes", "Recently uploaded", "Live" + category chips; guide: Home, Shorts, Subscriptions, You, History, Playlists, Your videos, Watch later, Liked videos, Downloads + subscriptions list + YouTube Premium/Music/Kids + Report history.
- HISTORY: tabs All / Music / PODCASTS / Shorts / Videos; buttons: Search watch history, Clear all watch history, Pause watch history, per-row Action menu.
- WATCH LATER (playlist WL): header actions "Play all" AND "Shuffle"; per-row Action menu.
- SEARCH: filter chips/tabs All / Live / Recently uploaded / Shorts / Unwatched / Videos (+ filter panel).

# SETUP (exact — all commands run from /home/z/my-project/db/repo-mirror-wfx2)

1. cd /home/z/my-project/db/repo-mirror-wfx2
2. git checkout -b wfx2/rea3-parity-sweep 2c036b4    # base = main @ 2c036b4
3. FIRST COMMIT — the packet: save THIS work order verbatim to docs/work-items/REA-3.md (redact the token as [REDACTED:github_token] wherever the push line mentions it — the never-commit law) with a header line: "dispatched: 2026-10-18 by resident-TL (ring-down era — the station's local worker channel; base 2c036b4, re-based after the P26-HPV merge; scope F1–F4, F5–F8 reserved for the follow-up lane)". Commit it: git add docs/work-items/REA-3.md && git commit -m "docs(work-item): REA-3 parity-sweep packet — ring-down dispatch 2026-10-18 by resident-TL, base 2c036b4, scope F1–F4".
4. Baseline gates BEFORE any edit (record the real numbers):
   - bun run lint → expect 0 errors / 1 pre-existing warning (tests/search-layout.test.tsx:52)
   - bun run typecheck → clean
   - bun run test → expect 1802 pass / 0 fail across the 7 groups (755+594+147+108+126+34+38). If the baseline does NOT reproduce, STOP and report the deviation instead of proceeding.
5. Dev server for your visual checks — PORT 3105 ONLY (port 3000 is the station's console; NEVER bind it, NEVER kill processes you don't own, NEVER run plain `bun run dev` — it hardcodes port 3000):
   bun run db:push && bun run db:seed
   DATABASE_URL=file:../db/webflix2.db bunx next dev -p 3105 > /tmp/wfx2-dev.log 2>&1 &
   (note the PID; poll http://localhost:3105 until it serves 200; the app makes live server-side YouTube reads — some surfaces may be slow or walled by the platform's bot check; record honestly what you actually see; SSR HTML via curl is your primary instrument, the agent-browser skill is your secondary)

# THE SWEEP — families F1–F4 ONLY (F5–F8 are the NEXT lane's scope; say so in the report)

For each family: render the dev server's surface (curl the SSR HTML and/or agent-browser snapshots of localhost:3105), compare against the pack, record a verdict: MATCHES / BOUNDED DELTA (fix it this lane) / STRUCTURAL (report honestly, do not fix):

- F1 App shell: guide order + collapse behavior, topbar (Search, voice, Create, Notifications, Account), category chips row incl. the dynamic-chip family ("New to you", "Mixes", "Recently uploaded", "Live" + category chips). Key files: src/components/app/sidebar.tsx, topbar.tsx, voice-search.tsx, create-menu.tsx, app-shell.tsx, and the home page's chips row.
- F2 History (/history): tabs All / Music / PODCASTS / Shorts / Videos; the controls rail (Search watch history / Clear all watch history / Pause watch history); per-row Action menu; row layout with watched-progress.
- F3 Watch later + Liked + Playlists pages (/playlist/WL, /liked, /playlists): header actions "Play all" AND "Shuffle" (NOTE: REA-1's G16 already built Shuffle on playlist pages — verify it reaches the WL special list specifically), per-row Action menu, the special-list presentation.
- F4 Search (/search): filter chips/tabs All / Live / Recently uploaded / Shorts / Unwatched / Videos (+ the filter panel), recents.

BOUNDED DELTAS you may fix this lane: label/wording mismatches, ordering differences, missing affordances that map to EXISTING seams (NO new API seams in this lane), layout deltas in the house component family. Each fix gets a test — ADD TO THE EXISTING SUITES where the battery already covers that surface (e.g. tests/sidebar-store.test.ts, tests/personal-routes.test.ts, tests/search-layout.test.tsx, tests/home-api.test.ts, tests/format.test.ts) rather than creating gratuitous new files.

STRUCTURAL findings: write into your WORKLOG entry as the parity-debt ledger (family, youtube.com behavior, WebFlix state, the seam that would be needed).

DO NOT regress: UX-PARITY-1 (read its WORKLOG entry first — the seven operator reports it closed), the P23 wave seams, REA-1/REA-2 seams + test registrations, P26-HPV's hover native lane. Their tests are your guard — zero regressions in the final battery.

# LAWS (binding — from docs/plans/2026-10-15-parity-audit.md + wave-claims.md)

- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint ever.
- Honest degradation only — never fabricated data, never a fake affordance.
- One lane = one branch (wfx2/rea3-parity-sweep). Never touch main. Never merge. Never run `bun run build`.
- Commit + PUSH the branch at every milestone (resilience law — if your context dies mid-run, the pushed commits survive).
- The claims ledger docs/plans/wave-claims.md is LEAD-OWNED — do not edit it. Your lane record goes in WORKLOG.md (repo root): append at the END, --- separator, the house format (read the REA-2-PLAYER-FAMILY entry near the file's end as the exact format reference; your Task ID line: "Task ID: REA-3-PARITY-SWEEP").
- The PAT lives at /home/z/my-project/download/recovery/github_pat.txt — read it into a shell variable ONLY at push time; NEVER echo it, NEVER commit it, NEVER paste it in any report or file. Push command: PAT=$(cat /home/z/my-project/download/recovery/github_pat.txt) && git push "https://[REDACTED:github_token]@github.com/payswapdotorg/webflix-2.0.git" wfx2/rea3-parity-sweep  (the remote prints "This repository moved … WebFlix-2.0" — the redirect works and the push succeeds; ignore the notice.)

# VERIFICATION (all three, exact numbers recorded in your final report)

- bun run lint → expect 0 errors (the pre-existing warning may remain)
- bun run typecheck → clean
- bun run test → expect 1802 + YOUR new tests pass / 0 fail. Zero regressions.

# DELIVERABLES

1. The pushed branch wfx2/rea3-parity-sweep with: the packet commit, the bounded fixes (each with tests), the WORKLOG.md entry appended (house format).
2. BEFORE your final message: kill your dev server (the PID you noted at launch) so the sandbox stays clean.
3. Append your work record to /home/z/my-project/worklog.md (the SHARED station worklog — a DIFFERENT file from the repo's WORKLOG.md; append at the end, never overwrite) using exactly this template:
---
Task ID: 31
Agent: full-stack-developer (ring-down worker — REA-3 parity-sweep)
Task: <one line>

Work Log:
- <concrete steps>

Stage Summary:
- <key results>
4. Your FINAL message must start with the exact line "COMPLETION REPORT — REA-3 parity-sweep" and contain:
   - Branch wfx2/rea3-parity-sweep @ <head sha> (<n> commits on base 2c036b4); the push confirmation (the remote's final output line)
   - The per-family verdict table (F1–F4: MATCHES / FIXED / STRUCTURAL + one-line evidence each)
   - Files changed (count + list with one-line purpose each)
   - Gate table: battery pass/fail total + per-group, lint, typecheck — the REAL numbers from your final run
   - The parity-debt ledger (structural findings for the next wave)
   - F5–F8 explicitly noted as the follow-up lane's scope
   - Known limits (honest)

Budget your work: baseline gates first, then one family at a time (verify → fix → test → commit), push at every milestone. Honest reporting beats optimistic claims — a MATCHES verdict with real evidence is as valuable as a fix.
