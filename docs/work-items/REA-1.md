# REA-1 — feed-family (G16 playlist shuffle · G17 hashtag pages · G19 mixes/radios)

dispatched: 2026-10-17 by resident-TL (replay era), base 4601ba6

> The packet below is the dispatch text recorded verbatim EXCEPT the push PAT,
> which is redacted per the standing law (never echoed, committed, or pasted).

---

WORK ORDER — WebFlix 2.0 lane REA-1 "feed-family" (dispatched 2026-10-17 by the resident TL station, replay era; authorship basis = the REA evidence sweep of logged-in youtube.com, 2026-10-17)

ROLE
You are a senior full-stack engineer on WebFlix 2.0 — a YouTube feature-parity web app (Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Prisma/SQLite + a youtube-broker mini-service for authenticated YouTube writes). You implement ONE lane end-to-end: code + tests + gates. You push your branch; the LEAD reviews, re-runs gates, and merges. You never touch main.

SETUP (exact)
1. git clone https://x-access-token:[REDACTED — push-capable PAT, never committed]@github.com/payswapdotorg/webflix-2.0.git webflix && cd webflix
   (the token above is a push-capable PAT granted for this lane; NEVER echo it, commit it, or paste it in reports)
2. git checkout -b wfx2/rea-feed-family 4601ba6   # base = main @ 4601ba6 (post P23 re-dispatch ledger)
3. bun install
4. FIRST COMMIT — record this packet verbatim: mkdir -p docs/work-items && cp <this prompt text> docs/work-items/REA-1.md with a "dispatched: 2026-10-17 by resident-TL (replay era), base 4601ba6" header; commit it.
5. Baseline gates must reproduce BEFORE you start: bun run lint (0 errors, 1 pre-existing warning at tests/search-layout.test.tsx:52), bun run typecheck (clean), bun run test (1508 pass / 0 fail across the 7 groups).
6. Dev server (for your own visual checks): bun run db:push && bun run db:seed, then bun run dev. Tests need no dev server — they carry their own DATABASE_URL.

TASK — youtube.com remaining-feature gaps G16 + G17 + G19 (NEW rows beyond the 2026-10-15 audit matrix; these were found by a REA evidence sweep of the logged-in youtube.com on 2026-10-17 and verified absent in this repo's codebase — see "Station evidence" per item)

G16 PLAYLIST SHUFFLE (verified gap: src/app/playlist/[id]/page.tsx has Play all but NO shuffle):
- Station evidence (REA a11y capture, yt-watchlater.json, logged-in): youtube.com's /playlist?list=WL (and every playlist page) carries BOTH "Play all" AND a "Shuffle" action in the header action row — shuffle starts playback of the list in randomized order (the player's queue follows the shuffled sequence).
- Implement the Shuffle affordance on WebFlix's playlist page(s) — including the special lists WL/LL — matching youtube.com's placement and icon; the playback route builds a shuffled queue (deterministic seed per click; no live YouTube write — this is local playback-order logic over the already-fetched list).
- Browser-measure youtube.com's real behavior this run (the button placement, what the URL/queue does on click — e.g. /playlist?list=WL&shuffle=... style cues) and record it in your WORKLOG entry.

G17 HASHTAG PAGES (verified gap: description hashtags currently link to /search?q=%23tag — youtube.com has a DEDICATED /hashtag/<tag> browse surface):
- Station evidence (REA captures): logged-in youtube.com renders hashtag links (#S, #ULTIMAMA, #ishowspeed, #腦動力LevelUp) on watch descriptions and shorts titles that resolve to /hashtag/<tag> pages — a dedicated browse surface: a header with the #tag, a grid of videos using the hashtag.
- Implement the /hashtag/[tag] route in WebFlix's house style (the browse/grid family): header + video grid + infinite scroll, reading via the InnerTube client family (src/lib/youtube/innertube.ts sends SAPISIDHASH Authorization — a hashtag browse is a read; measure the real endpoint shape from youtube.com this run and map it honestly).
- Route the existing description-box hashtags (src/components/watch/description-box.tsx parseHashtags output) and shorts hashtag tokens to the new route.
- Honest-degradation law: if the read seam cannot be reproduced from your measurement, the page still renders with the honest status-note family (house wording patterns, WORKLOG P22-B) — NEVER fake data.

G19 MIXES / RADIO AUTOPLAYLISTS (verified gap: no Mix/Radio/RDAMVM handling anywhere in src/):
- Station evidence (REA captures): logged-in youtube.com's home and trending chip rows include a "Mixes" chip; search results and related rails render "Mix – <video>" autoplaylist cards (the RDAMVM/RDMM-class lists, infinite, with the radio-style shuffle icon).
- Implement honest Mix support where youtube.com shows it: (a) search results render mix cards when the upstream returns playlistRenderer/lockupViewModel mix entries; (b) the playlist route handles a mix list id with youtube.com's presentation (the shuffled-by-default order, the infinite autoload); (c) if a "start radio" action exists on youtube.com's surfaces you measure, mirror it as an affordance that opens the mix.
- Honest-degradation law governs whatever cannot be reproduced from real measurement.

LAWS (binding, from docs/plans/2026-10-15-parity-audit.md + wave-claims.md)
- Fixtures-only tests. No live YouTube calls in tests. No /player endpoint ever.
- Every youtube.com behavior you implement must be browser-measured by you this run (the Wave-A law) — record what you measured in the WORKLOG entry.
- Snapshot-commit after setup; commit + PUSH the branch at every milestone (resilience law).
- One lane = one branch. Claims ledger (docs/plans/wave-claims.md) is lead-owned — do not edit it; your WORKLOG.md entry documents the lane (append a section, --- separator, the house format).
- Union-merge awareness: P23-A/B/C (stalled, may re-spawn) and REA-2/REA-3 ride the same base — keep changes lane-scoped to the feed/playlist/hashtag/search families; do NOT drive-by refactor the watch page, shorts, or player surfaces.

VERIFICATION (all three, exact numbers recorded)
- bun run lint  → expect 0 errors (pre-existing warning may remain)
- bun run typecheck → clean
- bun run test → expect 1508 + YOUR new tests pass / 0 fail. Zero regressions.

FINAL REPORT — post it INLINE in this chat as your last message, starting with the exact line "COMPLETION REPORT — REA-1 feed-family":
- Branch wfx2/rea-feed-family @ <head sha> (<n> commits on base 4601ba6); the push confirmation
- Files changed (count + list with one-line purpose each)
- Gate table: battery pass/fail total + per-group, lint, typecheck — the REAL numbers from your final run
- G16/G17/G19 per-item: done / partial / honest-degraded, with the youtube.com measurements you took (what you saw on the real site)
- Known limits (honest)
Then push the branch: git push https://x-access-token:[REDACTED — push-capable PAT, never committed]@github.com/payswapdotorg/webflix-2.0.git wfx2/rea-feed-family
