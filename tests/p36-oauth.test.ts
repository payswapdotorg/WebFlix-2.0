/**
 * WFX2-P36-C tests — the official Google OAuth CLIENT battery.
 *
 * The seam under test: src/lib/youtube/oauth.ts — the per-user OAuth lane
 * (the CSRF state, the AES-256-GCM token blobs, the token endpoints, the
 * identity read, the consent URL, the env contract). Every network call is
 * a mocked globalThis.fetch (NO network; the youtube-direct.test.ts
 * fetch-swap idiom); every outcome is the TYPED result, never a raw
 * exception.
 *
 * The isolation root is pinned here: the signed CSRF state minted for user
 * A is REJECTED for user B (the callback's session binding — a state minted
 * for one account can never finish a connect for another).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac, scryptSync } from "node:crypto";
import { DEV_AUTH_SECRET_FALLBACK } from "@/lib/auth/secret";
import {
  YOUTUBE_DATA_API_BASE,
  YOUTUBE_OAUTH_SCOPE,
  buildGoogleAuthUrl,
  createOAuthState,
  decryptSecret,
  encryptSecret,
  exchangeAuthorizationCode,
  fetchOwnChannelIdentity,
  oauthConfigured,
  oauthMissingEnv,
  oauthRedirectUri,
  refreshAccessToken,
  revokeToken,
  verifyOAuthState,
} from "@/lib/youtube/oauth";

/* ------------------------------------------------------------------ */
/* the fetch swap + env hygiene                                        */
/* ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];

/** The per-test responder (default: an empty 200 JSON body). */
let respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
  jsonResponse({});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A thrown named error (the AbortSignal.timeout() shape for TimeoutError). */
const namedError = (name: string, message = name): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "NEXTAUTH_SECRET",
  "YT_TOKEN_SECRET",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  fetchLog.length = 0;
  respond = () => jsonResponse({});
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
});

/* ------------------------------------------------------------------ */
/* the CSRF state — signed {uid, nonce, exp}, session-bound            */
/* ------------------------------------------------------------------ */

describe("createOAuthState / verifyOAuthState (the CSRF double-submit state)", () => {
  const USER_A = "u_state_a";
  const USER_B = "u_state_b";

  test("a state minted for user A verifies for user A; the cookie mirror + TTL ride along", async () => {
    const { state, cookieValue, maxAge } = await createOAuthState(USER_A);
    expect(state.split(".")).toHaveLength(4);
    expect(cookieValue).toBe(state); // the double-submit mirror
    expect(maxAge).toBe(600); // STATE_TTL 10 minutes
    expect(await verifyOAuthState(state, USER_A)).toBe(true);
  });

  test("THE ISOLATION ROOT: A's state is REJECTED for user B", async () => {
    const { state } = await createOAuthState(USER_A);
    expect(await verifyOAuthState(state, USER_B)).toBe(false);
  });

  test("a tampered signature is rejected", async () => {
    const { state } = await createOAuthState(USER_A);
    const parts = state.split(".");
    const sig = parts[3];
    parts[3] = sig.endsWith("A") ? sig.slice(0, -1) + "B" : sig.slice(0, -1) + "A";
    expect(await verifyOAuthState(parts.join("."), USER_A)).toBe(false);
  });

  test("a tampered exp segment is rejected (the signature check fails first)", async () => {
    const { state } = await createOAuthState(USER_A);
    const parts = state.split(".");
    parts[2] = String(Number(parts[2]) - 3_600_000); // forged "past" exp
    expect(await verifyOAuthState(parts.join("."), USER_A)).toBe(false);
  });

  test("an EXPIRED but validly-signed state is rejected (the true expiry law)", async () => {
    // createOAuthState only ever mints future exps, so the expired state is
    // RECOMPUTED here with the module's own public primitives (scrypt over
    // the same material + HMAC over {uid|nonce|past-exp}) — this pins the
    // exp branch itself, not just the signature check. Honest limitation:
    // the test re-derives the key; if the module's KDF changes, this pin
    // breaks loudly (a good thing for a security contract).
    const material = DEV_AUTH_SECRET_FALLBACK; // NEXTAUTH_SECRET/YT_TOKEN_SECRET deleted in beforeEach
    const key = scryptSync(material, "webflix-oauth-state", 32);
    const nonce = "testnonce1234567890";
    const exp = Date.now() - 60_000; // genuinely past
    const payload = `${USER_A}|${nonce}|${exp}`;
    const b64url = (buf: Buffer): string =>
      buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sig = b64url(createHmac("sha256", key).update(payload).digest());
    const state = [b64url(Buffer.from(USER_A, "utf8")), nonce, String(exp), sig].join(".");
    expect(await verifyOAuthState(state, USER_A)).toBe(false);
  });

  test("wrong part-counts are rejected (3 parts / 5 parts)", async () => {
    expect(await verifyOAuthState("a.b.c", USER_A)).toBe(false);
    expect(await verifyOAuthState("a.b.c.d.e", USER_A)).toBe(false);
  });

  test("null / undefined / empty are rejected", async () => {
    expect(await verifyOAuthState(null, USER_A)).toBe(false);
    expect(await verifyOAuthState(undefined, USER_A)).toBe(false);
    expect(await verifyOAuthState("", USER_A)).toBe(false);
  });

  test("two states for two users are distinct and cross-rejected (the per-user binding)", async () => {
    const a = await createOAuthState(USER_A);
    const b = await createOAuthState(USER_B);
    expect(a.state).not.toBe(b.state);
    expect(await verifyOAuthState(a.state, USER_B)).toBe(false);
    expect(await verifyOAuthState(b.state, USER_A)).toBe(false);
    expect(await verifyOAuthState(a.state, USER_A)).toBe(true);
    expect(await verifyOAuthState(b.state, USER_B)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* encryptSecret / decryptSecret — AES-256-GCM at rest                */
/* ------------------------------------------------------------------ */

describe("encryptSecret / decryptSecret (the token blobs)", () => {
  test("round-trip: decrypt(encrypt(x)) === x; the blob is a v1 4-part envelope", async () => {
    const blob = await encryptSecret("my-access-token-plain");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob.split(".")).toHaveLength(4);
    expect(await decryptSecret(blob)).toBe("my-access-token-plain");
  });

  test("distinct plaintexts produce distinct blobs (a real IV per encryption)", async () => {
    const a = await encryptSecret("tok_a");
    const b = await encryptSecret("tok_a");
    expect(a).not.toBe(b); // random IV — never deterministic
    expect(await decryptSecret(a)).toBe("tok_a");
    expect(await decryptSecret(b)).toBe("tok_a");
  });

  test("a corrupt blob (tampered ciphertext) → null (the GCM auth tag refuses)", async () => {
    const blob = await encryptSecret("secret");
    const parts = blob.split(".");
    const ct = parts[3];
    parts[3] = ct.endsWith("AA") ? ct.slice(0, -2) + "BB" : ct.slice(0, -2) + "AA";
    expect(await decryptSecret(parts.join("."))).toBeNull();
  });

  test("wrong-format blobs → null", async () => {
    expect(await decryptSecret("not-a-blob")).toBeNull();
    expect(await decryptSecret("v2.a.b.c")).toBeNull();
    expect(await decryptSecret("v1.only.two")).toBeNull();
    expect(await decryptSecret("")).toBeNull();
    expect(await decryptSecret(null)).toBeNull();
    expect(await decryptSecret(undefined)).toBeNull();
  });

  test("a blob encrypted under a ROTATED secret no longer decrypts (the honest re-auth)", async () => {
    const blob = await encryptSecret("secret-under-old-key");
    process.env.YT_TOKEN_SECRET = "a-dedicated-token-secret";
    expect(await decryptSecret(blob)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* the token endpoints — exchange + refresh                            */
/* ------------------------------------------------------------------ */

describe("exchangeAuthorizationCode (POST oauth2.googleapis.com/token)", () => {
  const opts = {
    code: "the-auth-code",
    clientId: "client-123",
    clientSecret: "secret-456",
    redirectUri: "https://app.example.com/api/connection/youtube/oauth/callback",
  };

  test("success: the body maps into the token set; the wire pins the form + endpoint", async () => {
    respond = () =>
      jsonResponse({
        access_token: "at_new",
        refresh_token: "rt_new",
        expires_in: 3600,
        scope: YOUTUBE_OAUTH_SCOPE,
      });
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        accessToken: "at_new",
        refreshToken: "rt_new",
        expiresIn: 3600,
        scope: YOUTUBE_OAUTH_SCOPE,
      });
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(fetchLog[0].init.method).toBe("POST");
    const headers = fetchLog[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(fetchLog[0].init.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-auth-code");
    expect(form.get("client_id")).toBe("client-123");
    expect(form.get("client_secret")).toBe("secret-456");
    expect(form.get("redirect_uri")).toBe(opts.redirectUri);
  });

  test("no refresh_token in the body → refreshToken null (the honest shape)", async () => {
    respond = () => jsonResponse({ access_token: "at", expires_in: 3600 });
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.refreshToken).toBeNull();
  });

  test("no scope in the body → the narrow default scope rides along", async () => {
    respond = () => jsonResponse({ access_token: "at", expires_in: 3600 });
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.scope).toBe(YOUTUBE_OAUTH_SCOPE);
  });

  test("missing access_token → malformed", async () => {
    respond = () => jsonResponse({ expires_in: 3600, refresh_token: "rt" });
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("the token response was malformed");
    }
  });

  test("missing expires_in → malformed", async () => {
    respond = () => jsonResponse({ access_token: "at" });
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("malformed");
  });

  test("400 {error:'invalid_grant'} → kind invalid-grant with the provider's message", async () => {
    respond = () =>
      jsonResponse({ error: "invalid_grant", error_description: "Code was already redeemed." }, 400);
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("invalid-grant");
      expect(r.status).toBe(400);
      expect(r.message).toBe("Code was already redeemed.");
    }
  });

  test("401 → kind invalid-grant", async () => {
    respond = () => jsonResponse({ error: "invalid_client" }, 401);
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("invalid-grant");
      expect(r.status).toBe(401);
    }
  });

  test("500 → kind http-error", async () => {
    respond = () => jsonResponse({ error: "server_error" }, 500);
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(500);
    }
  });

  test("fetch throws TimeoutError → kind timeout", async () => {
    respond = () => {
      throw namedError("TimeoutError");
    };
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("timeout");
      expect(r.status).toBe(0);
    }
  });

  test("fetch throws (other) → kind network", async () => {
    respond = () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await exchangeAuthorizationCode(opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("network");
      expect(r.status).toBe(0);
    }
  });
});

describe("refreshAccessToken (POST oauth2.googleapis.com/token)", () => {
  test("success: the refreshed set maps; the wire pins grant_type=refresh_token + the env client", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-refresh";
    process.env.GOOGLE_CLIENT_SECRET = "secret-refresh";
    respond = () => jsonResponse({ access_token: "at_fresh", expires_in: 3600 });
    const r = await refreshAccessToken("rt_stored");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.accessToken).toBe("at_fresh");
      expect(r.data.expiresIn).toBe(3600);
      expect(r.data.refreshToken).toBeNull(); // refresh responses carry no new refresh token
    }
    const form = new URLSearchParams(String(fetchLog[0].init.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt_stored");
    expect(form.get("client_id")).toBe("client-refresh");
    expect(form.get("client_secret")).toBe("secret-refresh");
  });

  test("a refused grant (400 invalid_grant) → kind invalid-grant (the needs-reauth signal)", async () => {
    respond = () =>
      jsonResponse({ error: "invalid_grant", error_description: "Token has been revoked." }, 400);
    const r = await refreshAccessToken("rt_revoked");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("invalid-grant");
      expect(r.status).toBe(400);
      expect(r.message).toBe("Token has been revoked.");
    }
  });
});

/* ------------------------------------------------------------------ */
/* revokeToken — best-effort, never throws                             */
/* ------------------------------------------------------------------ */

describe("revokeToken (POST oauth2.googleapis.com/revoke)", () => {
  test("200 → true; the wire pins the token on the query + POST", async () => {
    respond = () => new Response(null, { status: 200 });
    expect(await revokeToken("rt_to_revoke")).toBe(true);
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe("https://oauth2.googleapis.com/revoke?token=rt_to_revoke");
    expect(fetchLog[0].init.method).toBe("POST");
  });

  test("a non-2xx answer → false (never a claimed revoke)", async () => {
    respond = () => jsonResponse({ error: "invalid_token" }, 400);
    expect(await revokeToken("rt")).toBe(false);
  });

  test("fetch throws → false — NEVER a raw exception", async () => {
    respond = () => {
      throw new Error("network gone");
    };
    expect(await revokeToken("rt")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* fetchOwnChannelIdentity — channels.list(mine)                       */
/* ------------------------------------------------------------------ */

describe("fetchOwnChannelIdentity (GET channels.list mine=true)", () => {
  test("items[0] maps to the identity; the wire pins mine=true + the Bearer token", async () => {
    respond = () =>
      jsonResponse({
        items: [
          {
            id: "UC_own_1",
            snippet: {
              title: "Your Own Channel",
              thumbnails: { default: { url: "https://t/own.jpg" } },
            },
          },
        ],
      });
    const r = await fetchOwnChannelIdentity("tok_user");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        channelId: "UC_own_1",
        channelTitle: "Your Own Channel",
        channelThumbUrl: "https://t/own.jpg",
      });
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe(`${YOUTUBE_DATA_API_BASE}/channels?part=snippet&mine=true`);
    const headers = fetchLog[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_user");
  });

  test("empty items → ok with nulls (the honest degraded identity)", async () => {
    respond = () => jsonResponse({ items: [] });
    const r = await fetchOwnChannelIdentity("tok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ channelId: null, channelTitle: null, channelThumbUrl: null });
    }
  });

  test("a malformed body → kind malformed", async () => {
    respond = () => new Response("not json", { status: 200 });
    const r = await fetchOwnChannelIdentity("tok");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("channels.list response was malformed");
    }
  });

  test("403 → kind http-error with the status", async () => {
    respond = () => jsonResponse({ error: { code: 403 } }, 403);
    const r = await fetchOwnChannelIdentity("tok");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(403);
      expect(r.message).toBe("channels.list answered 403");
    }
  });

  test("fetch throws → kind network (typed, never a raw exception)", async () => {
    respond = () => {
      throw new Error("dns gone");
    };
    const r = await fetchOwnChannelIdentity("tok");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("network");
      expect(r.status).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* buildGoogleAuthUrl + the env contract                               */
/* ------------------------------------------------------------------ */

describe("buildGoogleAuthUrl (the consent page URL)", () => {
  test("carries the narrow scope, offline access, consent prompt, the state, and the redirect_uri", () => {
    const url = new URL(
      buildGoogleAuthUrl({
        clientId: "client-123",
        redirectUri: "https://app.example.com/api/connection/youtube/oauth/callback",
        state: "the-signed-state",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/connection/youtube/oauth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("the-signed-state");
  });
});

describe("the OAuth env contract (oauthConfigured / oauthMissingEnv / oauthRedirectUri)", () => {
  test("both vars present → configured, no missing env", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(oauthConfigured()).toBe(true);
    expect(oauthMissingEnv()).toEqual([]);
  });

  test("nothing set → the exact missingEnv list (the settings card's setup state)", () => {
    expect(oauthConfigured()).toBe(false);
    expect(oauthMissingEnv()).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  });

  test("only the id set → exactly the secret is missing", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    expect(oauthConfigured()).toBe(false);
    expect(oauthMissingEnv()).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });

  test("GOOGLE_OAUTH_REDIRECT_URI override wins verbatim", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://override.example.com/api/connection/youtube/oauth/callback";
    const req = new Request("https://elsewhere.example.com/ignored");
    expect(oauthRedirectUri(req)).toBe(
      "https://override.example.com/api/connection/youtube/oauth/callback",
    );
  });

  test("no override → derived from the request origin", () => {
    const req = new Request("https://app.example.com/watch?v=vid1");
    expect(oauthRedirectUri(req)).toBe(
      "https://app.example.com/api/connection/youtube/oauth/callback",
    );
    const dev = new Request("http://localhost:3000/settings");
    expect(oauthRedirectUri(dev)).toBe(
      "http://localhost:3000/api/connection/youtube/oauth/callback",
    );
  });
});
