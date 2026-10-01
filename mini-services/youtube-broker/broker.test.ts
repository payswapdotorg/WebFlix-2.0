/**
 * WFX2-A-W Session Broker tests — units only, NO live CDP, NO live actions.
 * CDP points at a dead port; the health contract with tabFound:false is the
 * honest PASS. Covers: auth (constant-time module), request validation,
 * action journal, healthz shape, like-params templating.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrokerServer, validateActionRequest } from "./server";
import { uploadExecuteScript } from "./kinds/upload";
import { liveChatSendScript } from "./kinds/livechat";
import { createBrokerOptions } from "./options";
import { secretMatches } from "./auth";
import { Journal } from "./journal";
import { buildLikeParams } from "./executor";

const dir = mkdtempSync(join(tmpdir(), "broker-test-"));
const journalPath = join(dir, "actions.jsonl");
const opts = createBrokerOptions({
  BROKER_SECRET: "test-secret",
  CDP_HTTP: "http://127.0.0.1:59999", // dead port — no CDP browser in CI
  BROKER_JOURNAL: journalPath,
});
opts.port = 0; // ephemeral
const server = createBrokerServer(opts);
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("auth (constant-time secret compare)", () => {
  test("correct secret passes", () => {
    expect(secretMatches("test-secret", "test-secret")).toBe(true);
  });
  test("wrong secret fails", () => {
    expect(secretMatches("wrong", "test-secret")).toBe(false);
  });
  test("missing secret fails closed", () => {
    expect(secretMatches("test-secret", null)).toBe(false);
    expect(secretMatches(null, "test-secret")).toBe(false);
  });
  test("length difference never throws (digest equalizes)", () => {
    expect(secretMatches("x".repeat(10000), "test-secret")).toBe(false);
  });
});

describe("request validation", () => {
  const validate = (body: unknown) => validateActionRequest(body);

  test("unknown kind → error naming the valid kinds", () => {
    const r = validate({ kind: "explode", target: { videoId: "dQw4w9WgXcQ" } });
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toContain("unknown kind");
  });
  test("like without videoId → error", () => {
    const r = validate({ kind: "like", target: {} });
    expect((r as { error: string }).error).toContain("videoId");
  });
  test("bell without pref → error", () => {
    const r = validate({ kind: "bell", target: { channelId: "UC123" }, payload: {} });
    expect((r as { error: string }).error).toContain("pref");
  });
  test("comment-create without text → error", () => {
    const r = validate({ kind: "comment-create", target: { videoId: "dQw4w9WgXcQ" } });
    expect((r as { error: string }).error).toContain("payload.text");
  });
  test("valid like request normalizes", () => {
    const r = validate({ kind: "like", target: { videoId: "dQw4w9WgXcQ" } });
    expect("req" in r).toBe(true);
    expect((r as { req: { kind: string } }).req.kind).toBe("like");
  });
});

describe("journal", () => {
  test("append + last + tail round-trip", () => {
    const j = new Journal(join(dir, "j2.jsonl"));
    expect(j.last()).toBeNull();
    j.append({ ts: "2026-09-29T00:00:00Z", kind: "like", target: { videoId: "abc" }, result: { ok: true } });
    j.append({ ts: "2026-09-29T00:00:01Z", kind: "dislike", target: { videoId: "abc" }, result: { ok: false } });
    expect(j.last()?.kind).toBe("dislike");
    expect(j.tail(5)).toHaveLength(2);
    expect(j.tail(1)).toHaveLength(1);
  });
  test("missing file → null (no throw)", () => {
    const j = new Journal(join(dir, "nope.jsonl"));
    expect(j.last()).toBeNull();
  });
});

describe("like params templating", () => {
  test("videoId swapped byte-level, timestamp refreshed, padding URL-encoded", () => {
    const p = buildLikeParams("jNQXAC9IVRw", false);
    expect(p).not.toBeNull();
    expect(p!.endsWith("%3D%3D")).toBe(true);
    const buf = Buffer.from(decodeURIComponent(p!), "base64");
    expect(buf.length).toBe(31);
    expect(buf.toString("latin1", 4, 15)).toBe("jNQXAC9IVRw");
    // field 6.1 varint timestamp at [20..25) decodes to a recent unix sec
    let ts = 0;
    for (let i = 24; i >= 20; i--) ts = ts * 128 + (buf[i] & 0x7f);
    expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(300);
  });
  test("remove template keeps field3/field5 variant shape", () => {
    const p = buildLikeParams("jNQXAC9IVRw", true);
    const buf = Buffer.from(decodeURIComponent(p!), "base64");
    expect(buf[15]).toBe(0x18); // field 3 varint (removelike variant)
    expect(buf[17]).toBe(0x2a); // field 5 (removelike variant)
  });
  test("non-11-char videoId → null (template not byte-swappable)", () => {
    expect(buildLikeParams("short", false)).toBeNull();
  });
});

describe("health contract (no CDP browser — dead port)", () => {
  test("GET /healthz → ok, tabFound:false, honest cdp error field", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tabFound: boolean; cdp?: string };
    expect(body.ok).toBe(true);
    expect(body.tabFound).toBe(false);
    expect(typeof body.cdp).toBe("string"); // honest about the dead endpoint
  });
});

describe("action route guards", () => {
  test("missing secret header → 401", async () => {
    const res = await fetch(`${base}/broker/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "like", target: { videoId: "dQw4w9WgXcQ" } }),
    });
    expect(res.status).toBe(401);
  });
  test("wrong secret → 401", async () => {
    const res = await fetch(`${base}/broker/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-broker-secret": "nope" },
      body: JSON.stringify({ kind: "like", target: { videoId: "dQw4w9WgXcQ" } }),
    });
    expect(res.status).toBe(401);
  });
  test("unknown kind with valid secret → 400", async () => {
    const res = await fetch(`${base}/broker/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-broker-secret": "test-secret" },
      body: JSON.stringify({ kind: "explode", target: { videoId: "dQw4w9WgXcQ" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("unknown kind");
  });
  test("valid request but CDP dead → honest 502 + journal entry", async () => {
    const res = await fetch(`${base}/broker/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-broker-secret": "test-secret" },
      body: JSON.stringify({ kind: "like", target: { videoId: "dQw4w9WgXcQ" } }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("cdp");
    const j = new Journal(journalPath);
    const last = j.last();
    expect(last?.kind).toBe("like");
    expect(last?.result.ok).toBe(false);
  });
});

describe("fail-closed without secret", () => {
  test("actions refused with 503 when BROKER_SECRET is unconfigured", async () => {
    const o2 = createBrokerOptions({ BROKER_SECRET: "", CDP_HTTP: "http://127.0.0.1:59999", BROKER_JOURNAL: join(dir, "j3.jsonl") });
    o2.port = 0;
    const s2 = createBrokerServer(o2);
    try {
      const res = await fetch(`http://127.0.0.1:${s2.port}/broker/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "like", target: { videoId: "dQw4w9WgXcQ" } }),
      });
      expect(res.status).toBe(503);
    } finally {
      s2.stop(true);
    }
  });
});

// WFX2-P3 pre-seed: the staged kinds route to their lane-owned modules and
// answer honestly until the lanes land (upload-execute / live-chat-send).
test("P3 staged kinds: upload-execute + live-chat-send route + honest stub", () => {
  const up = uploadExecuteScript({ fileName: "clip.mp4", title: "T" });
  expect(up.timeoutMs).toBeGreaterThan(0);
  expect(up.script).toContain("upload-execute: staged kind");
  const lc = liveChatSendScript("hello from WebFlix");
  expect(lc.script).toContain("live-chat-send: staged kind");
  expect(lc.script).toContain('\"messageLen\":18');
});
