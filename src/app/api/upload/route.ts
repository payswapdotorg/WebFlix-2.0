import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(140),
  description: z.string().trim().max(5000).default(""),
  videoUrl: z
    .string()
    .trim()
    .url("Must be a playable video URL (https)")
    .refine((u) => u.startsWith("https://"), "Must be an https URL"),
  thumbnailUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith("https://"), "Must be an https URL")
    .optional(),
  category: z.enum(CATEGORIES as [string, ...string[]]),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  isShort: z.boolean().default(false),
  durationSec: z.number().int().min(1).max(43_200).default(60),
});

/** POST /api/upload — create a video on the demo user's channel (CodeCraft). */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload" },
        { status: 400 }
      );
    }
    const user = await getDemoUser();
    const channel = await db.channel.findFirst({ where: { ownerId: user.id } });
    if (!channel) {
      return NextResponse.json({ error: "You don't own a channel yet" }, { status: 400 });
    }
    const d = parsed.data;
    const slug = d.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "upload";
    const video = await db.video.create({
      data: {
        channelId: channel.id,
        title: d.title,
        description: d.description,
        videoUrl: d.videoUrl,
        thumbnailUrl:
          d.thumbnailUrl ??
          `https://picsum.photos/seed/${slug}/${d.isShort ? "360/640" : "640/360"}`,
        durationSec: d.durationSec,
        views: 0,
        likes: 0,
        dislikes: 0,
        visibility: d.visibility,
        category: d.category,
        isShort: d.isShort,
      },
    });
    return NextResponse.json({ id: video.id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/upload failed", err);
    return NextResponse.json({ error: "Failed to upload" }, { status: 500 });
  }
}
