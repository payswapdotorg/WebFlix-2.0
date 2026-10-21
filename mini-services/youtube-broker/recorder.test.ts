/**
 * WFX2 P34 — WIRE-CAPTURE tests.
 *
 * Units only — NO live CDP, NO live actions (the broker file law). The
 * recorder is driven through a fake evented CdpConnection; the REAL
 * CdpConnection event dispatch is pinned through a patched WebSocket
 * global (the class's own message listener, not a stub).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpConnection, type CdpEventHandler } from "./cdp";
import { CaptureEntry, CaptureJournal } from "./captures";
import { MAX_POST_DATA, WireRecorder } from "./recorder";
import type { BrokerTarget } from "./types";

const dir = mkdtempSync(join(tmpdir(), "broker-recorder-test-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// the fake evented CDP (units only — the real class is pinned separately
// through the patched-WebSocket describe below)
// ---------------------------------------------------------------------------

interface SendCall {
  method: string;
  params: Record<string, unknown>;
}

function fakeEventedCdp(sendResults: Record<string, unknown | Error> = {}) {
  const sends: SendCall[] = [];
  const handlers = new Map<string, Set<CdpEventHandler>>();
  const conn = {
    evaluate: () => Promise.resolve(null),
    send: (method: string, params: Record<string, unknown> = {}) => {
      sends.push({ method, params });
      if (!(method in sendResults)) {
        return Promise.reject(new Error(`fake-cdp: unexpected send ${method}`));
      }
      const r = sendResults[method];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    on: (method: string, handler: CdpEventHandler) => {
      let set = handlers.get(method);
      if (!set) {
        set = new Set();
        handlers.set(method, set);
      }
      set.add(handler);
      return () => set.delete(handler);
    },
  };
  const emit = (method: string, params: unknown) => {
    handlers.get(method)?.forEach((h) => h(params));
  };
  return { conn: conn as unknown as CdpConnection, sends, emit };
}

const TARGET: BrokerTarget = { videoId: "dQw4w9WgXcQ" };

function requestWillBeSent(
  requestId: string,
  url: string,
  opts: { method?: string; postData?: string } = {}
) {
  return {
    requestId,
    request: { url, method: opts.method ?? "POST", postData: opts.postData },
  };
}

function responseReceived(requestId: string, status: number) {
  return { requestId, response: { status } };
}

const LIKE_URL = "https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false";

async function newRecorder(sendResults?: Record<string, unknown | Error>) {
  const fake = fakeEventedCdp({
    // the recorder's own domain toggles always resolve
    "Network.enable": {},
    "Network.disable": {},
    ...(sendResults ?? {}),
  });
  const file = join(dir, `captures-${Math.random().toString(36).slice(2)}.jsonl`);
  const journal = new CaptureJournal(file);
  const recorder = new WireRecorder(fake.conn, journal, { kind: "like", target: TARGET }, () => "2026-10-21T00:00:00Z");
  return { recorder, journal, fake, file };
}

describe("WireRecorder — the action window", () => {
  test("start arms the Network domain; flush disables it and unsubscribes", async () => {
    const { recorder, fake } = await newRecorder();
    await recorder.start();
    expect(fake.sends.map((s) => s.method)).toContain("Network.enable");
    const n = await recorder.flush();
    expect(n).toBe(0);
    expect(fake.sends.map((s) => s.method)).toContain("Network.disable");
    // unsubscribed: events after flush never capture
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL, { postData: "{}" }));
    expect(await recorder.flush()).toBe(0);
  });

  test("flush without start is a 0-capture no-op (the never-armed path)", async () => {
    const { recorder } = await newRecorder();
    expect(await recorder.flush()).toBe(0);
  });

  test("an action POST is captured with its response status and context", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit(
      "Network.requestWillBeSent",
      requestWillBeSent("r1", LIKE_URL, {
        postData: '{"context":{"clientName":"WEB"},"params":"Cg0KC2RRdzR3OVdnWGNRIAA=="}',
      })
    );
    fake.emit("Network.responseReceived", responseReceived("r1", 200));
    const n = await recorder.flush();
    expect(n).toBe(1);
    const tail = journal.tail(10);
    expect(tail).toHaveLength(1);
    const e = tail[0] as CaptureEntry;
    expect(e.endpoint).toBe("like/like");
    expect(e.kind).toBe("like");
    expect(e.target).toEqual(TARGET);
    expect(e.method).toBe("POST");
    expect(e.status).toBe(200);
    expect(e.postData).toContain('"params":"Cg0KC2RRdzR3OVdnWGNRIAA=="');
    expect(e.truncated).toBe(false);
    expect(e.ts).toBe("2026-10-21T00:00:00Z");
  });

  test("read noise is never captured (next/player/watch/plain browse)", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", "https://www.youtube.com/youtubei/v1/next", { postData: "{}" }));
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r2", "https://www.youtube.com/youtubei/v1/player", { postData: "{}" }));
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r3", "https://www.youtube.com/youtubei/v1/browse", { postData: "{}" }));
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r4", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r5", "https://www.youtube.com/youtubei/v1/guide", { postData: "{}" }));
    expect(await recorder.flush()).toBe(0);
    expect(journal.tail(10)).toHaveLength(0);
  });

  test("a GET on an action endpoint is not captured (POST-only law)", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL, { method: "GET" }));
    expect(await recorder.flush()).toBe(0);
    expect(journal.tail(10)).toHaveLength(0);
  });

  test("the action families are all kept (like/subscription/notification/comment/feedback/edit_playlist/history/live_chat)", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    const urls = [
      "https://www.youtube.com/youtubei/v1/like/dislike",
      "https://www.youtube.com/youtubei/v1/subscription/subscribe",
      "https://www.youtube.com/youtubei/v1/notification/get_notification_menu",
      "https://www.youtube.com/youtubei/v1/comment/perform_comment_action",
      "https://www.youtube.com/youtubei/v1/feedback",
      "https://www.youtube.com/youtubei/v1/browse/edit_playlist",
      "https://www.youtube.com/youtubei/v1/history/delete_watch_history",
      "https://www.youtube.com/youtubei/v1/live_chat/send_message",
    ];
    urls.forEach((u, i) => fake.emit("Network.requestWillBeSent", requestWillBeSent(`r${i}`, u, { postData: "{}" })));
    expect(await recorder.flush()).toBe(urls.length);
    expect(journal.tail(50).map((e) => e.endpoint)).toEqual(urls.map((u) => u.replace("https://www.youtube.com/youtubei/v1/", "")));
  });

  test("missing postData is fetched via Network.getRequestPostData", async () => {
    const { recorder, journal, fake } = await newRecorder({
      "Network.getRequestPostData": { postData: '{"params":"AA=="}' },
    });
    await recorder.start();
    const evt = requestWillBeSent("r1", LIKE_URL);
    delete (evt.request as { postData?: string }).postData;
    fake.emit("Network.requestWillBeSent", evt);
    expect(await recorder.flush()).toBe(1);
    expect(journal.tail(1)[0].postData).toBe('{"params":"AA=="}');
    expect(fake.sends.find((s) => s.method === "Network.getRequestPostData")?.params).toEqual({ requestId: "r1" });
  });

  test("a getRequestPostData failure keeps postData null (the honest shape)", async () => {
    const { recorder, journal, fake } = await newRecorder({
      "Network.getRequestPostData": new Error("No resource with given identifier found"),
    });
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL));
    expect(await recorder.flush()).toBe(1);
    const e = journal.tail(1)[0];
    expect(e.postData).toBeNull();
    expect(e.truncated).toBe(false);
  });

  test("a requestId is deduped (redirect re-send: first wins)", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL, { postData: '{"a":1}' }));
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", "https://www.youtube.com/youtubei/v1/like/like?redirected", { postData: '{"a":2}' }));
    expect(await recorder.flush()).toBe(1);
    expect(journal.tail(1)[0].postData).toBe('{"a":1}');
  });

  test("oversized postData is truncated and flagged", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL, { postData: "x".repeat(MAX_POST_DATA + 100) }));
    expect(await recorder.flush()).toBe(1);
    const e = journal.tail(1)[0];
    expect(e.postData).toHaveLength(MAX_POST_DATA);
    expect(e.truncated).toBe(true);
  });

  test("loadingFailed leaves status null (not observed — honest)", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.requestWillBeSent", requestWillBeSent("r1", LIKE_URL, { postData: "{}" }));
    fake.emit("Network.loadingFailed", { requestId: "r1", errorText: "net::ERR_ABORTED" });
    expect(await recorder.flush()).toBe(1);
    expect(journal.tail(1)[0].status).toBeNull();
  });

  test("a response for an unknown requestId is ignored", async () => {
    const { recorder, journal, fake } = await newRecorder();
    await recorder.start();
    fake.emit("Network.responseReceived", responseReceived("unknown", 200));
    expect(await recorder.flush()).toBe(0);
    expect(journal.tail(10)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// the REAL CdpConnection event dispatch (patched WebSocket — the class's
// own message listener handles events and RPCs on one channel)
// ---------------------------------------------------------------------------

class FakeWebSocket {
  static last: FakeWebSocket;
  listeners = new Map<string, Set<(ev: { data?: string }) => void>>();
  sent: string[] = [];
  constructor(_url: string) {
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, fn: (ev: { data?: string }) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    if (type === "open") fn({}); // resolve connect() immediately
  }
  send(data: string) {
    this.sent.push(data);
  }
  message(data: string) {
    this.listeners.get("message")?.forEach((fn) => fn({ data }));
  }
  close() {
    this.listeners.get("close")?.forEach((fn) => fn({}));
  }
}

describe("CdpConnection — event dispatch (the real message listener)", () => {
  const OriginalWebSocket = globalThis.WebSocket;

  test("events (no id) dispatch to on() subscribers; RPCs (with id) still resolve", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const conn = await CdpConnection.connect("ws://fake");
      const seen: unknown[] = [];
      const off = conn.on("Network.requestWillBeSent", (p) => seen.push(p));
      FakeWebSocket.last.message(
        JSON.stringify({ method: "Network.requestWillBeSent", params: { requestId: "r1" } })
      );
      expect(seen).toEqual([{ requestId: "r1" }]);
      // an RPC interleaves cleanly with the event stream
      const rpc = conn.send("Runtime.evaluate", { expression: "1" });
      const id = JSON.parse(FakeWebSocket.last.sent.at(-1)!).id;
      FakeWebSocket.last.message(JSON.stringify({ id, result: { result: { value: 2 } } }));
      expect(await rpc).toEqual({ result: { value: 2 } });
      off();
      FakeWebSocket.last.message(
        JSON.stringify({ method: "Network.requestWillBeSent", params: { requestId: "r2" } })
      );
      expect(seen).toEqual([{ requestId: "r1" }]); // unsubscribed
    } finally {
      globalThis.WebSocket = OriginalWebSocket;
    }
  });

  test("a throwing handler never breaks the channel: siblings still receive, RPCs still resolve", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const conn = await CdpConnection.connect("ws://fake");
      const seen: unknown[] = [];
      conn.on("Network.requestWillBeSent", () => {
        throw new Error("listener defect");
      });
      conn.on("Network.requestWillBeSent", (p) => seen.push(p));
      FakeWebSocket.last.message(
        JSON.stringify({ method: "Network.requestWillBeSent", params: { requestId: "r1" } })
      );
      expect(seen).toEqual([{ requestId: "r1" }]); // the sibling ran despite the throw
      const rpc = conn.send("Runtime.evaluate", { expression: "1" });
      const id = JSON.parse(FakeWebSocket.last.sent.at(-1)!).id;
      FakeWebSocket.last.message(JSON.stringify({ id, result: {} }));
      await rpc; // the channel is intact
    } finally {
      globalThis.WebSocket = OriginalWebSocket;
    }
  });

  test("close() clears subscriptions (post-close events dispatch nowhere)", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    try {
      const conn = await CdpConnection.connect("ws://fake");
      const seen: unknown[] = [];
      conn.on("Network.responseReceived", (p) => seen.push(p));
      conn.close();
      FakeWebSocket.last.message(JSON.stringify({ method: "Network.responseReceived", params: {} }));
      expect(seen).toEqual([]);
    } finally {
      globalThis.WebSocket = OriginalWebSocket;
    }
  });
});
