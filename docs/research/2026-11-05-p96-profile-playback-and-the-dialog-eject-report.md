# P96 — the profile-playback gap and the dialog eject: a fresh user-walk report

Date: 2026-11-05 · Follows the P94 gap report (G1–G16 resolved by P94+P95, deployment verified
live) and the P95 closure report. This wave ran a NEW open-ended user walk (guest, agent-browser,
the live P95 production build `https://webflix-2-0-tepa.vercel.app`) that hunted gaps **outside**
the original 16-row matrix — the areas no prior walk had probed: search, the You/library surfaces,
history, the hub, unknown-handle degrade, and the guest import flow.

---

## 1. What the walk verified already working (no action)

| Surface | Verdict |
| --- | --- |
| TikTok hub `/tiktok` | The hand-off banner + the full 17-card grid + the honest scope note render (an earlier empty-looking snapshot was the API call in flight, not a defect) |
| Search results page | The TikTok shelf row rides the results (`TikTokSearchShelf`, P58); `/api/tiktok/search?q=scout2015` finds the post |
| Unknown-handle degrade | Format-invalid handle → API 400 + page 404 (the URL law's own verdict); valid-format unknown handle → honest 200 DTO (`postCount: 0`, note "paste one from this creator") + an honest page |
| Save-to-my-shelf guest gate | INLINE toast + Sign-in action, feed position kept (the P94 law, re-verified live) |
| One-iframe / mute / source-tab laws | All hold on the P95 build (re-verified: the iframe moves on hover, mute persists across reload, `?source=tiktok` remembered) |

## 2. The two new gaps

### G17 — no creator-scoped playback (P1, implementable) — the profile-playback gap
On TikTok, a creator profile IS a feed scope: tapping a profile video plays within that creator's
sequence. On WebFlix the channel page (`/tiktok/@handle`) has a header CTA and a grid, but:
- "Watch in Shorts" links the **general** feed (`/shorts?source=tiktok`) — the creator context is lost;
- every grid card deep-links into the **shared** feed (`/shorts?source=tiktok&post=<id>`, the M3
  canonical law) — same loss.

The feed API composes by post id only (`/api/tiktok/feed?cursor|post|limit`); no handle filter
exists. The composition machinery to close it already ships: `lib/tiktok/channels.ts` aggregates
the composed universe by the verifiable handle (author_url > author > import hint) — the exact
matching a scoped feed needs.

**The closure (P96-a):** the URL contract extends to `/shorts?source=tiktok&creator=@handle`
(`&post=` still composes). Server-parsed like `source`/`post` (back/reload/deep-link render the
scope on first paint); `/api/tiktok/feed?creator=` answers the scoped pages through the channel
matcher; the rail shows an honest scope chip with a Clear action; a scoped feed with zero posts
renders the honest empty note; the channel page's CTA and grid cards link the scoped URLs
(TikTok profile parity) while hub/search/home cards keep the shared canonical law.

### G18 — the import dialog still hard-ejects guests (P2, implementable)
The P94 inline law killed the hard `/signin` ejects for the rail gates (save/like/dislike/save),
but the **Add-a-TikTok-post dialog** kept the pre-P94 pattern: a guest click runs
`window.location.assign(signInHref(...))` — a full page load that drops the feed position the
law exists to keep (the walk measured it: guest tap → hard `/signin?redirect=…` navigation).

**The closure (P96-b):** the dialog's guest gate goes inline — the same toast + Sign-in action the
rail gates use; the redirect param still carries the feed URL (including a scoped one). The
401-on-submit path (a session that died mid-dialog) gets the same treatment. No navigation happens
until the viewer chooses Sign in.

## 3. The documented non-closures (no code, honestly labeled)

| Item | Why not |
| --- | --- |
| Search-suggest dropdown carries no TikTok rows | The TikTok search lane is curated-library-scoped (P58, ADR 0004 §3); suggest parity would promise a universe the deployment doesn't have. The results page already surfaces TikTok. |
| TikTok watches never enter History | WebFlix's history is empty BY LAW for every source (P36: YouTube's watch history has no official API; the route serves the honest empty envelope). A first-party TikTok history would be a new feature, not a parity closure — deferred, documented. |
| You-page sign-posting to the studio shelf | The studio is reachable from the Create affordances and settings; a cosmetic link, deferred. |
| Counts / hashtag pages / sound pages / FYP / writes | Unchanged: API-impossible or forbidden (ADR 0002/0004) — the P94 report's residual set stands. |

## 4. The honesty ledger (unchanged)

No fabricated rows, no invented counts, no fake write capability. The scoped feed renders only
posts the composed universe verifiably owns; an empty scope says so.

*Method: guest-side agent-browser walk of the P95 production build (2026-11-05), plus code reads
of the search/history/hub/import surfaces. The closures ship in the same wave (P96), report-first.*
