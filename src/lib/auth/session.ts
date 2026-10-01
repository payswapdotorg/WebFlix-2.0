/**
 * WFX2-P2-AU — server-side session resolution + the route gate.
 *
 * `getSessionUser(request)` resolves the signed-in WebFlix identity from the
 * stock NextAuth session cookie (next-auth/jwt getToken — the same decode
 * the /api/auth routes use). The personal + write API routes wrap their
 * handlers with the gate: a guest gets the uniform 401 shape the client
 * degrades on — BEFORE any broker/InnerTube call (guests never hit the
 * broker). Signed-in requests pass through to EXACTLY the pre-auth behavior.
 */
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "./secret";
import type { WebFlixSessionUser } from "./types";

const SESSION_COOKIE = "next-auth.session-token";
const SECURE_SESSION_COOKIE = "__Secure-next-auth.session-token";

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      if (key) out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve the signed-in WebFlix user from a request. Reads the stock
 * session cookie (both stock names are honored — http and https egress can
 * never mismatch the gate). Null = guest.
 */
export async function getSessionUser(request: Request): Promise<WebFlixSessionUser | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  // alias the two stock cookie names so the gate works identically in dev
  // (http), behind proxies, and on Vercel (https / __Secure-)
  const plain = cookies[SESSION_COOKIE];
  const secure = cookies[SECURE_SESSION_COOKIE];
  if (plain && !secure) cookies[SECURE_SESSION_COOKIE] = plain;
  if (secure && !plain) cookies[SESSION_COOKIE] = secure;

  const token = await getToken({
    req: { headers: request.headers, cookies } as never,
    secret: authSecret(),
  });
  if (!token?.sub) return null;
  return {
    id: token.sub,
    email: typeof token.email === "string" ? token.email : "",
    displayName: typeof token.name === "string" ? token.name : "",
    avatarSeed: typeof token.avatarSeed === "number" ? token.avatarSeed : 0,
  };
}

/**
 * The uniform guest response — the 401 shape every gated client degrades
 * on. The message is machine-stable ("unauthenticated"); the UI owns the
 * human copy (the youtube-parity signed-out screens).
 */
export function authRequiredResponse(): NextResponse {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}
