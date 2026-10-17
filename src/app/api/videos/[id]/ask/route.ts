import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { cached, rateLimit } from "@/lib/youtube/cache";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { llmConfigured, llmChat, LlmError } from "@/lib/ai/llm";
import {
  AI_ANSWER_TTL_MS,
  answerSeeksFor,
  buildWatchAskMessages,
  chaptersFromDescription,
  resolveAskTranscript,
  type WatchAskGrounding,
} from "@/lib/ai/ask-service";
import type { WatchAskResponse } from "@/lib/ai/heuristic";

export const dynamic = "force-dynamic";

/**
 * P23-B (G4) — POST /api/videos/[id]/ask — the watch Ask panel's backing.
 *
 * Grounded on the video's REAL `next` metadata (title/channel/description),
 * its chapters, and its transcript (WebFlix-local rows first, then the real
 * caption track). [m:ss] timestamps in the answer survive only when they
 * land exactly on a chapter or cue start — fabricated ones are dropped.
 * Honest degradation: no ZAI_API_KEY → 200 {status:"disabled"} before any
 * upstream/LLM call; LLM failure → 502 (client offers retry); unknown video
 * → 404. Per-IP budget: 20 asks / minute; answers cached per (video,
 * question) 10m.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length < 3 || question.length > 500) {
      return json({ error: "Ask needs a question (3-500 characters)" }, 400);
    }
    if (
      !(await rateLimit(`watch-ask:${req.headers.get("x-forwarded-for") ?? "local"}`, {
        limit: 20,
        windowMs: 60_000,
      }))
    ) {
      return json({ error: "Too many AI requests — wait a moment and try again" }, 429);
    }
    // honest degradation: no key → disabled, before any work
    if (!llmConfigured()) {
      return json({ status: "disabled" } satisfies WatchAskResponse);
    }
    const meta = await getWatchMetadata(id);
    if (!meta) return json({ error: "Video not found" }, 404);
    const payload = await cached(
      `ask:watch:${id}:${question}`,
      AI_ANSWER_TTL_MS,
      async (): Promise<WatchAskResponse> => {
        const grounding: WatchAskGrounding = {
          title: meta.video.title,
          channelName: meta.video.channel.name,
          description: meta.video.description,
          chapters: meta.chapters.length
            ? meta.chapters
            : chaptersFromDescription(meta.video.description, meta.video.durationSec),
          cues: await resolveAskTranscript(id),
        };
        const answer = await llmChat(buildWatchAskMessages(question, grounding));
        return { status: "ok", answer, seeks: answerSeeksFor(answer, grounding) };
      }
    );
    return json(payload);
  } catch (e) {
    if (e instanceof LlmError) return json({ error: e.message }, 502);
    return errorResponse(e);
  }
}
