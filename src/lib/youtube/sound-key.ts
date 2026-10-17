/**
 * WFX2-P23-C (G5) — the /sound/<key> URL codec (client-safe, no imports).
 *
 * The sound's identity this app carries is the audio-pivot browse
 * continuation token (the feed's own data — measured, see
 * evidence/wfx2p23c/DISCOVERY.md). The token contains literal '%3D'
 * sequences (protobuf base64), which makes URL handling the subtle part:
 *  - the LINK side encodeURIComponent's the RAW token (…%3D → …%253D);
 *  - NEXT 16 MEASURED (dev-server verified 2026-10-17): PAGE route params
 *    arrive UNDECODED (the link form), while API ROUTE handler params
 *    decode exactly once;
 *  - so the normalizer decodes AT MOST ONCE and only when the param carries
 *    the link's escaped-percent form ("%25…") — a raw token never contains
 *    it; both arrival shapes resolve to the raw token.
 *
 * Pure functions only (no server imports) — shared by the client rail/page
 * and re-exported by the server-side sound.ts.
 */

/** The /sound/<key> link for a sound token (the disc's href). */
export function soundTokenToKeyLink(token: string): string {
  return `/sound/${encodeURIComponent(token)}`;
}

/** Collapse either arrival shape (link form / raw token) back to the token. */
export function normalizeSoundKeyParam(key: string): string {
  if (key.includes("%25")) {
    try {
      return decodeURIComponent(key);
    } catch {
      return key;
    }
  }
  return key;
}
