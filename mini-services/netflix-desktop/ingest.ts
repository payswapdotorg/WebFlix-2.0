/**
 * WebFlix Netflix Desktop — the automatic sign-in ingest (P46).
 *
 * The measured reality (P44/P45): Netflix's risk engine hard-blocks automated
 * logins pre-validation. The only automation that never touches that engine is
 * one that mints NO cookies at all: the operator's own genuine, signed-in
 * browser pushes its session here. That is the WebFlix Bridge (a one-time
 * install MV3 extension): it watches the .netflix.com cookie jar (HttpOnly
 * included — chrome.cookies is privileged) and pushes on every rotation.
 *
 * Poison-proofing (the P45 lesson — a quarantined cookie set once sat in the
 * trusted cache): bridge payloads NEVER enter the trusted cache directly.
 *   - sandbox live  → applied immediately through the strict checkSignedIn
 *                     path (applyExternalCookies); only success is cached.
 *   - sandbox idle  → stored as a CANDIDATE; the next bootstrap validates it
 *                     before the cached/harvest paths and promotes or drops it.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { NetflixCookie } from "./cookies";
import { parseCookieHeader } from "./session";

const INGEST_TOKEN_PATH =
  process.env.NETFLIX_INGEST_TOKEN_PATH ?? "/tmp/netflix-ingest-token.json";
const BRIDGE_CANDIDATE_PATH =
  process.env.NETFLIX_BRIDGE_CANDIDATE_PATH ?? "/tmp/netflix-bridge-candidate.json";

interface IngestStore {
  token: string;
  lastBridgePushAt?: number;
  lastBridgeDevice?: string;
  lastRejection?: { at: number; reason: string };
  lastSignature?: string | null;
}

export interface BridgeCandidate {
  cookies: NetflixCookie[];
  device: string | null;
  pushedAt: number;
}

export interface IngestResult {
  code: number;
  ok: boolean;
  /** true when the payload was applied to a live sandbox and validated */
  applied: boolean;
  message: string;
}

function loadStore(): IngestStore {
  try {
    const parsed = JSON.parse(readFileSync(INGEST_TOKEN_PATH, "utf8")) as IngestStore;
    if (parsed && typeof parsed.token === "string" && parsed.token.length >= 32) return parsed;
  } catch {
    /* first boot */
  }
  const fresh: IngestStore = { token: randomBytes(24).toString("hex") };
  saveStore(fresh);
  return fresh;
}

function saveStore(s: IngestStore) {
  try {
    writeFileSync(INGEST_TOKEN_PATH, JSON.stringify(s));
  } catch {
    /* best effort */
  }
}

/** The pairing token the operator pastes into the WebFlix Bridge options. */
export function getIngestToken(): string {
  return loadStore().token;
}

/** Invalidate the old token and mint a new one (compromised-token recovery). */
export function rotateIngestToken(): string {
  const s = loadStore();
  s.token = randomBytes(24).toString("hex");
  saveStore(s);
  return s.token;
}

export function verifyIngestToken(provided: string | undefined | null): boolean {
  if (!provided) return false;
  const expected = Buffer.from(loadStore().token);
  const got = Buffer.from(String(provided));
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/** Pure: accept a JSON cookie array or a raw Cookie-header string. */
export function normalizeBridgeCookies(input: unknown): NetflixCookie[] {
  let raw: Array<Partial<NetflixCookie>> = [];
  if (typeof input === "string") {
    raw = parseCookieHeader(input);
  } else if (Array.isArray(input)) {
    raw = input as Array<Partial<NetflixCookie>>;
  }
  return raw
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => ({
      name: c.name as string,
      value: c.value as string,
      domain: typeof c.domain === "string" && c.domain ? c.domain : ".netflix.com",
      path: typeof c.path === "string" && c.path ? c.path : "/",
      expires: typeof c.expires === "number" ? c.expires : undefined,
      httpOnly: c.httpOnly ?? true,
      secure: c.secure ?? true,
    }));
}

/** Pure: a NetflixId must be a STANDALONE name (SecureNetflixId contains it as a substring). */
export function hasUsableAuthCookies(cookies: NetflixCookie[]): boolean {
  return cookies.some((c) => c.name === "NetflixId");
}

/**
 * Pure: stable signature over the two auth cookies — the bridge pushes only
 * real rotations (plus a 6h keepalive); idempotent re-pushes are cheap no-ops.
 */
export function cookieSignature(cookies: NetflixCookie[]): string | null {
  const auth = cookies
    .filter((c) => c.name === "NetflixId" || c.name === "SecureNetflixId")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!auth.some((c) => c.name === "NetflixId")) return null;
  return createHash("sha256").update(auth.map((c) => `${c.name}=${c.value}`).join("|")).digest("hex").slice(0, 32);
}

/** Pure — the bridge-side push decision (mirrored in extension/logic.js). */
export function decidePush(opts: {
  signature: string | null;
  lastSignature: string | null | undefined;
  lastPushAt: number | null | undefined;
  now: number;
  debounceMs?: number;
  keepaliveMs?: number;
}): { push: boolean; reason: "no-auth" | "first" | "rotated" | "keepalive" | "unchanged" | "debounced" } {
  const debounceMs = opts.debounceMs ?? 30_000;
  const keepaliveMs = opts.keepaliveMs ?? 6 * 60 * 60 * 1000;
  if (!opts.signature) return { push: false, reason: "no-auth" };
  if (opts.lastSignature == null) return { push: true, reason: "first" };
  if (opts.signature !== opts.lastSignature) return { push: true, reason: "rotated" };
  if (!opts.lastPushAt) return { push: true, reason: "first" };
  if (opts.now - opts.lastPushAt < debounceMs) return { push: false, reason: "debounced" };
  if (opts.now - opts.lastPushAt >= keepaliveMs) return { push: true, reason: "keepalive" };
  return { push: false, reason: "unchanged" };
}

export function readBridgeCandidate(): BridgeCandidate | null {
  try {
    const parsed = JSON.parse(readFileSync(BRIDGE_CANDIDATE_PATH, "utf8")) as BridgeCandidate;
    if (parsed && Array.isArray(parsed.cookies) && parsed.cookies.length) return parsed;
  } catch {
    /* none */
  }
  return null;
}

export function saveBridgeCandidate(c: BridgeCandidate) {
  try {
    writeFileSync(BRIDGE_CANDIDATE_PATH, JSON.stringify(c));
  } catch {
    /* best effort */
  }
}

export function clearBridgeCandidate() {
  try {
    rmSync(BRIDGE_CANDIDATE_PATH, { force: true });
  } catch {
    /* noop */
  }
}

/** The non-secret auto-auth status the app surfaces to the operator. */
export function getBridgeStatus() {
  const s = loadStore();
  return {
    lastBridgePushAt: s.lastBridgePushAt ?? null,
    lastBridgeDevice: s.lastBridgeDevice ?? null,
    candidatePending: readBridgeCandidate() !== null,
    lastRejection: s.lastRejection ?? null,
  };
}

function recordPush(device: string | null) {
  const s = loadStore();
  s.lastBridgePushAt = Date.now();
  if (device) s.lastBridgeDevice = device.slice(0, 120);
  saveStore(s);
}

function recordRejection(reason: string) {
  const s = loadStore();
  s.lastRejection = { at: Date.now(), reason: reason.slice(0, 200) };
  saveStore(s);
}

export interface IngestDeps {
  /** phase is ready | auth-required → a live sandbox can take cookies now */
  isSessionLive: () => boolean;
  /** the strict, live-validated apply path (applyExternalCookies) */
  applyLive: (cookies: NetflixCookie[]) => Promise<{ ok: boolean; message: string }>;
}

/** The /ingest handler — the bridge's automatic sign-in push. */
export async function ingestBridgeCookies(
  input: { token?: unknown; cookies?: unknown; device?: unknown },
  deps: IngestDeps,
): Promise<IngestResult> {
  if (!verifyIngestToken(typeof input.token === "string" ? input.token : null)) {
    return { code: 401, ok: false, applied: false, message: "Invalid pairing token." };
  }
  const cookies = normalizeBridgeCookies(input.cookies);
  if (!hasUsableAuthCookies(cookies)) {
    return {
      code: 422,
      ok: false,
      applied: false,
      message: "Payload has no NetflixId — sign into netflix.com in that browser first.",
    };
  }
  const device = typeof input.device === "string" ? input.device : null;
  const signature = cookieSignature(cookies);

  recordPush(device);

  if (deps.isSessionLive()) {
    // A live sandbox at the auth wall ALWAYS takes the apply attempt — even an
    // unchanged signature (the cached set may have gone dead since; the push
    // is a cheap cookie injection, never a Netflix-side attempt).
    const r = await deps.applyLive(cookies);
    if (r.ok) {
      const s = loadStore();
      s.lastSignature = signature;
      saveStore(s);
      clearBridgeCandidate(); // applyExternalCookies already wrote the trusted cache
      return { code: 200, ok: true, applied: true, message: r.message };
    }
    recordRejection(r.message);
    return { code: 422, ok: false, applied: false, message: r.message };
  }

  // sandbox idle: an unchanged re-push is an idempotent no-op (no churn)
  const s0 = loadStore();
  if (signature && s0.lastSignature === signature && !readBridgeCandidate()) {
    return { code: 200, ok: true, applied: false, message: "Session already current." };
  }

  // sandbox idle: queue as a candidate — validated on the next bootstrap
  saveBridgeCandidate({ cookies, device, pushedAt: Date.now() });
  const s = loadStore();
  s.lastSignature = signature;
  saveStore(s);
  return {
    code: 200,
    ok: true,
    applied: false,
    message: "Session queued — it connects automatically on the next play.",
  };
}
