/**
 * WFX2-A-W tests — the app-side broker client contract (mocked global
 * fetch; NO network, NO live CDP): success mapping, timeout, unreachable,
 * 401/400, 502 action-failure, and the unconfigured-env fail path.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BROKER_OFFLINE_MESSAGE,
  BrokerError,
  brokerAction,
  brokerConfigured,
  brokerUrl,
  brokerTimeoutMs,
} from "@/lib/broker";

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  process.env.BROKER_URL = "http://127.0.0.1:3055";
  process.env.BROKER_SECRET = "s3cret";
  delete process.env.BROKER_TIMEOUT_MS;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.BROKER_URL;
  delete process.env.BROKER_SECRET;
  delete process.env.BROKER_TIMEOUT_MS;
});

function mockFetch(handler: () => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler();
  }) as unknown as typeof fetch;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("env configuration", () => {
  test("brokerUrl strips trailing slashes", () => {
    process.env.BROKER_URL = "http://127.0.0.1:3055///";
    expect(brokerUrl()).toBe("http://127.0.0.1:3055");
  });
  test("brokerConfigured is false without url or secret", () => {
    process.env.BROKER_URL = "";
    expect(brokerConfigured()).toBe(false);
    process.env.BROKER_URL = "http://x";
    process.env.BROKER_SECRET = "";
    expect(brokerConfigured()).toBe(false);
  });
  test("brokerTimeoutMs defaults to 15s, honors the env override", () => {
    expect(brokerTimeoutMs()).toBe(15000);
    process.env.BROKER_TIMEOUT_MS = "30000";
    expect(brokerTimeoutMs()).toBe(30000);
    process.env.BROKER_TIMEOUT_MS = "not-a-number";
    expect(brokerTimeoutMs()).toBe(15000);
  });
});

describe("brokerAction contract (mocked fetch)", () => {
  test("success: POSTs {kind,target,payload} with the secret header and maps ok", async () => {
    mockFetch(() => jsonResponse(200, { ok: true, verified: true, path: "ui" }));
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" }, { mode: "set" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:3055/broker/action");
    expect((calls[0].init.headers as Record<string, string>)["x-broker-secret"]).toBe("s3cret");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.kind).toBe("like");
    expect(body.target).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(body.payload).toEqual({ mode: "set" });
    expect(r).not.toBeInstanceOf(BrokerError);
    expect((r as { ok: boolean; verified: boolean; path: string }).ok).toBe(true);
    expect((r as { verified: boolean }).verified).toBe(true);
    expect((r as { path: string }).path).toBe("ui");
  });

  test("broker 502 action-failure → typed error carrying the broker's message", async () => {
    mockFetch(() => jsonResponse(502, { ok: false, error: "click-did-not-flip", dom: { was: {} } }));
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" });
    expect(r).toBeInstanceOf(BrokerError);
    const err = r as BrokerError;
    expect(err.kind).toBe("action-failed");
    expect(err.message).toBe("click-did-not-flip");
    expect(err.status).toBe(502);
  });

  test("network unreachable → offline error with the honest message", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const r = await brokerAction("subscribe", { channelId: "UC123" });
    expect(r).toBeInstanceOf(BrokerError);
    expect((r as BrokerError).kind).toBe("offline");
    expect((r as BrokerError).message).toBe(BROKER_OFFLINE_MESSAGE);
  });

  test("timeout (AbortError) → offline error with the honest message", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" });
    expect((r as BrokerError).kind).toBe("offline");
    expect((r as BrokerError).message).toBe(BROKER_OFFLINE_MESSAGE);
  });

  test("401 → unauthorized typed error", async () => {
    mockFetch(() => jsonResponse(401, { error: "unauthorized" }));
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" });
    expect((r as BrokerError).kind).toBe("unauthorized");
  });

  test("400 → bad-request typed error carrying the broker message", async () => {
    mockFetch(() => jsonResponse(400, { error: "unknown kind" }));
    const r = await brokerAction("explode" as never, {});
    expect((r as BrokerError).kind).toBe("bad-request");
    expect((r as BrokerError).message).toBe("unknown kind");
  });

  test("non-JSON error body still maps to a typed error", async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" });
    expect((r as BrokerError).kind).toBe("action-failed");
  });

  test("unconfigured env → offline without any fetch", async () => {
    process.env.BROKER_URL = "";
    const r = await brokerAction("like", { videoId: "dQw4w9WgXcQ" });
    expect((r as BrokerError).kind).toBe("offline");
    expect((r as BrokerError).message).toBe(BROKER_OFFLINE_MESSAGE);
  });
});
