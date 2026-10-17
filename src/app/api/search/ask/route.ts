import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { cached, rateLimit } from "@/lib/youtube/cache";
import { parseSearchFilters, type SearchFilters } from "@/lib/youtube/filters";
import { searchYouTube } from "@/lib/youtube/search";
import { llmConfigured, llmChat, LlmError } from "@/lib/ai/llm";
import {
  AI_ANSWER_TTL_MS,
  ASK_GROUNDING_RESULTS,
  buildSearchAskMessages,
} from "@/lib/ai/ask-service";
import type { SearchAskResponse } from "@/lib/ai/heuristic";

export const dynamic = "force-dynamic";

/**
 * P23-B (G3) — POST /api/search/ask — the search answer card's backing.
 *
 * Grounded on the REAL search results for the query (the same cached
 * InnerTube search the results grid reads — the answer cites the videos the
 * user sees). Honest degradation family:
 *  - no ZAI_API_KEY → 200 {status:"disabled"} BEFORE any search or LLM call
 *    (the card stays hidden);
 *  - no results to ground on → 200 {status:"no-results"} (card hidden);
 *  - LLM failure → 502 with the honest error (client offers retry).
 * Per-IP budget: 10 asks / minute. Answers cached per (query, filters) 10m.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { q?: unknown; filters?: Record<string, unknown> }
      | null;
    const q = typeof body?.q === "string" ? body.q.trim() : "";
    if (!q || q.length > 500) {
      return json({ error: "Ask needs a question (1-500 characters)" }, 400);
    }
    const filters: SearchFilters = body?.filters ? parseSearchFilters(sanitizeFilters(body.filters)) : {};
    if (
      !(await rateLimit(`ask:${req.headers.get("x-forwarded-for") ?? "local"}`, {
        limit: 10,
        windowMs: 60_000,
      }))
    ) {
      return json({ error: "Too many AI requests — wait a moment and try again" }, 429);
    }
    // honest degradation: no key → disabled, before any work
    if (!llmConfigured()) {
      return json({ status: "disabled" } satisfies SearchAskResponse);
    }
    const payload = await cached(
      `ask:search:${q}:${JSON.stringify(filters)}`,
      AI_ANSWER_TTL_MS,
      async (): Promise<SearchAskResponse> => {
        const results = await searchYouTube(q, filters);
        const grounding = results.videos
          .slice(0, ASK_GROUNDING_RESULTS)
          .map((v) => ({
            id: v.id,
            title: v.title,
            channelName: v.channel.name,
            description: v.description,
          }));
        if (grounding.length === 0) return { status: "no-results" };
        const answer = await llmChat(buildSearchAskMessages(q, grounding));
        return {
          status: "ok",
          answer,
          citations: grounding.map((g, i) => ({
            n: i + 1,
            videoId: g.id,
            title: g.title,
            channelName: g.channelName,
          })),
        };
      }
    );
    return json(payload);
  } catch (e) {
    if (e instanceof LlmError) return json({ error: e.message }, 502);
    return errorResponse(e);
  }
}

/** Only the known filter keys, string/boolean shaped (never client JSON junk). */
function sanitizeFilters(input: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const bool = (v: unknown) =>
    typeof v === "boolean" ? v : typeof v === "string" && v !== "" ? v : null;
  return {
    sort: str(input.sort),
    uploadDate: str(input.uploadDate),
    duration: str(input.duration),
    type: str(input.type),
    live: bool(input.live),
    verbatim: bool(input.verbatim),
  };
}
