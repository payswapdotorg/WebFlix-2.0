# P95 — the remaining gaps: re-walk evidence, closure plan, and the open set

Date: 2026-11-05 · Follows the P94 report (`2026-11-04-tiktok-main-interface-gap-report.md`), whose
§6 left a "P95+ open set" after closing every P0 (G1–G5, G12, G13, partial G6). This report
re-walked the live production build (`https://webflix-2-0-tepa.vercel.app`, the P94 deployment) as a
guest with the browser agent, resolved every remaining matrix row against **live evidence**, and
plans the closures that survive.

---

## 1. The re-walk verdicts (P94-build production, guest, agent-browser)

| Row | P94 report said | Live re-walk (this report) | Verdict |
| --- | --- | --- | --- |
| G8 | "'Ask AI about this video' is a dead button for guests" | The button opens the Ask panel; a suggested question submits; the thread answers the honest note *"AI answers aren't available on this deployment."* The affordance is not dead — the **deployment lacks the LLM key** (`ZAI_API_KEY` was never provisioned on the Vercel project; P93 set only `DATABASE_URL` + `NEXTAUTH_SECRET`), so every ask — guest *and* signed-in — degrades honestly. | **Re-scope**: the gap is a deployment env rung, not a guest path |
| G9 | "Notifications button is inert for guests" | Clicking the bell opens the dropdown with the youtube.com-style signed-out screen ("Don't miss new videos" + Sign in) — the guest popover the row claimed missing has shipped since P2-AU. | **Closed** (evidence: the walk's finding does not reproduce on the P94 build) |
| G10 | "Placeholder descriptions on watch pages" | Watch pages hydrate descriptions from the live `next` metadata (dQw4w9WgXcQ and aqz-KE-bpKQ both render full real descriptions). The gap survives only as the **empty-description row**: locally-mirrored catalog rows (`/api/videos` rows with `description: ""`) render a visually-empty description box whenever their live metadata read fails — a broken-looking empty box. | **Narrow**: close with an honest "No description" line |
| G14 | "Channel identity mismatch on one YouTube channel" | The demo/seed universe attributes the Blender open movies to `@pixel-studios` — a handle that resolves to a **real, unrelated YouTube channel** (a GTA FiveM map channel: 41 subscribers, 5 map videos, joined 2023). A viewer on a seeded video follows the channel link into a stranger's live channel: name matches, everything else contradicts. The same collision exists for `@gamevault`, `@wanderlust-travel`, `@sound-forge`, `@codecraft` (all plausible real handles). | **Confirmed + root-caused**: seed handles collide with live handles |
| G15 | "No home hero / first-viewport feed" | The home first viewport IS the youtube.com-parity layout — topbar, category chips, the video grid, and the Shorts shelf header (screenshot: `evidence/p95/home-1280-viewport.png`). youtube.com itself has no home hero; WebFlix's feed lives one click away at `/shorts`. A hero would fight the app's own parity doctrine. | **Closed by decision** (parity law), documented |
| G16 | "'Remix' permanently disabled without a reason surfaced" | Clicking the actual Remix **button** fires the honest toast: *"Shorts creation is not available in WebFlix — YouTube's Shorts editor (incl. the 2026 AI editing family) is studio/app-side."* (The toast has shipped since the g14 wave.) The walk's no-reason finding was a click-target artifact: the visible "Remix" label text sits **outside** the button, and clicking it does nothing. | **Closed** (toast verified live); the label-not-clickable nuance noted below |

## 2. The closure plan (P95 work)

### P95-a — G8: make the honest-disabled state actionable (code, small)
The Ask panel's disabled note and placeholder name the *fact* but not the *path*. Upgrade both to
carry the enable path — the same honest-degrade doctrine as the connection cards' not-configured
envelopes (which print the exact missing env):
- disabled note → "AI answers aren't available on this deployment — they turn on when the operator
  sets the `ZAI_API_KEY` environment variable (see `.env.example`)."
- disabled placeholder → "AI answers aren't available"
No fake capability is added; the rung itself (provisioning a real key) stays the operator's errand —
no Z.ai/OpenRouter credential exists in the delivered batch, and the vault's OpenRouter slot is
empty.

### P95-b — G10: the honest empty-description line (code, small)
`DescriptionBox` renders a visually-empty box when `description` is blank (the mirrored-catalog
case). Render an honest muted "No description" line instead — never invented copy — in both the
collapsed and expanded states.

### P95-c — G14: de-collide the demo universe (code, two parts)
1. **Seed hygiene**: the five seeded channel handles gain a `-wf` suffix (`@pixel-studios-wf`,
   `@gamevault-wf`, `@wanderlust-travel-wf`, `@sound-forge-wf`, `@codecraft-wf`) — handles no real
   YouTube channel is likely to carry — so local attribution can never land on a stranger's live
   channel again. Test pins follow (`tests/personal-routes.test.ts` owns the only two).
2. **The local-universe channel page**: `GET /api/channel/[handle]` is live-first today, and the
   re-walk MEASURED the hazard: the live ladder's search-compose rung resolves almost any
   handle-ish string to a real-but-unrelated channel (`@pixel-studios-wf` once composed the
   unrelated "Pixel Studio" `@pixel-studio-app`, 12.3K subs). So the law is **local-first when a
   local Channel row owns the handle**: the demo universe's channels render their own rows through
   the existing DTOs (`toChannelLite` + `toVideoDTO`) — banner/description/createdAt from the row,
   real video rows, `joinable: false`, additive `local: true` — and the 1,419-line client page
   renders them unchanged. The `-wf` suffix guarantees a local row can never shadow a real channel
   a viewer might want live; every other handle rides the live ladder exactly as before.

### P95-d — documented verdicts (no code)
G9, G15, G16 carry the §1 evidence into the matrix below and into the WORKLOG; the P94 report's
open set shrinks to: the operator-gated TikTok for Developers app, the operator-gated LLM key, and
the API-impossible writes/counts/hashtag/sound set (unchanged by this wave).

## 3. The residual open set (after P95)

| Item | Gate | Path |
| --- | --- | --- |
| Real TikTok OAuth connections + avatars/stats + M4 import enrichment | TikTok for Developers approval (operator) | WebFlix code ready since P94-b; the card lights up with zero code change |
| Working AI surfaces in production | `ZAI_API_KEY` provisioning (operator) | Documented in `.env.example` + the P95-a note |
| TikTok write-sync, counts, hashtag/sound pages, FYP | No public API; scraping forbidden (ADR 0002/0004) | Stays outbound hand-offs by law |
| Remix label text is not itself a click target | Cosmetic (the button is) | Noted, no action — youtube.com's rail labels behave the same way |

## 4. The honesty ledger (unchanged)

No fabricated descriptions, no invented channel identities, no fake AI capability, no scraped
backfill. Every closure renders a real row, a real page, or a labeled absence.

*Evidence: the §1 re-walk ran guest-side against `https://webflix-2-0-tepa.vercel.app` (P94 build)
on 2026-11-05 with agent-browser; screenshots under `evidence/p95/`.*
