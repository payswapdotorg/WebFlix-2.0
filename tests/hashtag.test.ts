/// <reference types="bun-types" />
/**
 * REA-1 G17 — the hashtag browse (FEhashtag): the params protobuf (byte-
 * verified against youtube.com's own links), the pure mapper against the
 * REAL captured browse pages, and the /api/hashtag/[tag] route contracts —
 * all through the fixture upstream. Fixtures-only, no live calls.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";

import { buildHashtagParams, getHashtagPage, mapHashtagPage } from "@/lib/youtube/hashtags";
import { GET as hashtagRoute } from "@/app/api/hashtag/[tag]/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const firstPage = load("hashtag_browse_lofi");
const secondPage = load("hashtag_browse_lofi_page2");

describe("buildHashtagParams — youtube.com's measured FEhashtag protobuf", () => {
  // the four REAL params measured off youtube.com's own watch-page hashtag
  // links (2026-10-17) — the byte-exactness law:
  test("byte-exact against youtube.com's own link params", () => {
    expect(buildHashtagParams("lofi")).toBe("6gUICgRsb2ZpGAE=");
    expect(buildHashtagParams("lofimusic")).toBe("6gUNCglsb2ZpbXVzaWMYAQ==");
    expect(buildHashtagParams("lofihiphop")).toBe("6gUOCgpsb2ZpaGlwaG9wGAE=");
    expect(buildHashtagParams("chill")).toBe("6gUJCgVjaGlsbBgB");
  });

  test("unicode tags encode their utf8 bytes faithfully", () => {
    const params = buildHashtagParams("腦動力LevelUp");
    expect(params).not.toBe("");
    // field 1 of the wrapped message IS the raw utf8 tag bytes
    const buf = Buffer.from(params, "base64");
    const inner = buf.subarray(3); // ea 05 <len> then the inner message
    const tagLen = inner[1]!;
    expect(inner.subarray(2, 2 + tagLen).toString("utf8")).toBe("腦動力LevelUp");
    expect(inner[inner.length - 2]).toBe(0x18); // the trailing field 3 varint
    expect(inner[inner.length - 1]).toBe(0x01);
  });

  test("empty and oversized tags refuse honestly (empty params)", () => {
    expect(buildHashtagParams("")).toBe("");
    expect(buildHashtagParams("x".repeat(101))).toBe("");
  });
});

describe("mapHashtagPage — the real captured #lofi browse", () => {
  test("the header: '#lofi' + youtube.com's own meta line", () => {
    const dto = mapHashtagPage("lofi", firstPage);
    expect(dto.title).toBe("#lofi");
    expect(dto.metaText).toBe("7M videos • 1.4M channels");
    expect(dto.tag).toBe("lofi");
  });

  test("the grid: real videoRenderer items with real fields", () => {
    const dto = mapHashtagPage("lofi", firstPage);
    expect(dto.videos.length).toBeGreaterThanOrEqual(30);
    expect(dto.videos[0]!.id).toBe("sF80I-TQiW0");
    expect(dto.videos[0]!.title).toContain("90's Chill Lofi");
    expect(dto.videos[0]!.channel?.name).toBeTruthy();
  });

  test("the continuation token rides the response (the infinite scroll chain)", () => {
    const dto = mapHashtagPage("lofi", firstPage);
    expect(typeof dto.nextCursor).toBe("string");
    expect(dto.nextCursor!.length).toBeGreaterThan(20);
    // the token decodes to the FEhashtag browse family (measured)
    const buf = Buffer.from(dto.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(buf.toString("latin1")).toContain("FEhashtag");
  });

  test("the continuation page (the real capture): more videos + the next token", () => {
    const dto = mapHashtagPage("lofi", secondPage);
    expect(dto.videos.length).toBeGreaterThanOrEqual(30);
    expect(dto.nextCursor).toBeTruthy();
    // the continuation's videos differ from the first page's
    const first = mapHashtagPage("lofi", firstPage);
    expect(dto.videos[0]!.id).not.toBe(first.videos[0]!.id);
  });

  test("a response with no header degrades to the '#tag' title (never fabricated meta)", () => {
    const dto = mapHashtagPage("anything", { responseContext: {} });
    expect(dto.title).toBe("#anything");
    expect(dto.metaText).toBeNull();
    expect(dto.videos).toEqual([]);
    expect(dto.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the read + the route (fixture upstream)
// ---------------------------------------------------------------------------

interface Recorded {
  method: string;
  url: string;
  body: any;
}

function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/browse")) {
      if (body?.continuation) return json(secondPage);
      if (body?.browseId === "FEhashtag" && body?.params === buildHashtagParams("lofi")) {
        return json(firstPage);
      }
      return json({ responseContext: {} });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded };
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
  setUpstream(upstream.impl);
});

afterEach(() => {
  setUpstream(null);
});

describe("getHashtagPage — the read seam", () => {
  test("the browse request is EXACTLY youtube.com's own hashtag link endpoint (measured)", async () => {
    await getHashtagPage("lofi");
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(call).toBeDefined();
    expect(call!.body.browseId).toBe("FEhashtag");
    expect(call!.body.params).toBe("6gUICgRsb2ZpGAE="); // byte-exact (measured)
  });

  test("the continuation POSTs the token back (the infinite scroll chain)", async () => {
    const first = await getHashtagPage("lofi");
    const token = first.nextCursor!;
    const second = await getHashtagPage("lofi", token);
    const calls = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(calls[1]!.body.continuation).toBe(token);
    expect(second.videos.length).toBeGreaterThanOrEqual(30);
  });

  test("an oversized tag refuses honestly (never a bogus browse)", async () => {
    let refused = false;
    try {
      await getHashtagPage("x".repeat(101));
    } catch (err) {
      refused = err instanceof Error && err.message === "Invalid hashtag";
    }
    expect(refused).toBe(true);
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/hashtag/[tag] — the route contracts", () => {
  const get = (path: string) => hashtagRoute(new Request(`http://localhost${path}`), {
    params: Promise.resolve({ tag: path.split("/").pop()!.split("?")[0] }),
  } as Parameters<typeof hashtagRoute>[1]);

  test("serves the real #lofi page", async () => {
    const res = await get("/api/hashtag/lofi");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.title).toBe("#lofi");
    expect(data.metaText).toBe("7M videos • 1.4M channels");
    expect(data.videos.length).toBeGreaterThanOrEqual(30);
  });

  test("the cursor pages the chain", async () => {
    const first = (await (await get("/api/hashtag/lofi")).json()) as any;
    const res = await get(`/api/hashtag/lofi?cursor=${encodeURIComponent(first.nextCursor)}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.length).toBeGreaterThanOrEqual(30);
    expect(data.videos[0].id).not.toBe(first.videos[0].id);
  });

  test("a garbage cursor answers the honest 400", async () => {
    const res = await get("/api/hashtag/lofi?cursor=%21%21short");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("Invalid hashtag cursor");
  });

  test("an unknown/empty tag answers the honest 404", async () => {
    expect((await get("/api/hashtag/")).status).toBe(404);
    const res = await get("/api/hashtag/%23lofi"); // the # form refuses (# rides display, not ids)
    expect(res.status).toBe(404);
  });

  test("an upstream failure answers the honest 502 (never a fabricated grid)", async () => {
    setUpstream(async () => {
      throw new Error("upstream down");
    });
    const res = await get("/api/hashtag/lofi");
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toBe("Failed to load hashtag videos");
  });
});
