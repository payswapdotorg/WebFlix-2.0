import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_TITLE_MAX,
} from "@/lib/youtube/studio";

export const dynamic = "force-dynamic";

/**
 * WFX2-P36 — POST /api/upload/execute: the HONEST UNSUPPORTED lane.
 *
 * The pre-P36 drive staged the file and then uploaded it by driving
 * youtube.com's upload dialog in the OPERATOR's logged-in browser tab through
 * the broker — a YouTube WRITE executed as the shared operator identity,
 * exactly the class of path the P36 work order retires. The official
 * per-user lane (videos.insert with the signed-in user's own OAuth
 * connection, an upload-sized resumable flow) is FUTURE WORK — it is not
 * claimed here. Until it lands, this route answers the honest 501 with the
 * machine-stable kind "youtube-unsupported": nothing is uploaded, nothing is
 * claimed, and the wizard's hand-off rung (the metadata bundle + YouTube's
 * own upload page — POST /api/upload, untouched) carries the user instead.
 *
 * The request validation (the wizard's field laws) is kept so the honest 400s
 * stay contract-stable; only request errors are 4xx. The metadata/stage
 * routes are untouched (staging stays available for the hand-off rung).
 */

const executeSchema = z.object({
  stageId: z.string({ message: "stageId is required" }).trim().min(1, "stageId is required"),
  title: z
    .string({ message: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(YOUTUBE_TITLE_MAX, `Title is limited to ${YOUTUBE_TITLE_MAX} characters on YouTube`),
  description: z.string().trim().max(YOUTUBE_DESCRIPTION_MAX).default(""),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  // carried for the honest hand-off rung (tags/thumbnail/isShort are
  // hand-off fields — YouTube's own upload form takes them there)
  tags: z
    .array(z.string().trim().min(1))
    .max(30, "At most 30 tags")
    .default([])
    .transform((tags) => [...new Set(tags)].slice(0, 30)),
  thumbnailUrl: z
    .string()
    .trim()
    .url("Thumbnail must be an https URL")
    .refine((u) => u.startsWith("https://"), "Thumbnail must be an https URL")
    .nullable()
    .default(null),
  isShort: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (
      !(await rateLimit(`upload-execute:${req.headers.get("x-forwarded-for") ?? "local"}`, {
        limit: 20,
        windowMs: 10 * 60_000,
      }))
    ) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const parsed = executeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload metadata" },
        { status: 400 }
      );
    }

    // WFX2-P36 — the honest unsupported verdict: no upload runs, none is
    // claimed; the hand-off rung (the wizard's Visibility step) carries the
    // user to YouTube's own upload page.
    return NextResponse.json(
      {
        error:
          "Publishing videos through WebFlix isn't supported yet — the official YouTube upload lane (videos.insert on your own connected account) is future work. Use the hand-off bundle on the Visibility step to upload on YouTube.",
        kind: "youtube-unsupported",
      },
      { status: 501, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("POST /upload/execute failed", err);
    return NextResponse.json({ error: "Failed to execute the upload" }, { status: 500 });
  }
}
