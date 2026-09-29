/**
 * WFX2-A-W Session Broker — shared-secret auth (constant-time compare).
 * Digest both sides with sha256 first so timingSafeEqual always compares
 * equal-length buffers (and string length never leaks).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function secretMatches(provided: string | null, secret: string | null): boolean {
  if (!secret) return false; // fail closed when unconfigured
  if (provided === null) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}
