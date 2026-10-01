/**
 * WFX2-P2-AU — the NextAuth session secret.
 *
 * Law: the repo runs its gates env-clean (dev + tests never require secrets),
 * so an INSECURE dev-only fallback keeps every local flow working when
 * NEXTAUTH_SECRET is absent. Production MUST set NEXTAUTH_SECRET (see
 * .env.example — generate with `openssl rand -base64 32`); the value is never
 * committed. The fallback is intentionally recognizable so a leaked prod
 * misconfiguration is obvious in the logs.
 */
export const DEV_AUTH_SECRET_FALLBACK =
  "wf-dev-insecure-nextauth-secret-do-not-use-in-production";

/** The active signing secret (env-configured, dev fallback when absent). */
export function authSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? DEV_AUTH_SECRET_FALLBACK;
}
