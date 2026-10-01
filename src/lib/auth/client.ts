/**
 * WFX2-P2-AU — client-side auth helpers (browser-safe, no server imports).
 *
 * The sign-in / sign-out flows use the STOCK NextAuth HTTP routes directly
 * (CSRF fetch → form-encoded callback POST) — no next-auth/react client
 * bundle is pulled in; this module is the whole client surface.
 */

/** Only same-app relative redirects — never an open redirect. */
export function safeRedirect(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

/** The sign-in URL carrying the surface that prompted it. */
export function signInHref(redirect?: string | null): string {
  const target = redirect ? safeRedirect(redirect) : "/";
  return target === "/" ? "/signin" : `/signin?redirect=${encodeURIComponent(target)}`;
}

export type SignInOutcome = { ok: true } | { ok: false; error: "credentials" | "network" };

/**
 * Sign in with email + password via the stock NextAuth credentials
 * callback: fetch the CSRF token, then POST form-encoded with json=true.
 * 200 → the session cookie is set; 401 → wrong credentials.
 */
export async function signInWithCredentials(email: string, password: string): Promise<SignInOutcome> {
  try {
    const csrfRes = await fetch("/api/auth/csrf", { cache: "no-store" });
    if (!csrfRes.ok) return { ok: false, error: "network" };
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const res = await fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, error: "credentials" };
    if (!res.ok) return { ok: false, error: "network" };
    return { ok: true };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Sign out via the stock NextAuth signout route (CSRF + form-encoded). */
export async function signOutFromWebFlix(): Promise<void> {
  const csrfRes = await fetch("/api/auth/csrf", { cache: "no-store" });
  if (!csrfRes.ok) return;
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  await fetch("/api/auth/signout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, json: "true" }),
    cache: "no-store",
  }).catch(() => {});
}
