/**
 * WFX2-W transcript service — cue rows seeded per video (honest,
 * generated-from-seed content), ordered by startSec.
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import type { TranscriptCueDto } from "./types";

export async function getTranscript(videoId: string): Promise<TranscriptCueDto[]> {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");
  const cues = await db.transcriptCue.findMany({
    where: { videoId },
    orderBy: [{ startSec: "asc" }, { id: "asc" }],
  });
  return cues.map((c) => ({
    id: c.id,
    startSec: c.startSec,
    endSec: c.endSec,
    text: c.text,
  }));
}
