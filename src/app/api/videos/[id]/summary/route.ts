import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { cached, rateLimit } from "@/lib/youtube/cache";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { llmConfigured, llmChat, LlmError } from "@/lib/ai/llm";
import {
  AI_ANSWER_TTL_MS,
  buildSummaryMessages,
  chaptersFromDescription,
  parseSummary,
  resolveAskTranscript,
  type WatchAskGrounding,
} from "@/lib/ai/ask-service";
import type { WatchSummaryResponse } from "@/lib/ai/heuristic";

export const dynamic = "force-dynamic";

/**
 * P23-B (G4) — GET /api/videos/[id]/summary — the AI summary block's backing.
 *
 * A grounded 3-5 sentence summary + Key moments. Key moments ride the REAL
 * chapter timestamps only (a moment the model places anywhere else is
 * dropped server-side; the chip's chapter binding is re-derived from the
 * description's own chapter list — never the model's word). Honest
 * degradation: no ZAI_API_KEY → 200 {status:"disabled"} before any
 * upstream/LLM call (the block stays hidden); LLM failure → 502 (client
 * offers retry); unknown video → 404. Cached per video 10m.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!(await rateLimit(`watch-summary:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return json({ error: "Too many requests — slow down" }, 429);
    }
    // honest degradation: no key → disabled, before any work
    if (!llmConfigured()) {
      return json({ status: "disabled" } satisfies WatchSummaryResponse);
    }
    const meta = await getWatchMetadata(id);
    if (!meta) return json({ error: "Video not found" }, 404);
    const payload = await cached(
      `ask:summary:${id}`,
      AI_ANSWER_TTL_MS,
      async (): Promise<WatchSummaryResponse> => {
        const grounding: WatchAskGrounding = {
          title: meta.video.title,
          channelName: meta.video.channel.name,
          description: meta.video.description,
          chapters: meta.chapters.length
            ? meta.chapters
            : chaptersFromDescription(meta.video.description, meta.video.durationSec),
          cues: await resolveAskTranscript(id),
        };
        const raw = await llmChat(buildSummaryMessages(grounding));
        const { summary, keyMoments } = parseSummary(raw, grounding.chapters);
        return { status: "ok", summary, keyMoments };
      }
    );
    return json(payload);
  } catch (e) {
    if (e instanceof LlmError) return json({ error: e.message }, 502);
    return errorResponse(e);
  }
}
