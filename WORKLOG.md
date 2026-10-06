# WFX2 P7-CH worklog — the channel Membership tab + Join-sheet completion

Branch: `wfx2/p7-channel-membership` (base `5e9481a`)
Lane: ONE lane only — `wfx2/p7-channel-membership`. Nothing outside the
channel page's membership surface.

## Baseline (recorded before any edit)

`env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u UPSTASH_REDIS_REST_TOKEN_2 bun run test`

- test:boot 383 pass / 0 fail
- test:watch 388 pass / 0 fail
- test:liveshorts 110 pass / 0 fail
- test:cutover 103 pass / 0 fail
- test:auth 98 pass / 0 fail
- test:community 34 pass / 0 fail
- test:notifications 18 pass / 0 fail
- **TOTAL: 1134 pass / 0 fail**

## Survey notes (the shapes that matter)

- `src/app/channel/[handle]/page.tsx` — the tab system: `ALL_TABS` (fixed
  display order) filtered by `availableTabs` (from `data.tabs`, the channel's
  own tab list via `channelTabsFromResponse`); `SEEDED_TABS = home/videos/
  shorts` seed from the page payload, every other tab lazy-loads
  `/api/channel/[handle]/tab?tab=<id>`; the Join sheet at ~line 521; the
  sheet's tiers block ends with a fake in-app "Join" button → `/account`
  (to be replaced by the per-tier Join-on-YouTube CTA per deliverable B).
- `src/lib/youtube/channel-tabs.ts` — `getChannelJoin` (~line 474) is the
  ONE memberships-panel walk: resolveChannel → channelJoinable → signin
  check → findFirst(getMembershipsPanelCommand) → innertubeBrowse(cmd.params)
  → mapMembershipTiers. Cached at `yt:channel:join:<handle>`. Two
  TAB_TITLE_TO_ID maps exist: mappers.ts (feeds `channelTabsFromResponse`
  → `data.tabs`) and channel-tabs.ts (feeds `tabParamFromResponse`).
- `src/lib/youtube/mappers.ts` — `channelJoinable` + `channelTabsFromResponse`
  (+ its TAB_TITLE_TO_ID).
- `src/lib/types.ts` — `ChannelTabId` (no "membership" yet), `ChannelTabDTO`
  (no membership field yet). `ChannelJoinDTO` actually lives in
  channel-tabs.ts (the task brief said types.ts — it needs to move there so
  `ChannelTabDTO` can carry it).
- Tab route `src/app/api/channel/[handle]/tab/route.ts` — `TAB_IDS` allowlist
  + the per-tab switch (`community` branches to `getCommunityTab` — the
  natural place for the membership branch).
- Tests: `tests/channel-tabs.test.ts` (fixture-upstream + setUpstream seam,
  route-level asserts on `upstream.recorded`), `tests/channel-page.test.tsx`
  (happy-dom + createRoot/act + fetch stub; radix portals queried via
  `win.document` — see comment-composer tests).

## Design decisions (made up front, documented in code)

1. **The shared helper**: `getChannelJoin` IS the single memberships-panel
   walk. The Membership tab consumes it through a thin shaper
   (`getChannelMembershipTab`) that returns a `ChannelTabDTO` carrying
   `membership: ChannelJoinDTO`. Both `/join` and `?tab=membership` hit the
   same cached walk — zero copy-paste divergence.
2. **The tab route branch**: the per-tab switch gains `tab === "membership"`
   (the code's natural shape, like community's branch) — NOT an extended
   /join response.
3. **ChannelJoinDTO moves to types.ts** (re-exported from channel-tabs.ts
   for compat) so `ChannelTabDTO.membership` can reference it — the tier row
   becomes `ChannelMembershipTierDTO` (one canonical shape; the page's local
   `JoinInfo` duplicate is deleted).
4. **The walled membership tab**: when the join walk degrades to its
   "channel unavailable" shape (joinable false + that note — the join
   surface's own wall marker), the tab DTO carries the standard
   `{tab, walled: true}` so the panel renders the app's byte-identical
   walled-tab copy.
5. **ALL_TABS placement**: "membership" sits between "community" and
   "about" (youtube.com's placement), gated on the channel's own tab list
   carrying it AND `joinable === true`.
6. **The sheet's fake in-app "Join" button (→ /account) is REMOVED** — the
   per-tier "Join on YouTube" CTAs are the completion; the honest explainer
   states WebFlix never processes or fakes a payment, and the old button
   faked exactly that. The signinRequired/unreadable honest states stay
   byte-identical.

## Progress

- [x] Baseline recorded (1134/0: boot 383, watch 388, liveshorts 110, cutover 103, auth 98, community 34, notifications 18)
- [x] Survey
- [x] types.ts — `ChannelTabId` + `"membership"`; `ChannelMembershipTierDTO` + `ChannelJoinDTO`
      (moved from channel-tabs.ts, re-exported there); `ChannelTabDTO.membership?: ChannelJoinDTO`
- [x] mappers.ts — `TAB_TITLE_TO_ID` + `Membership: "membership"` (the tab list's source of
      truth; the ONLY mapper touched — the membership path's tab mapping)
- [x] channel-tabs.ts — `getChannelJoin` documented as THE shared walk (its "channel
      unavailable" degrades now ride the `JOIN_CHANNEL_UNAVAILABLE_NOTE` constant);
      `getChannelMembershipTab` (the thin shaper both consume → no divergence);
      `CHANNEL_TAB_PARAMS` excludes membership (no browse param); the channel-tabs
      `TAB_TITLE_TO_ID` gains the Membership mapping (lockstep)
- [x] tab route — `TAB_IDS` + membership; the per-tab switch branches membership to
      `getChannelMembershipTab` (choice documented in the route comment)
- [x] page.tsx — local `JoinInfo` duplicate deleted (the canonical `ChannelJoinDTO` serves);
      ALL_TABS + membership (between community and about); the availableTabs gate
      (own list carries it AND joinable); `MembershipTabPanel` (Join-this-channel header,
      tier cards with perk rows split on newlines/commas, the honest states); the Join
      sheet's per-tier "Join on YouTube" CTA (bare-handle href, _blank, noopener
      noreferrer, ExternalLink icon) + the one-line honest explainer; the fake in-app
      Join button (→ /account) removed
- [x] tests — 17 added (9 channel-tabs + 8 channel-page), all in the two existing files
      (both already in the test:boot script — the package.json test-list union is UNTOUCHED)
- [x] typecheck clean + lint clean + FULL suite: **1151 pass / 0 fail**
      (baseline 1134 + 17 added, 0 fail; boot 383→400, every other script byte-identical)
- [x] commit + push

## Verified honest-state matrix

| State | Surface | Behavior |
|---|---|---|
| joinable + tiers (session) | tab + sheet | real tier cards from the memberships panel (title/price/perks); per-tier CTA in the sheet |
| joinable + signin (public) | tab + sheet | "Sign in to become a member." + the sign-in affordance (byte-identical sheet state kept) |
| joinable + unreadable (session, no panel) | tab + sheet | "Membership tiers are not readable from this session right now." |
| not-joinable | sheet + tab route | "This channel doesn't offer memberships." / membership.joinable false honestly; the TAB itself never renders |
| walled / channel unavailable | page + tab | the standard `{tab, walled: true}` → the byte-identical tab-family degrade copy (existing page-level walled tests untouched and passing) |

## Known honest limits (reported, not hidden)

- The memberships-panel wire form is unverifiable from this sandbox (no YT_COOKIES);
  the tier mapping is exercised against shape-real synthetic panel bytes through the
  real route chain — same posture as the WFX2-B-S honest gap note.
- The CTA href follows the bare-handle law verbatim (`youtube.com/<bare-handle>/join`);
  for the rare UC…-id fallback handle the URL carries the id as-is (the letter of the
  spec — no invented @handle).

## P10-OPS — broker route restoration + re-arm automation (2026-10-05)

**Lane goal:** restore production Tier-2 writes (tunnel down, 0 connectors, no DNS record) and make the broker chain self-healing; reconcile ops docs with the real route.

**What happened:** production `BROKER_URL` pointed at the named tunnel `webflix-broker.flauz.app`, which had no DNS record and no connector — all broker-backed actions were dead. The provisioned CF API token is read-only for tunnels (cannot fetch the connector token), so the named tunnel could not be armed from the sandbox. Bridge: a cloudflared **quick tunnel** now fronts the broker (public healthz ok; DOM-verified write through the public route). A 120s watchdog re-arms the whole chain (Xvfb → Chrome CDP → login → broker → tunnel) and auto-republishes the URL on rotation (env PATCH + 3-way deploy-trigger chain: v13 API gitSource POST → deploy hook → empty-commit push). Gates at this commit: lint/typecheck green, **1237/1237 tests pass**.

**Honest-state matrix:**
- LIVE: production deployment with quick-tunnel `BROKER_URL` (Tier-2 writes restored); fresh `YT_COOKIES` land on the next deployment.
- QUEUED/LIMITED: Vercel deploy API quota exhausted until ~2026-10-06 11:50 UTC (hook jobs still build).
- NEEDS OPERATOR: (1) CF API token with Tunnel:Edit + DNS:Edit to restore the named tunnel; (2) Vercel↔GitHub reconnect (repo has no webhooks — push deploys dead).
- SANDBOX-LOCAL ONLY (never commit): `youtube_login.py`, `harvest_cookies.py` (account material).

## P11-DOCS — post-roadmap hardening retro-documentation (2026-10-05)

**Lane goal:** close the documentation gap for the post-roadmap hardening lanes
P6–P10-OPS — executed as commit-history lanes after the 2026-10-02 roadmap
close, never documented in docs/plans/ (only fragments in WORKLOG.md and
docs/ops/).

**What was done:** read docs/plans/wave-claims.md, WORKLOG.md,
docs/ops/vercel-env.md (the 2026-10-05 section), scripts/rearm/README.md,
README.md; mined `git log --oneline -100` for the P6/P7/P8/P9/P10 lane commits
(subjects, bodies, per-commit stats); wrote
docs/plans/2026-10-05-post-roadmap-hardening.md — one section per lane (scope,
key commits, acceptance evidence recorded in history, production impact) ending
with a sources list; appended the settle section to docs/plans/wave-claims.md;
this entry. Zero code changes.

**Baseline (recorded before any edit, at base `225eba0`):** lint 0 errors /
typecheck 0 errors / test 1237 pass / 0 fail (boot 413, watch 447, liveshorts
110, cutover 108, auth 107, community 34, notifications 18) — matches the
1237/1237 recorded at the P10-OPS commit.

**Gates after the edits (verification):** identical — lint 0 / typecheck 0 /
test 1237 pass / 0 fail.

**Files touched:** docs/plans/2026-10-05-post-roadmap-hardening.md (new),
docs/plans/wave-claims.md (the settle section), WORKLOG.md (this entry).

# WFX2 P12-UX worklog — youtube-parity home feed, hover mini-player previews, watch autoplay

Branch: `work/P12-UX` (base `7dc1af3`)

## Baseline (recorded before any edit; foreground per group with
`env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u UPSTASH_REDIS_REST_TOKEN_2`)

- test:boot 413 pass / 0 fail
- test:watch 447 pass / 0 fail
- test:liveshorts 110 pass / 0 fail
- test:cutover 108 pass / 0 fail
- test:auth 107 pass / 0 fail
- test:community 34 pass / 0 fail
- test:notifications 18 pass / 0 fail
- **TOTAL: 1237 pass / 0 fail** (+ lint 0, typecheck 0)

## YouTube.com measurements (2026-10-06, live DOM via headless browser + served CSS)

- rich-grid item min-width **326.8-331.6px** (live grid inline style; html default
  `--ytd-rich-grid-items-per-row: 4`), item margin **16px**, row margin **36px**,
  shelf margin 48px; grid computed 3-up at 1440px viewport (guide open).
- skeleton CSS cross-check: cards flex 310-500px, avatar 36px, content padding
  16px, guide 240px/72px collapsed — WebFlix already matched the last three.
- shorts lockup (channel Shorts grid, live): **208x389px, 4px gaps, 9:16**.
- logged-out home/search feeds are bot-walled (empty shell) — the channel page
  and stylesheet extraction carried the measurements.

## Design decisions

1. **Home layout**: hero + TrendingSideList deleted; feed = chips -> grid (no
   heading, youtube.com has none) -> continue-watching -> because-you-watched
   -> shorts shelf -> demoted full "Trending now" rail -> infinite-scroll
   sentinel. The sentinel moved to the TRUE END of the feed (lifted into
   `useRecommendedInfiniteScroll` + presentational `RecommendedGrid`): with the
   grid first, a mid-feed sentinel would Zeno-push the rails away on every
   append. `data.hero` stays in the DTO (API untouched); the empty-state check
   dropped its hero term.
2. **Card sizing**: grid `gap-x-4 gap-y-9` (16/36px measured), cols 1/2/3/4
   (sm/lg/2xl — 2xl = 1296px content ~= youtube's 4-up zone); rail cards
   `w-[320px] sm:w-[360px]` (full-size, replacing w-[240px]); kebab button
   44px on touch (h-11) / 32px on desktop pointers.
3. **Shorts**: `w-[208px]` (measured), gap-4, 9:16 + hover scale kept, /shorts
   links kept, `data-no-preview` opt-out (youtube.com shows NO hover video
   preview on shorts tiles — verified; ours now matches).
4. **Hover preview (the operator's core ask)**: embed-first mini player. The
   shared store snapshot gains `mode`; the hook computes it per dwell —
   coarse pointer -> NO preview; reduced-motion -> storyboard-only; else
   embed. The embed is created inside the ONE shared layer (probe-style
   imperative host; the React-owned mount stays stable) with
   autoplay+mute+controls:0; EMBED_HEALTH_MS=1500 deadline (PLAYING/BUFFERING
   proof, onError -> give up) then destroy + the WFX2-P6-HP storyboard lane
   takes over (kept intact as the fallback). Single-instance law: hide and
   retarget destroy first. Muted pill (bottom-left) in the embed phase. Zero
   layout shift: the layer is the card's own thumbnail rect (unchanged
   geometry law).
5. **Watch autoplay**: `autoplay: 1` in playerVars (sound attempt); 1.5s
   UNSTARTED check (armed at creation/ready/loadVideoById, cleared on
   PLAYING) -> `mute()+playVideo()` + "Tap to unmute" overlay (44px); the
   native fallback keeps its `autoplay` attribute + gains the same
   paused-at-1.5s muted-retry + affordance. Player-host wrapper law,
   miniplayer, and the probe -> PlayerFallback chain untouched.
6. **Reduced motion**: storyboard-only previews; `.wfx-kenburns` disabled via
   `@media (prefers-reduced-motion: reduce)`. `.hero-scrim` removed with its
   only consumer.

## Test contract updates (legitimate behavior changes, none deleted)

- `tests/hover-preview.test.tsx`: storyboard-lane tests kept verbatim (they
  pin geometry, dwell, frames, degrade, scroll-hide); "no iframes ever"
  re-scoped to the storyboard lane; NEW embed-lane describe (creation vars,
  PLAYING -> embed phase + muted pill, walled -> destroyed + fallback at the
  deadline, hide/retarget single-instance, coarse-pointer skip,
  reduced-motion storyboard-only). Stub stores options + tracks destroyed.
- `tests/youtube-player.test.tsx`: mount test asserts `autoplay: 1`; NEW
  autoplay-policy describe (blocked -> mute+play+affordance+tap-unmute;
  success -> no fallback). Mock gains a state override + call counters + an
  afterEach state reset.

---

## P15-SHORTS — youtube-parity shorts rail (dislike, more menu, sound disc, remix)

**Agent:** P15-SHORTS frontend-parity lane
**Base:** 3ae85a14f12b131eb5c4b96282b0fc6436cb1470

### What shipped (src/components/shorts/ only)

1. **Dislike + live Like** (`shorts-engagement-rail.tsx`): wired to the watch
   page's seam — `POST /api/videos/{id}/like {value, baseline}` via `post()`
   from `@/lib/watch/client`, the ActionRow idiom verbatim (optimistic
   set/swap/unset, `aria-pressed` + `fill-current text-[#f03]` filled icon,
   honest revert on failure, guest gate → `signInHref("/shorts")`,
   broker-offline → `toastActionError`). Session-local pressed state keyed per
   short id (one rail instance per slide), starting unpressed — there is no
   per-user rating READ for shorts. Like label keeps the real `likesText`
   (optimistic ±1 only when parseable; the response's DOM-observed count
   wins; unparseable labels never fabricate a number). Dislike shows NO count
   (youtube.com never shows one).
2. **More (⋯) menu**: the app's DropdownMenu with REAL actions only — Report
   (the watch `report-dialog`, read-only reuse, gated), Save to Watch later
   (`POST /api/playlists/watch-later` toggle, BookmarkPlus↔BookmarkCheck
   pressed state), Copy link (the existing share handler), Not interested
   (`POST /api/videos/{id}/not-interested`). Omitted honestly: Captions,
   Playback speed, Don't recommend channel, Quality (no seams; embed is
   controls=0).
3. **Honest absence**: Remix (no seam — only `WEB_REMIX` InnerTube client name
   in streams.ts; /upload is not a remix flow) and the sound disc (shorts
   DTOs carry no sound metadata; no sound page route) — omitted, never faked.
4. **Measured geometry** (youtube.com 2026-10-06, desktop 1280×900 + mobile
   412×915, signed-out): 48×48 buttons (was 44), 24px icons (was 20),
   rgba(0,0,0,0.3) tonal bg (was /50), 8px unit gap + 70px units = 78px pitch
   (was gap-4), 12px right inset (was 8px, `right-3`), labels 12px/400/18px
   with reserved slots (skeleton while meta hydrates — no layout shift),
   `bottom-16` kept (64px = measured last-rail-element bottom with the disc
   honestly absent). Channel chip REMOVED from the rail (youtube.com has no
   rail chip — channel info lives bottom-left, which the feed already has).
5. **Feed wiring** (`shorts-feed.tsx`): one `useWebFlixSession` probe for the
   whole feed (per-instance fetches avoided), `reportFor` state + one
   conditionally-mounted `ReportDialog`, keyboard guard extended
   (`reportFor` + `event.defaultPrevented` so an open ⋯ menu owns arrows).

### Files touched (all in scope)

- `src/components/shorts/shorts-engagement-rail.tsx` (rewritten)
- `src/components/shorts/shorts-feed.tsx` (wiring only; player/sheet/chevrons
  untouched)

Shared files: READ-ONLY imports only (`action-row` idiom, `report-dialog`,
`post`, `toastActionError`, `signInHref`, `useWebFlixSession`,
`LikeValue`/`LikeResultDto` types). No API/DTO/watch/video/search/home edits.

### Verified in-browser (agent-browser, dev :3001)

Rail 48×48/78px pitch on desktop+mobile; labels 997/33/Share with sr-only;
⋯ menu opens upward, 4 items @44px; Copy link → "Link copied"; guest Like →
`/signin?redirect=%2Fshorts`; authenticated Like/WL/NI with broker offline →
the honest disconnected toast + state reverts; Report → dialog → the route's
own honest 404 for live videoIds (identical to the watch page's behavior for
live videos — read-only reuse, no API edits); comments sheet (20 comments),
chevrons, ArrowDown feed scroll, menu-open arrow ownership all intact.
No hydration/runtime errors from the shorts surface.

### Gates

lint 0 errors (1 pre-existing warning in tests/search-layout.test.tsx,
outside scope) · typecheck clean · test 1255/0 (baseline 1255/0, no test
changes needed — shorts tests cover API/mappers only, untouched).
