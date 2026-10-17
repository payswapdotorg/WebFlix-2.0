/**
 * P23-B — the shared ask-AI pure layer: the conversational-query heuristic,
 * the answer-token splitters (citation chips + seek chips), the suggested
 * prompts, the clock formatting. Pure functions only — no env, no fetch.
 */
import { describe, expect, test } from "bun:test";
import {
  formatClock,
  isConversationalQuery,
  parseAnswerSeeks,
  splitAnswerSegments,
  suggestedAskPrompts,
} from "@/lib/ai/heuristic";

describe("isConversationalQuery — the G3 gate", () => {
  test("a trailing question mark is conversational", () => {
    expect(isConversationalQuery("did the bunnies win?")).toBe(true);
    expect(isConversationalQuery("What?")).toBe(true);
  });

  test("question-starter words are conversational", () => {
    for (const q of [
      "who is proog",
      "what is elephants dream",
      "why is blender open source",
      "how to render in cycles",
      "when was sintel released",
      "where was big buck bunny made",
      "is sintel free to watch",
      "are blender movies creative commons",
      "can I use blender films commercially",
      "does the bunny get revenge",
    ]) {
      expect(isConversationalQuery(q)).toBe(true);
    }
  });

  test("keyword-soup searches are NOT conversational", () => {
    expect(isConversationalQuery("lofi beats")).toBe(false);
    expect(isConversationalQuery("blender open movie")).toBe(false);
    expect(isConversationalQuery("rick astley")).toBe(false);
  });

  test("a long natural-language phrase (6+ words) is conversational", () => {
    expect(isConversationalQuery("videos of a giant bunny getting revenge on rodents")).toBe(true);
  });

  test("short phrases (under 6 words, no ?) are not conversational", () => {
    expect(isConversationalQuery("bunny revenge rodents")).toBe(false);
  });

  test("quoted / exact-match intent is never conversational", () => {
    expect(isConversationalQuery('"never gonna give you up"')).toBe(false);
    expect(isConversationalQuery("what is “lofi” exactly")).toBe(false);
  });

  test("junk input is rejected (too short / too long)", () => {
    expect(isConversationalQuery("")).toBe(false);
    expect(isConversationalQuery("  ")).toBe(false);
    expect(isConversationalQuery("a?")).toBe(false);
    expect(isConversationalQuery(`${"x".repeat(501)}?`)).toBe(false);
  });
});

describe("parseAnswerSeeks — the [m:ss] validation law", () => {
  const valid = new Set([0, 75, 132, 184, 610]);

  test("keeps only timestamps that land on a real moment, deduped, in order", () => {
    const out = parseAnswerSeeks(
      "It starts at [0:00], the hall rings at [3:04], again [3:04], and ends around [10:10].",
      valid
    );
    expect(out).toEqual([
      { sec: 0, label: "0:00" },
      { sec: 184, label: "3:04" },
      { sec: 610, label: "10:10" },
    ]);
  });

  test("fabricated timestamps are dropped (the honest-absence law)", () => {
    const out = parseAnswerSeeks("a fake moment [9:59] and a real one [1:15].", valid);
    expect(out).toEqual([{ sec: 75, label: "1:15" }]);
  });

  test("h:mm:ss timestamps parse and validate like m:ss", () => {
    const out = parseAnswerSeeks("the finale [1:02:03] plus [2:12].", new Set([3723, 132]));
    expect(out).toEqual([
      { sec: 3723, label: "1:02:03" },
      { sec: 132, label: "2:12" },
    ]);
  });

  test("malformed clock tokens never become seeks", () => {
    expect(parseAnswerSeeks("bad [12:34:567] and [0:0] and :30]", valid)).toEqual([]);
  });
});

describe("splitAnswerSegments — the render splitter (chips vs plain text)", () => {
  test("in-range [n] tokens are citation chips; out-of-range stay text", () => {
    const segments = splitAnswerSegments("See [1] and [3], not [9].", { citations: 3, seeks: [] });
    expect(segments).toEqual([
      { kind: "text", text: "See ", start: 0 },
      { kind: "citation", n: 1, start: 4 },
      { kind: "text", text: " and ", start: 7 },
      { kind: "citation", n: 3, start: 12 },
      // an out-of-range token stays plain text (its own segment — the
      // renderer concatenates adjacent text segments)
      { kind: "text", text: ", not ", start: 15 },
      { kind: "text", text: "[9]", start: 21 },
      { kind: "text", text: ".", start: 24 },
    ]);
  });

  test("[m:ss] tokens are chips only when the route validated that label", () => {
    const segments = splitAnswerSegments(
      "Real [2:12] but fake [9:59].",
      { citations: 0, seeks: [{ sec: 132, label: "2:12" }] }
    );
    expect(segments).toEqual([
      { kind: "text", text: "Real ", start: 0 },
      { kind: "seek", sec: 132, label: "2:12", start: 5 },
      { kind: "text", text: " but fake ", start: 11 },
      { kind: "text", text: "[9:59]", start: 21 },
      { kind: "text", text: ".", start: 27 },
    ]);
  });

  test("citations and seeks interleave with text with correct offsets", () => {
    const segments = splitAnswerSegments("x [1] y [0:52] z", {
      citations: 2,
      seeks: [{ sec: 52, label: "0:52" }],
    });
    expect(segments.map((s) => s.kind)).toEqual(["text", "citation", "text", "seek", "text"]);
    expect(segments[3].start).toBe(8);
  });
});

describe("suggestedAskPrompts — the Ask panel's empty state", () => {
  test("title- and chapter-derived prompts, deduped and capped", () => {
    const prompts = suggestedAskPrompts("Big Buck Bunny — Blender Open Movie (Full HD)", [
      { title: "Intro" },
      { title: "A peaceful morning" },
      { title: "The rodent gang" },
      { title: "Justice" },
    ]);
    expect(prompts[0]).toBe("What is this video about?");
    expect(prompts[1]).toBe("Summarize the key points");
    expect(prompts).toContain("What happens in “Intro”?");
    expect(prompts).toContain("What happens in “A peaceful morning”?");
    // only the first two chapters ride the suggestions
    expect(prompts).not.toContain("What happens in “The rodent gang”?");
    expect(prompts.length).toBeLessThanOrEqual(5);
  });

  test("no chapters → the base prompts (+ the title prompt) only", () => {
    const prompts = suggestedAskPrompts("Sintel Trailer", []);
    expect(prompts).toEqual([
      "What is this video about?",
      "Summarize the key points",
      "What does “Sintel Trailer” cover?",
    ]);
  });

  test("a blank title adds nothing fabricated", () => {
    const prompts = suggestedAskPrompts("", [{ title: "Intro" }]);
    expect(prompts).toContain("What happens in “Intro”?");
    expect(prompts.some((p) => p.includes("cover?"))).toBe(false);
  });
});

describe("formatClock", () => {
  test("m:ss under an hour, h:mm:ss above", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("0:00");
  });
});
