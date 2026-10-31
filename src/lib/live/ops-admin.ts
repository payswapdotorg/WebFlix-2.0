/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the ops-admin gate (ADR-0009).
 *
 * The first first-party site-admin gate in the app, and deliberately the
 * smallest honest one: the OPERATOR declares who may see operations via
 * `WEBFLIX_OPS_ADMIN_EMAILS` (comma-separated, case-insensitive, matched
 * against the session email — the user-store key identity). No admin-role
 * schema, no privilege rows, no client-claimable admin bit: the gate
 * resolves PER REQUEST and fails closed.
 *
 *   - signed out            → "unauthenticated" (401)
 *   - env unset/empty       → "not-configured" (503 — the honest explainer
 *     names the env var; never a fake empty dashboard)
 *   - signed in, not listed → "forbidden" (403)
 *   - listed                → "admin" (+ the shadow identity for audit)
 */
import { ensureShadowUser } from "@/lib/watch/local-comments";
import type { WebFlixSessionUser } from "@/lib/auth/types";

export const OPS_ADMIN_ENV = "WEBFLIX_OPS_ADMIN_EMAILS";

export type OpsAdminResolution =
  | { status: "unauthenticated" }
  | { status: "not-configured" }
  | { status: "forbidden" }
  | { status: "admin"; admin: OpsAdmin };

export interface OpsAdmin {
  id: string;
  handle: string;
  name: string;
  email: string;
}

/** The parsed allowlist — empty means the deployment has not declared ops admins. */
export function opsAdminEmails(): string[] {
  const raw = process.env[OPS_ADMIN_ENV];
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export async function resolveOpsAdmin(
  sessionUser: WebFlixSessionUser | null,
): Promise<OpsAdminResolution> {
  if (!sessionUser) return { status: "unauthenticated" };
  const emails = opsAdminEmails();
  if (emails.length === 0) return { status: "not-configured" };
  const email = sessionUser.email.trim().toLowerCase();
  if (!emails.includes(email)) return { status: "forbidden" };
  const identity = await ensureShadowUser(sessionUser);
  return {
    status: "admin",
    admin: { id: identity.id, handle: identity.handle, name: identity.name, email },
  };
}
