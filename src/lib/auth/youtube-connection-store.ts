/**
 * P99 / G23 — the per-user YouTube account connection store.
 *
 * THE P36 LAW (docs/work-items/P36-ACTION-PERSISTENCE.md): app sign-in is a
 * WebFlix IDENTITY, not YouTube authorization. Every end-user write must act
 * on the signed-in user's OWN connected YouTube account, bound through the
 * official Google OAuth flow. This store holds that binding — one record per
 * WebFlix user (userId = the NextAuth token sub), holding the user's own
 * channel identity + the encrypted OAuth tokens.
 *
 * THE DURABILITY LAW (docs/research/2026-11-07-p99-connection-store-durability-g23-report.md):
 * a connection must never live on one lambda instance only. The record's
 * durable layer is the stack's OWN database (Prisma — YouTubeConnectionRecord),
 * replacing the operator-gated Upstash REST lane whose supplied host is
 * DNS-dead on production. The public contract is byte-identical to the
 * P36 store:
 *   - get: durable read first; the in-memory mirror is ONLY the read-
 *     degradation fallback (a DB outage never breaks a request — the G22
 *     doctrine). An unknown user is the honest null.
 *   - put: durable upsert + mirror; a durable failure throws
 *     YoutubeConnectionStoreUnavailableError (the routes' honest 503).
 *   - delete: durable delete + mirror; true when a record was removed.
 *   - no TTL — durable until the user disconnects or Google revokes consent
 *     (status → needs_reauth).
 *
 * Token security (the work order's contract):
 *  - accessTokenEnc / refreshTokenEnc are AES-256-GCM blobs produced by
 *    src/lib/youtube/oauth.ts (encryptSecret) — the plaintext tokens NEVER
 *    touch this store, the logs, or the browser;
 *  - records carry no TTL — a connection is durable until the user
 *    disconnects or Google revokes consent (status → needs_reauth).
 *
 * Record shape: the `data` column carries the EXACT serialized record the
 * Upstash adapter carried — parseRecord/isConnectionShape unchanged; a
 * corrupt row is an honest miss, never a crash.
 */
import { db } from "@/lib/db";
import type { WebFlixYouTubeConnection } from "./types";

// ---------------------------------------------------------------------------
// The local mirror — the read-degradation fallback (DB-outage lane only)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __webflixYouTubeConnections?: Map<string, string> };
const local: Map<string, string> = (g.__webflixYouTubeConnections ??= new Map());

/** Test hook: wipe the mirror AND the durable table (await it — the wipe is deterministic). */
export async function resetYoutubeConnectionStore(): Promise<void> {
  local.clear();
  await db.youTubeConnectionRecord.deleteMany();
}

function isConnectionShape(v: unknown): v is WebFlixYouTubeConnection {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.userId === "string" && typeof r.accessTokenEnc === "string";
}

function parseRecord(raw: string | null | undefined): WebFlixYouTubeConnection | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WebFlixYouTubeConnection;
    if (!isConnectionShape(record)) return null;
    return record;
  } catch {
    return null; // a corrupt row is an honest miss, never a crash
  }
}

/**
 * Read the user's YouTube connection. Durable read first (the freshness law
 * — the record must survive instance churn); the local mirror answers only
 * when the durable read itself fails (the outage lane). An unknown user
 * simply misses (not connected — the honest null).
 */
export async function getYouTubeConnection(userId: string): Promise<WebFlixYouTubeConnection | null> {
  let row: { data: string } | null = null;
  try {
    row = await db.youTubeConnectionRecord.findUnique({
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
export async function putYouTubeConnection(record: WebFlixYouTubeConnection): Promise<void> {
  const raw = JSON.stringify(record);
  local.set(record.userId, raw);
  try {
    await db.youTubeConnectionRecord.upsert({
      where: { userId: record.userId },
      update: { data: raw },
      create: { userId: record.userId, data: raw },
    });
  } catch (err) {
    throw new YoutubeConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "durable write failed",
    );
  }
}

/** Delete the user's connection (disconnect). Returns true when a record was removed. */
export async function deleteYouTubeConnection(userId: string): Promise<boolean> {
  const existed = local.delete(userId);
  try {
    const removed = await db.youTubeConnectionRecord.deleteMany({ where: { userId } });
    return existed || removed.count > 0;
  } catch (err) {
    throw new YoutubeConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "durable delete failed",
    );
  }
}

/** Flip a connection to needs_reauth (refresh refused — consent revoked/expired). */
export async function markYouTubeConnectionNeedsReauth(userId: string): Promise<void> {
  const record = await getYouTubeConnection(userId);
  if (!record || record.status === "needs_reauth") return;
  await putYouTubeConnection({
    ...record,
    status: "needs_reauth",
    updatedAt: new Date().toISOString(),
  });
}

/** A durable-store outage surfaced to the caller (fail honest, never fake). */
export class YoutubeConnectionStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebFlix YouTube connection store unavailable: ${cause}`);
    this.name = "YoutubeConnectionStoreUnavailableError";
  }
}
