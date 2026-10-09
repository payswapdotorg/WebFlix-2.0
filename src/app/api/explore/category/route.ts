import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { decodeExploreCategoryCursor } from "@/lib/youtube/cursors";
import {
  EXPLORE_CATEGORY_SEEDS,
  getExploreCategoryPage,
  isExploreCategory,
} from "@/lib/youtube/explore-categories";
import { hasSession } from "@/lib/youtube/session";
import type { ExploreCategoryPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/explore/category?key=Music&cursor=… — the explore category browse
 * pages (WFX2-P19-EXPL). youtube.com's own category surfaces are
 * session-walled (browse FEexplore → 400; the public /feed/trending redirects
 * to the nudge — probed live), so the honest public path is the SAME
 * machinery the home ladder's rung 3 and the Live surface use: REAL
 * per-category seed searches merged + de-duplicated into a ranked grid, then
 * live search continuations for the infinite scroll — never fabricated rows.
 *
 * `key` is one of the 13 browse categories (Live keeps /explore/live — the
 * Features→Live filter search). `cursor` is the opaque rung-3 envelope from
 * the previous page (cursors.ts {s:"ecat"}/{s:"ecats"}, scoped to the
 * category): a garbage or cross-category cursor answers the honest 400 —
 * never a 500. `source` labels the data path; `publicMode` tells the UI the
 * operator YouTube session is absent (its honest degradation banner).
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const key = params.get("key") ?? "";
    if (!isExploreCategory(key)) {
      return NextResponse.json({ error: "Unknown explore category" }, { status: 404 });
    }
    const rawCursor = params.get("cursor");
    const cursor = rawCursor
      ? decodeExploreCategoryCursor(rawCursor, key, EXPLORE_CATEGORY_SEEDS[key].length)
      : null;
    if (rawCursor !== null && !cursor) {
      return NextResponse.json({ error: "Invalid category cursor" }, { status: 400 });
    }
    if (!(await rateLimit(`explore-category:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const limitParam = params.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 24, 1), 48);
    const page = await getExploreCategoryPage(key, cursor, limit);
    const data: ExploreCategoryPageDTO = {
      category: page.category,
      videos: page.videos,
      nextCursor: page.nextCursor,
      source: "search",
      publicMode: !hasSession(),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/explore/category failed", err);
    return NextResponse.json({ error: "Failed to load category videos" }, { status: 502 });
  }
}
