# WebFlix 2.0 — YouTube Feature-Parity Audit (2026-10-15)

**Operator directive (verbatim, 2026-10-15):** "Use the existing pat, this is an
informed decision I'm making. Also focus on feature parity of the web app with
youtube.com." Standing order (unchanged): resident watch — monitor → harvest →
review → approve/require-changes → dispatch next, until the roadmap is
complete. No early returns.

**Source of truth:** this repo (payswapdotorg/webflix-2.0) — main @ `51f9a41`
(P22-B merged; 1508/1508 gates; production webflix-2-0-one.vercel.app). The
audit below is the wave-authorship basis for the parity completion program
(P23 → P25). Every lane browser-measures youtube.com during execution (the
binding law since Wave A); this document is the dispatch map, not a substitute
for live measurement.

## Method

- README feature inventory (16 interface areas) × route surface (`src/app/**`,
  `src/app/api/**`) × broker action registry
  (`mini-services/youtube-broker/executor.ts` — 29+ kinds) × the codebase's own
  honest-absence ledger (`src/components/shorts/shorts-engagement-rail.tsx`
  header) × WORKLOG.md (P6–P22) × live web check of youtube.com's 2026 feature
  news (Google I/O 2026 "Ask YouTube" conversational search; Made-on-YouTube
  2026 Shorts AI editing; Gemini Omni in Shorts).

## Verdict matrix (youtube.com ships → webflix-2.0 state)

### Covered — no gap (verified by route + broker registry)

App shell (collapsible sidebar, topbar, category chips); home feed (hero,
rails, recommended grid, infinite scroll — P22-C); shorts vertical feed +
interactions; trending (SSR + category tabs); subscriptions feed (sentinel
auto-load — P22-C); You area (guide parity — P22-B); watch page (player
controls incl. theater/miniplayer/queue, like/dislike, share **with ?t=
timestamp**, save, subscribe+bell, description+chapters+transcript, comments
full stack incl. creator heart/pin/report/edit/delete, related rail); upload
wizard (staged, XHR progress, visibility); creator studio (dashboard, content,
analytics, revenue, comments, moderation); channel pages (tabs incl. community,
join button, sort chips — P6-CH); search (filters, autocomplete, keyboard nav,
recents — P3-SG); explore categories (14); live (browse + live chat **send** —
P3-LC — + super-chat display + replay); notifications (menu, prefs,
mark-read); playlists (SSR reads + WL/LL special lists — P22-B — + create /
update / delete / reorder / remove-item via broker + local fallback); history
(reads + remove + clear-all + pause via broker); community posts (create,
like, comment — broker post-* kinds + composer UI); voice search (Web Speech
API — real); settings/help/feedback/report-history/premium/purchases/data
(P5-SS/YA); downloads page (honest no-tier — P22-B); hover previews that play
(P22-A); the playback bot-wall ladder (P22-C); honest-degradation family
(P22-B).

### Gaps — the parity debt (the P23→P25 program)

| # | youtube.com feature | webflix-2.0 today | Wave |
|---|---|---|---|
| G1 | **Clip** — create 15–60s segment clips, share `youtube.com/clip/…` links, resolve inbound clip links to the ranged player | absent everywhere (share-dialog has clipboard only) | **P23-A** |
| G2 | **Stats for nerds** — the player's technical overlay | absent | **P23-A** |
| G3 | **Ask YouTube** — conversational/natural-language search with curated results (I/O 2026) | absent | **P23-B** |
| G4 | **Watch-page Ask panel + AI summaries** — "Ask about this video", suggested prompts, summary of the video | absent (transcript + chapters already fetched — the grounding exists; no LLM seam in the app) | **P23-B** |
| G5 | **Shorts sound disc + sound pages** — the rotating disc on the rail, `/sound/…` pages listing shorts that use the sound | absent (documented honest-absence: DTOs carry no sound metadata) | **P23-C** |
| G6 | **Shorts Remix** — the remix entry (audio / video / full) incl. the 2026 AI-era entry points | absent (documented honest-absence: "no remix flow exists anywhere in src/") | **P23-C** |
| G7 | **Trending region/country** — the location switcher that re-shapes trending | absent (SSR parse locked to egress default) | **P23-C** |
| G8 | **Super Chat / Super Thanks / Super Sticker SEND** — the paid-tier interactions (display exists; sending does not) | absent (live-chat panel displays stamps; no send seam) | **P24** |
| G9 | **Membership JOIN purchase flow** — tier selection + join completion (display + join button exist) | partial | **P24** |
| G10 | **Go live flow** — the CREATE menu's "Go live" rung (currently honest-absent by design) | absent | **P24** |
| G11 | **Premiere create** — schedule a premiere in the upload visibility step | absent | **P24** |
| G12 | **"Don't recommend channel"** — feed/shorts control + undo | absent (shorts ⋯ documents it) | **P24** |
| G13 | **Podcasts dedicated surface** — podcasts browse beyond the explore category | category only | **P25** |
| G14 | **Shorts conversational editing (2026)** — AI first-draft editing | absent (depends on P23-B's LLM seam) | **P25** |
| G15 | Shorts captions/playback-speed in the ⋯ menu (embed `controls=0` limit) | honest-absent (player-bound) | defer — needs the player ladder's own rung, not a UI patch |

## Wave plan

- **P23 (dispatch 2026-10-15, 3 lanes, base = main @ the audit commit):**
  - **P23-A `wfx2/p23-clip-stats`** — Clip create/share/resolve + stats-for-nerds (G1, G2).
  - **P23-B `wfx2/p23-ask-ai`** — the AI surfaces: Ask-search + watch-page Ask panel + summaries, env-keyed LLM seam with the honest-degradation family (G3, G4).
  - **P23-C `wfx2/p23-sound-region`** — Shorts sound disc + sound pages + the Remix entry + trending region switcher (G5, G6, G7).
- **P24 (after P23 merges):** monetize-send family — Super Chat/Thanks send, membership join, go-live, premiere create, don't-recommend-channel (G8–G12).
- **P25 (after P24):** podcasts surface, shorts AI editing on the P23-B seam, remaining polish + the defer ledger review (G13–G15).

## Standing laws (unchanged, binding)

- GitHub is the single source of truth; **the lead (this station, PAT
  sanctioned by the operator 2026-10-15) gates (lint / typecheck / the test
  battery) + merges `--no-ff` + pushes main**; workers push lanes with the
  push-only PAT (never committed) or relay bundles when credential-less.
- One lane = one branch; base = main at dispatch time; claims ledger first
  (`docs/plans/wave-claims.md`, claim-before-dispatch).
- No `player` endpoint. Fixtures-only tests. Live calls only in running routes
  (rate-limited + cached through the Upstash adapter).
- YouTube is the user-data source of truth; WebFlix stores UI prefs only.
  Every action on WebFlix = the same exact effect on youtube.com (broker
  verification). Honest degradation only — never fabricated data, never a fake
  affordance.
