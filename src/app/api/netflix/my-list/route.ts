import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mirrorRowToDTO, getNetflixTitle } from "@/lib/netflix/catalog";
import { rateLimit } from "@/lib/youtube/cache";
import { netflixViewerId } from "@/lib/netflix/viewer";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

export const dynamic = "force-dynamic";

/**
 * My Netflix List (P42) — the viewer's WebFlix-LOCAL list (ADR 0002 §5: no
 * Netflix credentials anywhere, so the list lives in WebFlix's own DB, exactly
 * like the watch lane's local Watch-Later rung). P49: identity =
 * `netflixViewerId` — the signed-in WebFlix account first (its shadow user,
 * the same bridge the local comment rung rides), then the watch-lane demo
 * fallback (the honest-anonymous viewer gets an empty list / 401 on writes).
 *
 * GET            → { items: NetflixTitleDTO[] } (newest first)
 * POST {netflixId} → { myList: true }
 * DELETE ?netflixId= → { myList: false }
 */
async function listItems(userId: string): Promise<NetflixTitleDTO[]> {
  const rows = await db.netflixMyListItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { title: true },
  });
  return rows.map((r) => mirrorRowToDTO(r.title));
}

export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`netflix:mylist:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ items: [], source: "netflix-my-list" });
    }
    const items = await listItems(viewerId);
    return NextResponse.json({ items, source: "netflix-my-list" });
  } catch (err) {
    console.error("GET /api/netflix/my-list failed", err);
    return NextResponse.json({ error: "Failed to load My Netflix List" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`netflix:mylist:post:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ error: "Sign in to build your Netflix list" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { netflixId?: unknown };
    const netflixId = Number(body.netflixId);
    if (!Number.isInteger(netflixId) || netflixId <= 0) {
      return NextResponse.json({ error: "netflixId required" }, { status: 400 });
    }
    // The mirror row must exist (FK) — upsert it from the live pools/mirror.
    const title = await getNetflixTitle(netflixId);
    if (!title) {
      return NextResponse.json({ error: "Title not in the tracked Netflix catalog" }, { status: 404 });
    }
    await db.netflixTitle.upsert({
      where: { netflixId },
      create: {
        netflixId,
        title: title.title,
        kind: title.kind,
        synopsis: title.synopsis,
        releaseYear: title.releaseYear,
        maturityRating: title.maturityRating,
        posterUrl: title.posterUrl,
        backdropUrl: title.backdropUrl,
        logoUrl: title.logoUrl,
        weeklyRank: title.weeklyRank,
        allTimeRank: title.allTimeRank,
        weeksInTop10: title.weeksInTop10,
        weeklyHoursViewed: title.weeklyHoursViewed,
        weeklyViews: title.weeklyViews,
        weekEndDate: title.weekEndDate,
        pool: title.pool,
        isPlayable: title.isPlayable,
        countryRanks: Object.entries(title.countryRanks)
          .map(([cc, rank]) => `${cc}:${rank}`)
          .join(","),
      },
      update: {},
    });
    await db.netflixMyListItem.upsert({
      where: { userId_netflixId: { userId: viewerId, netflixId } },
      create: { userId: viewerId, netflixId },
      update: {},
    });
    return NextResponse.json({ myList: true });
  } catch (err) {
    console.error("POST /api/netflix/my-list failed", err);
    return NextResponse.json({ error: "Failed to add the title" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!(await rateLimit(`netflix:mylist:del:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ error: "Sign in to manage your Netflix list" }, { status: 401 });
    }
    const netflixId = Number(new URL(req.url).searchParams.get("netflixId"));
    if (!Number.isInteger(netflixId) || netflixId <= 0) {
      return NextResponse.json({ error: "netflixId required" }, { status: 400 });
    }
    await db.netflixMyListItem.deleteMany({
      where: { userId: viewerId, netflixId },
    });
    return NextResponse.json({ myList: false });
  } catch (err) {
    console.error("DELETE /api/netflix/my-list failed", err);
    return NextResponse.json({ error: "Failed to remove the title" }, { status: 502 });
  }
}
