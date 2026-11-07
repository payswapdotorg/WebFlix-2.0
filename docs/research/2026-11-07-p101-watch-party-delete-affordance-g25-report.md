# P101 — the fresh walk of the P100 build: the watch-party chat's missing delete affordance (G25)

Date: 2026-11-07
Walk mandate: the standing `go` law — every window walks the current build and records what it finds. This window's walk ran the PROD interact battery that the P100-DEPLOY-VERIFY walk had only partially covered (guest 401 yes, signed-in send no) and then hunted the next gap.
Status: REPORT FIRST — the walk's findings, then the TDD closure of the one real gap, same wave (the implementable set).
Gap ledger: **G25** — the watch-party chat's tombstone law was HALF-wired: the route (`DELETE /api/tiktok/live/chat/[room]?messageId=`), the lib (`deleteOwnTikTokLiveChatMessage`, idempotent, owner-only), the tests (lib + route pins), and the renderer (`m.deleted → "message removed"`) all existed — but the UI exposed NO delete control. A signed-in user could send a message they could never remove. The affordance half was missing.

---

## 1. The walk (every claim measured this session)

| # | Probe | Result | Verdict |
|---|---|---|---|
| W1 | Post-reset state audit | the sandbox was rebuilt (the wrapper lost its history); the real repo `/home/z/webflix-2.0` survived clean at `0bea232`, synced with `origin/main` | the P94→P100 chain + the ledger survived; the dev DB seed did not (re-seeded; `/api/me` 500 → 200) |
| W2 | Prod gates re-run from scratch | tsc 0; eslint 0/0; TikTok battery 244/0 (incl. all six P100 suites) | the reset changed nothing in the tree |
| W3 | Prod read lane re-probe | `/api/tiktok/live?handle=lofigirl` → 200 real live data (`live:true`, "christmas lofi radio 🎄", 297→340 viewers, `source:"apify"`); `handle=b@d` → 400 | the P100 lane holds on prod without anyone touching it |
| W4 | Prod offline walk (`/tiktok/scout2015/live`) | "@scout2015 is not live right now" + the checked-just-now copy + outbound "Open on TikTok" + "Back to the channel" | the honest offline is an answer, not an error — verified on prod, not just dev |
| W5 | Prod account + sign-in | `p101walk@example.com` registered through the real `/api/auth/register` → 201; signed in through the real `/signin` form | the walk pattern from P98/P99, repeated |
| W6 | Prod signed-in send | composer → Send → the durable row landed (`P101 Walker / "P101 signed-in walk — hello from the watch party"` via the prod chat API), rendered in the panel, and the cursor polls rode `?after=<the row's id>` | **the interact write path is now live-verified signed-in on PROD** (P100 had only the guest 401) |
| W7 | Delete hunt on prod | the panel offered NO delete affordance — no control in the DOM, none in the component source | **G25** |
| W8 | The id-space audit (while closing G25) | `ensureShadowUser` derives `wf-<sessionUserId>` (the prod DTO's `sender.id: "wf-9ca69f0a…"`), while the client session carries the raw User id — a naive `m.sender.id === session.user.id` check would NEVER match on prod | the closure derives the SAME shadow id on both sides (§3); the fixtures use the real id-space so the pins catch this class |

The honest probing window was observed again during the walk (a LIVE panel flipping to "Checking whether…" when the 30s cache expired mid-visit, then back) — the documented cost law, not a defect.

## 2. The gap, precisely

- The tombstone law says: a deleted message's row stays and renders "message removed" — tombstones, never deletions.
- Server side, complete: `DELETE /api/tiktok/live/chat/[room]?messageId=` → session-required, room-keyed (G20), owner-only (strangers → 404, no existence leak), idempotent re-tombstone, `{deleted:true}`.
- Renderer side, complete: `m.deleted` renders the italic "message removed" row.
- UI side, MISSING: no control anywhere calls DELETE. The affordance could not exist.
- Adjacent drift found and fixed in passing: the lib docstring claimed "the route maps that to 403"; the route actually maps `!done` → 404. Comment corrected to the route's real contract.

## 3. The closure (TDD, RED-first)

**The pins landed RED** (3 fail / 11 pass), then greened:

1. `P101/G25 — an own row carries the delete affordance; a stranger's row carries none` — exactly one `[data-testid="tiktok-live-chat-delete"]`, `data-message-id` = the own row, `aria-label="Delete message"`; the stranger's row carries none.
2. `P101/G25 — clicking delete rides the route contract and renders the tombstone, not a hole` — the click fires `DELETE /api/tiktok/live/chat/lofigirl?messageId=m-own`; the row renders "message removed"; the body text leaves. The fixture is STATEFUL (`deleted: deletedChats.length > 0`) — it models the durable row's truth after the DELETE, because the 4s poll re-answers server truth and must CONFIRM the tombstone, not undo it.
3. `P101/G25 — a failed delete keeps the row and surfaces the honest error` — DELETE 500 → the row survives, `[role=alert]` shows the panel's own copy ("The message could not be removed."), no fake tombstone.

**The implementation** (`src/components/tiktok/tiktok-live-chat.tsx`):
- Own non-deleted rows render an inline ghost icon button (Trash2, 3.5), `aria-label="Delete message"`, riding the existing route contract verbatim.
- `removeMessage`: DELETE → 200 ⇒ local tombstone (the next poll reconciles); non-ok / network ⇒ the honest alert, row intact.
- The optimistic echo's sender id now carries the shadow id too, so a just-sent own message is immediately deletable.
- **The identity seam** (`src/lib/watch/identity.ts`): `shadowUserId` extracted to a client-safe module (a pure function, no db import) and re-exported from `local-comments.ts` for every existing importer. Importing from `local-comments` in a client component would have dragged Prisma into the client bundle — the same import-law class P100's first pass hit. Client and server now derive the SAME `wf-<id>` from the SAME session id.

## 4. Gates

- tsc 0; eslint 0/0.
- FULL battery **3067 pass / 0 fail, exit 0** (3064 → 3067: the three G25 pins; every existing pin held — no route/lib behavior changed).

## 5. Residual (documented, not papered over)

- The delete control is inline-icon-only (hover-visible via color); a confirm dialog could be added if mis-clicks ever show up in evidence — none today (deletes are idempotent and self-owned only).
- TikTok chat READ (Euler key), native HLS (stream URL), webcast refresh (room_id), mass discovery (E6) — unchanged, operator-gated per P100 §6/§7.
- Money gate stays CLOSED (nothing money-shaped touched).
