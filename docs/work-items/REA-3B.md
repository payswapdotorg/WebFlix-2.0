# REA-3B — the parity-sweep follow-up lane (families F5–F8)

dispatched: 2026-10-18 (evening) by resident-TL (ring-down era — the station's local worker channel; base 888ec98; scope F5–F8, the REA-3 reserved families)

## THE WORK ORDER (verbatim)

You are the ring-down worker for WebFlix 2.0 lane REA-3B "parity-sweep families F5–F8" (subscriptions feed, channel pages, notifications/account menus, explore/trending). Your Task ID is 35. This is a REAL implementation task — write real code, run real commands, commit and push a real branch.

FIRST: read /home/z/my-project/worklog.md (the shared station worklog — especially the Task 34 entry at the end) to understand what previous agents did. Also note: the repo you work in is at /home/z/my-project/db/repo-mirror-wfx2 — a full clone of https://github.com/payswapdotorg/webflix-2.0 with node_modules installed, the prisma client generated, and webflix2.db pushed+seeded. Do NOT clone anything.

# CONTEXT

The platform's worker ring is captcha-walled, so this lane dispatches through the station's local worker channel (you). The station (your dispatcher) reviews your branch afterward and merges it — you NEVER touch main, NEVER merge, NEVER run `bun run build`.

THE PRODUCT: WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite). Current main @ 888ec98 already contains: the P23 wave (G1–G7), REA-1 (G16/G17/G19), REA-2 (G18/G20), P26-HPV + P26-HPV2 (the hover-preview native lane + the six-rung innertube client chain), REA-3 (F1–F4: app shell/home chips, history, WL/LL row menus, search chip order). Unit battery at base = 1833 pass / 0 fail.

THE OPERATOR'S DIRECTIVE (standing): "make sure the matched features are implemented as on youtube.com" + "figure out remaining features from youtube.com and add them". This lane = the REA-3 reserved families F5–F8: verify the audited-as-covered surfaces actually match youtube.com, fix the bounded deltas, report the structural ones honestly.

MEASUREMENT BASIS (the ring-down reality): the station's FRESH public captures (2026-10-18, un-logged-in egress — embedded below) + the REA-3 station pack carryover (logged-in, measured 2026-10-17) + your own PUBLIC-page curls (dev-time probes only, NEVER in tests). The platform wall prevents logged-in re-measurement this run; for the login-walled families (F5 feed content, F7 notifications content) the honest verdict rides the existing implementation + fixtures + the pack carryover. Record honestly in your WORKLOG entry that the measurement basis is the station pack (ring-down lane).

STATION EVIDENCE PACK — FRESH PUBLIC CAPTURES (2026-10-18, un-logged-in, curl + ytInitialData parse; the captures live at /tmp/yt-{channel,trending,explore}.html if still present — re-curl if not):

- CHANNEL PAGE (https://www.youtube.com/@mkbhd — 200, 2.8MB):
  - Tabs (twoColumnBrowseResultsRenderer.tabs, in order): Home (selected, params EghmZWF0dXJlZPIGBAoCMgA%3D), Videos (EgZ2aWRlb3PyBgQKAjoA), Shorts (EgZzaG9ydHPyBgUKA5oBAA%3D%3D), Live (EgdzdHJlYW1z8gYECgJ6AA%3D%3D), Shows (EgVzaG93c_IGBAoCYgA%3D), Playlists (EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA), Posts (EgVwb3N0c_IGBAoCSgA%3D), Store (EgVzdG9yZfIGBAoCGgA%3D). NOTE: WebFlix's channel-tabs.ts maps Home/Videos/Shorts/Live/Playlists/Posts→community/Membership — "Shows" and "Store" are UNMAPPED today.
  - Header: the NEW pageHeaderViewModel shape (header.pageHeaderRenderer.content.pageHeaderViewModel) — title "Marques Brownlee" (dynamicTextViewModel), metadata.contentMetadataViewModel.metadataRows = [["@mkbhd"], ["21.4M subscribers", "1.8K videos"]], plus banner/image/attribution/description/rendererContext; actions.flexibleActionsViewModel carries the Subscribe buttonViewModel (logged-out → modalWithTitleAndButtonRenderer "Want to subscribe to this channel? … Sign in").
  - Home tab content: sectionListRenderer with 13 sections — first shelf "Videos" (the Latest-videos shelf), then themed shelves ("🔥 MKBHD Approved 🔥", "Explained!", "Reviews!", "Dope Tech!", "First Impressions!").
- TRENDING (https://www.youtube.com/feed/trending — 200, 956KB) AND EXPLORE (https://www.youtube.com/feed/explore — 200, 957KB): BOTH serve the SAME shape from this egress — tabs[0].tabRenderer with tabIdentifier "FEwhat_to_watch" (selected, no title), header.feedTabbedHeaderRenderer.title "Home", content richGridRenderer. The classic Trending category tabs (Music/Gaming/Movies) are NOT in the served HTML from this un-logged-in egress. Honest note: the logged-in and/or other-egress shapes may differ (the REA-3-era trending read was the category family); your own public curls are the dev-time probe — record what YOU measure.
- REA-3 PACK CARRYOVER (measured logged-in youtube.com 2026-10-17 — BINDING for login-walled surfaces): guide ladder = Home, Shorts, Subscriptions, You, History, Playlists, Your videos, Watch later, Liked videos, Downloads + the subscriptions list (the account's subscribed channels) + YouTube Premium/Music/Kids + Report history; topbar right rail = Create + Notifications + Account.

# SETUP (exact — all commands run from /home/z/my-project/db/repo-mirror-wfx2)

1. cd /home/z/my-project/db/repo-mirror-wfx2
2. git checkout -b wfx2/rea3b-sweep 888ec98    # base = main @ 888ec98
3. FIRST COMMIT — the packet: save THIS work order verbatim to docs/work-items/REA-3B.md (redact the token as [REDACTED:github_token] wherever the push line mentions it — the never-commit law) with a header line: "dispatched: 2026-10-18 (evening) by resident-TL (ring-down era — the station's local worker channel; base 888ec98; scope F5–F8, the REA-3 reserved families)". Commit it: git add docs/work-items/REA-3B.md && git commit -m "docs(work-item): REA-3B parity-sweep packet — ring-down dispatch 2026-10-18 by resident-TL, base 888ec98, scope F5–F8".
4. Baseline gates BEFORE any edit (record the real numbers):
   - bun run lint → expect 0 errors / 1 pre-existing warning (tests/search-layout.test.tsx:52)
   - bun run typecheck → clean
   - bun run test → expect 1833 pass / 0 fail across the 7 groups (763+605+147+108+138+34+38). If the baseline does NOT reproduce, STOP and report the deviation instead of proceeding.
   - ENV-REPAIR NOTE (this cycle's recycle damage — check FIRST if gates fail): if lint crashes with "Cannot find module …/typescript/lib/typescript.js" → rm -rf node_modules/typescript && bun install; if tests fail with PrismaClientKnownRequestError (db.user…) → the battery scripts recreate their own test dbs (boot-test.db/watch-test.db) via prisma db push + seed — re-running bun run test fixes it; bunx prisma generate if the client is stale.
5. Dev server for your visual checks — PORT 3105 ONLY (port 3000 is the station's console; NEVER bind it, NEVER kill processes you don't own, NEVER run plain `bun run dev` — it hardcodes port 3000):
   DATABASE_URL=file:../db/webflix2.db bunx next dev -p 3105 > /tmp/wfx2-dev.log 2>&1 &
   (note the PID; poll http://localhost:3105 until it serves 200; the app makes live server-side YouTube reads — some surfaces may be slow or walled by the platform's bot check; record honestly what you actually see; SSR HTML via curl is your primary instrument, the agent-browser skill is your secondary)

# THE SWEEP — families F5–F8 ONLY

For each family: render the dev server's surface (curl the SSR HTML and/or agent-browser snapshots of localhost:3105) + curl the PUBLIC youtube.com counterpart (dev-time probes only), compare against the pack, record a verdict: MATCHES / BOUNDED DELTA (fix it this lane) / STRUCTURAL (report honestly, do not fix):

- F5 SUBSCRIPTIONS FEED (/subscriptions): the feed's card grid + the grid/list layout switcher + the infinite-scroll sentinel; the sidebar's Subscriptions section (the guide's subscriptions list — pack carryover). Key files: src/app/subscriptions/{view.tsx,layout-store.ts,page.tsx}, src/app/api/subscriptions/route.ts, src/lib/youtube/feeds.ts, src/components/app/sidebar.tsx. The feed CONTENT is login-walled — the gate screen (guest) + the honest states are the verifiable surface this run.
- F6 CHANNEL PAGES (/channel/[handle]): the tabs family (measured: youtube.com carries Shows + Store tabs that WebFlix does not map — a BOUNDED fix candidate IF the response's own tab list carries them, riding the EXISTING tab-browse seam: extend TAB_TITLE_TO_ID + the tab params map, honest availability from the response's own tab list, exactly the Membership-tab precedent); the header (verify what the DTO renders today — handle, subscriber text, video count, description snippet, verified badge — against the measured pageHeaderViewModel metadataRows); the Home tab's shelf family (first Videos shelf + themed shelves); the Subscribe button's honest logged-out state; the sort chips + search-this-channel flows (WFX2-P6-CH/WFX2-B-W — do not regress). Key files: src/app/channel/[handle]/page.tsx, src/lib/youtube/{channels.ts,channel-tabs.ts,channel-compose.ts,channel-search.ts}, src/app/api/channel/.
- F7 NOTIFICATIONS + ACCOUNT MENUS: the notifications center (the read/unread states, the channel prefs sheet, the per-item menu), the topbar bell (the unread count + the panel), the account menu (the avatar menu's family), the guide's account section vs the pack carryover. The notification CONTENT is login-walled — the honest states + the local read/prefs stores + the API contracts are the verifiable surface. Key files: src/app/notifications/{view.tsx,local-read-store.ts,channel-prefs-store.ts,channel-prefs-sheet.tsx}, src/app/api/notifications/{center,read,[id]}, src/components/app/{account-menu.tsx,notifications-bell.tsx}, src/lib/youtube/notifications.ts.
- F8 EXPLORE/TRENDING: the /trending surface (Now/Music/Gaming/Movies chips + the ranked rail + the region switcher — P23-C/WFX2-B-W) + the /explore hub (the category grid) + the category pages + the Live surface. THE MEASURED REALITY: youtube.com's /feed/trending AND /feed/explore both serve the FEwhat_to_watch "Now" feed from the un-logged-in egress — the classic category tabs are not in the served HTML. Your sweep: measure what the app's own /api/trending + /api/explore/category reads actually answer TODAY (dev-time curls of the real upstream), compare against what youtube.com serves you, and rule honestly: if the category family is gone upstream, the chips must honestly reflect whatever the real read answers (never dead controls, never fabricated categories); if the reads still answer categories, MATCHES stands. Record every measurement in the WORKLOG entry. Key files: src/app/trending/{view.tsx,region-store.ts}, src/app/explore/{view.tsx,page.tsx} + category/[key]/ + live/, src/lib/youtube/{trending-categories.ts,explore-categories.ts}, src/app/api/{trending,explore}/.

BOUNDED DELTAS you may fix this lane: label/wording mismatches, ordering differences, missing affordances that map to EXISTING seams (e.g. the Shows/Store tab mapping on the existing channel tab-browse seam; NO new API seams in this lane), layout deltas in the house component family. Each fix gets a test — ADD TO THE EXISTING SUITES where the battery already covers that surface (e.g. tests/channel-tabs.test.ts, tests/channel-page.test.tsx, tests/subscriptions-layout.test.tsx, tests/notifications-center.test.ts, tests/trending-region.test.ts, tests/explore-layout.test.tsx) rather than creating gratuitous new files.

STRUCTURAL findings: write into your WORKLOG entry as the parity-debt ledger (family, youtube.com behavior, WebFlix state, the seam that would be needed) — the REA-3 precedent.

DO NOT regress: REA-3's F1–F4 seams + test registrations, the P23 wave, REA-1/2, P26-HPV/HPV2's hover + playback seams, UX-PARITY-1. Their tests are your guard — zero regressions in the final battery.

# LAWS (binding — from docs/plans/2026-10-15-parity-audit.md + wave-claims.md)

- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint ever.
- Honest degradation only — never fabricated data, never a fake affordance, never a dead control.
- One lane = one branch (wfx2/rea3b-sweep). Never touch main. Never merge. Never run `bun run build`.
- Commit + PUSH the branch at every milestone (resilience law — if your context dies mid-run, the pushed commits survive; the two-incarnation runs of REA-3/P26-HPV2 proved this law's worth).
- The claims ledger docs/plans/wave-claims.md is LEAD-OWNED — do not edit it. Your lane record goes in WORKLOG.md (repo root): append at the END, --- separator, the house format (read the P26-HPV2-WALLED-CLASS entry near the file's end as the exact format reference; your Task ID line: "Task ID: REA-3B-SWEEP (Task 35)").
- The PAT lives at /home/z/my-project/download/recovery/github_pat.txt — read it into a shell variable ONLY at push time; NEVER echo it, NEVER commit it, NEVER paste it in any report or file. Push command: PAT=[REDACTED:github_token] && git push "https://[REDACTED:github_token]@github.com/payswapdotorg/webflix-2.0.git" wfx2/rea3b-sweep  (the remote prints "This repository moved … WebFlix-2.0" — the redirect works and the push succeeds; ignore the notice.)
- Dev-time public-page curls are your instrument — captures to /tmp or evidence/ are fine, but tests stay fixtures-only.

# VERIFICATION (all three, exact numbers recorded in your final report)

- bun run lint → expect 0 errors (the pre-existing warning may remain)
- bun run typecheck → clean
- bun run test → expect 1833 + YOUR new tests pass / 0 fail. Zero regressions.

# DELIVERABLES

1. The branch wfx2/rea3b-sweep pushed to origin (the packet commit first, then one commit per family fix, then the WORKLOG entry).
2. The WORKLOG.md lane record (Task ID: REA-3B-SWEEP (Task 35)) with: per-family verdicts (MATCHES / BOUNDED DELTA fixed / STRUCTURAL ledgered), every measurement you took (the dev-server renders + the public-page curls), the env-repair notes if any, exact final gate numbers.
3. F5–F8 explicitly covered; the structural findings as the parity-debt ledger for the next wave.
4. Honest reporting beats optimistic claims — a MATCHES verdict with real evidence is as valuable as a fix.

Budget your work: baseline gates first, then one family at a time (verify → fix → test → commit), push at every milestone.
