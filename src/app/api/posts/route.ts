import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPostCreate } from "@/lib/community/action-proxy";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts — WFX2-P36: the HONEST UNSUPPORTED lane. Creating a
 * community post has no official end-user YouTube API, and the pre-P36
 * broker drive (youtube.com's backstage composer on the OPERATOR's tab) is
 * retired with the shared operator identity itself — the proxy answers the
 * honest 501 (kind "youtube-unsupported", the handoff to YouTube), rendered
 * verbatim by errorResponse. The composer's request validation (text/image/
 * poll, the 2-5 poll option law) still answers its honest 400s first.
 *
 * WFX2-P2-AU added: the route is now gated on the WebFlix session — a guest
 * gets the uniform 401 before anything runs (it was rate-limit-only before
 * P36).
 *
 * Request: { handle, channelId?, text, imageUrl?, pollOptions? } (shapes kept).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — post on YouTube.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`post-create:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 20 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const handle = typeof body.handle === "string" ? body.handle.trim() : "";
    if (!handle) return json({ error: "handle is required (the OWN channel)" }, 400);
    const channelId =
      typeof body.channelId === "string" && body.channelId ? body.channelId : undefined;
    const text = typeof body.text === "string" ? body.text : "";
    if (text.length > 15_000) {
      return json({ error: "text must be ≤ 15000 chars" }, 400);
    }
    const imageUrlRaw = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const imageUrl = imageUrlRaw || undefined;
    if (imageUrl && !/^https?:\/\//.test(imageUrl)) {
      return json({ error: "imageUrl must be an http(s) URL" }, 400);
    }
    const pollRaw = body.pollOptions;
    const pollOptions = Array.isArray(pollRaw)
      ? pollRaw.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : undefined;
    if (pollOptions && (pollOptions.length < 2 || pollOptions.length > 5)) {
      return json({ error: "pollOptions must carry 2-5 non-empty options" }, 400);
    }
    if (!text.trim() && !imageUrl && !(pollOptions && pollOptions.length)) {
      return json({ error: "a post needs text, an image, or a poll" }, 400);
    }
    const result = await proxyPostCreate({
      handle,
      ...(channelId ? { channelId } : {}),
      text,
      ...(imageUrl ? { imageUrl } : {}),
      ...(pollOptions ? { pollOptions } : {}),
    });
    return json(result, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
