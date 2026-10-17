import { NextRequest } from "next/server";
import { json } from "@/lib/watch/api";
import { rateLimit } from "@/lib/youtube/cache";
import { isTestUpstream } from "@/lib/youtube/innertube";
import { resolveClip, type ClipResolveError } from "@/lib/clip/clip-service";

export const dynamic = "force-dynamic";

/**
 * WFX2-P23-A — GET /api/clip/[id] — RESOLVE a clip id (the /clip page's
 * read): WebFlix-local ids from the Clip table, youtube.com clip postIds
 * (Ug…) through the SSR read family (cached, the house pattern).
 *
 * Honest failure mapping (never a synthesized clip):
 *   404 { status: "not-found" }        — the id names no clip anywhere
 *   404 { status: "clip-unavailable" } — youtube.com served the page but
 *        no clip (the dead-clip family; youtube.com's own wording:
 *        "Clip not available - Try again later")
 *   502 { status: "read-failed" }      — the read itself failed (the
 *        P22-B honest-degradation family wording)
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    return json({ status: "not-found", error: "Clip not found" }, 404);
  }
  // the remote read is rate-limited per IP (local ids never reach it)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!isTestUpstream() && !(await rateLimit(`clip-resolve:${ip}`, { limit: 30 }))) {
    return json({ status: "read-failed", error: "Too many requests" }, 429);
  }
  const result = await resolveClip(id).catch((e): ClipResolveError => {
    console.error("[wfx2p23a:api] clip resolve failed", e);
    return { status: "read-failed", message: "the clip page could not be read" };
  });
  if ("status" in result) {
    const status = result.status;
    if (status === "read-failed") {
      return json(
        { status, error: result.message ?? "the clip page could not be read" },
        502
      );
    }
    return json(
      {
        status,
        error:
          status === "clip-unavailable"
            ? "Clip not available - Try again later"
            : "Clip not found",
      },
      404
    );
  }
  return json(result);
}
