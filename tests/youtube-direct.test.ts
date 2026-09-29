/**
 * WFX2-A-W tests — the direct subscribe path (mocked fetch: NO network).
 * Asserts the VERIFIED wire format (verification log §16/§17):
 * classic `Authorization: SAPISIDHASH <time>_<sha1(time SAPISID origin)>`,
 * cookie auth, and the subscription/subscribe|unsubscribe body.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  parseCookies,
  sapisidhash,
  subscribeChannel,
  getSubscribedState,
  directAuthConfigured,
} from "@/lib/youtube-direct";

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

const COOKIES = "SAPISID=fake-sapisid-xyz; SID=sid-value; LOGIN_INFO=yes";

beforeEach(() => {
  process.env.YT_COOKIES = COOKIES;
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.YT_COOKIES;
});

describe("cookie parsing", () => {
  test("parseCookies splits on ; and =", () => {
    const map = parseCookies(COOKIES);
    expect(map["SAPISID"]).toBe("fake-sapisid-xyz");
    expect(map["SID"]).toBe("sid-value");
    expect(map["LOGIN_INFO"]).toBe("yes");
  });
  test("malformed parts are skipped", () => {
    const map = parseCookies("; junk;; =novalue; ok=1");
    expect(map["ok"]).toBe("1");
    expect(map[""]).toBeUndefined();
  });
  test("directAuthConfigured reflects SAPISID presence", () => {
    expect(directAuthConfigured()).toBe(true);
    process.env.YT_COOKIES = "SID=x";
    expect(directAuthConfigured()).toBe(false);
    delete process.env.YT_COOKIES;
    expect(directAuthConfigured()).toBe(false);
  });
});

describe("SAPISIDHASH header", () => {
  test("format: <unix-sec>_<40-char lowercase hex>", () => {
    const h = sapisidhash("sapisid-value", 1_760_000_000);
    expect(h).toMatch(/^1760000000_[0-9a-f]{40}$/);
  });
  test("value = sha1(time + ' ' + SAPISID + ' ' + 'https://www.youtube.com')", () => {
    const time = 1_760_000_123;
    const expected = createHash("sha1")
      .update(`${time} fake-sapisid-xyz https://www.youtube.com`, "utf8")
      .digest("hex");
    expect(sapisidhash("fake-sapisid-xyz", time)).toBe(`${time}_${expected}`);
  });
});

describe("subscribeChannel (direct, mocked fetch)", () => {
  test("subscribe: correct endpoint, auth header, cookies, body", async () => {
    const now = 1_760_000_456;
    const r = await subscribeChannel("UCuAXFkgsw1L7xaCfnd5JJOw", true, { now });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://www.youtube.com/youtubei/v1/subscription/subscribe?prettyPrint=false");
    const headers = init.headers as Record<string, string>;
    const expected = sapisidhash("fake-sapisid-xyz", Math.floor(now / 1000));
    expect(headers["Authorization"]).toBe(`SAPISIDHASH ${expected}`);
    expect(headers["Authorization"]).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
    expect(headers["Cookie"]).toBe(COOKIES);
    expect(headers["Origin"]).toBe("https://www.youtube.com");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(body.context.client.clientName).toBe("WEB");
    expect(typeof body.context.client.clientVersion).toBe("string");
  });

  test("unsubscribe hits subscription/unsubscribe", async () => {
    const r = await subscribeChannel("UCuAXFkgsw1L7xaCfnd5JJOw", false);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toContain("/youtubei/v1/subscription/unsubscribe");
  });

  test("missing cookies → honest not-configured failure (broker fallback trigger)", async () => {
    const r = await subscribeChannel("UC1", true, { cookies: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("direct-not-configured");
    expect(calls).toHaveLength(0);
  });

  test("non-2xx → ok:false with the status", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const r = await subscribeChannel("UC1", true);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe("getSubscribedState (SSR truth, mocked fetch)", () => {
  const page = (subscribed: boolean) =>
    `<html><script>var ytInitialData = {"metadata": {"subscribeButtonRenderer": {"subscribed": ${subscribed}}}};</script></html>`;

  test("true when subscribeButtonRenderer.subscribed is true", async () => {
    globalThis.fetch = (async () => new Response(page(true))) as unknown as typeof fetch;
    expect(await getSubscribedState("UC1")).toBe(true);
  });
  test("false when explicitly false", async () => {
    globalThis.fetch = (async () => new Response(page(false))) as unknown as typeof fetch;
    expect(await getSubscribedState("UC1")).toBe(false);
  });
  test("null when the marker is absent or the fetch fails", async () => {
    globalThis.fetch = (async () => new Response("<html>no data</html>")) as unknown as typeof fetch;
    expect(await getSubscribedState("UC1")).toBeNull();
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await getSubscribedState("UC1")).toBeNull();
  });
  test("no cookies → null (undeterminable)", async () => {
    expect(await getSubscribedState("UC1", { cookies: "" })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
