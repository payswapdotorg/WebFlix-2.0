/// <reference types="bun-types" />
/**
 * WFX2-P2-AU tests — the WebFlix account domain (src/lib/auth/users.ts) +
 * the user store (src/lib/auth/user-store.ts): register validation +
 * uniqueness, scrypt verify (right/wrong password, salt uniqueness),
 * profile read/update validation, and the store's key schema + fallback
 * behavior (in-memory when Upstash env is absent; the injected REST seam
 * records SETs with NO TTL — user records never expire). Env-clean, no
 * network: the in-memory fallback is exactly what dev/tests run on.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  hashPassword,
  registerUser,
  verifyPasswordHash,
  verifyUser,
  getProfile,
  updateProfile,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/users";
import {
  getUserRecord,
  putUserRecord,
  resetUserStore,
  setUserStoreRest,
  userStoreKey,
  USER_KEY_PREFIX,
} from "@/lib/auth/user-store";
import type { WebFlixUserRecord } from "@/lib/auth/types";

const PASSWORD = "hunter2hunter2";

beforeEach(() => {
  resetUserStore();
  setUserStoreRest(null);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  resetUserStore();
  setUserStoreRest(null);
});

describe("registerUser — validation + uniqueness", () => {
  test("creates the account: profile shape, no password leak, record durably stored", async () => {
    const result = await registerUser({ email: "Viewer@WebFlix.test", password: PASSWORD, displayName: "Viewer" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBeTruthy();
    expect(result.user.email).toBe("viewer@webflix.test"); // normalized lowercase
    expect(result.user.displayName).toBe("Viewer");
    expect(typeof result.user.avatarSeed).toBe("number");
    // the durable record exists under the wf:auth:user: key, hash ≠ password
    const record = await getUserRecord("viewer@webflix.test");
    expect(record).not.toBeNull();
    expect(record!.passwordHash).not.toContain(PASSWORD);
    expect(record!.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // salt:hash
  });

  test("rejects an invalid email", async () => {
    const result = await registerUser({ email: "not-an-email", password: PASSWORD });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-email");
  });

  test("rejects a password shorter than 8 characters", async () => {
    const result = await registerUser({ email: "a@b.test", password: "short" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("weak-password");
    expect(result.message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  test("rejects a duplicate email (case-insensitive — one identity per email)", async () => {
    expect((await registerUser({ email: "dupe@webflix.test", password: PASSWORD })).ok).toBe(true);
    const again = await registerUser({ email: "DUPE@webflix.test", password: PASSWORD });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("duplicate-email");
  });
});

describe("scrypt hashing + verifyUser", () => {
  test("two users with the SAME password get different hashes (per-user salt)", async () => {
    await registerUser({ email: "one@webflix.test", password: PASSWORD });
    await registerUser({ email: "two@webflix.test", password: PASSWORD });
    const one = await getUserRecord("one@webflix.test");
    const two = await getUserRecord("two@webflix.test");
    expect(one!.passwordHash).not.toBe(two!.passwordHash);
  });

  test("verifyUser: the right password → the profile", async () => {
    await registerUser({ email: "op@webflix.test", password: PASSWORD, displayName: "Operator" });
    const user = await verifyUser("OP@webflix.test", PASSWORD); // case-insensitive email
    expect(user).not.toBeNull();
    expect(user!.displayName).toBe("Operator");
    expect(user!.email).toBe("op@webflix.test");
  });

  test("verifyUser: the wrong password → null (never a throw)", async () => {
    await registerUser({ email: "op@webflix.test", password: PASSWORD });
    expect(await verifyUser("op@webflix.test", "wrong-password-1")).toBeNull();
  });

  test("verifyUser: unknown email → null", async () => {
    expect(await verifyUser("ghost@webflix.test", PASSWORD)).toBeNull();
  });

  test("verifyPasswordHash: constant-time compare accepts the right password, rejects the wrong one", () => {
    const stored = hashPassword(PASSWORD);
    expect(verifyPasswordHash(stored, PASSWORD)).toBe(true);
    expect(verifyPasswordHash(stored, "wrong-password-1")).toBe(false);
    expect(verifyPasswordHash("not-a-valid-hash", PASSWORD)).toBe(false); // corrupt row → honest false
  });
});

describe("profile read/update", () => {
  test("updateProfile changes displayName + avatarSeed; getProfile reflects it", async () => {
    await registerUser({ email: "edit@webflix.test", password: PASSWORD, displayName: "Before" });
    const updated = await updateProfile("edit@webflix.test", { displayName: "After", avatarSeed: 210 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.user.displayName).toBe("After");
    expect(updated.user.avatarSeed).toBe(210);
    const profile = await getProfile("edit@webflix.test");
    expect(profile?.displayName).toBe("After");
  });

  test("updateProfile rejects an invalid name and an out-of-range hue", async () => {
    await registerUser({ email: "edit@webflix.test", password: PASSWORD });
    const name = await updateProfile("edit@webflix.test", { displayName: "   " });
    expect(name.ok).toBe(false);
    const hue = await updateProfile("edit@webflix.test", { avatarSeed: 999 });
    expect(hue.ok).toBe(false);
    if (hue.ok) return;
    expect(hue.code).toBe("invalid-avatar-seed");
  });

  test("getProfile on an unknown email → null", async () => {
    expect(await getProfile("ghost@webflix.test")).toBeNull();
  });
});

describe("the user store — key schema + fallback behavior", () => {
  test("the key schema is the cross-app contract: wf:auth:user:<lowercased email>", () => {
    expect(USER_KEY_PREFIX).toBe("wf:auth:user:");
    expect(userStoreKey("Viewer@WebFlix.test")).toBe("wf:auth:user:viewer@webflix.test");
  });

  test("no Upstash env → the in-memory fallback round-trips and survives across calls", async () => {
    const record: WebFlixUserRecord = {
      id: "u1",
      email: "fallback@webflix.test",
      displayName: "Fallback",
      passwordHash: hashPassword(PASSWORD),
      avatarSeed: 42,
      createdAt: new Date().toISOString(),
    };
    await putUserRecord(record);
    expect(await getUserRecord("fallback@webflix.test")).toMatchObject({ id: "u1", email: "fallback@webflix.test" });
    expect(await getUserRecord("missing@webflix.test")).toBeNull();
    // reset clears the local mirror (the test hook)
    resetUserStore();
    expect(await getUserRecord("fallback@webflix.test")).toBeNull();
  });

  test("the injected REST seam receives SET with NO expiry (records never expire) and serves GET", async () => {
    const commands: string[][] = [];
    const durable = new Map<string, string>();
    setUserStoreRest(async (cmds) => {
      commands.push(...cmds);
      const results: unknown[] = [];
      for (const [op, key, value] of cmds) {
        if (op === "SET") {
          durable.set(key, value);
          results.push("OK");
        } else if (op === "GET") {
          results.push(durable.get(key) ?? null);
        } else {
          results.push(null);
        }
      }
      return results;
    });

    const created = await registerUser({ email: "durable@webflix.test", password: PASSWORD });
    expect(created.ok).toBe(true);
    const setCommand = commands.find((c) => c[0] === "SET");
    expect(setCommand).toBeDefined();
    expect(setCommand![1]).toBe("wf:auth:user:durable@webflix.test");
    // NO TTL flag on the write — user records are permanent by contract
    expect(setCommand!.slice(3)).toEqual([]);
    // the durable value round-trips as the stored record
    const raw = durable.get("wf:auth:user:durable@webflix.test");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).email).toBe("durable@webflix.test");
  });
});
