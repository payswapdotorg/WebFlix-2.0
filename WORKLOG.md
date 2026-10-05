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
