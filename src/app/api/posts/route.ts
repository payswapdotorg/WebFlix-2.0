import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPostCreate } from "@/lib/community/action-proxy";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts — LIVE Tier-2 write: create a community post on the
 * operator's OWN channel (the creator composer's path — broker post-create
 * executes youtube.com's real backstage create flow).
 *
 * Request: { handle, channelId?, text, imageUrl?, pollOptions? }
 *   — handle (required): the OWN channel's handle (the browser navigates to
 *     its community tab, where the composer lives);
 *   — text: the post body (required unless an image or poll carries the post);
 *   — imageUrl: an https image URL (fetched into the real composer's file
 *     input — a real upload through YouTube's own pipeline);
 *   — pollOptions: 2-5 non-empty option texts.
 *
 * Response: { ok, effect, verified?, path?, note? } — the PostCreateResult
 * contract. Ownership is enforced by youtube.com itself (the composer only
 * renders on the operator's own channel); the routes never synthesize a post.
 */
export async function POST(req: NextRequest) {
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
