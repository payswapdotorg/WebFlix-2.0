# WebFlix Creator Studio (apps/studio)

Standalone Creator Studio for **WebFlix** — studio.youtube.com parity, deployed as its
own Vercel project (`studio-webflix`). A self-contained Next.js 16 app: its own
`package.json` / `tsconfig.json` / Tailwind / eslint / test setup. It holds **no data
source of its own**: every surface reads the MAIN app's APIs and degrades honestly when
upstream is unavailable.

## Purpose

Surfaces: exact studio shell (10-item left nav, channel picker, Create deep-links to the
main app, bell, sign-out), Dashboard, Content (Videos/Shorts/Live/Posts tabs), Analytics
(Overview/Content/Audience), Community moderation, Customization, plus honest-empty
Subtitles / Copyright / Earn / Audio Library / Settings.

## Environment

| var | meaning |
|---|---|
| `MAIN_APP_URL` | base URL of the main WebFlix app (e.g. `https://webflix-2-0-one.vercel.app`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | shared Upstash cache (in-memory mirror/fallback in dev + tests) |
| `STUDIO_AUTH_SECRET` | JWT signing secret for the studio session cookie |

No secrets live in this repo — values come from the Vercel project env.

## Consumed endpoints (main app)

- `GET {MAIN_APP_URL}/api/studio` — operator channel
- `GET {MAIN_APP_URL}/api/channel/<handle>/videos` — content table
- `GET {MAIN_APP_URL}/api/channel/<handle>/posts` (fallback `?tab=posts`) — community posts
- `GET {MAIN_APP_URL}/api/comments?videoId=` — comment moderation list
- broker `POST {MAIN_APP_URL}/api/comments/{id}/{approve|delete|heart}` — moderation actions
- `POST {MAIN_APP_URL}/api/channel/<handle>` — customization save

## Auth contract

Shared with the main app's auth system: Upstash key `wf:auth:user:<email>` holding
`{ id, email, displayName, passwordHash }` with
`passwordHash = scrypt$<saltHex>$<hashHex>`.

## Honest-degrade map

- download, delete, comment actions, customization save → honest 502 when the broker is offline
- community posts → honest-empty while that lane is unavailable upstream
- Earn / YPP revenue, Subtitles, Copyright, Audio Library → honest-empty surfaces
- any upstream parse failure → `degraded` response type, never synthetic data

## Analytics honesty

- series = real per-video counts bucketed by publish date
- "Est. watch time (views × duration)" is a real derived metric, labeled as an estimate
- never synthetic, never back-filled

## Commands

```bash
bun install
bun run dev        # next dev --port 3100
bun run lint       # eslint .
bun run typecheck  # tsc --noEmit
bun test           # 25 test blocks (fixtures-only, happy-dom)
```
