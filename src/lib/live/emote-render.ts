/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes — the frozen render law (ADR-0011 §4).
 *
 * Chat bodies store emote short-codes AS SENT (`:code:`). Substitution
 * happens ONLY here, ONLY for exact matches against the server-provided
 * emote map — never regex→HTML, never arbitrary parsing:
 *   - a token `:code:` matching a map entry renders the map's unicode glyph;
 *   - anything else (unknown codes, literal colons, scores like 2:1, times
 *     10:30, improvised ":)") stays plain text — the honest history;
 *   - a DELETED emote's code in an old message stays plain text (emotes are
 *     configuration, never history — deleting one never rewrites the past).
 *
 * Zero-import pure module so the chat panel, the tests and any future
 * surface share ONE substitution law. The client never invents a glyph:
 * every rendered unicode comes from the server map byte-for-byte.
 */

export interface EmoteGlyph {
  code: string;
  unicode: string;
}

export interface EmoteSegment {
  kind: "text" | "emote";
  /** The text slice, or the glyph's unicode for emote segments. */
  value: string;
  /** The matched short-code (emote segments only) — for title/aria labels. */
  code?: string;
}

/**
 * The token pattern — a lowercase slug inside single colons. MUST stay in
 * sync with the server intake law (src/lib/live/emotes.ts EMOTE_CODE_RE):
 * the server validates exactly what this pattern can match, so a body that
 * passed sendChat can never surprise this renderer.
 */
const EMOTE_TOKEN_RE = /:([a-z0-9_-]{1,24}):/g;

/** Split a chat body into text/emote segments against the room's emote map. */
export function renderEmoteSegments(
  body: string,
  emotes: readonly EmoteGlyph[],
): EmoteSegment[] {
  if (!body) return [];
  const map = new Map(emotes.map((e) => [e.code, e.unicode]));
  const segments: EmoteSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(EMOTE_TOKEN_RE)) {
    const code = m[1];
    const unicode = map.get(code);
    if (unicode === undefined) continue; // unknown/retired code stays literal
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: "text", value: body.slice(last, start) });
    segments.push({ kind: "emote", value: unicode, code });
    last = start + m[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", value: body.slice(last) });
  return segments.length > 0 ? segments : [{ kind: "text", value: body }];
}
