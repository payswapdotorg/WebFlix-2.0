/**
 * WFX2-P3-UP — the staged-file store (the upload flow's file carrier).
 *
 * The user's picked video never travels through the broker: the app stages
 * the bytes in per-instance memory (the same law as the cache adapter's L1)
 * behind an unguessable UUID, and the operator tab FETCHES them from
 * GET /api/upload/stage?id=… in page context (the post-create image pattern,
 * video-scaled). TTL + entry cap + per-file size cap keep the footprint
 * honest and bounded; nothing is persisted.
 */

import { randomUUID } from "node:crypto";

export interface StagedUpload {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array<ArrayBuffer>;
  stagedAt: number;
}

/** How long a staged file stays fetchable (the broker drive starts within seconds of staging). */
export const STAGE_TTL_MS = 10 * 60_000;

/** Per-file byte cap — a real upload's honest ceiling for the in-memory carrier. */
export const STAGE_MAX_BYTES_PER_FILE = 256 * 1024 * 1024;

/** Concurrent staged files per instance (LRU-bounded). */
export const STAGE_MAX_FILES = 3;

const store = new Map<string, StagedUpload>();

function purgeExpired(now = Date.now()): void {
  for (const [id, entry] of store) {
    if (now - entry.stagedAt > STAGE_TTL_MS) store.delete(id);
  }
}

function purgeOverflow(): void {
  while (store.size > STAGE_MAX_FILES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [id, entry] of store) {
      if (entry.stagedAt < oldestAt) {
        oldestAt = entry.stagedAt;
        oldestKey = id;
      }
    }
    if (oldestKey === null) break;
    store.delete(oldestKey);
  }
}

/** Stage the picked file's bytes. Throws an honest Error on cap violations. */
export function stageUpload(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}): StagedUpload {
  if (input.bytes.byteLength === 0) {
    throw new Error("the picked file is empty");
  }
  if (input.bytes.byteLength > STAGE_MAX_BYTES_PER_FILE) {
    throw new Error(
      `the file exceeds the ${Math.floor(STAGE_MAX_BYTES_PER_FILE / (1024 * 1024))}MB staging cap — use the hand-off flow for very large uploads`
    );
  }
  purgeExpired();
  purgeOverflow();
  const entry: StagedUpload = {
    id: randomUUID(),
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    bytes: input.bytes,
    stagedAt: Date.now(),
  };
  store.set(entry.id, entry);
  purgeOverflow();
  return entry;
}

/** Resolve a staged file (null when unknown, malformed, or expired — honest). */
export function getStagedUpload(id: string): StagedUpload | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  purgeExpired();
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() - entry.stagedAt > STAGE_TTL_MS) {
    store.delete(id);
    return null;
  }
  return entry;
}

/** Current staged-file count (diagnostics). */
export function stagedUploadCount(): number {
  purgeExpired();
  return store.size;
}

/** Test hook: wipe the store between route-handler invocations. */
export function clearStagedUploads(): void {
  store.clear();
}
