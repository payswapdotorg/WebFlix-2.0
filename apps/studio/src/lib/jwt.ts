const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = "wf_studio_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export interface SessionPayload { sub: string; email: string; name: string; seed: string }

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecodeToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSessionJWT(payload: SessionPayload, secret: string, ttlSec: number = SESSION_TTL_SEC): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(body)))}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionJWT(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const key = await hmacKey(secret);
    const sigBytes = b64urlDecodeToBytes(s);
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const raw = JSON.parse(dec.decode(b64urlDecodeToBytes(p))) as SessionPayload & { exp?: number };
    if (typeof raw.exp === "number" && raw.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!raw.sub || !raw.email) return null;
    return { sub: raw.sub, email: raw.email, name: raw.name ?? raw.email, seed: raw.seed ?? raw.email };
  } catch {
    return null;
  }
}
