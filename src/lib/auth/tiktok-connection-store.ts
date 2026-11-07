/**
 * P99 / G23 — the per-user TikTok account connection store.
 *
 * THE DURABILITY LAW (docs/research/2026-11-07-p99-connection-store-durability-g23-report.md):
 * a connection must never live on one lambda instance only. The record's
 * durable layer is the stack's OWN database (Prisma — TikTokConnectionRecord),
 * replacing the operator-gated Upstash REST lane whose supplied host is
 * DNS-dead on production. The public contract is byte-identical to the
 * P94-b store:
 *   - get: durable read first; the in-memory mirror is ONLY the read-
 *     degradation fallback (a DB outage never breaks a request — the G22
 *     doctrine). An unknown user is the honest null.
 *   - put: durable upsert + mirror; a durable failure throws
 *     TikTokConnectionStoreUnavailableError (the routes' honest 503).
 *   - delete: durable delete + mirror; true when a record was removed.
 *   - no TTL — durable until the user disconnects or the provider revokes
 *     consent (status → needs_reauth).
 *
 * Record shape: the `data` column carries the EXACT serialized record the
 * Upstash adapter carried — parseRecord/isConnectionShape unchanged; a
 * corrupt row is an honest miss, never a crash.
 */
import { db } from "@/lib/db";
import type { WebFlixTikTokConnection } from "./types";

// ---------------------------------------------------------------------------
// The local mirror — the read-degradation fallback (DB-outage lane only)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __webflixTikTokConnections?: Map<string, string> };
const local: Map<string, string> = (g.__webflixTikTokConnections ??= new Map());

/** Test hook: wipe the mirror AND the durable table (test lane only). */
export async function resetTikTokConnectionStore(): Promise<void> {
  local.clear();
  await db.tikTokConnectionRecord.deleteMany();
}

function isConnectionShape(v: unknown): v is WebFlixTikTokConnection {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.userId === "string" &&
    typeof r.handle === "string" &&
    (r.mode === "oauth" || r.mode === "profile_link") &&
    (r.status === "connected" || r.status === "needs_reauth" || r.status === "linked")
  );
}

function parseRecord(raw: string | null | undefined): WebFlixTikTokConnection | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WebFlixTikTokConnection;
    if (!isConnectionShape(record)) return null;
    return record;
  } catch {
    return null; // a corrupt row is an honest miss, never a crash
  }
}

/**
 * Read the user's TikTok connection. Durable read first (the freshness law
 * — the record must survive instance churn); the local mirror answers only
 * when the durable read itself fails (the outage lane). An unknown user
 * simply misses (not connected — the honest null).
 */
export async function getTikTokConnection(userId: string): Promise<WebFlixTikTokConnection | null> {
  let row: { data: string } | null = null;
  try {
    row = await db.tikTokConnectionRecord.findUnique({
      where: { userId },
      select: { data: true },
    });
  } catch {
    // the durable read failed — degrade to the mirror, never break the request
    return parseRecord(local.get(userId));
  }
  const record = parseRecord(row?.data ?? null);
  if (record) local.set(userId, JSON.stringify(record)); // mirror the durable read
  return record;
}

/**
 * Write a connection durably: the DB upsert is AUTHORITATIVE (awaited — a
 * connection must never live on one lambda instance only), the mirror rides
 * along for the outage lane. A durable failure surfaces the honest
 * Unavailable error (the routes' 503 contract — fail honest, never fake).
 */
export async function putTikTokConnection(record: WebFlixTikTokConnection): Promise<void> {
  const raw = JSON.stringify(record);
  local.set(record.userId, raw);
  try {
    await db.tikTokConnectionRecord.upsert({
      where: { userId: record.userId },
      update: { data: raw },
      create: { userId: record.userId, data: raw },
    });
  } catch (err) {
    throw new TikTokConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "durable write failed",
    );
  }
}

/** Delete the user's connection (disconnect/unlink). True when a record was removed. */
export async function deleteTikTokConnection(userId: string): Promise<boolean> {
  const existed = local.delete(userId);
  try {
    const removed = await db.tikTokConnectionRecord.deleteMany({ where: { userId } });
    return existed || removed.count > 0;
  } catch (err) {
    throw new TikTokConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "durable delete failed",
    );
  }
}

/** A durable-store outage surfaced to the caller (fail honest, never fake). */
export class TikTokConnectionStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebFlix TikTok connection store unavailable: ${cause}`);
    this.name = "TikTokConnectionStoreUnavailableError";
  }
}
