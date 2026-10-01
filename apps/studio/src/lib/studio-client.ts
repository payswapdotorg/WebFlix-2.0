export type ClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; degraded: true; status: number; reason: string };

export async function apiGet<T>(url: string): Promise<ClientResult<T>> {
  try {
    const r = await fetch(url);
    const j = (await r.json()) as { ok?: boolean; status?: number; reason?: string };
    if (j && j.ok === false) {
      return { ok: false, degraded: true, status: j.status ?? r.status, reason: j.reason ?? "unavailable" };
    }
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, degraded: true, status: 502, reason: "network error" };
  }
}

export async function apiPost<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: T | null }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as T | null;
    return { ok: r.ok, status: r.status, json };
  } catch {
    return { ok: false, status: 502, json: null };
  }
}
