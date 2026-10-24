/**
 * WebFlix Bridge — pure decision logic.
 *
 * Kept chrome-free and dependency-free so the repo's hermetic battery can pin
 * the push semantics directly (tests/netflix-autoauth.test.ts imports this file).
 */

/** Netflix only truly needs these two; a standalone NetflixId is the floor. */
export function hasAuthCookies(cookies) {
  return cookies.some((c) => c.name === "NetflixId");
}

/** djb2-style signature over the two auth cookies — pushes only real rotations. */
export function cookieSignature(cookies) {
  const auth = cookies
    .filter((c) => c.name === "NetflixId" || c.name === "SecureNetflixId")
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  if (!auth.some((c) => c.name === "NetflixId")) return null;
  let h1 = 0x811c9dc5;
  for (const c of auth) {
    const pair = `${c.name}=${c.value}`;
    for (let i = 0; i < pair.length; i++) {
      h1 ^= pair.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
  }
  return h1.toString(16);
}

/** chrome.cookies.getAll output → the broker's NetflixCookie shape. */
export function toBridgeCookies(chromeCookies) {
  return (chromeCookies || [])
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || ".netflix.com",
      path: c.path || "/",
      expires: typeof c.expirationDate === "number" ? c.expirationDate : undefined,
      httpOnly: c.httpOnly ?? true,
      secure: c.secure ?? true,
    }));
}

/**
 * The push decision — mirrors mini-services/netflix-desktop/ingest.ts.
 *  - no NetflixId            → never push
 *  - first sight of a session → push
 *  - signature changed        → push (Netflix rotated the session cookie)
 *  - unchanged                → keepalive push at most every 6h (min 30s apart)
 */
export function decidePush(opts) {
  const debounceMs = opts.debounceMs ?? 30_000;
  const keepaliveMs = opts.keepaliveMs ?? 6 * 60 * 60 * 1000;
  if (!opts.signature) return { push: false, reason: "no-auth" };
  if (opts.lastSignature == null) return { push: true, reason: "first" };
  if (opts.signature !== opts.lastSignature) return { push: true, reason: "rotated" };
  if (!opts.lastPushAt) return { push: true, reason: "first" };
  if (opts.now - opts.lastPushAt < debounceMs) return { push: false, reason: "debounced" };
  if (opts.now - opts.lastPushAt >= keepaliveMs) return { push: true, reason: "keepalive" };
  return { push: false, reason: "unchanged" };
}
