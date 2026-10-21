/**
 * WFX2-W typed fetch client (relative paths only).
 */

export class ApiClientError extends Error {
  status: number;
  /** WFX2-P36 — the route's machine-stable failure kind (e.g.
   * "youtube-not-connected"), carried from the {error, kind} body so the
   * UI's error surfacing can render the connect/re-auth prompts. */
  kind?: string;
  constructor(status: number, message: string, kind?: string) {
    super(message);
    this.status = status;
    if (kind) this.kind = kind;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const body = (typeof data === "object" && data !== null ? data : {}) as {
      error?: unknown;
      kind?: unknown;
    };
    const message =
      "error" in body && body.error !== undefined
        ? String(body.error)
        : `Request failed (${res.status})`;
    const kind = typeof body.kind === "string" && body.kind ? body.kind : undefined;
    throw new ApiClientError(res.status, message, kind);
  }
  return data as T;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
