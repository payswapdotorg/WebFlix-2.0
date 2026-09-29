import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { getStudioData, DEFAULT_ENRICH_LIMIT, MAX_ENRICH_LIMIT } from "@/lib/youtube/studio";

export const dynamic = "force-dynamic";

/**
 * GET /api/studio?enrich=N — the creator studio surface for the
 * single-tenant operator channel:
 *  - the operator's REAL channel (session-only resolution; null in public
 *    mode — honest "connect the operator session" state)
 *  - the channel's real public videos + per-video real likes/comments for
 *    the first N rows (public-scope, labeled)
 *  - studio-scope analytics via Studio SSR (parse-or-honestly-degrade —
 *    NEVER fabricated numbers)
 *  - deep links out to the real studio.youtube.com pages
 * `enrich` defaults to 10, clamped to 50 (each enriched row costs real,
 * cached upstream reads).
 */
export async function GET(req: NextRequest) {
  try {
    if (!rateLimit(`studio:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 30 })) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const raw = new URL(req.url).searchParams.get("enrich");
    const parsed = raw !== null ? Number(raw) : NaN;
    const enrich = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_ENRICH_LIMIT;
    const data = await getStudioData({
      enrich: Number.isFinite(parsed) ? Math.max(0, Math.min(enrich, MAX_ENRICH_LIMIT)) : undefined,
    });
    return NextResponse.json({ ...data, loginRequired: !hasSession() });
  } catch (err) {
    console.error("GET /api/studio failed", err);
    return NextResponse.json({ error: "Failed to load studio" }, { status: 502 });
  }
}
