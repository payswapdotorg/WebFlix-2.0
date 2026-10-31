# WFX2-LIVE-PLATFORM-1 — Phase 5-emotes frozen contracts: supporter emotes (§4G)

Frozen by the TL before the lanes dispatch (work order §7). Base SHA:
`27c73a4` (origin/main, Phase 5 fan clubs). ADR-0011 is the law document;
this file is the lane-dispatch contract. The money gate (ADR-0010 §2)
stays CLOSED — an emote is never purchased, never a wallet item.

## 1. Frozen schema (both prisma variants; parity guard green)

`LiveClubEmote` — id cuid · clubId · code · unicode · requiredLevel Int
default 1 · createdAt/updatedAt · relation `club LiveFanClub` (Cascade) ·
`@@unique([clubId, code])` · `@@index([clubId])`. `LiveFanClub` gains the
`emotes LiveClubEmote[]` back-reference. Both `prisma/schema.prisma` and
`prisma/schema.postgres.prisma` carry the model byte-identically.

`LiveRoomMessage` is UNTOUCHED — bodies store `:code:` tokens as sent
(ADR-0011 §4; no migration on the message plane).

## 2. Frozen numeric laws (`src/lib/live/permissions.ts`)

- `EMOTE_CODE_MAX = 24` — code charset `[a-z0-9_-]`, lowercase enforced
  (mixed-case input is REJECTED, not folded).
- `EMOTE_UNICODE_MAX = 16` — the glyph clamp.
- `EMOTES_PER_CLUB_MAX = 20` — the set cap (409 `emote-set-full` on
  overflow).
- `EMOTE_REQUIRED_LEVEL_MAX = CLUB_LEVEL_MAX` — requiredLevel clamps.
- `RATE_LIMITS.emoteSave = { 20, 60s }` — host CRUD only; usage rides
  `RATE_LIMITS.chat` (an emote send IS a chat send).

## 3. Frozen entitlement law (ADR-0011 §3)

- host → all entitled; member → `derivedLevel >= requiredLevel`;
  everyone else (anonymous / non-member viewer / non-member moderator) →
  nothing. Derived per request from durable rows; never client-claimed.
- Chat intake (in `sendChat`, after the members-only gate): tokens
  matching the host club's emote codes must be entitled else
  `LiveDomainError("forbidden", "emote-locked")`; tokens matching NO
  emote code stay literal punctuation (no error); no `:` in the body →
  zero-query fast path.
- The GET map stamps `entitled` for the CALLER — a display hint, never
  authority (the send path re-derives).

## 4. Frozen render law (`src/lib/live/emote-render.ts` — zero-import)

`renderEmoteSegments(body, emotes)` splits a body into
text/emote segments; only exact `:code:` matches against the
server-provided map render a glyph; unknown/retired codes and all other
colons stay plain text. The token regex
`/([a-z0-9_-]{1,24}):/` INSIDE single colons must stay in sync with the
server intake — the server validates exactly what this can match.
UI renders segments as React text nodes — never HTML.

## 5. Frozen routes (`/api/live-clubs/emotes`; DTOs in `types.ts` §Phase 5-emotes)

- `GET  /api/live-clubs/emotes?hostId=` → 200
  `LiveClubEmotesDto` (anonymous OK; `clubName: null` + empty list when
  the host has no club; two-plane host param resolution EXACTLY like
  `clubForHost` — the row's durable id wins).
- `POST /api/live-clubs/emotes` `{ code, unicode, requiredLevel? }` →
  201 create / 200 update (upsert by code), host-only (the caller's OWN
  club — a creator without a club → 404 `no-club`), clamps + slug law +
  set cap, rate-limited `emoteSave`.
- `DELETE /api/live-clubs/emotes?code=` → 200 `{ ok: true }`, host-only,
  idempotent (absent code → still 200).
- Error contract: `LiveDomainError` → `liveErrorStatus` (the shared law);
  anonymous writes → 401; validation → 400/422 by kind.

## 6. The three disjoint lanes (dispatch on this frozen base; additive-only)

- **E-a domain + routes**: NEW `src/lib/live/emotes.ts` + NEW
  `src/app/api/live-clubs/emotes/route.ts` + NEW
  `tests/live-emotes.test.ts` (lane db `db/live-emotes-test.db`).
  Pins: the slug/clamp laws, the set cap, host-only gates (404 no-club,
  401 anonymous), the two-plane resolution, the upsert idempotency, the
  delete idempotency, the entitlement stamp matrix (host all-true /
  member by level / anonymous all-false / non-member all-false).
- **E-b chat integration**: `src/lib/live/chat.ts` (the intake hook +
  `validateEmoteUsage` export) + NEW `tests/live-emotes-chat.test.ts`
  (lane db shared with E-a is FORBIDDEN — its own
  `db/live-emotes-chat-test.db`). Pins: entitled emote send passes;
  locked emote → 403 `emote-locked`; unknown-code literal passes with
  the body stored as sent; no-colon fast path (spy: zero extra club
  queries); scores/times bodies untouched; banned/muted rejections still
  precede the emote gate; tombstoned emote messages unchanged.
- **E-c UI**: `src/components/live/live-chat-panel.tsx` (picker +
  segment rendering + the `hostId` prop) + `src/app/studio/live/view.tsx`
  (the ClubManagerCard emote manager + pass `hostId`) + the room view
  call site + NEW `tests/live-ui-emotes.test.tsx` (lane db
  `db/live-emotes-ui-test.db`). Pins: the picker renders entitled glyphs
  clickable and locked ones disabled with the level lock; picked code
  appends `:code:`; message bodies render segments from the frozen
  module; no emote map → bodies render plain; the manager saves and
  deletes through the routes with honest error toasts.

Lanes share NO files. `emote-render.ts` is frozen (TL) and consumed by
E-b (pins) and E-c (render). `permissions.ts` / `types.ts` are TL-owned
and read-only for the lanes. Gate law per lane: `tsc 0` repo-wide,
lane-db tests green, `eslint 0` on every touched file.

## 7. Acceptance contract (TL, after integration)

Three real browser contexts (the P66 pattern): the host defines ≥2
emotes with different `requiredLevel` in the studio manager; a club
member (level 1) sends the level-1 emote in a live room chat and the
glyph renders on BOTH browsers; the member's API attempt at the
higher-level emote → 403 `emote-locked`; a non-member sees the picker
fully locked. DB-verified durable facts + screenshots +
`acceptance-facts.json` under
`evidence/wfx2-live-platform-1-phase-5-emotes/`.
