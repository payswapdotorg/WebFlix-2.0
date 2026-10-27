/**
 * P59-R3 — the dead-post ledger.
 *
 * The viewer-side player is the only place that LEARNS a curated post is
 * dead (1001 INVALID_VIDEO — private/removed/bad id): WebFlix's egress can
 * never probe tiktok.com liveness (the measured 302 wall). So the player
 * reports the error once and the ledger remembers it for a SOFT 48h TTL on
 * the shared cache adapter (the one infrastructure seam the netflix module
 * already rides — the import law stays intact).
 *
 * Poison guards — a record is only written for the LETHAL family:
 * - 1000–1099 (INVALID_VIDEO family) = the post itself is gone → recorded.
 * - 2001 SERVER_ERROR, 3xxx PLAYBACK/AUTOPLAY, network timeouts = transient
 *   or viewer-side → refused ({ recorded: null }), so one bad network can
 *   never blank the shelf for everyone.
 */

import { cacheJsonGet, cacheJsonSet } from "@/lib/youtube/upstash-cache";
import { isTikTokPostId } from "./urls";

export const TIKTOK_DEAD_TTL_MS = 48 * 60 * 60 * 1000;

export interface TikTokDeadRecord {
  postId: string;
  code: number;
  type: string;
  reportedAt: string;
}

/** True only for the lethal 1000–1099 family (the post itself is gone). */
export function isLethalPlayerError(code: number): boolean {
  return Number.isInteger(code) && code >= 1000 && code <= 1099;
}

function deadKey(postId: string): string {
  return `tt:dead:${postId}`;
}

/** Read one post's dead record (null when alive/unreported/expired). */
export async function getDeadPost(postId: string): Promise<TikTokDeadRecord | null> {
  if (!isTikTokPostId(postId)) return null;
  try {
    const rec = await cacheJsonGet<TikTokDeadRecord>(deadKey(postId));
    if (!rec || typeof rec !== "object" || rec.postId !== postId) return null;
    if (!isLethalPlayerError(rec.code)) return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Record a player-reported death. Returns:
 * - `{ recorded: true }`  — a lethal code was persisted for the soft TTL.
 * - `{ recorded: false }` — malformed input (bad id / non-integer code).
 * - `{ recorded: null }`  — a non-lethal code (poison guard: never written).
 */
export async function recordDeadPost(
  postId: string,
  code: number,
  type: string
): Promise<{ recorded: boolean | null }> {
  if (!isTikTokPostId(postId) || !Number.isInteger(code)) return { recorded: false };
  if (!isLethalPlayerError(code)) return { recorded: null };
  const rec: TikTokDeadRecord = {
    postId,
    code,
    type: typeof type === "string" && type ? type.slice(0, 64) : "PLAYER_ERROR",
    reportedAt: new Date().toISOString(),
  };
  try {
    await cacheJsonSet(deadKey(postId), rec, TIKTOK_DEAD_TTL_MS);
    return { recorded: true };
  } catch {
    // The ledger is best-effort telemetry — a cache outage never 5xxs the lane.
    return { recorded: false };
  }
}
