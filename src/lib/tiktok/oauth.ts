/**
 * P94-b — the TikTok Login Kit OAuth seam (the gap report's G2): the P36
 * pattern's second-source twin of src/lib/youtube/oauth.ts, SELF-CONTAINED —
 * the lib/tiktok import law forbids @/lib/youtube imports, so the AES-256-GCM
 * token helpers are this module's own copies of the P36 idiom (keyed from
 * TIKTOK_TOKEN_SECRET ?? NEXTAUTH_SECRET).
 *
 * What this seam owns: the configured/missing-env verdict, the redirect-URI
 * derivation, the state mint/verify (HMAC-bound to the user + the double-
 * submit cookie the routes carry), the token exchange, and the user-info
 * read — every tiktok.com STRING comes from the URL law (urls.ts
 * tiktokAuthorizeUrl); the API host (open.tiktokapis.com) is TikTok's
 * documented REST endpoint, not a web-domain URL.
 *
 * HONESTY: with no developer app provisioned (TIKTOK_CLIENT_KEY/SECRET
 * absent), the deployment answers not-configured — the same deployment-truth
 * law P38 pinned for YouTube. Nothing here fakes a grant.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "@/lib/auth/secret";
import { tiktokAuthorizeUrl } from "./urls";

export const TIKTOK_OAUTH_SCOPE = "user.info.basic,user.info.profile";
export const TIKTOK_STATE_COOKIE = "wf_tt_oauth_state";

/** The documented Login Kit token + user-info endpoints (open platform API). */
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_URL = "https://open.tiktokapis.com/v2/user/info/";

export function oauthConfigured(): boolean {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export function oauthMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.TIKTOK_CLIENT_KEY) missing.push("TIKTOK_CLIENT_KEY");
  if (!process.env.TIKTOK_CLIENT_SECRET) missing.push("TIKTOK_CLIENT_SECRET");
  return missing;
}

/** The callback URI to register in the TikTok for Developers app. */
export function oauthRedirectUri(req: { headers: { get(name: string): string | null } }): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}/api/connection/tiktok/oauth/callback`;
}

// ---------------------------------------------------------------------------
// Token encryption — the P36 idiom, self-contained (AES-256-GCM)
// ---------------------------------------------------------------------------

function tokenKey(): Buffer {
  const secret = process.env.TIKTOK_TOKEN_SECRET || authSecret();
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM seal: `v1:<ivHex>:<tagHex>:<cipherHex>` (the P36 blob shape). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

/** The AES-256-GCM open — null on any tampering/key mismatch (honest miss). */
export function decryptSecret(blob: string): string | null {
  try {
    const [version, ivHex, tagHex, dataHex] = blob.split(":");
    if (version !== "v1" || !ivHex || !tagHex || !dataHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The state mint/verify — HMAC-bound to the user, carried by the double-
// submit httpOnly cookie (the P36 callback law's shape)
// ---------------------------------------------------------------------------

function sign(userId: string, nonce: string): string {
  return createHmac("sha256", authSecret()).update(`${userId}.${nonce}`).digest("hex");
}

/** Mint `{ state, cookie }` — the same value goes in the URL and the cookie. */
export function mintTikTokOAuthState(userId: string): { state: string; cookie: string } {
  const nonce = randomBytes(16).toString("hex");
  const state = `${Buffer.from(userId).toString("base64url")}.${nonce}.${sign(userId, nonce)}`;
  return { state, cookie: state };
}

/** Verify a callback state against the cookie AND the HMAC user binding. */
export function verifyTikTokOAuthState(
  state: string | null,
  cookie: string | null,
): { ok: true; userId: string } | { ok: false } {
  if (!state || !cookie || state !== cookie) return { ok: false };
  const parts = state.split(".");
  if (parts.length !== 3) return { ok: false };
  const [subB64, nonce, sig] = parts;
  let userId: string;
  try {
    userId = Buffer.from(subB64, "base64url").toString("utf8");
  } catch {
    return { ok: false };
  }
  if (!userId || !nonce || !sig) return { ok: false };
  const expected = sign(userId, nonce);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// The TikTok API calls (documented Login Kit v2 shapes)
// ---------------------------------------------------------------------------

export interface TikTokTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  openId: string | null;
  scope: string;
}

/** The authorization-code exchange (the documented form-encoded POST). */
export async function exchangeTikTokCode(input: {
  code: string;
  redirectUri: string;
}): Promise<TikTokTokenResponse | null> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;
  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    });
    const res = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      scope?: string;
    };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : 0,
      openId: data.open_id ?? null,
      scope: data.scope ?? TIKTOK_OAUTH_SCOPE,
    };
  } catch {
    return null;
  }
}

export interface TikTokUserInfo {
  openId: string | null;
  unionId: string | null;
  /** the creator handle (the `username` field) when the grant carried it */
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** The consented user read (the documented fields on user.info). */
export async function fetchTikTokUserInfo(accessToken: string): Promise<TikTokUserInfo | null> {
  try {
    const url = `${TIKTOK_USER_URL}?fields=${encodeURIComponent(
      "open_id,union_id,display_name,avatar_url,username",
    )}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: {
        user?: {
          open_id?: string;
          union_id?: string;
          display_name?: string;
          avatar_url?: string;
          username?: string;
        };
      };
    };
    const user = body.data?.user;
    if (!user) return null;
    return {
      openId: user.open_id ?? null,
      unionId: user.union_id ?? null,
      handle: user.username ?? null,
      displayName: user.display_name ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  } catch {
    return null;
  }
}

/** The consent-screen entry (the URL law's own builder). */
export function buildTikTokAuthorizeUrl(input: {
  clientKey: string;
  redirectUri: string;
  state: string;
}): string {
  return tiktokAuthorizeUrl({
    clientKey: input.clientKey,
    redirectUri: input.redirectUri,
    state: input.state,
    scope: TIKTOK_OAUTH_SCOPE,
  });
}
