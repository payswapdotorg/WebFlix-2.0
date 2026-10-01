import { expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "@/lib/scrypt";
import { signSessionJWT, verifySessionJWT } from "@/lib/jwt";
import { authKey } from "@/lib/auth-store";

const SECRET = "test-secret";
const payload = { sub: "u1", email: "a@b.c", name: "A", seed: "s" };

test("scrypt roundtrip verifies the correct password", () => {
  const h = hashPassword("hunter2");
  expect(h.startsWith("scrypt$")).toBe(true);
  expect(verifyPassword("hunter2", h)).toBe(true);
});

test("scrypt rejects wrong password and malformed hash", () => {
  const h = hashPassword("hunter2");
  expect(verifyPassword("hunter3", h)).toBe(false);
  expect(verifyPassword("hunter2", "plain")).toBe(false);
  expect(verifyPassword("hunter2", "scrypt$zz$00")).toBe(false);
});

test("session JWT roundtrip; wrong secret fails", async () => {
  const t = await signSessionJWT(payload, SECRET);
  const p = await verifySessionJWT(t, SECRET);
  expect(p?.email).toBe("a@b.c");
  expect(await verifySessionJWT(t, "other-secret")).toBeNull();
});

test("session JWT rejects tampering + expiry; auth key schema matches P2-AU", async () => {
  const t = await signSessionJWT(payload, SECRET);
  const bad = `${t.slice(0, -2)}zz`;
  expect(await verifySessionJWT(bad, SECRET)).toBeNull();
  const expired = await signSessionJWT(payload, SECRET, -10);
  expect(await verifySessionJWT(expired, SECRET)).toBeNull();
  expect(authKey("  A@B.Com ")).toBe("wf:auth:user:a@b.com");
});
