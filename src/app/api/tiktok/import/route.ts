import { NextRequest, NextResponse } from "next/server";
import { importTikTokPost, listMyTikTokImports, importUserId } from "@/lib/tiktok/imports";
import { getSessionUser, authRequiredResponse } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/tiktok/import — the canonical URL paste/import (ADR 0013 §7,
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2).
 *
 * Gate: the WebFlix account session (the P83 law — the comment plane's
 * reconciliation applies to every new write lane: NO operator gate, the
 * signed-in account is the truth). Guests get the uniform 401 shape.
 *
 * Body: `{ url }` — a canonical tiktok.com URL (or a bare post id). The
 * URL law parses it; short links (`vm.tiktok.com`) honestly refuse.
 *
 * Dedupe law: a repeat import (by anyone) is idempotent — the first row
 * stands; a curated post answers `curated: true` as a no-op. Fresh rows
 * are PRIVATE saves (the owner's feed only) until the owner flips them
 * public (the curator rule, PATCH /api/tiktok/import/[postId]).
 *
 * The metadata resolution rides the SAME honest lane as every surface — a
 * walled egress does NOT block the import (the embed player is
 * viewer-side); the row's authorHint keeps the fallback card factual.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await rateLimit(`tiktok:import:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return authRequiredResponse();
    const userId = await importUserId(sessionUser);

    let body: { url?: unknown };
    try {
      body = (await req.json()) as { url?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body?.url !== "string" || !body.url.trim()) {
      return NextResponse.json(
        { error: "Provide the canonical TikTok post URL (or a bare post id)." },
        { status: 400 },
      );
    }

    const result = await importTikTokPost({ url: body.url, userId });
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            "That is not a canonical TikTok post URL. Paste a www.tiktok.com/@user/video/<id> link (short links cannot be resolved honestly).",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        post: result.post,
        alreadyImported: result.alreadyImported,
        curated: result.curated,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("POST /api/tiktok/import failed", err);
    return NextResponse.json({ error: "Failed to import the TikTok post" }, { status: 502 });
  }
}

/**
 * GET /api/tiktok/import — the signed-in viewer's own imports (the
 * management list, newest-first; capped). Guests get the uniform 401.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`tiktok:import:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return authRequiredResponse();
    const imports = await listMyTikTokImports(await importUserId(sessionUser));
    return NextResponse.json({ imports }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/tiktok/import failed", err);
    return NextResponse.json({ error: "Failed to list the TikTok imports" }, { status: 502 });
  }
}
