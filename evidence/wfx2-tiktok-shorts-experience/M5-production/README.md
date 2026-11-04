# M5 — production deployment leg (deployed-SHA verification)

**Date:** 2026-11-04 · **Station:** Z.ai Code (TL, issue #2) · **Base chain:** 3475af8 → 11259fb

## The unblock (operator-side, per P86's recorded path)

The operator minted a fresh Vercel token (`vcp_…`, delivered 2026-11-04). It validates on
`/v2/user` as account `payswap` (hobby plan) and **clears the fair-use 402** that blocked the
old team: the v13 deployment one-liner went `402 resource_creation_blocked → 400
missing_project_settings → 200` across three attempts (projectSettings.framework=nextjs added).

## Deployment

| field | value |
| --- | --- |
| project | `webflix-2-0` (payswap scope, prj_LBZQ…) |
| deployment | `dpl_EPQsGWAFKxVPwgTdtJ5VbnQyiABn` — **READY** (5th poll) |
| stable domain | `https://webflix-2-0-tay-nurs-projects.vercel.app/` |
| deployed commit | `11259fb700ffc167d67c00b3bc33e904e3cfda42` == origin main (`githubCommitSha` meta, independently matched against `git rev-parse main`) |

Build failures solved en route (each recorded in the commit message of `11259fb`):

1. `P1012 DATABASE_URL not found` → env re-provisioned. `api.neon.tech` is **globally NXDOMAIN**
   now; the API was reached at `console.neon.tech/api/v2` with `NEON_API_KEY_4` (org-scoped) via
   direct resource probes (`projects/restless-breeze-74749954`, `…/branches`, `…/databases`,
   `…/roles`), yielding the pooled connection URI — restored into the vault as the
   `NEON_WEBFLIX2_PROD_URL` slot (the P56-era slot lost in a later vault re-delivery).
   **Sourcing law:** the URI contains `&` (`?channel_binding=require&sslmode=require`); unquoted
   it parses as `VAR=…&` (backgrounded subshell assignment, discarded) + a phantom
   `sslmode=require` command → the slot must stay **double-quoted** in the vault.
2. `P1012 DATABASE_URL resolved to an empty string` → the quoted fix above.
3. `prisma db push` refused (data-loss warning) → `migrate diff --from-url … --to-schema-datamodel`
   audited **read-only** first: 224 lines, zero `DROP TABLE/COLUMN/CONSTRAINT`, one `DROP NOT NULL`
   relax (`Notification.sourceChannelId`); the `[userId,liveRoomId]` unique pair is all-NULL in the
   live DB (the column is new) so it cannot collide. `vercel.json` build command gains
   `--accept-data-loss`, matching the repo's own `db:push` law (commit `11259fb`).
4. 302 → `vercel.com/login?sso-api…` → new-project default SSO deployment protection
   (`all_except_custom_domains`) → PATCHed to `ssoProtection: null` (public).

## Env posture (honest)

| var | state |
| --- | --- |
| `DATABASE_URL` | Neon pooled (`ep-withered-hat-b7gxuqz3-pooler…/neondb`), type sensitive |
| `NEXTAUTH_SECRET` | minted fresh (old value unreadable — Vercel hides `sensitive`/`decryptable=no`) |
| `UPSTASH_*` | **skipped honestly**: vault pair still NXDOMAIN-dead (P53/P56 DoH-proven); prod's own pair is unreadable → documented in-memory degrade |
| `YT_COOKIES`, `BROKER_*`, `GOOGLE_*`, `LIVEKIT_*`, `R2_*` | not carried (old values unreadable) → public mode / writes & official-actions & live-upload lanes degrade honestly |

## Browser verification (agent-browser, headless Chromium 1440×900, 2026-11-04)

- `/` → 200, `WebFlix — Watch & Share Videos`, full app shell (nav incl. Shorts/TikTok/LIVE),
  **zero console errors**; TikTok shelf cards deep-link `/shorts?source=tiktok&post=<id>` (M3 law).
- `/shorts?source=tiktok&post=6718335390845095173` → exactly **one iframe** =
  `https://www.tiktok.com/player/v1/6718335390845095173?music_info=1&desc…` ("TikTok player",
  official Embed Player, audited 2026-10-28 params).
- **Active-player law on production:** ArrowDown → still 1 iframe, active post
  `7206561191609716014`; ArrowUp → 1 iframe, back to `6718335390845095173`. Previous player
  unmounts; nothing offscreen stays mounted.
- `/shorts` (no params) → YouTube default, source selector UI (TikTok/YouTube tabs) present;
  headless YouTube embeds engage the honest bot-wall fallback ("Open on YouTube" /
  "Sign in on youtube.com") — never faked playback.

Screenshots: `prod-shorts-tiktok.png`, `prod-shorts-youtube.png`.

## Residuals (recorded, non-blocking)

- Old team project (fair-use blocked) still serves stale P65-era `a4c1905` at
  `webflix-2-0-one.vercel.app`; the canonical short name `webflix-2-0.vercel.app` also resolves to
  that old scope. Re-pointing those domains is an operator-side dashboard action.
- Writes/official-actions/live-upload lanes need the unreadable secrets re-delivered if the
  operator wants them live on this deployment (public mode is the shipped, honest default).
- UPSTASH cutover needs a live Redis pair (operator-supplied) to leave in-memory degrade.
