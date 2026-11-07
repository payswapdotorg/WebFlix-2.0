# P97 — The Fresh Walk of the P96 Production Build (report-first)

Date: 2026-11-05 · Window: trace `1a1b29f9338f0cbd` · Base: main @ `79ac4d5` (P96 + its ledger; the fifteenth sandbox reset survived — repo cloned fresh == origin, install + db rebuilt; **no credentials available this window** — the ship step is documented as blocked, not skipped)

## The walk's mandate

The P94/P95 matrix is closed and P96's fresh walk closed its two finds (G17 profile-playback, G18 dialog eject). This wave ran ANOTHER fresh open-ended guest walk of the live P96 production build (`dpl_9j2VnTYNh6i1AScNGSJapu6dWwuA`, sha `b632e77`, verified by bundle markers `tiktok-scope-chip` + `tiktok-channel-watch-scoped` in the served chunks) hunting gaps in territory the previous walks never entered:

- the shorts rail's **More actions menu** (Save / Not interested / Report on TikTok / Copy link) as a guest
- the **`/tiktok/v/[id]` post-view route** and its degrade rungs
- the **About tab** and its connect pointer on production (desktop + 375px)
- the **multi-creator trail** (a second creator's channel page CTAs)
- the **source-tab switch under an active creator scope**
- the **rail's keyboard accessibility** (no-hover focusability)
- the **Share/clipboard** lane as a guest

## Verdicts — already working (no action)

| # | Surface | Walk | Verdict |
|---|--------|------|---------|
| W1 | Not interested (guest, More actions) | click → toast + URL unchanged; the scope's ONLY post hides; the honest scoped empty renders ("No posts from @scout2015 … Add one of their posts with the Add TikTok button"); reload restores the post (session-local, zero persistence claimed — matches the code's `toast.success("Hidden for this session")` + no-store law) | ✅ coherent local-preference law |
| W2 | Report on TikTok (guest) | new-tab open (WebFlix tab never navigates); target = the canonical post deep link `tiktok.com/@scout2015/video/…` (TikTok owns moderation — ADR 0004); the sandbox observed TikTok redirecting it to `/hk/about` — TikTok-side bot/region handling, not a WebFlix defect | ✅ honest outbound posture |
| W3 | Share as guest (clipboard blocked in sandbox) | the honest fallback toast fires: "Copy manually: https://www.tiktok.com/@scout2015/video/6718335390845095173" — the real URL handed to the viewer | ✅ honest degrade |
| W4 | `/tiktok/v/6718335390845095173` | 307s to `/shorts?source=tiktok&post=…` (the canonical deep-link law); feed renders the full shared feed, post spliced first, ONE iframe | ✅ |
| W5 | `/tiktok/v` (bare) → hub; `/tiktok/v/not-a-real-post-id` → `/shorts?source=tiktok` (invalid id honestly dropped) | ✅ |
| W6 | Multi-creator trail (@nowthispolitics) | channel page grammar complete; CTA `Watch in Shorts` + grid card BOTH carry `creator=%40nowthispolitics` scoped hrefs (the G17 law generalizes); honest nulls everywhere | ✅ |
| W7 | About tab on prod | derivation disclosure + Handle/Posts/Profile table + **"Connect your TikTok account in Settings"** — the "Settings" word IS a live link (`a[href="/settings#tiktok-connection"]`, verified in the DOM). An initial walk probe reported it dead text; the re-probe against the DOM retracted it (the probe had searched for the whole sentence inside the anchor — probe artifact, recorded honestly) | ✅ (G19 retracted) |
| W8 | Mobile 375px About tab | full grammar, `scrollWidth == clientWidth == 375` (0 overflow) | ✅ |
| W9 | Source-tab switch under an active creator scope | YouTube tab → `/shorts` (the scope cleanly dropped — YouTube carries no creator concept; the canonical source href wins) | ✅ |
| W10 | Rail keyboard a11y | every rail control natively tabbable (tabIndex 0) and visible without hover on the full feed | ✅ |

## THE GAP — G20: the multi-`@` creator input answers four different laws at four rungs

**Repro (live prod, guest):** `/shorts?source=tiktok&creator=%40%40bad`

| Rung | Live answer | The law it follows today |
|------|-------------|--------------------------|
| `/api/tiktok/channel/%40%40bad` | **400** `{"error":"Invalid TikTok handle"}` | `isTikTokHandle` on the RAW URL segment (`@@bad` → strip one `@` → `@bad` → regex `^[\w.\-]{1,30}$` rejects the inner `@`) |
| `/tiktok/%40%40bad` (channel page) | **200** (renders a channel) | page normalizes first (`@@bad` → `@bad`), `isTikTokHandle` is sigil-optional so `@bad` passes, then `getTikTokChannelPage` normalizes AGAIN → renders the `bad` channel |
| `/api/tiktok/feed?creator=%40%40bad` | **200** scoped | feed route normalizes once (`@bad`), sigil-optional check passes, the matcher normalizes again → scope = `bad` |
| `/shorts?source=tiktok&creator=%40%40bad` (the UI) | **200** scoped — and the scope chip + honest-empty message display the RAW **`@@bad`** | server normalizes once (`@bad`) and passes it as the creator prop; the UI prepends its own `@` → the viewer sees `@@bad` while the feed actually scopes `@bad` |

**Root cause (one line):** `normalizeTikTokHandle` strips exactly ONE leading sigil — `raw.replace(/^@/, "").trim()` (src/lib/tiktok/urls.ts:164). Combined with `isTikTokHandle`'s own sigil-optional re-normalization, every rung applies the strip a different number of times, so the same raw input is simultaneously "invalid" (API), "valid @bad" (feed/shorts), and "the bad channel" (page) — and the UI leaks the un-normalized spelling.

**Also observed:** the chip's channel link for this input is `/tiktok/bad` (the href builder strips correctly) — so the trail is coherent once you CLICK; only the label lies, and only the channel-API rung calls it invalid.

### The closure plan (the lenient law)

Make `normalizeTikTokHandle` strip ALL leading sigils: `raw.replace(/^@+/, "").trim()`. Then:

- `@@bad` → `bad` at EVERY rung: the shorts UI displays `@bad`, the chip href stays `/tiktok/bad`, the feed API 200s the `bad` scope, the channel page AND channel API both 200 the `bad` channel — **one input, one identity, four rungs**.
- The channel API's documented 400 law ("a format-invalid handle answers 400") stays true for genuinely invalid strings (`bad handle!` keeps its pinned 400; `b@d` keeps failing the charset).
- This is the codebase's established input-tolerance posture (decodeURIComponent-first, trim, sigil-optional checks): a viewer who pastes `@@handle` means `@handle`.
- Pins: the normalize law (multi-@ collapse + idempotence + genuinely-invalid still false), the feed route's `@@bad` → `bad` scope, the shorts-page display showing `@bad` (never the raw spelling).

**Residual after closure:** none from this walk — the operator-gated set (TikTok for Developers app, `ZAI_API_KEY`) and the API-impossible family (writes / counts / hashtag / sound) are unchanged.

---

**Restoration note (P97-r2, trace `1a1b3f2ad49e50d9`):** this report and the whole P97 wave were first delivered on commit `223f913` — which the sixteenth window lost before any push could happen (no credentials). The seventeenth reset re-cloned at `79ac4d5` and the wave is re-applied verbatim from the ledger + context (the report, the urls fix, the three pins, the collateral tsc fix, this restoration note).
