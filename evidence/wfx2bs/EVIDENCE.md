# WFX2-B-S — Comment writes + channel deep parity + channel-wall resilience

**Branch:** `wfx2/waveB-comments-write` (base: `main` @ 8626ba1) · **Worker:** WFX2-B-S
**Scope:** comment WRITES (lane A) · channel page deep parity (lane B) · channel-wall resilience (lane C) · honest degradation (lane D).

---

## 1. Wire-form research (LIVE-VERIFIED from this sandbox, 2026-09-30)

### The channel wall (lane C's premise — reproduced from this egress)

| Surface | Mechanism | From this sandbox |
|---|---|---|
| `GET youtube.com/@handle` (SSR scrape) | the `resolveChannel` @handle path | **404 — WALLED** |
| `GET youtube.com/channel/UC…` (SSR) | — | 200 OK |
| `browse {browseId: UC…}` | the channel page + tabs | 200 OK (header + 7 tabs) |
| `search {query, params: EgIQAg==}` (type=channel) | channel-renderer resolution | 200 OK (20 channelRenderers) |
| `search {query}` (mixed) | channel result rows | 200 OK but **0 channelRenderers** (the wall signature — production sees the same on Vercel egress) |

Production's raw 502 path reproduced: `fetchYtInitialData("/@RickAstleyYT")` → SSR 404 → **throws** → the old route's catch → naked 502. The fix (§3) absorbs this into the honest degrade.

### Channel tabs (lane B)

- Every tab is `browse {browseId: "UC…", params: <the channel's OWN tab param>}` — the params come from the channel home response's `tabRenderer[].endpoint.browseEndpoint.params`. **CRITICAL discovery:** the classic constant family must use the FULL forms — the truncated `EglwbGF5bGlzdHPyBgoKCEIGCgIQaC` (Playlists, missing the trailing `IA` bytes) silently falls back to the channel Home tab (verified live: 71 video/album lockups instead of 13 playlist lockups). Full verified forms live in `CHANNEL_TAB_PARAMS`; the response-own params always win.
- **Community** = the "Posts" tab (`backstagePostRenderer` rows: postId, contentText.runs, voteCount.accessibility.accessibilityData.label = "4.4K likes", replyButton text, publishedText, optional backstageImageRenderer attachment).
- **Playlists** = `LOCKUP_CONTENT_TYPE_PLAYLIST` lockups: id = `contentId`, title = `metadata.lockupMetadataViewModel.title.content`, video-count badge ("N videos") on `contentImage.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel` overlays, thumbnail from `image.sources`.
- **About — NOT a tab param.** The classic `EgVhYm91dPIGBAoCEgA=` "about tab" param just returns the channel home (verified dead end — 3 client versions probed). The REAL mechanism: the channel home response's description "…more" tap carries `showEngagementPanel` → an `engagementPanelSectionListRenderer` whose sectionList content holds a **continuation token** → `browse {continuation}` → `aboutChannelViewModel` (joinedDateText "Joined Feb 1, 2015", viewCountText "2,570,271,276 views", subscriberCountText, videoCountText, country, links — 11 `channelExternalLinkViewModel` rows with `youtube.com/redirect?q=<target>` redirects that we unwrap to the honest target URL).
- **Join/memberships**: the `pageHeaderViewModel.actions.flexibleActionsViewModel.actionsRows[].actions[].buttonViewModel.title === "Join"` renderer appears only when the channel offers memberships (verified: Markiplier has it, Rick Astley doesn't). Logged-out, its onTap is YouTube's own sign-in modal — **"Sign in to become a member."** Tier rows require the signed-in memberships panel (the join button's `getMembershipsPanelCommand` — only present with the operator session). Public mode therefore reports `joinable: true, signinRequired: true, tiers: null` — YouTube's own logged-out state, never fabricated tiers.

### Comment read model (lane A ride-along)

The comments continuation response's `frameworkUpdates.entityBatchUpdate.mutations` carry **`engagementToolbarStateEntityPayload`** (keyed by `commentViewModel.toolbarStateKey`): `heartState: TOOLBAR_HEART_STATE_HEARTED` (creator hearts — the fixture's first comment IS hearted by @RickAstleyYT) and `likeState: TOOLBAR_LIKE_STATE_LIKE/DISLIKE/INDIFFERENT` (the session viewer's own rating). Both now surface in the read model (`heartedByCreator`, `yourLike`).

### Comment WRITES — the wire-form choice for edit/delete/heart/pin/report

**Research:** the read layer carries NO edit tokens — the comments continuation's entity payloads (`commentEntityPayload`, `commentSurfaceEntityPayload`, `engagementToolbar*`) contain no `editCommentParams`/menu commands (verified against the real `comments_dQw4.json` capture: 0 occurrences of edit/delete/report wire forms). YouTube's own edit flow renders the ⋮ menu items client-side, and the `browse {editCommentParams}` endpoint's token is only carried to signed-in owners' own-comment menus — not reachable from the public read layer, and not verifiable from this sandbox (no YT_COOKIES here).

**Choice: the broker DOM path (⋮ → menu item → dialog/inline editor), the 100%-fidelity tier.** Implemented as five new broker kinds (`comment-edit`, `comment-delete`, `comment-heart`, `comment-pin`, `comment-report`) — each locates the comment by its current text (`payload.commentText`), opens the real ⋮ menu, clicks the real item, drives the real dialog (delete confirm, report reasons radio rows + Report/Next submit through sub-reason steps), and verifies the effect in the DOM. Comment-create stays direct-first: InnerTube `comment/create_comment` with SAPISIDHASH (the subscribe lane's verified pattern) → broker fallback (the watch page's simplebox DOM path).

## 2. Lane A — comment writes

| Surface | Path |
|---|---|
| Composer (`"Comment..."` placeholder, 0/10000 char counter, Cancel/Comment disabled-until-text) | `POST /api/comments` → direct `create_comment` (SAPISIDHASH) → broker `comment-create` |
| Replies (inline composer per comment) | `POST /api/comments` with parentId + parentText → broker `comment-reply` |
| Edits (⋮ → Edit → inline textarea) | `PATCH /api/comments/[id]` {body, videoId, commentText} → broker `comment-edit` |
| Deletes (⋮ → Delete → "Delete comment?" confirm) | `DELETE /api/comments/[id]` {videoId, commentText} → broker `comment-delete` |
| Comment likes (toggle) | `POST /api/comments/[id]/like` (existing, unchanged) |
| Creator heart (⋮ → Heart) | `POST /api/comments/[id]/heart` → creator-mode guard → broker `comment-heart` |
| Creator pin (⋮ → Pin, top-level only) | `POST /api/comments/[id]/pin` → creator-mode guard → broker `comment-pin` |
| Report (⋮ → Report → reasons dialog) | `POST /api/comments/[id]/report` {reason, videoId, commentText} → broker `comment-report` |
| Sort (Top/Newest) | the existing continuation-based sort param (unchanged, now YouTube-copy UI) |

- **Creator-mode detection**: `/api/videos/[id]` sets `state.isCreator` by matching the operator's channel (the signed-in home page's ytcfg `CHANNEL_ID` — the studio lane's verified mechanism, cached) against the watch metadata's channel id. Public mode → false, honestly.
- **Own-comment rendering**: `isOwn` from the read model's `author.isCurrentUser` (session truth); the composer's synthesized row carries the operator identity (`isOwn: true`).
- **Optimistic UI + rollback**: like toggles optimistically with server-truth reconciliation and rollback on failure; toasts per YouTube's snackbar behavior.
- **YouTube-parity UI details**: delete goes through the confirm dialog ("Delete comment?" / "Deleted comments can't be recovered."); the report dialog uses the comment-report reason family (Spam or misleading / Harassment or bullying / Hate speech or graphic violence / Promotes terrorism / Impersonation); the composer counter reads `N/10000`; the edit flow sends the CURRENT text as the DOM locator and merges `{body, edited}` into the row.

## 3. Lane C — the channel-wall fix

`getChannelPageResilient(handle)` wraps the whole channel read in `cachedResilient(channelPageCacheKey(handle), TTL.FEED_MS, fn, { isEmpty: (v) => v?.walled === true })`:

- **healthy** → cached normally (tabs + joinable ride the payload, additive);
- **walled/failed** (the SSR 404 throw, the null lookup, any upstream error) → the `{page: null, walled: true}` marker — NEVER cached (poisoning guard), last-good serves when one exists;
- **cold + walled** → the marker reaches the route → **HTTP 200** `{channel: null, videos: [], shorts: [], tabs: [], joinable: false, walled: true, note}` — the structured honest degrade, never a naked 502.

**Search channel renderers (item 14):** when a search upstream returns zero channel renderers (the wall signature — verified: mixed search from this egress returns 0 while videos map fine), `channelFromLastGood(query)` peeks the channel last-good cache family (`yt:channel:page:<normalized-handle>`) for an **exact handle match** (query "lofi"/"@lofi" ↔ the cached @lofi page — never a guessed attribution) and serves that channel's real last-good header as the row; honest empty otherwise.

## 4. Lane D — the degradation matrix

| Surface | Public mode (no YT_COOKIES) | Operator session |
|---|---|---|
| Composer | "Comment..." box → "Sign in to continue to comment" dialog → /account (the account flow) | composer → direct/broker post |
| Comment like / report taps | "Sign in to continue" dialog | broker toggle / report dialog → broker |
| Report API | 403 `{needsSession: true}` — honest, no fake reported state | broker comment-report |
| Edit/Delete menu | not rendered (no own comments — isOwn is session truth) | rendered for isOwn rows |
| Heart/Pin menu | not rendered (isCreator false) | rendered when creator-mode |
| Channel page | full reads; subscribe→broker honest 502s as before | same + creator tools |
| Join sheet | `joinable` + "Sign in to become a member." + /account link (YouTube's own logged-out modal copy) | tiers when the memberships panel is reachable; honest note otherwise |
| Walled channel read | last-good → else HTTP 200 `walled: true` + retry | same |

The `/account` page (new) states the session honestly: local identity, operator session state, the YT_COOKIES connection pointer — no fake login form.

## 5. Test coverage (61 new, fixtures only — zero live network in tests)

- `tests/comment-writes.test.ts` (23): the write routes with mocked broker/direct/session/watch/operator — direct-first vs broker fallback, locator payloads, honest 502s, needs-session degrade, creator guards.
- `tests/comment-composer.test.tsx` (6): placeholder/counter/max-length/submit-to-`/api/comments`/signed-out dialog (happy-dom + the focusin→keyup change-detection recipe — the plain input event does not trigger React 19's tracker in happy-dom; documented in the file).
- `tests/comment-report-flow.test.tsx` (4): the report dialog's reasons list, disabled-until-select, submit payload, closed-render.
- `tests/channel-tabs.test.ts` (21): the tab mappers against the sanitized real captures, per-tab browse with the response-own params, the About continuation mechanism, the Join honest degrade, the walled tab degrade, tab caching.
- `tests/channel-wall.test.ts` (7): the production gap fix — walled → 200 + `walled: true` (never 502), last-good serving + no poisoning, recovery, the search channel-renderer wall fallback (exact-handle match only).

New sanitized fixtures (from live captures, tracking/redir tokens stripped): `channel_posts_rickastley.json`, `channel_playlists_rickastley.json`, `channel_about_rickastley.json`, `channel_shorts_rickastley.json`.

## 6. Live verification runs (dev-time, not tests)

- browse-UC / tab params / Posts / Playlists / Shorts / About-continuation / Join-button detection probed live from this sandbox (the raw captures are in this repo's test fixtures, sanitized).
- The @handle wall (404) reproduced and exercised through the honest-degrade path in the fixture tests.

## 7. Honest gaps

- The memberships **tier rows** wire form (`getMembershipsPanelCommand` → the panel response) is implemented best-effort but unverifiable here (no YT_COOKIES in this workspace) — the join sheet honestly degrades (`tiers: null` + note) in both public mode and when the panel isn't readable. Never fabricated.
- The `comment-edit` `browse {editCommentParams}` fetch fallback is NOT implemented (unverified wire form, no token source in the read layer) — the DOM path is the single, honest edit tier.
- The lead's broker (port 3055) must restart on this branch to gain the five new action kinds — until then those actions honestly 502 with the standard offline message.
