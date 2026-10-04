/**
 * WFX2-A-W Session Broker tests — units only, NO live CDP, NO live actions.
 * CDP points at a dead port; the health contract with tabFound:false is the
 * honest PASS. Covers: auth (constant-time module), request validation,
 * action journal, healthz shape, like-params templating.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrokerServer, validateActionRequest } from "./server";
import { uploadExecuteScript } from "./kinds/upload";
import { liveChatSendScript } from "./kinds/livechat";
import { playlistUpdateScript, playlistReorderScript } from "./kinds/playlistedit";
import { createBrokerOptions } from "./options";
import { secretMatches } from "./auth";
import { Journal } from "./journal";
import type { CdpConnection } from "./cdp";
import {
  buildLikeParams,
  buildScript,
  ensureTabLiveness,
  executeAction,
  livenessSeam,
  requiredUrl,
} from "./executor";

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

describe("fetch validation (WFX2-4A read transport)", () => {
  const validate = (body: unknown) => validateActionRequest(body);

  test("valid top-level path normalizes into payload.path — no target required", () => {
    const r = validate({ kind: "fetch", path: "/@RickAstleyYT" });
    expect("req" in r).toBe(true);
    const req = (r as { req: { kind: string; target: Record<string, never>; payload: { path: string } } })
      .req;
    expect(req.kind).toBe("fetch");
    expect(req.target).toEqual({});
    expect(req.payload.path).toBe("/@RickAstleyYT");
  });
  test("payload.path is the tolerated alias (same shape as the top-level form)", () => {
    const r = validate({ kind: "fetch", payload: { path: "/watch?v=dQw4w9WgXcQ" } });
    expect("req" in r).toBe(true);
    expect((r as { req: { payload: { path: string } } }).req.payload.path).toBe(
      "/watch?v=dQw4w9WgXcQ"
    );
  });
  test("missing / empty / non-string path → error", () => {
    for (const body of [{ kind: "fetch" }, { kind: "fetch", path: "" }, { kind: "fetch", path: 42 }, { kind: "fetch", path: null }]) {
      const r = validate(body);
      expect("error" in r).toBe(true);
      expect((r as { error: string }).error).toContain("fetch requires path");
    }
  });
  test("absolute URLs are refused (path must start with \"/\")", () => {
    for (const path of ["https://evil.com/x", "http://www.youtube.com/", "watch?v=x", "www.youtube.com/watch?v=x"]) {
      const r = validate({ kind: "fetch", path });
      expect("error" in r).toBe(true);
      expect((r as { error: string }).error).toContain('must start with "/"');
    }
  });
  test("protocol-relative paths are refused (\"//host/…\" is an absolute URL)", () => {
    const r = validate({ kind: "fetch", path: "//evil.com/x" });
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toContain('must start with "/"');
  });
  test("query-bearing watch paths pass (the playback rung's shape)", () => {
    const r = validate({ kind: "fetch", path: "/watch?v=dQw4w9WgXcQ&hl=en&gl=US" });
    expect("req" in r).toBe(true);
  });
});

describe("fetch routing (executor)", () => {
  test("requiredUrl is null — the READ transport never navigates the tab", () => {
    expect(requiredUrl({ kind: "fetch", target: {}, payload: { path: "/@RickAstleyYT" } })).toBeNull();
  });
  test("buildScript: broker-side URL resolution + credentials + the 4 MiB cap", () => {
    const built = buildScript({ kind: "fetch", target: {}, payload: { path: "/watch?v=dQw4w9WgXcQ" } });
    expect(built).not.toBeNull();
    expect(built!.timeoutMs).toBeGreaterThan(0);
    // the path is resolved broker-side against the youtube.com base (never
    // re-parsed in-page) and interpolated as a JSON string literal
    expect(built!.script).toContain('"https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(built!.script).toContain("credentials:'include'");
    expect(built!.script).toContain("4*1024*1024");
    expect(built!.script).toContain("truncated");
    // the same-origin guard refuses a non-www tab (music/studio subdomains)
    expect(built!.script).toContain("https://www.youtube.com'");
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

// WFX2-P3: upload-execute LANDED (the P3-UP lane — kinds/upload.test.ts owns
// the deep script-shape suite). The pre-seed's transitional assertion
// ("upload-execute: staged kind") was self-expiring by design — "answer
// honestly until the lanes land" — and is replaced by the real-module
// routing lock. live-chat-send still routes to its honest staged stub until
// the P3-LC lane lands. CORRECTIVE (P3-UP lane, disclosed): the routing
// assertions pin the pre-seed's own documented intent — buildScript routes
// the kind modules, requiredUrl is null for upload-execute (the script owns
// its navigation).
test("P3 kinds: upload-execute + live-chat-send route their real lane drives", () => {
  const routingPayload = {
    fileName: "clip.mp4",
    title: "T",
    fileUrl: "http://127.0.0.1:3000/upload/stage?id=abc",
  };
  const up = uploadExecuteScript(routingPayload);
  expect(up.timeoutMs).toBeGreaterThan(0);
  expect(up.script).toContain("https://www.youtube.com/upload");
  expect(up.script).not.toContain("staged kind");
  const built = buildScript({ kind: "upload-execute", target: {}, payload: routingPayload });
  expect(built && built.script).toBe(up.script);
  expect(requiredUrl({ kind: "upload-execute", target: {}, payload: {} })).toBeNull();
  // WFX2-P3-LC LANDED (kinds/livechat.ts owns the deep fake-DOM suite). The
  // pre-seed's transitional "staged kind" assertion was self-expiring by
  // design — replaced by the real-drive routing lock (the P3-UP pattern).
  const lc = liveChatSendScript("hello from WebFlix");
  expect(lc.timeoutMs).toBeGreaterThan(0);
  expect(lc.script).toContain("yt-live-chat-text-input-field-renderer");
  expect(lc.script).not.toContain("staged kind");
  const lcBuilt = buildScript({ kind: "live-chat-send", target: {}, payload: { message: "hi" } });
  expect(lcBuilt && lcBuilt.script).toBe(liveChatSendScript("hi").script);
});

// WFX2-P4-PE LANDED (kinds/playlistedit.ts owns the deep script-shape suite).
// The pre-seed's transitional "staged kind" assertions were self-expiring by
// design — "answer honestly until the lanes land" — and are replaced by the
// real-module routing lock (the P3-UP / P3-LC pattern). The deep script-shape
// + payload-normalization coverage lives in kinds/playlistedit.test.ts.
test("P4 kinds: playlist-update + playlist-reorder route their real lane drives", () => {
  const up = playlistUpdateScript({ playlistId: "PL_test", title: "New name" });
  expect(up.timeoutMs).toBeGreaterThan(0);
  expect(up.script).toContain("ytd-edit-playlist-dialog-renderer");
  expect(up.script).not.toContain("staged kind");
  expect(up.script).toContain("title");
  const ro = playlistReorderScript({ playlistId: "PL_test", fromIndex: 0, toIndex: 2 });
  expect(ro.script).toContain("ytd-playlist-video-renderer");
  expect(ro.script).not.toContain("staged kind");
  expect(ro.script).toContain("fromIndex");
  const built = buildScript({ kind: "playlist-update", target: { playlistId: "PLx" }, payload: { title: "T" } });
  expect(built && built.script).toBe(playlistUpdateScript({ title: "T" }).script);
  expect(requiredUrl({ kind: "playlist-update", target: { playlistId: "PLx" }, payload: {} })).toBe(
    "https://www.youtube.com/playlist?list=PLx"
  );
  expect(requiredUrl({ kind: "playlist-reorder", target: { playlistId: "PLx" }, payload: {} })).toBe(
    "https://www.youtube.com/playlist?list=PLx"
  );
});

// -------------------------------------------------------------------------
// WFX2-5 tab-liveness pre-check + auto-revive (the 4-c wedge incidents)
// -------------------------------------------------------------------------

/**
 * Minimal CdpConnection stub — a SCRIPTED sequence of evaluate results
 * (per-call: an Error means the call REJECTS, the wedge's "CDP timeout"
 * shape) and a per-method send() outcome table. No live CDP (the file law:
 * units only — the real CdpConnection never opens a socket here).
 */
function fakeCdp(
  evalResults: (unknown | Error)[],
  sendResults: Record<string, unknown | Error> = {}
) {
  const calls = {
    evals: [] as string[],
    sends: [] as { method: string; params: Record<string, unknown> }[],
  };
  let evalIdx = 0;
  const conn = {
    evaluate: (expression: string) => {
      calls.evals.push(expression);
      const r = evalResults[evalIdx++];
      if (r === undefined) {
        return Promise.reject(
          new Error(`fake-cdp: unexpected evaluate #${evalIdx}: ${expression.slice(0, 60)}`)
        );
      }
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    send: (method: string, params: Record<string, unknown> = {}) => {
      calls.sends.push({ method, params });
      if (!(method in sendResults)) {
        return Promise.reject(new Error(`fake-cdp: unexpected send ${method}`));
      }
      const r = sendResults[method];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  };
  return { conn: conn as unknown as CdpConnection, calls };
}

const CDP_TIMEOUT = () => new Error("CDP timeout: Runtime.evaluate");

describe("WFX2-5 ensureTabLiveness — probe + auto-revive", () => {
  const settleBefore = livenessSeam.settleMs;

  beforeEach(() => {
    livenessSeam.settleMs = 1; // keep the suite fast (prod default 2500)
  });
  afterEach(() => {
    livenessSeam.settleMs = settleBefore;
  });

  test("healthy tab: the probe answers → alive; no reload, zero CDP sends", async () => {
    const { conn, calls } = fakeCdp([2]);
    expect(await ensureTabLiveness(conn)).toBe("alive");
    expect(calls.evals).toEqual(["1+1"]);
    expect(calls.sends).toEqual([]);
  });

  test("wedged renderer: the probe times out → Page.reload → settle → re-probe answers → revived", async () => {
    const { conn, calls } = fakeCdp([CDP_TIMEOUT(), 2], { "Page.reload": {} });
    expect(await ensureTabLiveness(conn)).toBe("revived");
    expect(calls.evals).toEqual(["1+1", "1+1"]); // probe + post-revival re-probe
    expect(calls.sends.map((s) => s.method)).toEqual(["Page.reload"]);
  });

  test("an exception-object answer is still proof of life (the renderer evaluated)", async () => {
    const { conn, calls } = fakeCdp([{ __exception: "SyntaxError" }]);
    expect(await ensureTabLiveness(conn)).toBe("alive");
    expect(calls.sends).toEqual([]);
  });

  test("Page.reload refused → the https://www.youtube.com/ navigation fallback revives", async () => {
    const { conn, calls } = fakeCdp([CDP_TIMEOUT(), 2], {
      "Page.reload": new Error("CDP error:reload-refused"),
      "Page.navigate": { frameId: "f1", loaderId: "l1" },
    });
    expect(await ensureTabLiveness(conn)).toBe("revived");
    expect(calls.sends.map((s) => s.method)).toEqual(["Page.reload", "Page.navigate"]);
    expect(calls.sends[1].params).toEqual({ url: "https://www.youtube.com/" });
  });

  test("reload sent but the renderer stays wedged → honest revive-failed (never a throw)", async () => {
    const { conn, calls } = fakeCdp([CDP_TIMEOUT(), CDP_TIMEOUT()], { "Page.reload": {} });
    expect(await ensureTabLiveness(conn)).toBe("revive-failed");
    expect(calls.sends.map((s) => s.method)).toEqual(["Page.reload"]);
  });

  test("dead connection (reload AND navigate both refused) → revive-failed without a throw", async () => {
    const { conn, calls } = fakeCdp([CDP_TIMEOUT()], {
      "Page.reload": new Error("CDP connection closed"),
      "Page.navigate": new Error("CDP connection closed"),
    });
    expect(await ensureTabLiveness(conn)).toBe("revive-failed");
    expect(calls.evals).toEqual(["1+1"]); // no re-probe — nothing was revived
  });
});

describe("WFX2-5 executeAction — the liveness pre-check runs at the entry (ALL kinds)", () => {
  const settleBefore = livenessSeam.settleMs;
  const fetchPayload = { ok: true, verified: true, path: "fetch", status: 200, body: "<html>yt</html>" };

  beforeEach(() => {
    livenessSeam.settleMs = 1;
  });
  afterEach(() => {
    livenessSeam.settleMs = settleBefore;
  });

  test("healthy tab: probe → action script (exactly the two evaluates, fetch kind)", async () => {
    const { conn, calls } = fakeCdp([2, fetchPayload]);
    const res = await executeAction(conn, {
      kind: "fetch",
      target: {},
      payload: { path: "/@RickAstleyYT" },
    });
    expect(res.ok).toBe(true);
    expect((res as { body: string }).body).toBe("<html>yt</html>");
    // call 0 = the liveness probe, call 1 = the fetch action script
    expect(calls.evals).toHaveLength(2);
    expect(calls.evals[1]).toContain("https://www.youtube.com/@RickAstleyYT");
    expect(calls.sends).toEqual([]);
  });

  test("wedged tab: auto-revived BEFORE the action script runs (probe → reload → re-probe → script)", async () => {
    const { conn, calls } = fakeCdp([CDP_TIMEOUT(), 2, fetchPayload], { "Page.reload": {} });
    const res = await executeAction(conn, {
      kind: "fetch",
      target: {},
      payload: { path: "/watch?v=dQw4w9WgXcQ&hl=en&gl=US" },
    });
    expect(res.ok).toBe(true);
    expect(calls.sends.map((s) => s.method)).toEqual(["Page.reload"]);
    expect(calls.evals).toHaveLength(3); // probe → post-revive re-probe → script
    expect(calls.evals[2]).toContain("/watch?v=dQw4w9WgXcQ");
  });

  test("failed revive is honest: the action proceeds and fails with its NORMAL error", async () => {
    // probe times out, reload refused, navigate refused → revive-failed →
    // the action script's own evaluate rejects (the normal cdp failure)
    const { conn, calls } = fakeCdp([CDP_TIMEOUT(), CDP_TIMEOUT()], {
      "Page.reload": new Error("CDP connection closed"),
      "Page.navigate": new Error("CDP connection closed"),
    });
    await expect(
      executeAction(conn, { kind: "fetch", target: {}, payload: { path: "/@MrBeast" } })
    ).rejects.toThrow("CDP timeout: Runtime.evaluate");
    expect(calls.evals).toHaveLength(2); // probe + the action's own (failing) evaluate
  });
});
