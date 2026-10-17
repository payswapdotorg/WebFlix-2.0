/**
 * P23-B — the ask-service prompt builders + answer parsers: G3's grounded
 * numbered-sources prompt, G4's chapters/transcript-grounded prompt, the
 * summary's KEYMOMENT contract, and the validation laws (real timestamps
 * only, fabricated dropped). Pure + in-memory cue fixtures — no network.
 */
import { describe, expect, test } from "bun:test";
import {
  answerSeeksFor,
  buildSearchAskMessages,
  buildSummaryMessages,
  buildWatchAskMessages,
  parseSummary,
  sampleCues,
  type WatchAskGrounding,
} from "@/lib/ai/ask-service";

const cues = (starts: number[]) =>
  starts.map((s, i) => ({ id: `c${i}`, startSec: s, endSec: s + 6, text: `line ${i}` }));

const grounding: WatchAskGrounding = {
  title: "Big Buck Bunny — Blender Open Movie (Full HD)",
  channelName: "Blender Studio",
  description: "The classic open movie.\n\n0:00 Intro\n1:15 A peaceful morning\n3:04 Bullying the butterfly",
  chapters: [
    { startSec: 0, endSec: 75, title: "Intro" },
    { startSec: 75, endSec: 184, title: "A peaceful morning" },
    { startSec: 184, endSec: null, title: "Bullying the butterfly" },
  ],
  cues: cues([0, 6, 16, 30, 52, 75, 96, 132, 184, 252]),
};

describe("buildSearchAskMessages — G3 grounding", () => {
  test("the numbered sources ride the user message (title — channel — snippet)", () => {
    const [system, user] = buildSearchAskMessages("what is elephants dream", [
      { id: "v1", title: "Elephants Dream", channelName: "Blender Studio", description: "The first open movie" },
      { id: "v2", title: "Sintel", channelName: "Blender Studio", description: "" },
    ]);
    expect(system.role).toBe("system");
    expect(system.content).toContain("[n]");
    expect(system.content).toContain("ONLY");
    expect(user.content).toContain("Question: what is elephants dream");
    expect(user.content).toContain("[1] Elephants Dream — Blender Studio — The first open movie");
    expect(user.content).toContain("[2] Sintel — Blender Studio");
  });

  test("long descriptions are snippeted to 160 chars", () => {
    const [, user] = buildSearchAskMessages("q", [
      { id: "v1", title: "T", channelName: "C", description: "d".repeat(400) },
    ]);
    const line = user.content.split("\n").find((l) => l.startsWith("[1]"))!;
    expect(line.length).toBeLessThanOrEqual("[1] T — C — ".length + 160);
  });
});

describe("buildWatchAskMessages — G4 grounding", () => {
  test("title, channel, chapters (with real timestamps) and transcript ride the prompt", () => {
    const [system, user] = buildWatchAskMessages("does the bunny win", grounding);
    expect(system.content).toContain("[m:ss]");
    expect(system.content).toContain("ONLY");
    expect(user.content).toContain(`Video: ${grounding.title}`);
    expect(user.content).toContain("Channel: Blender Studio");
    expect(user.content).toContain("- [1:15] A peaceful morning");
    expect(user.content).toContain("[4:12] line 9"); // cue 252s → 4:12 is index 9
    expect(user.content).toContain("Question: does the bunny win");
  });

  test("the transcript is sampled down to the char budget (first + last always kept)", () => {
    const long = grounding.cues.map((c, i) => ({
      ...c,
      text: `cue number ${i} ${"x".repeat(120)}`,
    }));
    const sampled = sampleCues([...long], 1000);
    const rendered = sampled.reduce((n, c) => n + c.text.length + 12, 0);
    expect(rendered).toBeLessThanOrEqual(1000 + 140);
    expect(sampled[0].id).toBe(long[0].id);
    expect(sampled[sampled.length - 1].id).toBe(long[long.length - 1].id);
  });

  test("answerSeeksFor keeps only chapter/cue-exact timestamps (fabricated dropped)", () => {
    const seeks = answerSeeksFor(
      "The morning starts [1:15], then [4:12], but never [9:59].",
      grounding
    );
    expect(seeks).toEqual([
      { sec: 75, label: "1:15" },
      { sec: 252, label: "4:12" },
    ]);
  });
});

describe("buildSummaryMessages + parseSummary — the AI summary contract", () => {
  test("with chapters, the prompt demands KEYMOMENT lines on chapter timestamps", () => {
    const [system] = buildSummaryMessages(grounding);
    expect(system.content).toContain("KEYMOMENT");
    expect(system.content).toContain("3-5 sentence");
  });

  test("without chapters, the prompt forbids key moments entirely", () => {
    const [system] = buildSummaryMessages({ ...grounding, chapters: [], cues: [] });
    expect(system.content).toContain("no chapters");
  });

  test("valid KEYMOMENT lines become moments bound to the REAL chapter titles", () => {
    const { summary, keyMoments } = parseSummary(
      "A giant rabbit's gentle revenge.\n\nKEYMOMENT 1:15 - the calm morning\nKEYMOMENT 3:04 - the butterfly\nKEYMOMENT 9:59 - fabricated",
      grounding.chapters
    );
    expect(summary).toBe("A giant rabbit's gentle revenge.");
    expect(keyMoments).toEqual([
      { sec: 75, label: "1:15", title: "A peaceful morning" },
      { sec: 184, label: "3:04", title: "Bullying the butterfly" },
    ]);
  });

  test("fabricated KEYMOMENT timestamps are dropped (real ones only)", () => {
    const { keyMoments } = parseSummary(
      "Summary.\nKEYMOMENT 0:30 - not a chapter start\nKEYMOMENT 0:00 - real",
      grounding.chapters
    );
    expect(keyMoments).toEqual([{ sec: 0, label: "0:00", title: "Intro" }]);
  });

  test("no KEYMOMENT section → summary only, moments empty", () => {
    const { summary, keyMoments } = parseSummary("Just a summary, no moments.", grounding.chapters);
    expect(summary).toBe("Just a summary, no moments.");
    expect(keyMoments).toEqual([]);
  });

  test("duplicate timestamps collapse to one moment", () => {
    const { keyMoments } = parseSummary(
      "S\nKEYMOMENT 1:15 - a\nKEYMOMENT 1:15 - b",
      grounding.chapters
    );
    expect(keyMoments).toEqual([{ sec: 75, label: "1:15", title: "A peaceful morning" }]);
  });
});
