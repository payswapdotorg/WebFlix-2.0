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
  buildLikeParams,
  rateVideo,
  editPlaylistMembership,
  playlistContains,
  PLAYLIST_CONTAINS_PAGE_BUDGET,
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

// ---------------------------------------------------------------------------
// P33-DIRECT-ACTIONS — the direct everyday-action family (the captured wire)
// ---------------------------------------------------------------------------

describe("P33 buildLikeParams (the captured templates, byte-exact)", () => {
  test("like params: the captured dQw4 template round-trips with a refreshed timestamp", () => {
    const fixedNow = 1_761_000_000_000; // ms
    const p = buildLikeParams("dQw4w9WgXcQ", false, fixedNow)!;
    // base64 with URL-encoded padding — the exact wire form youtube.com sends
    expect(p).toMatch(/^[A-Za-z0-9+/]+%3D%3D$/);
    const buf = Buffer.from(p.replace(/%3D/g, "="), "base64");
    // the videoId at byte offset 4 (0a 0b <id>)
    expect(buf.subarray(4, 15).toString("latin1")).toBe("dQw4w9WgXcQ");
    // the like marker `20 00` (field 2 varint 0) — like, not remove
    expect(buf[15]).toBe(0x20);
    expect(buf[16]).toBe(0x00);
    // the timestamp varint slot (bytes 20-24) refreshed to the fixed clock
    const ts = Math.floor(fixedNow / 1000);
    const decoded =
      (buf[20] & 0x7f) | ((buf[21] & 0x7f) << 7) | ((buf[22] & 0x7f) << 14) |
      ((buf[23] & 0x7f) << 21) | (buf[24] << 28);
    expect(decoded).toBe(ts);
  });

  test("remove params: the remove marker `18 00` (field 3 varint 0) + the `2a` second field", () => {
    const p = buildLikeParams("dQw4w9WgXcQ", true, 1_761_000_000_000)!;
    const buf = Buffer.from(p.replace(/%3D/g, "="), "base64");
    expect(buf.subarray(4, 15).toString("latin1")).toBe("dQw4w9WgXcQ");
    expect(buf[15]).toBe(0x18); // the remove marker, not the like marker
    expect(buf[16]).toBe(0x00);
    expect(buf[17]).toBe(0x2a); // field 5 (the ts/hash submessage)
  });

  test("a different 11-char videoId swaps into the template; a non-11-char id answers null (never a guess)", () => {
    const p = buildLikeParams("abcdefghijk", false, 1_761_000_000_000)!;
    const buf = Buffer.from(p.replace(/%3D/g, "="), "base64");
    expect(buf.subarray(4, 15).toString("latin1")).toBe("abcdefghijk");
    expect(buildLikeParams("short", false)).toBeNull();
    expect(buildLikeParams("an-id-that-is-too-long", false)).toBeNull();
  });
});

describe("P33 rateVideo (direct, mocked fetch)", () => {
  test("like: like/like endpoint, SAPISIDHASH + Cookie headers, the templated params in the body", async () => {
    const fixedNow = 1_761_000_000_000;
    const r = await rateVideo("dQw4w9WgXcQ", "like", { now: fixedNow });
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
    const { url, init } = calls[0];
    expect(String(url)).toBe("https://www.youtube.com/youtubei/v1/like/like?prettyPrint=false");
    const headers = init.headers as Record<string, string>;
    const ts = Math.floor(fixedNow / 1000);
    expect(headers.Authorization).toBe(`SAPISIDHASH ${sapisidhash("fake-sapisid-xyz", ts)}`);
    expect(headers.Cookie).toBe(COOKIES);
    expect(headers.Origin).toBe("https://www.youtube.com");
    const body = JSON.parse(String(init.body));
    expect(body.params).toBe(buildLikeParams("dQw4w9WgXcQ", false, fixedNow));
    expect(body.context.client.clientName).toBe("WEB");
  });

  test("none: like/removelike endpoint with the remove params", async () => {
    const r = await rateVideo("dQw4w9WgXcQ", "none", { now: 1_761_000_000_000 });
    expect(r.ok).toBe(true);
    expect(String(calls[0].url)).toContain("/youtubei/v1/like/removelike?");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.params).toBe(buildLikeParams("dQw4w9WgXcQ", true, 1_761_000_000_000));
  });

  test("missing cookies → honest not-configured failure (the broker fallback trigger)", async () => {
    const r = await rateVideo("dQw4w9WgXcQ", "like", { cookies: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("direct-not-configured");
    expect(calls).toHaveLength(0);
  });

  test("non-11-char videoId → honest unavailable failure, never a guessed template", async () => {
    const r = await rateVideo("short", "like");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("direct-like-unavailable");
    expect(calls).toHaveLength(0);
  });

  test("non-2xx → ok:false with the status (the caller's fallback signal)", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const r = await rateVideo("dQw4w9WgXcQ", "like");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe("P33 editPlaylistMembership (direct, mocked fetch)", () => {
  test("add: browse/edit_playlist with ACTION_ADD_VIDEO + addedVideoId + videoId (the broker's verified wire)", async () => {
    const r = await editPlaylistMembership("WL", "dQw4w9WgXcQ", true, { now: 1_761_000_000_000 });
    expect(r.ok).toBe(true);
    expect(String(calls[0].url)).toBe(
      "https://www.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false"
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^SAPISIDHASH /);
    expect(headers.Cookie).toBe(COOKIES);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.playlistId).toBe("WL");
    expect(body.actions).toEqual([
      { action: "ACTION_ADD_VIDEO", addedVideoId: "dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ" },
    ]);
  });

  test("remove: ACTION_REMOVE_VIDEO + removedVideoId + videoId", async () => {
    const r = await editPlaylistMembership("PLtest123", "abcdefghijk", false);
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.playlistId).toBe("PLtest123");
    expect(body.actions).toEqual([
      { action: "ACTION_REMOVE_VIDEO", removedVideoId: "abcdefghijk", videoId: "abcdefghijk" },
    ]);
  });

  test("missing cookies → honest not-configured failure (the broker fallback trigger)", async () => {
    const r = await editPlaylistMembership("WL", "dQw4w9WgXcQ", true, { cookies: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("direct-not-configured");
    expect(calls).toHaveLength(0);
  });

  test("non-2xx → ok:false with the status", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    const r = await editPlaylistMembership("WL", "dQw4w9WgXcQ", true);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
});

describe("P33 playlistContains (the fresh membership read)", () => {
  test("no cookies → null (undeterminable, no read)", async () => {
    expect(await playlistContains("WL", "dQw4w9WgXcQ", { cookies: "" })).toBeNull();
  });

  test("first page contains the video → true", async () => {
    const r = await playlistContains("WL", "v1", {
      cookies: COOKIES,
      readPage: async () => ({ videos: [{ id: "v1" }], nextCursor: null }),
    });
    expect(r).toBe(true);
  });

  test("first page misses, no cursor → false", async () => {
    const r = await playlistContains("WL", "v2", {
      cookies: COOKIES,
      readPage: async () => ({ videos: [{ id: "v1" }], nextCursor: null }),
    });
    expect(r).toBe(false);
  });

  test("the membership rides a continuation page (page 2 answers)", async () => {
    let read = 0;
    const r = await playlistContains("WL", "v2", {
      cookies: COOKIES,
      readPage: async (cursor) => {
        read += 1;
        return read === 1
          ? { videos: [{ id: "v1" }], nextCursor: "page2" }
          : { videos: [{ id: cursor === "page2" ? "v2" : "x" }], nextCursor: null };
      },
    });
    expect(r).toBe(true);
    expect(read).toBe(2);
  });

  test("deeper than the page budget → honestly null (never a guess)", async () => {
    let read = 0;
    const r = await playlistContains("WL", "v99", {
      cookies: COOKIES,
      readPage: async () => {
        read += 1;
        return { videos: [{ id: "other" }], nextCursor: `page${read}` };
      },
    });
    expect(r).toBeNull();
    expect(read).toBe(PLAYLIST_CONTAINS_PAGE_BUDGET);
  });

  test("a read failure → honestly null", async () => {
    const r = await playlistContains("WL", "v1", {
      cookies: COOKIES,
      readPage: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(r).toBeNull();
  });
});
