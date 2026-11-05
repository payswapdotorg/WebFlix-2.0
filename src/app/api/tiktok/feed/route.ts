import { NextRequest, NextResponse } from "next/server";
import { getTikTokFeedPage } from "@/lib/tiktok/library";
import { getTikTokChannelFeedPage } from "@/lib/tiktok/channels";
import { composedFeedExtraIds, decorateFeedPage, importUserId } from "@/lib/tiktok/imports";
import { isTikTokPostId, isTikTokHandle, normalizeTikTokHandle } from "@/lib/tiktok/urls";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/feed — the /shorts TikTok feed pages (ADR 0013 §6,
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1): cursor pagination over the composed
 * library in the SAME `{ items, nextCursor }` shape law as /api/shorts.
 *
 * Query:
 *  - `cursor` — the previous page's last post id (opaque to the client);
 *    absent → page 1.
 *  - `post` — a deep-linked post id, spliced FIRST on page 1 only (the
 *    /shorts?source=tiktok&post= contract; any canonical post works).
 *  - `limit` — 1..40 (the composed cap bounds it).
 *  - `creator` (P96-a, the gap report's G17) — a creator handle scoping
 *    the pages to that creator's verifiable posts (the profile-playback
 *    contract: /shorts?source=tiktok&creator=@handle). `@handle` and
 *    `handle` normalize the same; a format-invalid handle answers 400;
 *    a valid handle with zero shelf posts answers the honest empty page;
 *    a deep-linked `post` outside the scope is honestly ignored, never
 *    smuggled in.
 *
 * M2 composition: curated flow first, then PUBLIC community imports, then
 * the signed-in viewer's own private saves (their feed only). Every row is
 * honestly resolved through the cached oEmbed lane (walled egress → honest
 * cards, the embed rides viewer-side) and the viewer-scoped stamps
 * (`visibility`/`owned`) apply at the request layer — never inside the
 * shared cache. Guests see the public composition only.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`tiktok:feed:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const params = req.nextUrl.searchParams;
    const cursor = params.get("cursor");
    const post = params.get("post");
    const creatorRaw = params.get("creator");
    const limitRaw = Number(params.get("limit") ?? "");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

    if (cursor && !isTikTokPostId(cursor)) {
      return NextResponse.json({ error: "Invalid TikTok post id" }, { status: 400 });
    }
    if (post && !isTikTokPostId(post)) {
      return NextResponse.json({ error: "Invalid TikTok post id" }, { status: 400 });
    }
    const creator = creatorRaw ? normalizeTikTokHandle(creatorRaw) : null;
    if (creatorRaw && (!creator || !isTikTokHandle(creator))) {
      return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
    }
    const sessionUser = await getSessionUser(req);
    // the SAME shadow identity the write lanes resolve — private saves are
    // keyed by it (a raw session sub never matches the stored rows)
    const viewerId = sessionUser ? await importUserId(sessionUser) : null;
    const { extraIds, hintByPostId } = await composedFeedExtraIds(viewerId);
    const page = creator
      ? await getTikTokChannelFeedPage({
          handle: creator,
          cursor: cursor || null,
          post: post || null,
          // a positive integer passes through; the library clamps to the cap
          limit,
          extraIds,
          hintByPostId,
        })
      : await getTikTokFeedPage({
          cursor: cursor || null,
          post: post || null,
          // a positive integer passes through; the library clamps to the cap
          limit,
          extraIds,
        });
    if (!page) {
      return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
    }
    const items = await decorateFeedPage(page.items, viewerId);
    return NextResponse.json({ items, nextCursor: page.nextCursor }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/feed failed", err);
    return NextResponse.json({ error: "Failed to load the TikTok feed" }, { status: 502 });
  }
}
