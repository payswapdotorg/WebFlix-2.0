import { env } from "./env";
import { kvGetJson, kvSetJson } from "./cache";
import { normalizeChannel, normalizeComment, normalizePost, normalizeVideo, parseComments, parsePosts, parseVideos } from "./mapping";
import type { ChannelInfo, NormalizedComment, NormalizedPost, NormalizedVideo } from "./types";

export type ApiOk<T> = { ok: true; data: T };
export type Degraded = { ok: false; degraded: true; status: number; reason: string };
export type ApiResult<T> = ApiOk<T> | Degraded;

export async function mainFetch<T>(
  path: string,
  opts: { revalidateSec?: number; parse: (json: unknown) => T | null }
): Promise<ApiResult<T>> {
  const ttl = opts.revalidateSec ?? 60;
  const cacheKey = `wf:studio:main:${path}`;
  const cached = await kvGetJson<T>(cacheKey);
  if (cached !== null) return { ok: true, data: cached };
  try {
    const res = await fetch(`${env.MAIN_APP_URL}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false, degraded: true, status: res.status, reason: `main-app ${res.status} on ${path}` };
    const json: unknown = await res.json();
    const parsed = opts.parse(json);
    if (parsed === null) return { ok: false, degraded: true, status: 502, reason: `main-app payload shape mismatch on ${path}` };
    await kvSetJson(cacheKey, parsed, ttl);
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, degraded: true, status: 502, reason: `main-app unreachable on ${path} (network/broker offline)` };
  }
}

export async function mainPost(path: string, body?: unknown): Promise<{ ok: boolean; status: number }> {
  try {
    const r = await fetch(`${env.MAIN_APP_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false, status: 502 };
  }
}

function parseChannelish(json: unknown): ChannelInfo | null {
  const direct = normalizeChannel(json);
  if (direct) return direct;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["channel", "operator", "data"]) {
      if (o[k]) {
        const c = normalizeChannel(o[k]);
        if (c) return c;
      }
    }
  }
  return null;
}

export async function fetchOperatorChannel(): Promise<ApiResult<ChannelInfo>> {
  const res = await mainFetch("/api/studio", { revalidateSec: 60, parse: parseChannelish });
  if (res.ok && res.data.handle === "" && res.data.id === null) {
    return { ok: false, degraded: true, status: 204, reason: "no operator channel resolved by main-app /api/studio" };
  }
  return res;
}

export async function fetchChannelVideos(handle: string, tab: "videos" | "shorts" | "live"): Promise<ApiResult<NormalizedVideo[]>> {
  return mainFetch<NormalizedVideo[]>(`/api/channel/${encodeURIComponent(handle)}/videos?tab=${tab}&limit=200`, {
    revalidateSec: 60,
    parse: (json) => {
      const list = parseVideos(json).map(normalizeVideo).filter((v): v is NormalizedVideo => v !== null);
      return list;
    },
  });
}

// Honest-empty while the community-posts lane is in flight: ok:true + degraded flag + [].
export async function fetchCommunityPosts(handle: string): Promise<{ ok: true; degraded: boolean; reason: string | null; posts: NormalizedPost[] }> {
  const attempts = [`/api/channel/${encodeURIComponent(handle)}/posts`, `/api/channel/${encodeURIComponent(handle)}?tab=posts`];
  for (const p of attempts) {
    const res = await mainFetch<NormalizedPost[]>(p, {
      revalidateSec: 60,
      parse: (json) => parsePosts(json).map(normalizePost).filter((v): v is NormalizedPost => v !== null),
    });
    if (res.ok) return { ok: true, degraded: false, reason: null, posts: res.data };
  }
  return { ok: true, degraded: true, reason: "Community posts are not exposed by the main-app API yet — honest-empty while that lane lands.", posts: [] };
}

export async function fetchVideoComments(videoId: string): Promise<ApiResult<NormalizedComment[]>> {
  return mainFetch<NormalizedComment[]>(`/api/comments?videoId=${encodeURIComponent(videoId)}&limit=100`, {
    revalidateSec: 30,
    parse: (json) => parseComments(json).map(normalizeComment).filter((v): v is NormalizedComment => v !== null),
  });
}
