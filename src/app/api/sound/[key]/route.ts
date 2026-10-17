import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/livechat";
import { getSoundPage, normalizeSoundKeyParam } from "@/lib/youtube/sound";

/**
 * WFX2-P23-C (G5) — the sound page read: /api/sound/[key]?page=N
 *
 * `key` = the audio-pivot browse continuation token (URL-encoded — the sound
 * identity the reel sequence's pivot disc carries; measured live 2026-10-17:
 * youtube.com's own sound surface is exactly this browse continuation).
 * GET maps the sound card (title + image + channel) + the shorts grid + the
 * next continuation token.
 *
 * Honest degradation (the P22-B family, never a fake grid): an unreadable
 * sound answers 502 with the upstream reason; a read that yields neither a
 * title nor items answers 404 (the sound surface isn't served).
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (!(await rateLimit(`sound:${ip}`))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { key } = await params;
  // the route handler's params decode once (measured); the normalizer
  // passes the raw token through and collapses any link-form stragglers
  const token = normalizeSoundKeyParam(key);
  // deep-linked later pages: the running total seeds from the page param
  // (48/page — youtube.com's own richGrid page size); the client owns the
  // true count of what it loaded (it passes nothing here on in-app paging).
  const pageParam = Number(new URL(req.url).searchParams.get("page") ?? "1");
  const totalLoaded =
    Number.isFinite(pageParam) && pageParam > 1 ? (pageParam - 1) * 48 : 0;

  try {
    const data = await getSoundPage(token, totalLoaded);
    if (!data.title && data.items.length === 0) {
      return NextResponse.json(
        { error: "This sound is not available right now." },
        { status: 404 },
      );
    }
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error("GET /api/sound/[key] failed", err);
    return NextResponse.json(
      {
        error: "The sound page could not be read",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
