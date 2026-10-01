import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/youtube/cache";
import {
  getUploadContext,
  buildUploadHandoff,
  YOUTUBE_TITLE_MAX,
  YOUTUBE_DESCRIPTION_MAX,
} from "@/lib/youtube/studio";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** YouTube's own field limits — the hand-off carries exactly what the real upload form accepts. */
const handoffSchema = z.object({
  title: z
    .string({ message: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(YOUTUBE_TITLE_MAX, `Title is limited to ${YOUTUBE_TITLE_MAX} characters on YouTube`),
  description: z.string().trim().max(YOUTUBE_DESCRIPTION_MAX).default(""),
  tags: z
    .array(z.string().trim().min(1))
    .max(30, "At most 30 tags")
    .default([])
    .transform((tags) => [...new Set(tags)].slice(0, 30)),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  thumbnailUrl: z
    .string()
    .trim()
    .url("Thumbnail must be an https URL")
    .refine((u) => u.startsWith("https://"), "Thumbnail must be an https URL")
    .nullable()
    .default(null),
  isShort: z.boolean().default(false),
});

/**
 * GET /api/upload — the upload page context: the operator's real channel
 * ("publishing as …", session-only, null in public mode — honest) + the real
 * YouTube upload URL. No upload simulation anywhere in this flow.
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`upload:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 60 }))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const context = await getUploadContext();
    return NextResponse.json(context);
  } catch (err) {
    console.error("GET /api/upload failed", err);
    return NextResponse.json({ error: "Failed to load upload context" }, { status: 502 });
  }
}

/**
 * POST /api/upload — validate the gathered metadata and return the hand-off
 * bundle (title/description/tags/visibility/thumbnail) + the real
 * https://www.youtube.com/upload deep link. YouTube documents no URL params
 * for upload pre-fill → the copy-to-clipboard bundle is the honest carrier.
 * This route does NOT upload, does NOT create a video row, and does NOT
 * pretend anything was published — the button's label says exactly what it
 * does: hand off to YouTube.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`upload-post:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 30 }))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const parsed = handoffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload metadata" },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const handoff = buildUploadHandoff({
      title: d.title,
      description: d.description,
      tags: d.tags,
      visibility: d.visibility,
      thumbnailUrl: d.thumbnailUrl,
      isShort: d.isShort,
    });
    return NextResponse.json(handoff, { status: 200 });
  } catch (err) {
    console.error("POST /api/upload failed", err);
    return NextResponse.json({ error: "Failed to build the upload hand-off" }, { status: 500 });
  }
}
