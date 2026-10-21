/**
 * WFX2-P36-C tests — the OAuth ROUTE battery (the per-user connect flow).
 *
 * The routes under test, invoked directly with minted session cookies (the
 * action-routes.test.ts idiom — NO network: every googleapis fetch is a
 * mocked globalThis.fetch):
 *
 *  - GET  /api/connection/youtube/oauth/start — guest 401, the honest
 *    not-configured 503, the 303 consent redirect carrying the signed state
 *    + the httpOnly double-submit cookie;
 *  - GET  /api/connection/youtube/oauth/callback — the ?ytc= outcome codes
 *    (state / signin / denied / exchange / connected), the session-bound
 *    state verification, the server-side code exchange, the identity read,
 *    and the connection record stored for THE SAME signed-in user;
 *  - POST /api/connection/youtube/disconnect — best-effort revoke + removal;
 *  - GET  /api/connection/youtube — the status envelopes (kept minimal:
 *    tests/settings-system.test.tsx owns the copy pins).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GET as startGet, OAUTH_STATE_COOKIE } from "@/app/api/connection/youtube/oauth/start/route";
import { GET as callbackGet } from "@/app/api/connection/youtube/oauth/callback/route";
import { POST as disconnectPost } from "@/app/api/connection/youtube/disconnect/route";
import { GET as statusGet } from "@/app/api/connection/youtube/route";
import {
  createOAuthState,
  decryptSecret,
  encryptSecret,
  verifyOAuthState,
} from "@/lib/youtube/oauth";
import {
  getYouTubeConnection,
  putYouTubeConnection,
  resetYoutubeConnectionStore,
} from "@/lib/auth/youtube-connection-store";
import { mintSessionCookie } from "./helpers";
import { NextRequest } from "next/server";

/* ------------------------------------------------------------------ */
/* fixtures + env hygiene                                              */
/* ------------------------------------------------------------------ */

const USER_A = "u_route_a";
const USER_B = "u_route_b";

let COOKIE_A = "";
let COOKIE_B = "";

const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];

/** The per-test google responder (default: an empty 200 JSON body). */
let respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
  jsonResponse({});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "YT_COOKIES",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  COOKIE_A = await mintSessionCookie({ sub: USER_A });
  COOKIE_B = await mintSessionCookie({ sub: USER_B });
});

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  fetchLog.length = 0;
  respond = () => jsonResponse({});
  resetYoutubeConnectionStore();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    fetchLog.push({ url: u, init: i });
    return respond(u, i);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }
  resetYoutubeConnectionStore();
});

const req = (url: string, cookie?: string): NextRequest =>
  new NextRequest(url, { headers: cookie ? { cookie } : {} });

const googleCalls = (fragment: string): { url: string; init: RequestInit }[] =>
  fetchLog.filter((c) => c.url.includes(fragment));

/** A signed-in request carrying BOTH the session and a state cookie. */
const withStateCookie = (cookie: string, state: string): string =>
  `${cookie}; ${OAUTH_STATE_COOKIE}=${state}`;

const ytcOf = (location: string | null): string | null => {
  if (!location) return null;
  return new URL(location).searchParams.get("ytc");
};

/* ------------------------------------------------------------------ */
/* start — the consent redirect                                        */
/* ------------------------------------------------------------------ */

describe("GET /api/connection/youtube/oauth/start", () => {
  test("guest → the uniform 401; ZERO upstream calls", async () => {
    const res = await startGet(req("http://localhost/api/connection/youtube/oauth/start"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
    expect(fetchLog).toHaveLength(0);
  });

  test("OAuth not configured → the honest 503 envelope (the exact missing vars + the redirect URI to register)", async () => {
    const res = await startGet(
      req("http://localhost/api/connection/youtube/oauth/start", COOKIE_A),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: string;
      missing: string[];
      redirectUri: string;
      setup: string;
    };
    expect(body.error).toBe("youtube-oauth-not-configured");
    expect(body.missing).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(body.redirectUri).toBe(
      "http://localhost/api/connection/youtube/oauth/callback",
    );
    expect(body.setup).toContain("GOOGLE_CLIENT_ID");
    expect(fetchLog).toHaveLength(0);
  });

  test("configured → 303 to accounts.google.com with the signed state + the httpOnly double-submit cookie", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    const res = await startGet(
      req("http://localhost/api/connection/youtube/oauth/start", COOKIE_A),
    );
    expect(res.status).toBe(303);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const consent = new URL(location!);
    expect(consent.origin + consent.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(consent.searchParams.get("client_id")).toBe("client-route");
    expect(consent.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/connection/youtube/oauth/callback",
    );
    expect(consent.searchParams.get("response_type")).toBe("code");
    expect(consent.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/youtube.force-ssl",
    );
    expect(consent.searchParams.get("access_type")).toBe("offline");
    expect(consent.searchParams.get("prompt")).toBe("consent");
    const state = consent.searchParams.get("state");
    expect(state).toBeTruthy();
    // the state is SIGNED for the acting user (the callback's binding anchor)
    expect(await verifyOAuthState(state, USER_A)).toBe(true);
    expect(await verifyOAuthState(state, USER_B)).toBe(false);
    // the double-submit cookie: httpOnly, path-scoped to the callback, same value
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const raw = setCookies[0];
    expect(raw).toContain(`${OAUTH_STATE_COOKIE}=${state}`);
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("Path=/api/connection/youtube/oauth/callback");
    expect(raw).toContain("Max-Age=600");
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(fetchLog).toHaveLength(0); // no upstream call yet — consent is a redirect
  });
});

/* ------------------------------------------------------------------ */
/* callback — the outcome codes + the connection binding               */
/* ------------------------------------------------------------------ */

describe("GET /api/connection/youtube/oauth/callback (the ?ytc= outcome codes)", () => {
  const CALLBACK = "http://localhost/api/connection/youtube/oauth/callback";

  test("guest → ytc=signin (the binding anchor is the signed-in account)", async () => {
    const res = await callbackGet(req(`${CALLBACK}?code=x&state=y`));
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("signin");
  });

  test("state cookie + param MISMATCH → ytc=state (the double-submit law)", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    const a = await createOAuthState(USER_A);
    const b = await createOAuthState(USER_A);
    const res = await callbackGet(
      req(
        `${CALLBACK}?code=the_code&state=${encodeURIComponent(a.state)}`,
        withStateCookie(COOKIE_A, b.state),
      ),
    );
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("state");
    expect(fetchLog).toHaveLength(0); // rejected before ANY Google call
  });

  test("the state belongs to ANOTHER signed-in user → ytc=state (the session binding)", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    // minted for B, but A is the one signed in — B's state can never finish A's connect
    const bState = await createOAuthState(USER_B);
    const res = await callbackGet(
      req(
        `${CALLBACK}?code=the_code&state=${encodeURIComponent(bState.state)}`,
        withStateCookie(COOKIE_A, bState.state),
      ),
    );
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("state");
    expect(fetchLog).toHaveLength(0);
  });

  test("the provider reports a denial (error param) → ytc=denied", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    const a = await createOAuthState(USER_A);
    const res = await callbackGet(
      req(
        `${CALLBACK}?error=access_denied&state=${encodeURIComponent(a.state)}`,
        withStateCookie(COOKIE_A, a.state),
      ),
    );
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("denied");
  });

  test("not configured → ytc=exchange (the honest setup state, no Google call)", async () => {
    const a = await createOAuthState(USER_A);
    const res = await callbackGet(
      req(
        `${CALLBACK}?code=the_code&state=${encodeURIComponent(a.state)}`,
        withStateCookie(COOKIE_A, a.state),
      ),
    );
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("exchange");
    expect(fetchLog).toHaveLength(0);
  });

  test("the code exchange FAILS (invalid_grant) → ytc=exchange; NOTHING is stored", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    respond = () =>
      jsonResponse({ error: "invalid_grant", error_description: "Code was already redeemed." }, 400);
    const a = await createOAuthState(USER_A);
    const res = await callbackGet(
      req(
        `${CALLBACK}?code=stale_code&state=${encodeURIComponent(a.state)}`,
        withStateCookie(COOKIE_A, a.state),
      ),
    );
    expect(res.status).toBe(303);
    expect(ytcOf(res.headers.get("location"))).toBe("exchange");
    expect(googleCalls("oauth2.googleapis.com/token")).toHaveLength(1); // the one honest attempt
    expect(await getYouTubeConnection(USER_A)).toBeNull(); // no connection was invented
  });

  test("SUCCESS → the connection stored for THE SAME signed-in user, the identity read from channels.list(mine), ytc=connected", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    respond = (url) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({
          access_token: "at_route_new",
          refresh_token: "rt_route_new",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/youtube.force-ssl",
        });
      }
      if (url.includes("/youtube/v3/channels")) {
        return jsonResponse({
          items: [
            {
              id: "UC_route_own",
              snippet: {
                title: "Route Own Channel",
                thumbnails: { default: { url: "https://t/route.jpg" } },
              },
            },
          ],
        });
      }
      return jsonResponse({});
    };
    const a = await createOAuthState(USER_A);
    const res = await callbackGet(
      req(
        `${CALLBACK}?code=the_fresh_code&state=${encodeURIComponent(a.state)}`,
        withStateCookie(COOKIE_A, a.state),
      ),
    );
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/settings");
    expect(ytcOf(location)).toBe("connected");

    // the exchange carried the code server-side (the secret never leaves)
    const exchange = googleCalls("oauth2.googleapis.com/token");
    expect(exchange).toHaveLength(1);
    const form = new URLSearchParams(String(exchange[0].init.body));
    expect(form.get("code")).toBe("the_fresh_code");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("client-route");
    expect(form.get("client_secret")).toBe("secret-route");

    // the identity read ran with the fresh access token (channels.list mine)
    const identity = googleCalls("/youtube/v3/channels");
    expect(identity).toHaveLength(1);
    expect(identity[0].url).toContain("mine=true");
    const headers = identity[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer at_route_new");

    // THE BINDING: the record belongs to the SAME signed-in user, encrypted
    const stored = await getYouTubeConnection(USER_A);
    expect(stored).not.toBeNull();
    if (stored) {
      expect(stored.userId).toBe(USER_A);
      expect(stored.channelId).toBe("UC_route_own");
      expect(stored.channelTitle).toBe("Route Own Channel");
      expect(stored.channelThumbUrl).toBe("https://t/route.jpg");
      expect(stored.status).toBe("connected");
      expect(stored.scope).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
      expect(await decryptSecret(stored.accessTokenEnc)).toBe("at_route_new");
      expect(await decryptSecret(stored.refreshTokenEnc)).toBe("rt_route_new");
      expect(stored.accessExpiresAt).toBeGreaterThan(Date.now());
    }
    // and ONLY for that user — B still has nothing
    expect(await getYouTubeConnection(USER_B)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* disconnect — best-effort revoke + removal                           */
/* ------------------------------------------------------------------ */

describe("POST /api/connection/youtube/disconnect", () => {
  const disconnect = (): NextRequest =>
    req("http://localhost/api/connection/youtube/disconnect", COOKIE_A);

  test("guest → the uniform 401", async () => {
    const res = await disconnectPost(req("http://localhost/api/connection/youtube/disconnect"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
  });

  test("with a connected record: the refresh token is revoked at Google (best-effort), then the record is removed", async () => {
    await putYouTubeConnection({
      userId: USER_A,
      channelId: "UC_route_own",
      channelTitle: "Route Own Channel",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("at_route"),
      refreshTokenEnc: await encryptSecret("rt_route_stored"),
      accessExpiresAt: Date.now() + 3_600_000,
      status: "connected",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const res = await disconnectPost(disconnect());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok?: boolean; effect?: string }).effect).toBe("disconnected");
    // the revoke: Google's endpoint with the STORED refresh token
    const revokes = googleCalls("oauth2.googleapis.com/revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0].url).toBe("https://oauth2.googleapis.com/revoke?token=rt_route_stored");
    expect(revokes[0].init.method).toBe("POST");
    // the binding is gone — the user's actions honestly require a re-connect
    expect(await getYouTubeConnection(USER_A)).toBeNull();
  });

  test("with NO record → ok (idempotent), ZERO revoke calls", async () => {
    const res = await disconnectPost(disconnect());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);
    expect(fetchLog).toHaveLength(0);
  });

  test("Google being unreachable still disconnects locally (best-effort revoke, honest removal)", async () => {
    await putYouTubeConnection({
      userId: USER_A,
      channelId: null,
      channelTitle: null,
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("at_route"),
      refreshTokenEnc: await encryptSecret("rt_route_stored"),
      accessExpiresAt: Date.now() + 3_600_000,
      status: "connected",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    respond = () => {
      throw new Error("network gone");
    };
    const res = await disconnectPost(disconnect());
    expect(res.status).toBe(200);
    expect(await getYouTubeConnection(USER_A)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* status — the four envelopes (minimal: settings-system owns the copy) */
/* ------------------------------------------------------------------ */

describe("GET /api/connection/youtube (the status envelopes — copy pins live in settings-system.test.tsx)", () => {
  test("guest → the uniform 401", async () => {
    const res = await statusGet(req("http://localhost/api/connection/youtube"));
    expect(res.status).toBe(401);
  });

  test("no GOOGLE env → status not-configured", async () => {
    const res = await statusGet(req("http://localhost/api/connection/youtube", COOKIE_A));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean };
    expect(data.status).toBe("not-configured");
    expect(data.connected).toBe(false);
  });

  test("configured + no connection → status not-connected", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    const res = await statusGet(req("http://localhost/api/connection/youtube", COOKIE_A));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean };
    expect(data.status).toBe("not-connected");
    expect(data.connected).toBe(false);
  });

  test("configured + the user's own connected record → status connected with the account block", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    await putYouTubeConnection({
      userId: USER_A,
      channelId: "UC_route_own",
      channelTitle: "Route Own Channel",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("at_route"),
      refreshTokenEnc: await encryptSecret("rt_route"),
      accessExpiresAt: Date.now() + 3_600_000,
      status: "connected",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const res = await statusGet(req("http://localhost/api/connection/youtube", COOKIE_A));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      connected: boolean;
      account?: { channelId: string | null };
    };
    expect(data.status).toBe("connected");
    expect(data.connected).toBe(true);
    expect(data.account?.channelId).toBe("UC_route_own");
  });

  test("a needs_reauth record → status needs-reauth", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-route";
    process.env.GOOGLE_CLIENT_SECRET = "secret-route";
    await putYouTubeConnection({
      userId: USER_A,
      channelId: "UC_route_own",
      channelTitle: null,
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("at_route"),
      refreshTokenEnc: null,
      accessExpiresAt: Date.now() + 3_600_000,
      status: "needs_reauth",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const res = await statusGet(req("http://localhost/api/connection/youtube", COOKIE_A));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean };
    expect(data.status).toBe("needs-reauth");
    expect(data.connected).toBe(false);
  });
});
