/**
 * WFX2 P34 — the captured-wire promotion tool tests.
 *
 * The analyzer is driven with the REAL like template (the captured wire
 * the P33 lane shipped) and with the broker's own buildLikeParams output
 * (the wire form, URL-encoded padding) — the detection must land on the
 * exact byte layout the like family uses: the 11-char id at offset 4 and
 * the 5-byte unix-sec varint at offset 20. Non-like layouts take the
 * honest manual-review path (never a guessed builder).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLikeParams } from "./executor";
import type { CaptureEntry } from "./captures";
import {
  analyzeCapture,
  detectIdRuns,
  detectTsSlots,
  extractActionFields,
  parseCaptures,
  renderAnalysis,
  selectCapture,
  walkProtobuf,
} from "./promote-captured-wire";

const dir = mkdtempSync(join(tmpdir(), "promote-test-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// the P33 captured like fixture (dQw4w9WgXcQ) — byte-exact
const LIKE_B64 = "Cg0KC2RRdzR3OVdnWGNRIAAyDAiH6OzVBhCG4ZOCAg==";

function likeCapture(overrides: Partial<CaptureEntry> = {}): CaptureEntry {
  return {
    ts: "2026-10-21T01:23:45Z",
    kind: "dislike",
    target: { videoId: "dQw4w9WgXcQ" },
    endpoint: "like/like",
    url: "https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false",
    method: "POST",
    postData: JSON.stringify({ context: { clientName: "WEB" }, params: LIKE_B64 }),
    truncated: false,
    status: 200,
    requestId: "r1",
    ...overrides,
  };
}

describe("parseCaptures / selectCapture", () => {
  test("parses JSONL lines; a torn tail line is skipped, not fatal", () => {
    const text = [
      JSON.stringify(likeCapture({ endpoint: "like/like" })),
      JSON.stringify(likeCapture({ endpoint: "like/removelike" })),
      '{"torn": ',
    ].join("\n");
    expect(parseCaptures(text)).toHaveLength(2);
  });

  test("endpoint substring filter + negative index (latest match)", () => {
    const entries = [
      likeCapture({ endpoint: "like/like", requestId: "r1" }),
      likeCapture({ endpoint: "like/removelike", requestId: "r2" }),
      likeCapture({ endpoint: "comment/perform_comment_action", requestId: "r3" }),
      likeCapture({ endpoint: "like/like", requestId: "r4" }),
    ];
    expect(selectCapture(entries, { endpoint: "like/like" })?.requestId).toBe("r4");
    expect(selectCapture(entries, { endpoint: "like/like", index: -2 })?.requestId).toBe("r1");
    expect(selectCapture(entries, {})?.requestId).toBe("r4");
    expect(selectCapture(entries, { endpoint: "bell" })).toBeNull();
    expect(selectCapture(entries, { index: 99 })).toBeNull();
  });
});

describe("extractActionFields", () => {
  test("carries params and actions from the wire body", () => {
    const f = extractActionFields(
      JSON.stringify({ params: "AA==", actions: [{ action: "ACTION_ADD_VIDEO" }] })
    );
    expect(f?.params).toBe("AA==");
    expect(f?.actions).toEqual([{ action: "ACTION_ADD_VIDEO" }]);
  });
  test("null postData and non-JSON bodies answer null honestly", () => {
    expect(extractActionFields(null)).toBeNull();
    expect(extractActionFields("not json")).toBeNull();
    expect(extractActionFields("{}")).toBeNull();
  });
});

describe("the generic protobuf walk (READ, never guess)", () => {
  const buf = Buffer.from(LIKE_B64, "base64");

  test("walks the like template to its exact field tree", () => {
    const walk = walkProtobuf(buf);
    expect(walk).not.toBeNull();
    expect(walk).toHaveLength(3);
    // field 1 (len 13) nesting {1: "dQw4w9WgXcQ"} — the id string itself
    expect(walk![0].field).toBe(1);
    expect(walk![0].wireType).toBe(2);
    expect(walk![0].len).toBe(13);
    expect(walk![0].children).toHaveLength(1);
    expect(walk![0].children![0].bytes?.toString("latin1")).toBe("dQw4w9WgXcQ");
    // field 4 = varint 0 (outer level, tag at byte 15)
    expect(walk![1].field).toBe(4);
    expect(walk![1].offset).toBe(15);
    expect(walk![1].varint).toBe(0n);
    // field 6 (len 12) nesting {1: ts, 2: hash}
    expect(walk![2].field).toBe(6);
    expect(walk![2].children).toHaveLength(2);
  });

  test("a non-protobuf buffer walks to null (honest, no partial trees)", () => {
    expect(walkProtobuf(Buffer.from("hello world!!"))).toBeNull();
  });

  test("id-run detection lands on the 11-char id at offset 4", () => {
    const runs = detectIdRuns(buf);
    const id = runs.find((r) => r.text === "dQw4w9WgXcQ");
    expect(id).toBeDefined();
    expect(id!.offset).toBe(4);
    expect(id!.len).toBe(11);
  });

  test("ts-slot detection lands on the 5-byte unix-sec varint at offset 20", () => {
    const walk = walkProtobuf(buf)!;
    const slots = detectTsSlots(walk);
    expect(slots).toHaveLength(1);
    expect(slots[0].offset).toBe(20);
    expect(slots[0].len).toBe(5);
    expect(slots[0].path).toEqual([6, 1]);
    expect(Number(slots[0].value)).toBeGreaterThan(1_600_000_000);
  });
});

describe("analyzeCapture — the like family", () => {
  test("the real captured like template: layout YES + the exact like-law builder", () => {
    const a = analyzeCapture(likeCapture());
    expect(a.likeFamily).toBe(true);
    expect(a.tplConstant).toBe(`const LIKE_LIKE_TPL = Buffer.from("${LIKE_B64}", "base64");`);
    expect(a.proposedBuilder).toContain('buf.write(videoId, 4, "latin1");');
    expect(a.proposedBuilder).toContain("buf[20] = ((ts >>> 0) & 0x7f) | 0x80;");
    expect(a.proposedBuilder).toContain("buf[24] = (ts >>> 28) & 0x7f;");
    expect(a.notes.at(-1)).toMatch(/deterministic-401 probe/);
  });

  test("round-trip: the broker's own buildLikeParams output (URL-encoded padding) normalizes to the same family", () => {
    const wireParams = buildLikeParams("abcdefghijk", false, 1792605447000);
    expect(wireParams).toMatch(/%3D$/); // the wire form URL-encodes padding
    const a = analyzeCapture(
      likeCapture({ postData: JSON.stringify({ params: wireParams }), target: { videoId: "abcdefghijk" } })
    );
    expect(a.likeFamily).toBe(true);
    expect(a.idRuns.find((r) => r.text === "abcdefghijk")?.offset).toBe(4);
    expect(a.tsSlots[0].offset).toBe(20);
    expect(a.notes.some((n) => n.includes("normalized to padded base64"))).toBe(true);
  });

  test("a non-like layout takes the honest manual-review path (no guessed builder)", () => {
    // an 8-char id run and no unix-sec varint — NOT the like family
    const bytes = Buffer.from("1234567890", "latin1");
    const a = analyzeCapture(
      likeCapture({ postData: JSON.stringify({ params: bytes.toString("base64") }) })
    );
    expect(a.likeFamily).toBe(false);
    expect(a.proposedBuilder).toBeNull();
    expect(a.tplConstant).toContain("_TPL");
    expect(a.notes.some((n) => n.includes("NOT the like family"))).toBe(true);
  });

  test("a bodyless capture (getRequestPostData failed) says so honestly", () => {
    const a = analyzeCapture(likeCapture({ postData: null }));
    expect(a.paramsB64).toBeNull();
    expect(a.notes[0]).toContain("NO body");
  });
});

describe("renderAnalysis (the review surface)", () => {
  test("renders the header, walk, id runs, and the verification plan", () => {
    const a = analyzeCapture(likeCapture());
    const text = renderAnalysis(a);
    expect(text).toContain("captured wire — like/like (dislike)");
    expect(text).toContain("params: " + LIKE_B64);
    expect(text).toContain('id runs: "dQw4w9WgXcQ" @4 (len 11)');
    expect(text).toContain("like-family layout: YES");
    expect(text).toContain("deterministic-401 probe");
  });
});
