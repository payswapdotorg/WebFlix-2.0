# P94 — TikTok as WebFlix's main interface: the gap report and closure plan

Date: 2026-11-04 · Operator mandate: *"create a user channel for the tiktok videos as well but make
them look like the already created youtube ones, only you populate them with the corresponding info
from the corresponding tiktok channels; just like users can connect their youtube channels to enable
actions, they should be able to connect their tiktok channels to enable actions as well; research the
gaps that currently prevent webflix from being the main tiktok interface (use the webflix and tiktok
interfaces as a user with browser agent to discover gaps), generate a coherent plan to close them all
in a report; then follow the suggestions from the report to close them all."*

---

## 1. Method

Three research passes, all read-only:

| Pass | Instrument | Target | Outcome |
| --- | --- | --- | --- |
| 5-a | Codebase explorer | `/home/z/webflix-2.0` | Full YouTube-channel feature contract + TikTok integration inventory (§2, §3) |
| 5-b | agent-browser (headless Chromium, guest) | `https://webflix-2-0-tepa.vercel.app` | Page-by-page UX walk of the production site (§4) |
| 5-c | agent-browser + curl probes | `https://www.tiktok.com` (logged out) | **Hard-blocked**: every path geo-walls to `/hk/about` (this sandbox's egress is Hong Kong, where TikTok has discontinued service; oEmbed 302s through TLB, internal APIs 302/403). Inventory completed from knowledge, labeled as such (§5) |

The sandbox egress wall shapes what could be verified, not what was planned: every closure below is
designed against TikTok's **documented, approval-free** surfaces (keyless oEmbed + the official Embed
Player), which are exactly the lanes ADR 0004 already licenses.

## 2. What WebFlix already has (the strengths to build on)

- **One Shorts experience, two sources** (ADR 0013): `/shorts` with a YouTube | TikTok source
  selector; the TikTok adapter rides the official Embed Player under the active-slide lifecycle
  (exactly one iframe per feed), with the P90 mute law (`force_muted` re-mount), the P89 thumbnail
  hardening (R5 no-referrer / R6 fallback / R7 poster hydration / R8 preconnect), chevron paging,
  and the M2/M3 WebFlix-local action set (import/save, visibility flip, session-local hide, honest
  outbound report).
- **A YouTube channel system of proven shape**: `/channel/[handle]` (client page, 1,419 lines) fed
  by `GET /api/channel/[handle]` → `ChannelPageDTO`; a banner/avatar/name/stats header block
  (`ChannelHeaderBlock`), a tab strip (Home/Videos/Shorts/…/About, last-tab remembered), lazy tab
  loads, an in-channel search, and a Join sheet.
- **A per-user connection pattern (P36) to mirror**: Google OAuth quartet
  (`/api/connection/youtube[/oauth/start|/oauth/callback|/disconnect]` + the status route), an
  AES-256-GCM-encrypted token record under `wf:yt:conn:<userId>` (Upstash REST + in-memory
  fallback), a settings card with an honest `not-configured` deployment state, and a client
  SWR-style hook. **This is the template the TikTok connection must clone.**
- **TikTok data primitives**: the curated universe (17 cited posts with factual handles),
  `TikTokImport` rows (`authorHint` = the handle the pasted URL carried), the keyless oEmbed lane
  (`author_name` / `author_url` / `thumbnail_url` per post, cached 6h/24h), and the URL law
  (`src/lib/tiktok/urls.ts` is the only tiktok.com string source).
- **Honest capability map** (`SHORTS_SOURCE_CAPABILITIES`): TikTok `like/dislike/comment/follow` are
  `false` BY LAW — TikTok publishes no third-party write API. Any closure that fakes them is
  forbidden.

## 3. The core structural gap (5-a's headline finding)

**WebFlix has no TikTok channel entity at all.** No model, no page, no API, no connection record —
grep for tiktok×channel returns zero hits. A TikTok creator's name in WebFlix is a bare handle that
links OUT to tiktok.com, while a YouTube creator gets a rich internal `/channel/@handle` page with
subscribe, tabs, and a searchable video grid. That asymmetry is precisely "WebFlix is not the main
TikTok interface": the creator surface — the unit of TikTok's whole product — is missing.

Data reality check (honesty law): keyless oEmbed carries **no avatar, no banner, no follower/like
counts, and no bio**. So an honest TikTok channel page is *derived* — aggregated from the posts
WebFlix's own corpus (curated + community imports) already attributes to that handle:

- **handle** (always), **nickname** (oEmbed `author_name` when any post's metadata verified it),
  **post count** (real), **banner** (the latest verified post thumbnail), **avatar** (an
  aggregator candidate with an initials fallback — never fabricated pixels), **grid** (the posts,
  rendered by the same TikTokCard hover-play tiles the hub uses), **outbound** (the creator's real
  profile URL + per-post deep links — ADR 0004's outbound law stays intact).
- What is *not* shown: follower/like totals, bio, verified badges, follow buttons that claim a
  TikTok write. Those are unavailable or API-gated (§7); faking them would break the provenance law
  the whole TikTok module runs on.

## 4. Gap matrix (5-b's production walk + 5-c's TikTok inventory)

Priorities: **P0** = blocks the "main TikTok interface" claim or breaks the app; **P1** = a
TikTok-parity surface users will miss; **P2** = polish.

| # | Pri | Gap | Evidence | Root cause | Closure |
| --- | --- | --- | --- | --- | --- |
| G1 | P0 | **No internal TikTok creator channel page** — `@scout2015` on a TikTok slide links to `tiktok.com/@scout2015` (exits the app) while YouTube creators get `/channel/@handle` | 5-b §5 | No TikTok channel entity (§3) | **P94-a** — derived channel pages `/tiktok/[handle]` mirroring the YouTube page's visual grammar |
| G2 | P0 | **No TikTok channel connection** — users cannot connect their TikTok identity the way they connect YouTube (P36 card, OAuth, settings) | 5-b §7; 5-a §1b | No Login Kit seam, no store, no settings section | **P94-b** — the P36 pattern cloned for TikTok: Login Kit OAuth quartet (honest `not-configured` until the operator provisions credentials) + an interim **profile-link** lane that works TODAY |
| G3 | P0 | **Third-party embed can navigate the whole app away** — twice during the walk the top-level tab landed on `tiktok.com/about` / `tiktok.com/hk/about` right after the page fetched TikTok oEmbed/tiles | 5-b §3 (network log) | TikTok iframes (feed player, card preview, hub player) carry **no `sandbox` attribute** — embed content may drive top-level navigation | **P94-c1** — `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"` on all three TikTok iframe hosts (playback + postMessage unaffected; top-navigation vector dead) |
| G4 | P0 | **Guest-gated actions hard-navigate away, losing feed position** — Save-to-shelf / Add-a-post / Like / Subscribe drop the viewer onto `/signin?redirect=…` (full page load; the feed is gone) | 5-b §2, §B-2 | Guest gates call `window.location.assign(signInHref(...))` inside feed actions | **P94-c2** — the guest gate becomes an inline toast ("Sign in to save…"), navigating only when the viewer chooses the action; feed position never lost by a tap |
| G5 | P0 | **`/studio` ("Your videos") is dead in production** — lands on `studio-webflix.vercel.app` → "Deployment Paused" | 5-b §8 | The sidebar row targets an external deployment that is paused | **P94-c3** — honest in-app handling (see the closure note in §6) |
| G6 | P1 | **TikTok slides have no on-rail like/comment/save** — asymmetric with YouTube slides | 5-b §B-4 | The capability map forbids like/comment (no TikTok write API) — CORRECT by law; save lives in the ⋯ menu | Partially closed in **P94-a/c**: Save-to-shelf gets a first-class rail slot; like/comment stay forbidden (documented, §7) |
| G7 | P1 | **No action counts anywhere on TikTok surfaces** | 5-b §B-6; 5-c §A-1 | oEmbed carries no counts; TikTok's count APIs are approval-gated | Documented open (§7) — honest absence beats fabricated numbers |
| G8 | P1 | **"Ask AI about this video" is a dead button for guests** | 5-b §B-5 | No guest path behind the affordance | P95 work order (YouTube-side, not TikTok-parity) |
| G9 | P1 | **Notifications button is inert for guests** | 5-b §B-9 | No guest popover | P95 work order |
| G10 | P1 | **Placeholder descriptions on watch pages** (YouTube lane) | 5-b §B-7 | Seed/demo data | P95 work order (out of the TikTok mandate) |
| G11 | P1 | **Missing TikTok-parity surfaces**: hashtag pages, sound/music pages, explore, For-You/Following tabs | 5-c §B | oEmbed carries no sound/hashtag aggregation data; these need API approval or scraping (forbidden) | Documented open (§7) — revisit only if an approved API lane appears |
| G12 | P2 | **Footer is entirely non-interactive** (About/Terms/Privacy… are plain text) | 5-b §B-10 | Footer renders text, not anchors | **P94-c4** — wire the links to real surfaces |
| G13 | P2 | **Search suggestions overlay survives Back navigation** and intercepts clicks | 5-b §B-11 | Suggest listbox not closed on route change | **P94-c5** — close on route change (topbar) |
| G14 | P2 | Channel identity mismatch (name ↔ handle ↔ bio on one YouTube channel) | 5-b §B-12 | Seed data inconsistency | P95 (seed hygiene, out of mandate) |
| G15 | P2 | No home hero / first-viewport feed | 5-b §B-13 | Product direction | P95 (out of mandate) |
| G16 | P2 | "Remix" permanently disabled without a reason surfaced | 5-b §B-14 | Honest stub | P95 |

## 5. What TikTok's own interface defines as "the main interface" (5-c)

Ranked P0 surfaces for a TikTok-feeling app: ① the vertical snap feed with a right-rail action
stack; ② the **profile page** (avatar, nickname + handle, stats, tabbed grid); ③ the shareable video
permalink; ④ the login-gate UX that intercepts engagement without ejecting you; ⑤ keyboard/scroll
navigation. WebFlix already ships ①③⑤ (the shared `/shorts` shell, `?post=` deep links,
chevrons/keys); **② is G1 and ④ is G2+G4.** P1/P2 surfaces (search tabs, hashtag/sound pages,
explore) are the documented open set above.

## 6. The closure plan (this report's suggestions → the P94 work)

**Wave P94 — TIKTOK-CHANNELS-AND-INTERFACE-PARITY** (this delivery; all lanes below were implemented
immediately after this report, per the mandate):

- **P94-a — TikTok channel pages (closes G1).** `src/lib/tiktok/channels.ts` aggregates the composed
  universe (curated + public imports + the viewer's own saves, the M2 composition) by creator handle
  → `TikTokChannelPageDTO` (handle, verified-when-oEmbed nickname, avatar candidate, real post
  count, banner from the latest verified thumbnail, honest note). `GET /api/tiktok/channel/[handle]`
  serves it; `/tiktok/[handle]` renders it with the YouTube channel page's visual grammar
  (banner → avatar/name/handle/stats header → tab strip Videos|About → tile grid of TikTokCards →
  About disclosure + outbound "Open on TikTok"). The feed's attribution `@author` becomes the
  internal link (the outbound law survives: every channel page and rail keeps "Open on TikTok").
  The URL law absorbs `parseTikTokProfileUrl` + the in-app channel href builder; the lib-file pin
  test grows `channels.ts` (+`oauth.ts`).
- **P94-b — the TikTok channel connection (closes G2).** The P36 pattern cloned end-to-end:
  `WebFlixTikTokConnection` under `wf:tt:conn:<userId>` (own store module, own keyspace, AES-256-GCM
  tokens, no TTL); the status/start/callback/disconnect route quartet with the honest
  `not-configured` envelope (exact missing env + the redirect URI to register in a TikTok for
  Developers app); a settings card mirroring the YouTube one (`#tiktok-connection`), plus the
  **interim profile-link lane**: paste your profile URL → parsed by the URL law → stored as an
  unverified link (`status: "linked"`) — the connect action that works TODAY, honestly labeled,
  with Disconnect. `.env.example` documents `TIKTOK_CLIENT_KEY/SECRET`. When the operator's Login
  Kit app is approved, the same card lights up OAuth with zero code change.
- **P94-c — hardening set (closes G3–G5, G12, G13; partial G6).**
  c1: sandbox on all three TikTok iframe hosts. c2: inline guest gates on the TikTok rail's save
  (and the YouTube rail's equivalents where the same pattern applies). c3: `/studio` — the sidebar
  keeps its row but the destination stops lying: WebFlix's own your-videos surface answers with an
  honest state instead of a paused third-party deployment. c4: real footer anchors. c5: topbar
  suggestions close on route change.
- **Gates:** typecheck 0; eslint 0; the tiktok lane + the connection's existing test lanes stay
  green with the updated pins; FULL battery foreground-to-file; local agent-browser verification of
  the channel page, the connect card, the sandboxed hover-play law, and the inline guest gate.

**Waves P95+ (open, documented honestly):**
- Operator-gated: TikTok for Developers app (Login Kit + Display API) — unlocks real OAuth
  connections, avatars/stats via consented reads, and the M4 import-enrichment rung. WebFlix-side
  code is ready by P94-b; the API approval is the operator's errand.
- API-impossible today (no public API; scraping forbidden by ADR 0002/0004): TikTok write-sync
  (like/comment/follow/posting), FYP retrieval, hashtag/sound pages, DMs. These stay outbound
  hand-offs by law.
- YouTube-side hygiene (G8–G10, G13–G16): P95 work orders.

## 7. The honesty ledger (what this report refuses to fake)

No fabricated avatars/banners (fallbacks are labeled initials/music-glyph discs), no fabricated
stats, no follow/like affordances that claim a TikTok write, no scraping to fill gaps, no remote
oEmbed HTML injection, and no tiktok.com URL built outside `src/lib/tiktok/urls.ts`. Every "missing"
piece renders as an honest absence with the outbound lane intact — the same doctrine that carried
P58→P93.

*Evidence: the three research passes' full reports are in the P94 WORKLOG entry; the production
walk's route inventory (§4's citations) was captured guest-side against
`https://webflix-2-0-tepa.vercel.app` on 2026-11-04.*
