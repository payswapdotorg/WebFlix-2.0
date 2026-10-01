/// <reference types="bun-types" />
/**
 * WFX2-P2-AU tests — the auth ROUTE contracts:
 *  - GET /api/auth/session: guest → `{}`; a minted stock session cookie →
 *    the full user claims (the JWT session route contract);
 *  - POST /api/auth/register: 201 / duplicate 409 / validation 400;
 *  - POST /api/auth/callback/credentials: wrong password → 401, right
 *    password → 200 + the session cookie (then /api/auth/session answers
 *    the registered user — the end-to-end sign-in contract);
 *  - PATCH /api/auth/profile: guest → 401, signed-in → 200.
 *
 * The NextAuth app-router handler reads cookies via next/headers, which is
 * request-scoped in the real server — the mock wires the mock-holder to
 * each request (the verified pattern from the lane probe; mock.module is
 * restored in afterAll). No network anywhere.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

/* ---- the next/headers mock (registered BEFORE the route import) ---- */
let currentCookies: { name: string; value: string }[] = [];
let currentHeaders: [string, string][] = [];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNextHeaders = { ...require("next/headers") } as Record<string, unknown>;
mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => currentCookies }),
  headers: async () => currentHeaders,
}));

import { encode } from "next-auth/jwt";
import { DEV_AUTH_SECRET_FALLBACK, authSecret } from "@/lib/auth/secret";
import { resetUserStore } from "@/lib/auth/user-store";
import { registerUser } from "@/lib/auth/users";

import { GET as authGet, POST as authPost } from "@/app/api/auth/[...nextauth]/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { PATCH as profileRoute } from "@/app/api/auth/profile/route";

const SECRET = authSecret();

/** Invoke the NextAuth handler for one /api/auth/<action> path. */
async function callAuth(path: string, init?: RequestInit): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/auth/${path}`, init as never);
  currentHeaders = [...req.headers.entries()];
  currentCookies = [];
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    currentCookies = cookieHeader.split(";").map((part) => {
      const i = part.indexOf("=");
      return { name: part.slice(0, i).trim(), value: decodeURIComponent(part.slice(i + 1).trim()) };
    });
  }
  return authGet(req, { params: Promise.resolve({ nextauth: path.split("/") }) } as never) as unknown as Response;
}

/** A direct JSON request for the plain (non-NextAuth) auth routes. */
const jsonReq = (url: string, method: string, body: unknown, cookie?: string): NextRequest =>
  new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as never);

/** Mint a stock session cookie (the same encoder the handler uses). */
async function mintedCookie(): Promise<string> {
  const token = await encode({
    token: { sub: "u_mint", name: "Minted User", email: "minted@webflix.test", avatarSeed: 120 },
    secret: SECRET,
  });
  return `next-auth.session-token=${token}`;
}

beforeEach(() => {
  resetUserStore();
});

afterEach(() => {
  resetUserStore();
  delete process.env.NEXTAUTH_SECRET;
});

afterAll(() => {
  mock.module("next/headers", () => realNextHeaders);
});

// ---------------------------------------------------------------------------

describe("GET /api/auth/session — the JWT session route contract", () => {
  test("guest (no cookie) → 200 {}", async () => {
    const res = await callAuth("session");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  test("a minted stock session cookie → the full WebFlix claims", async () => {
    const res = await callAuth("session", { headers: { cookie: await mintedCookie() } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      user?: { id?: string; name?: string; email?: string; avatarSeed?: number };
      expires?: string;
    };
    expect(data.user?.id).toBe("u_mint");
    expect(data.user?.name).toBe("Minted User");
    expect(data.user?.email).toBe("minted@webflix.test");
    expect(data.user?.avatarSeed).toBe(120);
    expect(typeof data.expires).toBe("string");
  });

  test("a cookie signed with the WRONG secret → guest {}", async () => {
    const token = await encode({
      token: { sub: "u_evil", name: "Evil" },
      secret: "not-the-real-secret",
    });
    const res = await callAuth("session", { headers: { cookie: `next-auth.session-token=${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});

describe("POST /api/auth/register", () => {
  test("valid input → 201 with the profile (no password hash in the response)", async () => {
    const res = await registerRoute(
      jsonReq("http://localhost:3000/api/auth/register", "POST", {
        email: "new@webflix.test",
        password: "password123",
        displayName: "New Viewer",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user?: Record<string, unknown> };
    expect(body.user).toMatchObject({ email: "new@webflix.test", displayName: "New Viewer" });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("password123");
  });

  test("duplicate email → 409 with the honest message", async () => {
    await registerUser({ email: "dup@webflix.test", password: "password123" });
    const res = await registerRoute(
      jsonReq("http://localhost:3000/api/auth/register", "POST", {
        email: "dup@webflix.test",
        password: "password123",
      })
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.code).toBe("duplicate-email");
    expect(body.error).toContain("Sign in instead");
  });

  test("invalid email → 400; short password → 400", async () => {
    const badEmail = await registerRoute(
      jsonReq("http://localhost:3000/api/auth/register", "POST", { email: "nope", password: "password123" })
    );
    expect(badEmail.status).toBe(400);
    const shortPw = await registerRoute(
      jsonReq("http://localhost:3000/api/auth/register", "POST", { email: "ok@webflix.test", password: "short" })
    );
    expect(shortPw.status).toBe(400);
    expect(((await shortPw.json()) as { code?: string }).code).toBe("weak-password");
  });
});

describe("POST /api/auth/callback/credentials — the sign-in contract", () => {
  async function signIn(email: string, password: string): Promise<Response> {
    const csrfRes = await callAuth("csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookie = (csrfRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return callAuth("callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    });
  }

  test("wrong password → 401 (never a session cookie)", async () => {
    await registerUser({ email: "op@webflix.test", password: "password123" });
    const res = await signIn("op@webflix.test", "wrong-password-1");
    expect(res.status).toBe(401);
    const setCookies = res.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((c) => c.startsWith("next-auth.session-token="))).toBe(false);
  });

  test("right password → 200 + the session cookie; /api/auth/session answers the registered user", async () => {
    await registerUser({ email: "op@webflix.test", password: "password123", displayName: "The Operator" });
    const res = await signIn("op@webflix.test", "password123");
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = setCookies.find((c) => c.startsWith("next-auth.session-token="));
    expect(sessionCookie).toBeDefined();

    // the end-to-end contract: the fresh cookie answers the session claims
    const sessionRes = await callAuth("session", {
      headers: { cookie: sessionCookie!.split(";")[0] },
    });
    expect(sessionRes.status).toBe(200);
    const data = (await sessionRes.json()) as {
      user?: { id?: string; name?: string; email?: string; avatarSeed?: number };
    };
    expect(data.user?.email).toBe("op@webflix.test");
    expect(data.user?.name).toBe("The Operator");
    expect(typeof data.user?.avatarSeed).toBe("number");
    expect(data.user?.id).toBeTruthy();
  });

  test("unknown email → 401 (same shape as a wrong password)", async () => {
    const res = await signIn("ghost@webflix.test", "password123");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/auth/profile", () => {
  test("guest → the uniform 401 (the store is never touched)", async () => {
    const res = await profileRoute(
      jsonReq("http://localhost:3000/api/auth/profile", "PATCH", { displayName: "X" })
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
  });

  test("signed-in → 200 with the updated profile", async () => {
    // register the MINTED cookie's identity (minted@webflix.test) — the
    // route updates the session user's own profile
    const created = await registerUser({ email: "minted@webflix.test", password: "password123" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cookie = await mintedCookie();
    const res = await profileRoute(
      jsonReq("http://localhost:3000/api/auth/profile", "PATCH", { displayName: "Edited", avatarSeed: 90 }, cookie)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { displayName?: string; avatarSeed?: number } };
    expect(body.user?.displayName).toBe("Edited");
    expect(body.user?.avatarSeed).toBe(90);
  });
});

describe("the dev secret fallback law", () => {
  test("env-clean runs fall back to the documented insecure dev constant", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(authSecret()).toBe(DEV_AUTH_SECRET_FALLBACK);
    expect(DEV_AUTH_SECRET_FALLBACK).toContain("insecure");
  });
});
