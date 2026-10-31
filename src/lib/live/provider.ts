/**
 * WFX2-LIVE-PLATFORM-1 — the provider-neutral media adapter boundary
 * (work order principle #2 and §5).
 *
 * Route/component code depends on THIS interface and the frozen DTOs only.
 * Swapping/adding a provider (Cloudflare Stream WHIP/WHEP, Mux LL-HLS) means
 * implementing the interface — no route or renderer edits. The ADR (0005)
 * pins the Phase 1 decision after the spike; the boundary is what makes the
 * ADR cheap to revisit.
 *
 * SERVER-ONLY: implementations touch provider secrets. Nothing here may be
 * imported by a client component (enforced by the livekit adapter's import
 * surface + review law, and the secret-scan gate).
 */
import type {
  LivePlaybackPlan,
  LiveProvider,
  LiveTokenRole,
  LiveWebhookEvent,
} from "./types";

export interface MintTokenOptions {
  /** The provider room NAME (routing identity, not a secret). */
  roomName: string;
  /** The WebFlix user identity the token binds to (opaque to viewers). */
  identity: string;
  /** The requested capability rung. Host rung additionally requires the
   * caller to have proven host authorization at the ROUTE layer — the
   * adapter trusts the route's authorization, it does not re-check DB. */
  role: LiveTokenRole;
  /** Short-lived by law (work order principle #6). Route pins the TTL. */
  ttlSeconds: number;
}

/**
 * The scoped capability rung each role's token carries:
 * - host: publish + subscribe + data + room admin (end/quiet controls)
 * - guest: publish + subscribe + data
 * - viewer: subscribe ONLY — a viewer can never publish without the
 *   host-approved invitation path (spike acceptance #3).
 */
export function grantsForRole(role: LiveTokenRole): {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  roomAdmin: boolean;
} {
  switch (role) {
    case "host":
      return { canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: true };
    case "guest":
      return { canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: false };
    case "viewer":
      return { canPublish: false, canSubscribe: true, canPublishData: false, roomAdmin: false };
  }
}

export interface LiveProviderAdapter {
  readonly provider: LiveProvider;

  /** True when the deployment has complete provider credentials. */
  isConfigured(): boolean;

  /** Mint a short-lived, room-scoped join token for the capability rung. */
  mintToken(opts: MintTokenOptions): Promise<LivePlaybackPlan>;

  /** Provider-side room teardown (the host "End live" path). Idempotent:
   * deleting an already-gone room must not throw. */
  destroyRoom(roomName: string): Promise<void>;

  /** Does the provider currently know this room? (reconnect reconciliation) */
  roomExists(roomName: string): Promise<boolean>;

  /** Verify a provider webhook signature and decode the event.
   * Returns null on ANY signature failure (callers must 401, never reconcile). */
  parseWebhook(body: string, authHeader: string | null): Promise<LiveWebhookEvent | null>;
}
