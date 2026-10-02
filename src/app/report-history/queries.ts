import { db } from "@/lib/db";

export type ReportedVideoRow = {
  id: string;
  reason: string;
  createdAt: Date;
  video: { id: string; title: string; thumbnailUrl: string };
};

/**
 * WFX2-P5-SS — the verified local read path for report history.
 *
 * Video reports really do record locally: POST /api/videos/[id]/report
 * upserts a VideoReport row (the moderation review queue — the video stays
 * visible, matching youtube.com). This lists THIS user's rows.
 *
 * Comment reports are NOT here and never will be: they are proxied to the
 * operator's YouTube session (POST /api/comments/[id]/report) and leave no
 * local record. The page says both truths instead of blending them.
 */
export async function listMyVideoReports(userId: string): Promise<ReportedVideoRow[]> {
  return db.videoReport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { video: { select: { id: true, title: true, thumbnailUrl: true } } },
  });
}
