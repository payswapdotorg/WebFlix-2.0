# ADR 0011 — WebFlix LIVE supporter emotes (non-monetary club identity)

Status: Accepted · Date: 2026-10-31 · Deciders: TL (issue #2)
Extends: ADR-0010 (live fan clubs — the non-monetary law) ·
Scope: WFX2-LIVE-PLATFORM-1 §4G "supporter emotes where built" — the last
ungated wave under issue #2.

## 1. Context

The work order's §G fan-club bullet ends with "supporter emotes where
built" — the ONE scope phrase of WFX2-LIVE-PLATFORM-1 still unbuilt after
Phase 5 (P66) landed clubs/points/missions/badges/members-only surfaces.
TikTok-style supporter emotes are creator-defined custom emoji a supporter
may use in that creator's live chat. The money gate (ADR-0010 §2) stays
CLOSED, so these emotes must carry zero cash semantics.

## 2. The non-monetary law (extends ADR-0010 verbatim)

An emote is an ENTERTAINMENT/IDENTITY fact: never money, never a wallet
item, never purchasable, never convertible, never transferable, no
purchase path anywhere in its surface. Nothing in the emote domain reads
or writes a balance. The dev-credit/gift sandbox and any future money
lane are untouched by this ADR.

## 3. The entitlement law (server-authoritative, fail-closed)

- Emotes belong to the room HOST'S club (`LiveFanClub` unique hostId →
  `LiveClubEmote` unique (clubId, code)).
- Entitlement is re-derived per request from durable rows — clients claim
  nothing:
  - the room host is entitled to every emote of their own club;
  - a club member is entitled to an emote iff their derived member level
    (ADR-0010 §4 formula) ≥ the emote's `requiredLevel`;
  - everyone else — anonymous viewers, signed-out, non-member viewers,
    and moderators WITHOUT club membership — is entitled to nothing.
    (A moderator capability is a moderation fact, not a club-identity
    fact; the emote mark stays with the club.)
- Chat send validation (the intake law): in `sendChat`, after the
  existing gates, every `:code:` token in the body that MATCHES an emote
  code of the host's club must be entitled, else `403 emote-locked`. A
  token that matches NO emote code is ordinary punctuation (scores
  "2:1", times "10:30", ":)") — it stays literal text and never errors.
  A body with no `:` runs the zero-query fast path.
- Entitlement is stamped server-side onto the GET map (`entitled`) so the
  picker renders honest locks; the STAMP IS NEVER AUTHORITY — the send
  path re-derives.

## 4. The storage + render law

- Chat bodies store short-codes AS SENT (`:code:`). No new columns on
  `LiveRoomMessage`; tombstones/moderation/idempotency laws are untouched.
- Substitution happens ONLY in the frozen pure module
  `src/lib/live/emote-render.ts`, ONLY for exact matches against the
  server-provided map. The client never invents a glyph; every rendered
  unicode comes from the server map byte-for-byte. No HTML is ever
  parsed — React text nodes only.
- Emotes are CONFIGURATION, not history: deleting an emote never
  rewrites past messages; their codes render as plain text (honest
  history). Re-creating the same code re-renders old messages (the map
  is current-truth) — accepted, documented.

## 5. The operational law

- `LiveClubEmote` is host-managed configuration: upsert by code (unique
  (clubId, code)), delete, cap `EMOTES_PER_CLUB_MAX = 20`, code slug
  `[a-z0-9_-]{1,24}`, unicode clamp 16 chars, `requiredLevel` clamps to
  `CLUB_LEVEL_MAX`. Host CRUD is rate-limited (`RATE_LIMITS.emoteSave`);
  emote USAGE rides the existing chat limiter — an emote send IS a chat
  send and re-enters every chat gate (banned/muted/slow-mode/members).
- Reads are anonymous-friendly (`GET /api/live-clubs/emotes?hostId=`,
  `entitled:false` when signed out) — the picker shows honest locks, the
  same way the club overview shows non-member state.
- No ops telemetry kind is added (the five client beacons stay frozen);
  emote sends are chat sends and are already covered by the chat paths.

## 6. Consequences

- Positive: the last ungated scope phrase of issue #2 lands without any
  money surface, any new message column, or any new transport kind.
- Negative: emote glyphs render from one server map fetched per room
  mount (one small GET — acceptable; the club overview already rides the
  same pattern). Codes are case-folded at intake (lowercase slug) —
  mixed-case input is rejected, not silently folded.
- Revisit triggers: paid/subscriber emote tiers arrive ONLY with the
  money gate (a separate ADR); per-message emote sizing/animation is a
  render-layer concern that must keep this module pure.
