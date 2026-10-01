import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { getTranscript } from "@/lib/watch/transcript-service";
import { fetchCaptionCues } from "@/lib/youtube/captions";

export const dynamic = "force-dynamic";

/**
 * WFX2-P4-QT — GET /api/videos/[id]/transcript[?lang=xx] — cue rows, ordered.
 *
 * No `lang` → the default transcript (the seeded DB store, unchanged).
 * `lang` → the InnerTube caption track for that language (live, cached):
 * honest 404 when the video has no track for the language, honest 502 when
 * upstream fails — never fabricated cues.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const lang = new URL(req.url).searchParams.get("lang")?.trim();
    if (lang) {
      const cues = await fetchCaptionCues(id, lang);
      return json({ cues, language: lang });
    }
    const cues = await getTranscript(id);
    return json({ cues });
  } catch (e) {
    return errorResponse(e);
  }
}
