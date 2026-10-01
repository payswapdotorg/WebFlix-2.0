/**
 * WFX2-P4-PE — playlist edit kinds (lane-owned module).
 *
 * Pre-seeded by the lead on main with honest staged stubs (the P3 pattern:
 * ACTION_KINDS + executor routing live in the shared registry files — the
 * lead's commits — while the BODIES here are the P4-PE lane's exclusive
 * territory).
 *
 * The staged drives (the lane implements):
 *  - playlist-update: with the tab on the playlist's own page, open the
 *    REAL edit affordances, PATCH the payload's fields (title /
 *    description / privacy), confirm, and verify the header re-rendered
 *    the new values.
 *  - playlist-reorder: with the tab on the playlist's own page, hover the
 *    item at the payload's fromIndex, drive the REAL drag handle (the
 *    pointer-event ladder), then verify the list order changed (the moved
 *    videoId is at toIndex in the re-rendered list).
 *
 * Honest failure taxonomy (per the existing playlist kinds): the observed
 * DOM rides every failure; no fake success. The stubs below answer with
 * the staged-kind marker until the lane lands.
 */

import type { BrokerPayload } from "../types";

/** The lane's hard wall-clock ceiling (the reorder ladder is slow). */
export const PLAYLIST_EDIT_TIMEOUT_MS = 120_000;

export interface PlaylistUpdatePayload {
  /** which playlist (target.playlistId carries it too) */
  playlistId?: string;
  /** the new title (omitted = leave unchanged) */
  title?: string;
  /** the new description (omitted = leave unchanged) */
  description?: string;
  /** "public" | "unlisted" | "private" (omitted = leave unchanged) */
  visibility?: string;
}

export interface PlaylistReorderPayload {
  playlistId?: string;
  /** 0-based index of the item to move */
  fromIndex?: number;
  /** 0-based index to move it to */
  toIndex?: number;
  /** the moved video's id (verification aid) */
  videoId?: string;
}

/**
 * STUB (pre-seeded by the lead on main — the P4-PE lane replaces this body).
 * Honest staged-kind response until the lane lands.
 */
export function playlistUpdateScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p = (payload ?? {}) as BrokerPayload & PlaylistUpdatePayload;
  const fields = [
    typeof p.title === "string" ? "title" : null,
    typeof p.description === "string" ? "description" : null,
    typeof p.visibility === "string" ? "visibility" : null,
  ]
    .filter(Boolean)
    .join(",");
  return {
    script: `return {ok:false, error:"playlist-update: staged kind (the P4-PE lane lands the real drive)", detail:{playlistId:${JSON.stringify(
      p.playlistId ?? ""
    )}, fields:${JSON.stringify(fields || "none")}}}`,
    timeoutMs: PLAYLIST_EDIT_TIMEOUT_MS,
  };
}

/**
 * STUB (pre-seeded by the lead on main — the P4-PE lane replaces this body).
 * Honest staged-kind response until the lane lands.
 */
export function playlistReorderScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p = (payload ?? {}) as BrokerPayload & PlaylistReorderPayload;
  return {
    script: `return {ok:false, error:"playlist-reorder: staged kind (the P4-PE lane lands the real drive)", detail:{playlistId:${JSON.stringify(
      p.playlistId ?? ""
    )}, fromIndex:${JSON.stringify(p.fromIndex ?? null)}, toIndex:${JSON.stringify(
      p.toIndex ?? null
    )}}}`,
    timeoutMs: PLAYLIST_EDIT_TIMEOUT_MS,
  };
}
