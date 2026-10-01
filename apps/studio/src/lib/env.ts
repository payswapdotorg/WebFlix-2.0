function get(name: string): string | undefined {
  try { return process.env[name]; } catch { return undefined; }
}

// Lazy getters so tests can control env per-case (no import-time snapshot).
export const env = {
  get MAIN_APP_URL(): string {
    return (get("MAIN_APP_URL") ?? "").replace(/\/$/, "") || "https://webflix-2-0-one.vercel.app";
  },
  get UPSTASH_REDIS_REST_URL(): string | undefined { return get("UPSTASH_REDIS_REST_URL") || undefined; },
  get UPSTASH_REDIS_REST_TOKEN(): string | undefined { return get("UPSTASH_REDIS_REST_TOKEN") || undefined; },
  // Dev/test fallback only; production sets STUDIO_AUTH_SECRET in the Vercel project env.
  get AUTH_SECRET(): string { return get("STUDIO_AUTH_SECRET") ?? get("AUTH_SECRET") ?? "webflix-studio-dev-secret"; },
};
