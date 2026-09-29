/**
 * WFX2-A-B session provider — the operator's youtube.com cookie jar.
 *
 * `YT_COOKIES` (raw `k=v; k=v; …` string) is the ONLY source; it is never
 * committed (`.env` is gitignored — see `.env.example`). Without it every
 * surface runs in public mode (search / next / channel / comments still work;
 * personalized feeds degrade gracefully).
 */

const COOKIE_ENV = "YT_COOKIES";

/** Raw Cookie header value from `YT_COOKIES`, or null in public mode. */
export function getCookieHeader(): string | null {
  const raw = process.env[COOKIE_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // strip newlines — a header must be a single line
  const clean = trimmed.replace(/[\r\n]+/g, "; ").replace(/;\s*;+/g, "; ").replace(/;\s*$/, "");
  return clean || null;
}

/** True when a YouTube session is configured (personalized surfaces active). */
export function hasSession(): boolean {
  return getCookieHeader() !== null;
}
