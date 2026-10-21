/**
 * WFX2-P36-ACTION-PERSISTENCE — the official Google OAuth client (server-side
 * only). The per-user lane the work order requires:
 *
 *   accounts.google.com consent → code → token exchange (offline access) →
 *   the user's OWN channel identity (channels.list mine=true) → the
 *   connection record (encrypted tokens, wf:yt:conn:<userId>).
 *
 * Official references (the work order's list):
 *   - https://developers.google.com/youtube/data/guides/auth/server-side-web-apps
 *
 * Security contract (P36-B):
 *  - CSRF: the state param is HMAC-signed over {uid, nonce, exp} AND mirrored
 *    in a short-lived httpOnly cookie; the callback requires BOTH to match
 *    the signed-in user (double-submit + session binding);
 *  - tokens at rest: AES-256-GCM (key scrypt-derived from YT_TOKEN_SECRET,
 *    falling back to NEXTAUTH_SECRET so dev/tests run env-clean); plaintext
 *    tokens are never logged and never sent to the browser;
 *  - every network call carries an 8s abort budget and returns a TYPED
 *    outcome — never a raw exception, never a guessed success.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { authSecret } from "@/lib/auth/secret";

// ---------------------------------------------------------------------------
// Env contract
// ---------------------------------------------------------------------------

/** The narrowly-required scope for the supported write/read-back family. */
export const YOUTUBE_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

/** The OAuth endpoints (official, stable). */
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** The Data API base (the official-actions adapter shares it). */
export const YOUTUBE_DATA_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Network budget for every OAuth round-trip. */
const OAUTH_TIMEOUT_MS = 8_000;

/** True when the OAuth client is configured (both env vars present). */
export function oauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** The env vars missing for OAuth (the settings card's honest setup state). */
export function oauthMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  return missing;
}

/**
 * The redirect URI registered in the Google Cloud console. Env override
 * first (GOOGLE_OAUTH_REDIRECT_URI); else derived from the request origin —
 * on the production alias this is exactly the URL Google sees.
 */
export function oauthRedirectUri(req: Request): string {
  const override = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (override) return override;
  return new URL(req.url).origin + "/api/connection/youtube/oauth/callback";
}

// ---------------------------------------------------------------------------
// Token crypto — AES-256-GCM at rest (never plaintext in the store)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & {
  __webflixCryptoKeys?: Map<string, Promise<Buffer>>;
};
const keyCache: Map<string, Promise<Buffer>> = (g.__webflixCryptoKeys ??= new Map());

/** The key material: dedicated secret when set, else the NextAuth secret. */
function tokenSecretMaterial(): string {
  return process.env.YT_TOKEN_SECRET ?? authSecret();
}

async function deriveKey(purpose: string): Promise<Buffer> {
  const cacheKey = `${purpose}:${tokenSecretMaterial()}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = new Promise<Buffer>((resolve, reject) => {
      scryptCb(tokenSecretMaterial(), `webflix-${purpose}`, 32, (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      });
    });
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** Encrypt a secret (token/state) to a self-contained v1 blob. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await deriveKey("token-encryption");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

/**
 * Decrypt a v1 blob. Null when the blob is corrupt or the key rotated
 * (e.g. NEXTAUTH_SECRET changed) — the honest "re-authorize" answer,
 * never a crash, never a wrong plaintext.
 */
export async function decryptSecret(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const key = await deriveKey("token-encryption");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSRF state — signed {uid, nonce, exp}, double-submit with the cookie
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000;

async function stateKey(): Promise<Buffer> {
  return deriveKey("oauth-state");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint the state for a user: {state (param), cookieValue, maxAgeSeconds}. */
export async function createOAuthState(userId: string): Promise<{
  state: string;
  cookieValue: string;
  maxAge: number;
}> {
  const nonce = b64url(randomBytes(16));
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${userId}|${nonce}|${exp}`;
  const sig = b64url(createHmac("sha256", await stateKey()).update(payload).digest());
  const state = [b64url(Buffer.from(userId, "utf8")), nonce, String(exp), sig].join(".");
  return { state, cookieValue: state, maxAge: Math.floor(STATE_TTL_MS / 1000) };
}

/**
 * Verify a state value against the signed-in user. Returns true only when
 * the signature is valid, unexpired, and the embedded uid === userId.
 */
export async function verifyOAuthState(state: string | null | undefined, userId: string): Promise<boolean> {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 4) return false;
  const [uidB64, nonce, exp, sig] = parts;
  let uid: string;
  try {
    uid = Buffer.from(uidB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return false;
  }
  const payload = `${uid}|${nonce}|${exp}`;
  const expected = b64url(createHmac("sha256", await stateKey()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  if (uid !== userId) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > Date.now();
}

// ---------------------------------------------------------------------------
// The token endpoints — typed outcomes, never raw exceptions
// ---------------------------------------------------------------------------

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** seconds until the access token expires */
  expiresIn: number;
  scope: string;
}

export type OAuthTokenResult =
  | { ok: true; data: OAuthTokenSet }
  | { ok: false; kind: "invalid-grant" | "http-error" | "network" | "timeout" | "malformed"; status: number; message: string };

async function postForm(url: string, form: Record<string, string>): Promise<OAuthTokenResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, kind: timedOut ? "timeout" : "network", status: 0, message: timedOut ? "google token endpoint timed out" : "network error reaching the google token endpoint" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; error_description?: string } | null;
    const code = body?.error ?? "";
    const message = body?.error_description ?? `google token endpoint answered ${res.status}`;
    if (code === "invalid_grant" || code === "invalid_client" || res.status === 400 || res.status === 401) {
      return { ok: false, kind: "invalid-grant", status: res.status, message };
    }
    return { ok: false, kind: "http-error", status: res.status, message };
  }
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  } | null;
  if (!body || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    return { ok: false, kind: "malformed", status: res.status, message: "the token response was malformed" };
  }
  return {
    ok: true,
    data: {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresIn: body.expires_in,
      scope: typeof body.scope === "string" ? body.scope : YOUTUBE_OAUTH_SCOPE,
    },
  };
}

/** The consent-page URL (access_type=offline + prompt=consent → a refresh token every connect). */
export function buildGoogleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: YOUTUBE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchange the authorization code (the callback's one-time use). */
export function exchangeAuthorizationCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthTokenResult> {
  return postForm(GOOGLE_TOKEN_URL, {
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
}

/** Refresh the access token with the stored refresh token. */
export function refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult> {
  return postForm(GOOGLE_TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  });
}

/** Best-effort revoke (disconnect). Never throws; true when Google confirmed. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The identity read — the user's own channel (channels.list mine=true)
// ---------------------------------------------------------------------------

export interface OAuthChannelIdentity {
  channelId: string | null;
  channelTitle: string | null;
  channelThumbUrl: string | null;
}

/**
 * Resolve the connected account's own channel. The access token itself is
 * the proof of identity (a server-side HTTPS call) — no JWT verification
 * needed: whoever holds this token IS this channel per Google.
 */
export async function fetchOwnChannelIdentity(accessToken: string): Promise<
  { ok: true; data: OAuthChannelIdentity } | { ok: false; kind: "http-error" | "network" | "timeout" | "malformed"; status: number; message: string }
> {
  let res: Response;
  try {
    res = await fetch(`${YOUTUBE_DATA_API_BASE}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, kind: timedOut ? "timeout" : "network", status: 0, message: timedOut ? "youtube data api timed out" : "network error reaching the youtube data api" };
  }
  if (!res.ok) {
    return { ok: false, kind: "http-error", status: res.status, message: `channels.list answered ${res.status}` };
  }
  const body = (await res.json().catch(() => null)) as {
    items?: Array<{ id?: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }>;
  } | null;
  if (!body || !Array.isArray(body.items)) {
    return { ok: false, kind: "malformed", status: res.status, message: "channels.list response was malformed" };
  }
  const item = body.items[0];
  return {
    ok: true,
    data: {
      channelId: typeof item?.id === "string" ? item.id : null,
      channelTitle: typeof item?.snippet?.title === "string" ? item.snippet.title : null,
      channelThumbUrl: item?.snippet?.thumbnails?.default?.url ?? item?.snippet?.thumbnails?.medium?.url ?? null,
    },
  };
}
