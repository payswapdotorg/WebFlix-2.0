# P98 — The First Signed-In Walk (the link's invisible payoff + the unguarded identity seam)

Date: 2026-11-05 · Window: trace `1a1b3f2ad49e50d9` · Base: local main @ P97-r2 (the sixteenth window lost the original P97 commit before any push; the seventeenth reset re-cloned at `79ac4d5` and P97 was re-applied verbatim — see the restoration notes in the P97 report and ledger)

## The walk's mandate

Every walk of the P94–P97 era was a GUEST walk. The mandate says to use the interface "as a user" — so this wave registered a throwaway account on the live P96 production build (`p97walk@example.com`, created through the real `/api/auth/register` + the real `/signin` form), **linked a TikTok identity through the real Settings flow**, and walked the surfaces the guest walks could never reach:

- the **connection card's authed state** and its Login-Kit honesty
- the **Link-your-profile flow** end-to-end (the works-today lane)
- the **linked viewer's own channel page** (the "your channel page" promise)
- the **authed save lane** on the shorts rail
- the **authed import** through the real Add-a-TikTok-post dialog (the P96 guest gate's other half)
- the **You page** as a TikTok-linked viewer

## Verdicts — already working (no action)

| # | Surface | Walk | Verdict |
|---|--------|------|---------|
| W1 | Registration + sign-in | `POST /api/auth/register` → 201 with a real user row; the `/signin` form → signed in ("Your account" replaces "Sign in") | ✅ |
| W2 | The TikTok connection card (authed) | the full honesty grammar: "Link your profile today (works everywhere), or connect through TikTok's official Login Kit when this deployment is configured"; the capability split ("Runs on WebFlix: save to your shelf, share, visibility flips, your channel page" / "Runs on TikTok only: likes, comments, follows — no third-party write API exists, so those buttons hand off to TikTok"); the Login-Kit setup note names the missing env vars (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`) AND the exact callback URI to register | ✅ (the operator-gated OAuth lane's not-configured doctrine lives) |
| W3 | Link-your-profile (works today) | paste `https://www.tiktok.com/@scout2015` → "Linked as @scout2015" + the honest unverified disclosure ("An unverified WebFlix-local link… It is not a TikTok authorization; no TikTok write is claimed or performed") + Recheck/Disconnect | ✅ |
| W4 | Authed save on a curated post | "Already in every viewer's TikTok feed" — the honest no-op for a post the curated citation already carries publicly | ✅ |
| W5 | Authed import (the real dialog, authed submit) | paste a post URL (with a stray space after the `@` — the P97 lenient law absorbed it) → "TikTok post added to your feed (only you can see it)"; the row **renders in the full feed** with live-verified oEmbed metadata (@decoderpod) | ✅ |
| W6 | The scope-respecting import (P96's pin, live) | the fresh import of a DIFFERENT creator does NOT render inside `creator=%40scout2015`'s scoped feed; it does render in the full feed | ✅ |
| W7 | The owner affordances' contract | the rail's flip/remove pair exists for `owned` rows (code-verified: `item.owned ? flip/remove`); the visibility API is `PATCH /api/tiktok/import/[postId]` with the owner-only 404-to-strangers law | ✅ (code+API contract; the hover-lane DOM walk was cut short by the one-iframe active-card complexity — recorded honestly) |

## THE GAPS

### G21 — the linked identity is invisible on the channel page it claims

**Repro (live prod):** sign in, link `@scout2015` in Settings (W3), open `/tiktok/scout2015` → About tab still renders the generic guest prompt: *"Is this you? Connect your TikTok account in Settings to manage your posts from here."*

The connection card promises the linked identity's channel page "runs on WebFlix" — but the channel page never acknowledges the link. The viewer who did everything right sees the same stranger-facing copy a guest sees. The data layer makes this a one-field closure: the route already resolves the session for composition; the connection store already carries the linked handle (`WebFlixTikTokConnection.handle`, @-less); the compare is one normalize.

**Closure plan:** add `viewerLinked: boolean` to `TikTokChannelPageDTO` (additive — the P95 `local:true` pattern): the channel route compares the viewer's linked handle to the page's handle (case-insensitive, both already @-less post-P97) and stamps the DTO; guests answer `false`. The About tab swaps the prompt for the linked acknowledgment when the field is true: the viewer's own identity, named, pointing at Settings for management — never a fabricated capability.

### G22 — one unguarded DB touch 502s the whole authed feed

**Repro (live prod):** signed in, walked the full feed; on one reload the authed `/api/tiktok/feed` answered **502 `{"error":"Failed to load the TikTok feed"}`** — reproducibly for several probes — while the unauthed feed answered 200 the whole window. It self-healed minutes later (transient).

**Root cause (pinned in code):** the authed lane's identity step is the ONLY unguarded DB touch in the feed path — `importUserId` → `ensureShadowUser` runs `db.user.findUnique`/`update`/`create` bare (src/lib/watch/local-comments.ts:83-100). Every sibling lane degrades honestly (the import-id reads try/catch to `[]`, `importMeta` to an empty map, oEmbed to the honest-unavailable DTO) — but one transient Neon hiccup (serverless cold-start drop, pooled-connection race) throws through the route's single try/catch → 502 for the signed-in viewer.

**Closure plan:** make the identity seam resilient — catch the upsert failure and fall back to the DETERMINISTIC shadow id (`shadowUserId(sessionUser.id)`, a pure `wf-<sub>` function; exactly the id the upsert would have ensured). Reads then degrade honestly (composition loses nothing — the rows are keyed by the deterministic id), and writes fail at the FK with a clear error instead of an opaque 502. Strictly better at every rung; the guard is the same shape the sibling lanes already ride.

**Residual after closure:** the operator-gated set (TikTok for Developers app, `ZAI_API_KEY`) and the API-impossible family (writes / counts / hashtag / sound) are unchanged.
