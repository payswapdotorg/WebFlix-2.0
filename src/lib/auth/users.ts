/**
 * WFX2-P2-AU — the WebFlix account domain: register / verify / profile.
 *
 * Passwords: node:crypto scrypt (NO new deps — the law), per-user random
 * salt, constant-time comparison (timingSafeEqual). No PII beyond what
 * YouTube's own profile holds: email, display name, avatar color seed.
 *
 * THE ARCHITECTURE LAW: a WebFlix account is a WebFlix-local identity that
 * FRONTS the operator's YouTube session — it never creates or fabricates a
 * YouTube account. Signed-in copy stays honest about this.
 */
import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { getUserRecord, putUserRecord } from "./user-store";
import { PASSWORD_MIN_LENGTH } from "./types";
import type { WebFlixSessionUser, WebFlixUserRecord } from "./types";

// ---------------------------------------------------------------------------
// Validation — the register contract (email + password ≥ 8)
// ---------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize + validate an email; returns the lowercase email or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export type RegistrationErrorCode =
  | "invalid-email"
  | "weak-password"
  | "invalid-display-name"
  | "duplicate-email";

export type RegistrationResult =
  | { ok: true; user: WebFlixSessionUser }
  | { ok: false; code: RegistrationErrorCode; message: string };

export type ProfileUpdateCode = "invalid-display-name" | "invalid-avatar-seed";

export type ProfileUpdateResult =
  | { ok: true; user: WebFlixSessionUser }
  | { ok: false; code: ProfileUpdateCode; message: string };

// ---------------------------------------------------------------------------
// scrypt hashing — "<saltHex>:<hashHex>", constant-time verify
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

/** Hash a password with a fresh per-user salt (node:crypto scrypt). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time password check against a stored `salt:hash` value. */
export function verifyPasswordHash(stored: string, candidate: string): boolean {
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const salt = stored.slice(0, sep);
  const expected = Buffer.from(stored.slice(sep + 1), "hex");
  if (expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(candidate, salt, expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Register / verify / profile
// ---------------------------------------------------------------------------

function toProfile(record: WebFlixUserRecord): WebFlixSessionUser {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    avatarSeed: record.avatarSeed,
  };
}

function defaultDisplayName(email: string): string {
  const local = email.slice(0, email.indexOf("@"));
  return local.length > 0 ? local.slice(0, MAX_DISPLAY_NAME_LENGTH) : "WebFlix member";
}

/**
 * Register a WebFlix account. Validates the email shape, enforces the
 * password minimum (≥ 8 chars), and guarantees email uniqueness (the store
 * key IS the lowercased email — one record per identity). NEVER stores or
 * logs the raw password.
 */
export async function registerUser(input: {
  email: unknown;
  password: unknown;
  displayName?: unknown;
}): Promise<RegistrationResult> {
  const email = normalizeEmail(input.email);
  if (!email) {
    return { ok: false, code: "invalid-email", message: "Enter a valid email address" };
  }
  if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: "weak-password",
      message: `Use ${MIN_PASSWORD_LENGTH} characters or more for your password`,
    };
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, code: "weak-password", message: "That password is too long" };
  }
  let displayName: string;
  if (input.displayName === undefined || input.displayName === null || input.displayName === "") {
    displayName = defaultDisplayName(email);
  } else if (typeof input.displayName !== "string") {
    return { ok: false, code: "invalid-display-name", message: "Enter a valid name" };
  } else {
    displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return {
        ok: false,
        code: "invalid-display-name",
        message: `Use 1–${MAX_DISPLAY_NAME_LENGTH} characters for your name`,
      };
    }
  }

  if ((await getUserRecord(email)) !== null) {
    return {
      ok: false,
      code: "duplicate-email",
      message: "That email already has a WebFlix account. Sign in instead?",
    };
  }

  const record: WebFlixUserRecord = {
    id: randomUUID(),
    email,
    displayName,
    passwordHash: hashPassword(input.password),
    avatarSeed: randomInt(0, 360),
    createdAt: new Date().toISOString(),
  };
  await putUserRecord(record);
  return { ok: true, user: toProfile(record) };
}

/**
 * Verify credentials for the NextAuth authorize callback. Returns the
 * profile on success, null on any failure (unknown email / wrong password /
 * corrupt record) — never throws, never leaks which half failed.
 */
export async function verifyUser(email: unknown, password: unknown): Promise<WebFlixSessionUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== "string" || password.length === 0) return null;
  const record = await getUserRecord(normalized);
  if (!record) return null;
  if (!verifyPasswordHash(record.passwordHash, password)) return null;
  return toProfile(record);
}

/** Read a profile (the account page's identity card). Null when unknown. */
export async function getProfile(email: unknown): Promise<WebFlixSessionUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const record = await getUserRecord(normalized);
  return record ? toProfile(record) : null;
}

/**
 * Update the profile (display name and/or avatar color seed). The email is
 * the immutable identity — it cannot change here. Returns the updated
 * profile, or null when the account no longer exists.
 */
export async function updateProfile(
  email: unknown,
  update: { displayName?: unknown; avatarSeed?: unknown },
): Promise<ProfileUpdateResult | { ok: false; code: "not-found"; message: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { ok: false, code: "not-found", message: "Account not found" };
  }
  const record = await getUserRecord(normalized);
  if (!record) {
    return { ok: false, code: "not-found", message: "Account not found" };
  }

  const next: WebFlixUserRecord = { ...record };

  if (update.displayName !== undefined) {
    if (typeof update.displayName !== "string") {
      return { ok: false, code: "invalid-display-name", message: "Enter a valid name" };
    }
    const displayName = update.displayName.trim();
    if (displayName.length < 1 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return {
        ok: false,
        code: "invalid-display-name",
        message: `Use 1–${MAX_DISPLAY_NAME_LENGTH} characters for your name`,
      };
    }
    next.displayName = displayName;
  }

  if (update.avatarSeed !== undefined) {
    if (
      typeof update.avatarSeed !== "number" ||
      !Number.isInteger(update.avatarSeed) ||
      update.avatarSeed < 0 ||
      update.avatarSeed > 359
    ) {
      return { ok: false, code: "invalid-avatar-seed", message: "Pick a valid avatar color" };
    }
    next.avatarSeed = update.avatarSeed;
  }

  await putUserRecord(next);
  return { ok: true, user: toProfile(next) };
}
