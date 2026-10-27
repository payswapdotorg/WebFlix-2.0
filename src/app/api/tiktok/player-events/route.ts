import { NextResponse } from "next/server";
import { isTikTokPostId } from "@/lib/tiktok/urls";
import { recordDeadPost } from "@/lib/tiktok/dead";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/tiktok/player-events — the player's one-shot death report
 * (P59-R3). The viewer-side Embed Player is the only witness of a dead post
 * (1001 INVALID_VIDEO); the ledger soft-remembers it for 48h on the shared
 * cache adapter.
 *
 * Poison guards: a 1KiB body cap, URL-law id validation, and non-lethal
 * codes (2001/3xxx/transient) answer `{ recorded: null }` and are NEVER
 * written — one bad network must not blank the shelf for everyone.
 */
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`tiktok-events:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > 1024) {
      return NextResponse.json({ error: "Body too large" }, { status: 413 });
    }
    const text = await req.text();
    if (text.length > 1024) {
      return NextResponse.json({ error: "Body too large" }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const b = body as { postId?: unknown; code?: unknown; type?: unknown };
    const postId = typeof b.postId === "string" ? b.postId : "";
    const code = typeof b.code === "number" ? b.code : Number.NaN;
    if (!isTikTokPostId(postId) || !Number.isInteger(code)) {
      return NextResponse.json({ error: "Invalid player event" }, { status: 400 });
    }
    const result = await recordDeadPost(postId, code, typeof b.type === "string" ? b.type : "");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("POST /api/tiktok/player-events failed", err);
    return NextResponse.json({ error: "Failed to record the player event" }, { status: 502 });
  }
}
