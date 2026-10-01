import { env } from "./env";

const mem = new Map<string, { v: string; exp: number }>();

function memGet(key: string): string | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { mem.delete(key); return null; }
  return hit.v;
}
function memSet(key: string, v: string, ttlSec?: number): void {
  mem.set(key, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : Date.now() + 5 * 60_000 });
}

async function rest(path: string): Promise<unknown | null> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: unknown };
    return j.result ?? null;
  } catch {
    return null;
  }
}

export async function kvGetRaw(key: string): Promise<string | null> {
  const result = await rest(`/get/${encodeURIComponent(key)}`);
  if (typeof result === "string") return result;
  return memGet(key);
}

export async function kvSetRaw(key: string, value: string, ttlSec?: number): Promise<void> {
  const q = ttlSec ? `?EX=${ttlSec}` : "";
  await rest(`/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}${q}`);
  memSet(key, value, ttlSec);
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGetRaw(key);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function kvSetJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
  await kvSetRaw(key, JSON.stringify(value), ttlSec);
}

export function kvMemoryClearForTests(): void {
  mem.clear();
}
