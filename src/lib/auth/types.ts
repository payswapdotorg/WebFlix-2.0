/**
 * WFX2-P2-AU — the WebFlix auth types.
 *
 * THE ARCHITECTURE LAW (unchanged): WebFlix's data backend stays the single
 * operator YouTube session (Tier-2 broker). A WebFlix account is a WebFlix
 * IDENTITY that fronts that session — it is NOT a YouTube account, and no
 * YouTube-account data is ever fabricated. These types are client-safe
 * (pure shapes — no server imports ride along).
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
