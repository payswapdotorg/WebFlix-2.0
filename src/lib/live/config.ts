/**
 * WFX2-LIVE-PLATFORM-1 — provider config seam.
 *
 * Reads the media provider env (LiveKit Cloud) and answers an honest
 * `configured` flag. NO route or component reads provider env directly —
 * this seam is the only reader (work order principle #2/#6: adapters own
 * provider material; the renderer never sees a secret).
 *
 * Honest limits: absent/unconfigured env is a TESTABLE state — routes
 * answer 503 provider-not-configured and the UI explains why. No fake
 * success (principle #8).
 */
import type { LiveProvider } from "./types";

export interface LiveProviderConfig {
  provider: LiveProvider;
  /** The realtime edge URL the browser connects to (public, not a secret). */
  url: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  configured: boolean;
}

export function liveProviderConfig(): LiveProviderConfig {
  const url = process.env.LIVEKIT_URL ?? null;
  const apiKey = process.env.LIVEKIT_API_KEY ?? null;
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? null;
  return {
    provider: "livekit",
    url,
    apiKey,
    apiSecret,
    configured: Boolean(url && apiKey && apiSecret),
  };
}
