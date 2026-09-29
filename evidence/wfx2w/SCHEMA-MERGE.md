# WFX2-W — Schema & Merge Notes (for the lead)

Lane: `wfx2/watch-vertical`, base: main @ 6b992aa (**docs-only seed — SELF-CONTAINED mode per BASE LAW**).
origin/main was re-checked before build: still `6b992aa` (no boot-shell code had landed).

## 1. Shared-file escalations (scaffold bits this lane had to author)

Because base main had no app code, this lane carries a minimal, z.ai-standard
scaffold so the gates (`bun install → db:push → db:seed → lint → tsc → test →
dev`) run standalone. **When the boot lane (wfx2/boot-shell) lands, prefer
its versions for these files** — the watch lane must survive either choice:

| File | Note for merge |
|---|---|
| `package.json`, `bun.lock` | Lean subset (next 16, prisma, radix, shadcn deps, zod, sonner, lucide). Scripts carry explicit `DATABASE_URL` so env drift can't redirect the DB. Boot's superset wins; keep the `db:seed` script pointing at `prisma/seed-watch.ts`. |
| `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`, `eslint.config.mjs` | Verbatim copies of the z.ai standard scaffold. Byte-identical to boot's expected copies → trivial merges. `tsconfig.json` adds `"types": ["bun-types"]` (needed for `bun:test` in tests/). |
| `src/app/layout.tsx` | **TEMP-INTEGRATION** minimal root layout (fonts + sonner Toaster) so `/watch` renders. Boot owns the production shell — replace wholesale, keep a `<Toaster />`. |
| `src/app/globals.css` | Verbatim standard shadcn/Tailwind-4 token file. |
| `src/components/ui/**` | Verbatim shadcn (New York) subset used by watch components. Boot's full set supersedes (identical sources). |
| `src/lib/db.ts`, `src/lib/utils.ts` | Standard singleton + cn(). Byte-compatible with boot's. |
| `.gitignore` | Standard. |

Everything else this lane adds is **watch-specific and disjoint**:
`src/app/watch/**`, watch-domain `src/app/api/**`, `src/components/watch/**`,
`src/lib/watch/**`, `prisma/**` (schema + seed), `tests/**`, `evidence/wfx2w/**`.

No root page `/` was built (boot lane's). The dev server 404s `/` — by design.

## 2. Prisma schema (watch domain) — union-merge guidance

Authored here; if boot lands a fuller schema, take the **union**. All models
are additive; no renames or deletes needed. Watch-domain models:
`Channel`, `User`, `Video`, `VideoLike`, `ViewEvent`, `Comment`, `CommentLike`,
`Subscription`, `Membership`, `TranscriptCue`, `Playlist`, `PlaylistItem`,
`VideoReport`, `VideoSignal`.

Lane-specific **additive** fields other lanes should keep:

- `Video.likes`, `Video.dislikes` (Int aggregates) — honest counts, toggled
  transactionally with `VideoLike` rows. Same denormalization pattern as
  `Comment.likes` vs `CommentLike`.
- `Channel.ownerUserId` (unique, nullable) — creator identity for comment
  heart/pin permissions + creator badges. If boot models channel ownership
  differently, map `ownerUserId` → boot's owner relation and keep
  `src/lib/watch/*` reading one owner id per channel.
- `ViewEvent @@unique([videoId, userId])` — one progress row per user+video;
  the `at` column is the **view-dedupe anchor** (1h window), never bumped by
  progress saves. Keep this invariant if you extend.
- `Comment.moderation` ("approved" | "flagged" | "deleted") — "deleted" is a
  soft state that powers the delete-undo toast; "flagged" hides from the
  default view (report flow). The studio/moderation lane (WFX2-U) should
  build its queue on these states.
- `Membership` (user↔channel) — minimal; WFX2-C extends with tiers/pricing.
- `Playlist`/`PlaylistItem` — minimal Save-dialog surface (Watch later +
  create + toggle); WFX2-A extends with full CRUD/reorder.
- `VideoReport`, `VideoSignal(kind: not_interested)` — report queue +
  personalization signals for later lanes.

## 3. VIDEO SOURCE SUBSTITUTION (honesty note)

The task spec's media host —
`https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/` — is now
**bucket-ACL-locked**: both `commondatastorage…` and `storage.googleapis…`
endpoints return `403 AccessDenied` for anonymous callers (verified with
plain GET + range GET; it is a bucket-wide permission change, not a sandbox
restriction). Seeding those URLs would ship a watch page whose player can
never play — violating the lane's own gates and the real-YouTube law.

The seed therefore uses **verified-playable public sources with real matching
content** (durations/titles/descriptions/chapters/transcripts all match the
actual media — checked with ffprobe + browser playback):

| Spec file (dead) | Seed source (plays) | Content |
|---|---|---|
| BigBuckBunny.mp4 | `https://media.w3.org/2010/05/bunny/movie.mp4` | **full film**, 596.48s (matches the spec'd duration exactly) |
| ElephantsDream.mp4 | `https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov` | **full film**, 658.3s (h264/aac in .mov — plays in Chromium; verified) |
| Sintel.mp4 | `https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4` | official trailer, 52.2s (retitled honestly; chapters/transcript re-written for the trailer; resume demo moved to 24s) |
| TearsOfSteel.mp4 | `Blender_reel_2013.mov` / `Cycles_Demoreel_2015.mov` (download.blender.org/demo/movies) | TOS is not publicly streamable anymore (only .zip archives on blender.org); replaced with the Blender 2013 showreel + Cycles 2015 reel, honestly titled |
| ForBigger*.mp4 (5) | `vjs.zencdn.net/v/oceans.mp4`, `mdn.github.io/shared-assets/videos/flower.mp4`, `test-videos.co.uk` 10s reference clips (BBB 720/1080, Sintel, Jellyfish) | channels `@wildfocus` (nature) and `@cliplab` (reference clips) — all durations/transcripts honest |

If a future mirror of the gtv bucket appears, `videoUrl` is pure data — swap
the rows and restore the original titles; nothing else changes.
Thumbnails remain `picsum.photos/seed/<slug>/640/360` (verified reachable).

## 4. API addenda (beyond the spec's listed surface)

- `POST /api/comments/[id]/pin` — creator pin toggle (tests cover the state
  machine; the UI uses it from the creator kebab).
- `POST /api/comments/[id]/restore` — undo for the delete toast (soft-delete
  then restore).
- `GET /api/watch/session` — establishes the demo identity cookie
  (`wfx2_uid`); identity resolution order: `x-wfx2-user` header → cookie →
  seeded `@demo` (user-aware API shape without auth complexity).
- `GET/POST /api/playlists`, `POST /api/playlists/[id]/items` — Save dialog
  backend (minimal, additive; WFX2-A extends).
- `POST /api/videos/[id]/report`, `POST /api/videos/[id]/not-interested` —
  kebab actions (report → review queue, video stays visible like youtube.com;
  not-interested hides from that viewer's related rail).

## 5. Verification

Gates (all green, see `gate-output.txt`): `bun run lint` 0 errors/0 warnings ·
`tsc --noEmit` clean · `bun run test` **59 pass / 0 fail** (209 assertions).
Dev server boot + full browser session on `/watch/<bbb-id>`: player plays the
real BBB stream, all keyboard shortcuts, progress auto-save + resume,
autoplay-next countdown + cancel + auto-navigation, like/dislike swap,
subscribe/bell state machine, share (?t=), save (watch later + create),
transcript (highlight/seek/search), comments (sort/threads/like/edit/delete/
report/creator-heart), related pagination, theater, speed menu, mobile
viewport — screenshots in this folder (`shot-01…shot-14`).
