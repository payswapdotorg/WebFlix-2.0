/**
 * SERVER-ONLY MODULE — the replay object storage seam (ADR-0008).
 *
 * Nothing outside the LIVE replay domain may import this file. The seam
 * decides WHERE bytes live; the database stores opaque keys only and no
 * absolute path/URL is ever persisted or exposed (the leak law). The v1
 * implementation is local disk under `db/live-replays/` (gitignored); an
 * R2/Cloudflare implementation slots in behind the same four functions
 * when credentials are re-supplied — callers never change.
 *
 * Keys are opaque single-segment names (e.g. `replay_<assetId>.webm`).
 * Any key carrying "..", "/" or "\\" is rejected — the seam can never be
 * talked into escaping its root directory.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const REPLAY_ROOT = path.join(process.cwd(), "db", "live-replays");

function assertSafeKey(key: string): void {
  if (key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new Error(`unsafe replay object key: ${JSON.stringify(key)}`);
  }
}

function keyPath(key: string): string {
  assertSafeKey(key);
  return path.join(REPLAY_ROOT, key);
}

/** Persist one object (creates the root directory on first save). */
export async function saveReplayObject(key: string, data: Uint8Array): Promise<void> {
  const file = keyPath(key);
  await mkdir(REPLAY_ROOT, { recursive: true });
  await writeFile(file, data);
}

/** Read one object; null when absent (the honest broken-object answer). */
export async function readReplayObject(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
  let buf: Buffer;
  try {
    buf = await readFile(keyPath(key));
  } catch {
    return null;
  }
  // Fresh, self-owned backing buffer (never a view over the read pool) —
  // safe to hand straight to a Response body.
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/** Delete one object. Idempotent: deleting a missing object must not throw. */
export async function deleteReplayObject(key: string): Promise<void> {
  await rm(keyPath(key), { force: true });
}

/** The object's byte size, or null when absent. */
export async function replayObjectSize(key: string): Promise<number | null> {
  try {
    const s = await stat(keyPath(key));
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}
