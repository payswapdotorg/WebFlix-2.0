/**
 * WFX2-W tests — progress resume payload + transcript seek mapping.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { saveProgress, getResume } from "../src/lib/watch/progress-service";
import { getVideoDetail } from "../src/lib/watch/video-service";
import { getTranscript } from "../src/lib/watch/transcript-service";
import { activeCueIndex, cueSeekSec } from "../src/lib/watch/transcript";
import { parseChapters, activeChapterIndex } from "../src/lib/watch/chapters";

setupTestDb();

describe("progress + resume", () => {
  test("saveProgress upserts; resume returns lastPositionSec", async () => {
    const { sintel, demo } = await fixtures();
    // seed gives demo resume=24 on the sintel trailer
    expect(await getResume(sintel.id, demo.id)).toBe(24);
    const r = await saveProgress(sintel.id, demo.id, 40, 40);
    expect(r).toEqual({ watchedSec: 40, lastPositionSec: 40 });
    expect(await getResume(sintel.id, demo.id)).toBe(40);
    // watchedSec is monotonic (max), lastPositionSec follows the playhead
    await saveProgress(sintel.id, demo.id, 30, 30);
    const event = await (await import("../src/lib/db")).db.viewEvent.findUniqueOrThrow({
      where: { videoId_userId: { videoId: sintel.id, userId: demo.id } },
    });
    expect(event.watchedSec).toBe(40);
    expect(event.lastPositionSec).toBe(30);
  });

  test("getVideoDetail exposes resumeSec for the viewer (the resume-on-load payload)", async () => {
    const { sintel, demo, pip } = await fixtures();
    await saveProgress(sintel.id, demo.id, 35, 35);
    const detail = await getVideoDetail(sintel.id, demo.id);
    expect(detail.state.resumeSec).toBe(35);
    const fresh = await getVideoDetail(sintel.id, pip.id);
    expect(fresh.state.resumeSec).toBeNull();
  });
});

describe("transcript", () => {
  test("cues are ordered by start time", async () => {
    const { bbb } = await fixtures();
    const cues = await getTranscript(bbb.id);
    expect(cues.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startSec).toBeGreaterThanOrEqual(cues[i - 1].startSec);
    }
  });

  test("active cue mapping follows the playhead (gaps keep the previous cue)", async () => {
    const { bbb } = await fixtures();
    const cues = await getTranscript(bbb.id);
    // BBB cue starts: 0, 6, 16, 30, 52, 75, 96, 132, ...
    expect(activeCueIndex(cues, 0)).toBe(0);
    expect(activeCueIndex(cues, 7)).toBe(1); // inside cue 2
    expect(activeCueIndex(cues, 100)).toBe(6); // gap between 96..132 → previous stays active
    expect(activeCueIndex(cues, 10_000)).toBe(cues.length - 1); // past the end → last cue
    expect(activeCueIndex(cues, -1)).toBe(-1); // before the first cue
  });

  test("cue click maps to its start second (seek mapping)", async () => {
    const { bbb } = await fixtures();
    const cues = await getTranscript(bbb.id);
    expect(cueSeekSec(cues[3])).toBe(cues[3].startSec);
  });

  test("empty transcript is honest (empty array, not an error)", async () => {
    const { db } = await import("../src/lib/db");
    const video = await db.video.findFirstOrThrow({ where: { title: { contains: "Sintel" } } });
    await db.transcriptCue.deleteMany({ where: { videoId: video.id } });
    const cues = await getTranscript(video.id);
    expect(cues).toEqual([]);
    expect(activeCueIndex(cues, 5)).toBe(-1);
  });
});

describe("chapters (seek-bar segments source)", () => {
  test("BBB description parses 8 chapters with a 0:00 start", async () => {
    const { bbb } = await fixtures();
    const chapters = parseChapters(bbb.description, bbb.durationSec);
    expect(chapters.length).toBe(8);
    expect(chapters[0].startSec).toBe(0);
    expect(chapters[0].title).toBe("Intro");
    expect(chapters.at(-1)!.endSec).toBe(bbb.durationSec);
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].startSec).toBe(chapters[i - 1].endSec);
    }
  });

  test("active chapter index + descriptions without 0:00 don't activate", async () => {
    const { bbb } = await fixtures();
    const chapters = parseChapters(bbb.description, bbb.durationSec);
    expect(activeChapterIndex(chapters, 0)).toBe(0);
    expect(activeChapterIndex(chapters, 200)).toBe(3);
    expect(activeChapterIndex([], 5)).toBe(-1);
    const noChapters = parseChapters("1:00 not from zero\n2:00 also not", 300);
    expect(noChapters).toEqual([]);
  });
});
