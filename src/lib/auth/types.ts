/**
 * WFX2-P2-AU — the WebFlix auth types.
 *
 * THE ARCHITECTURE LAW (P36-ACTION-PERSISTENCE, 2026-10-21): a WebFlix
 * account is a WebFlix IDENTITY — it is NOT itself a YouTube account. The
 * ONE deployment-wide operator session may still power server-side READS
 * (feed enrichment), but END-USER WRITES act only on the signed-in user's
 * OWN connected YouTube account, bound through the official Google OAuth
 * flow (wf:yt:conn:<userId>, src/lib/auth/youtube-connection-store.ts) and
 * executed through the supported YouTube Data API. No YouTube-account data
 * is ever fabricated. These types are client-safe (pure shapes — no server
 * imports ride along).
 */

/** The password minimum (the register contract — client + server share it). */
export const PASSWORD_MIN_LENGTH = 8;

/** The signed-in WebFlix identity (the session user + the profile's shape). */
export interface WebFlixSessionUser {
  id: string;
  /** normalized (lowercase) email — the user-store key identity */
  email: string;
  /** the display name shown on the header avatar menu / account page */
  displayName: string;
  /** avatar hue 0–359 — the initial-based avatar's color (hsl(seed, 65%, 45%)) */
  avatarSeed: number;
}

/** The durable user record stored under `wf:auth:user:<email>` (JSON). */
export interface WebFlixUserRecord {
  id: string;
  email: string;
  displayName: string;
  /**
   * node:crypto scrypt hash — `"<saltHex>:<hashHex>"`, per-user random salt,
   * compared constant-time. NEVER the raw password.
   */
  passwordHash: string;
  avatarSeed: number;
  /** ISO timestamp — user records never expire (no TTL on the store writes) */
  createdAt: string;
}

/** The `/api/auth/session` JSON (stock NextAuth + the WebFlix claims). */
export interface WebFlixSessionPayload {
  user?: {
    name?: string | null;
    email?: string | null;
    id?: string;
    avatarSeed?: number;
  };
  expires?: string;
}

/**
 * WFX2-P36 — the per-user YouTube account connection (the OAuth binding).
 * Stored under `wf:yt:conn:<userId>` (JSON) in the connection store. The
 * tokens are AES-256-GCM blobs (encryptSecret in src/lib/youtube/oauth.ts) —
 * plaintext tokens never touch the store, the logs, or the browser.
 */
export interface WebFlixYouTubeConnection {
  /** the WebFlix account id (NextAuth token sub) — the binding key */
  userId: string;
  /** the user's own YouTube channel id (channels.list mine=true) */
  channelId: string | null;
  channelTitle: string | null;
  channelThumbUrl: string | null;
  /** the granted scope string (youtube.force-ssl family) */
  scope: string;
  /** AES-256-GCM blob — the current access token */
  accessTokenEnc: string;
  /** AES-256-GCM blob — the refresh token (offline access; null when absent) */
  refreshTokenEnc: string | null;
  /** epoch ms — the access token's expiry (refreshed transparently) */
  accessExpiresAt: number;
  /** "connected" | "needs_reauth" (revoked/expired consent → re-connect) */
  status: "connected" | "needs_reauth";
  /** ISO timestamps */
  connectedAt: string;
  updatedAt: string;
}
