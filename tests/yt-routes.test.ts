/// <reference types="bun-types" />
/**
 * WFX2-A-B route tests — the live routes exercised against fixture bytes via
 * the test-only `setUpstream()` seam in src/lib/youtube/innertube.ts.
 * NEVER the network (lane law: tests run against tests/fixtures/yt only).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { decodeCursor } from "@/lib/youtube/cursors";

import { GET as searchRoute } from "@/app/api/search/route";
import { GET as suggestRoute } from "@/app/api/search/suggest/route";
import { GET as videosRoute } from "@/app/api/videos/route";
import { GET as videoRoute } from "@/app/api/videos/[id]/route";
import { GET as commentsRoute } from "@/app/api/videos/[id]/comments/route";
import { GET as repliesRoute } from "@/app/api/videos/[id]/comments/[commentId]/replies/route";
import { GET as relatedRoute } from "@/app/api/videos/[id]/related/route";
import { GET as watchRoute } from "@/app/api/watch/[id]/route";
import { GET as homeRoute } from "@/app/api/home/route";
import { GET as trendingRoute } from "@/app/api/trending/route";
import { GET as channelRoute } from "@/app/api/channel/[handle]/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/**
 * Fixture-backed upstream: routes requests to recorded fixture bytes and
 * records every request for param assertions.
 */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const search = load("search_lofi");
  const next = load("next_dQw4");
  const comments = load("comments_dQw4");
  const home = load("home_feed");
  const trending = load("ssr_trending");
  const channel = load("channel_rickastley");
  const autocompleteRaw = load("autocomplete_lofi").raw as string;

  const htmlFor = (data: unknown) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script></body></html>`;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    // InnerTube POST endpoints
    if (url.includes("/youtubei/v1/search")) return json(search);
    if (url.includes("/youtubei/v1/next")) {
      return json(body?.videoId ? next : comments);
    }
    if (url.includes("/youtubei/v1/browse")) {
      const browseId = body?.browseId ?? "";
      return json(browseId.startsWith("UC") ? channel : home);
    }
    // SSR pages
    if (url.includes("/feed/trending")) {
      return new Response(htmlFor(trending), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("youtube.com/@RickAstleyYT")) {
      return new Response(htmlFor(channel), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    // suggestqueries JSONP
    if (url.includes("suggestqueries")) {
      return new Response(autocompleteRaw, { status: 200, headers: { "Content-Type": "text/javascript" } });
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

// ---------------------------------------------------------------------------

describe("GET /api/search — live InnerTube search", () => {
  test("maps the real result set into SearchPageDTO", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.query).toBe("lofi");
    expect(data.videos.length).toBe(40);
    expect(data.videos[0].id).toBe("rFZHOHl-L8A");
    expect(data.videos[0].channel.name).toBe("Lofi Girl");
    expect(data.videos[0].isLive).toBe(true);
    expect(Array.isArray(data.channels)).toBe(true);
    // the upstream POST actually happened with the query
    const searchCalls = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/search"));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0].body.query).toBe("lofi");
    expect(searchCalls[0].body.context.client.clientName).toBe("WEB");
  });

  test("empty q → empty page, no upstream call", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q="));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos).toEqual([]);
    expect(upstream.recorded).toHaveLength(0);
  });

  test("filters reach the upstream as verified params (type=shorts)", async () => {
    await searchRoute(new Request("http://localhost/api/search?q=lofi&type=shorts"));
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("EgIQCQ==");
  });

  test("combined filters (sort=views + uploadDate=today + type=video)", async () => {
    await searchRoute(
      new Request("http://localhost/api/search?q=lofi&sort=views&uploadDate=today&type=video")
    );
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("CAMSBAgCEAE="); // sort=views + today + video (live-verified encoding)
  });
});

describe("GET /api/search/suggest — autocomplete", () => {
  test("JSONP body → clean array", async () => {
    const res = await suggestRoute(new Request("http://localhost/api/search/suggest?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.suggestions[0]).toBe("lofi hip hop");
    expect(data.suggestions.length).toBe(14);
  });

  test("empty q → no upstream call", async () => {
    const res = await suggestRoute(new Request("http://localhost/api/search/suggest?q="));
    const data = (await res.json()) as any;
    expect(data.suggestions).toEqual([]);
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/videos — continuation-cursor pagination", () => {
  test("default page: nudge browse → search-backed compose (never empty)", async () => {
    const res = await videosRoute(new Request("http://localhost/api/videos"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    // the nudge browse maps to nothing — the compose fills the default feed
    expect(page.videos.length).toBeGreaterThan(0);
    // WFX2-P6-IS: a composed page carries the rung-3 POOL cursor now (not a
    // browse continuation) — an opaque envelope resuming the merged pool
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor?.s).toBe("pool");
    expect(cursor?.s === "pool" ? cursor.o : 0).toBe(12); // resumes after the first window
    const browse = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse?.body.browseId).toBe("FEwhat_to_watch");
    const search = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(search?.body.query).toBeTypeOf("string"); // a real compose query went upstream
  });

  test("category pages are search-backed (type=video params)", async () => {
    const res = await videosRoute(new Request("http://localhost/api/videos?category=Music"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.videos.length).toBeGreaterThan(0);
    expect(page.videos.every((v: any) => !v.isShort || v.isShort)).toBe(true);
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.query).toBe("Music");
    expect(call?.body.params).toBe("EgIQAQ==");
  });

  test("cursor pages POST the continuation token upstream", async () => {
    const res = await videosRoute(
      new Request("http://localhost/api/videos?cursor=abc123&category=Music")
    );
    expect(res.status).toBe(200);
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.continuation).toBe("abc123");
  });
});

describe("GET /api/home — shelves → rails", () => {
  test("nudge browse + live search → the composed home (never empty, honest source)", async () => {
    const res = await homeRoute(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.chips[0]).toBe("All");
    expect(feed.chips).toHaveLength(15);
    expect(feed.source).toBe("search-compose"); // never claims browse when composed
    expect(feed.hero?.id).toBeTypeOf("string");
    expect(feed.trending).toEqual([]);
    expect(feed.continueWatching).toEqual([]); // no session → omitted gracefully
    expect(feed.becauseYouWatched?.videos.length).toBeGreaterThan(0);
    expect(feed.shorts.length).toBeGreaterThan(0);
    expect(feed.recommended.length).toBeGreaterThan(0);
    // WFX2-P6-IS: the composed feed hands the grid the rung-3 pool cursor —
    // the scroll resumes right after the prefix the feed itself showed
    const cursor = decodeCursor(feed.recommendedCursor);
    expect(cursor?.s).toBe("pool");
    expect(cursor?.s === "pool" ? cursor.o : 0).toBeGreaterThan(0);
    expect(cursor?.s === "pool" ? cursor.o : 0).toBeLessThanOrEqual(feed.recommended.length + 1 + 25);
  });

  test("category mode is search-backed with a continuation cursor", async () => {
    const res = await homeRoute(new Request("http://localhost/api/home?category=Gaming"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.hero).toBeNull();
    expect(feed.recommended.length).toBeGreaterThan(0);
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.query).toBe("Gaming");
  });
});

describe("GET /api/trending — SSR parse", () => {
  test("ytInitialData → rail of real videos", async () => {
    const res = await trendingRoute(new Request("http://localhost/api/trending"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // WFX2-B-W: the trending category set is the real youtube.com one —
    // the default chip is "Now" (was the WebFlix-local "All" pre-B-W)
    expect(data.category).toBe("Now");
    expect(data.source).toBe("trending");
    expect(data.videos.length).toBeGreaterThan(0);
    const mj = data.videos.find((v: any) => v.id === "h_D3VFfhvs4");
    expect(mj).toBeDefined();
    expect(mj.title).toBe("Michael Jackson - Smooth Criminal (Official Video)");
    expect(mj.durationSec).toBe(566);
    expect(mj.views).toBe(1_300_000_000);
    // the SSR fetch hit /feed/trending with browser headers
    const ssrCall = upstream.recorded.find((r) => r.url.includes("/feed/trending"));
    expect(ssrCall).toBeDefined();
  });

  test("category pages hit the real semantic URL", async () => {
    await trendingRoute(new Request("http://localhost/api/trending?category=Music"));
    const ssrCall = upstream.recorded.find((r) => r.url.includes("/feed/trending/music"));
    expect(ssrCall).toBeDefined();
  });
});

describe("GET /api/channel/[handle] — resolve + browse", () => {
  test("@handle → SSR resolve → browse → header + videos + shorts", async () => {
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      { params: Promise.resolve({ handle: "@RickAstleyYT" }) } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(page.channel.handle).toBe("@RickAstleyYT");
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.channel.subscriberCount).toBe(4_550_000);
    expect(page.channel.subscriberCountText).toBe("4.55M subscribers");
    expect(page.channel.bannerUrl).toMatch(/^https:\/\//);
    expect(page.channel.avatarUrl).toMatch(/^https:\/\//);
    expect(page.channel.isSubscribed).toBe(false); // public mode
    expect(page.videos.length).toBe(59); // 79 cards minus the 20 shorts
    expect(page.shorts.length).toBe(12); // capped shelf
    // SSR page fetched, then browse by the resolved UC id
    const ssrCall = upstream.recorded.find((r) => r.url.includes("/@RickAstleyYT"));
    expect(ssrCall).toBeDefined();
    const browseCalls = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browseCalls.length).toBeGreaterThanOrEqual(2); // home tab + videos tab
    expect(browseCalls.every((c) => c.body.browseId === "UCuAXFkgsw1L7xaCfnd5JJOw")).toBe(true);
  });

  test("UC… handle browses directly", async () => {
    const res = await channelRoute(
      new Request("http://localhost/api/channel/UCuAXFkgsw1L7xaCfnd5JJOw"),
      { params: Promise.resolve({ handle: "UCuAXFkgsw1L7xaCfnd5JJOw" }) } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel.name).toBe("Rick Astley");
    expect(upstream.recorded.some((r) => r.url.includes("/@RickAstleyYT"))).toBe(false);
  });
});

describe("GET /api/videos/[id] — next()-backed watch payload", () => {
  test("full metadata: title, exact views + likes, channel, description", async () => {
    const res = await videoRoute(new Request("http://localhost/api/videos/dQw4w9WgXcQ"), {
      params: Promise.resolve({ id: "dQw4w9WgXcQ" }),
    } as any);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as any;
    expect(detail.video.title).toContain("Never Gonna Give You Up");
    expect(detail.video.views).toBe(1_821_187_782);
    expect(detail.video.likes).toBe(19_427_647);
    expect(detail.video.channel.name).toBe("Rick Astley");
    expect(detail.video.channel.subscriberCount).toBe(4_550_000);
    expect(detail.video.description.length).toBeGreaterThan(1000);
    expect(detail.state.subscribed).toBe(false);
    // the next endpoint was used — never player
    const nextCall = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/next"));
    expect(nextCall?.body.videoId).toBe("dQw4w9WgXcQ");
    expect(upstream.recorded.some((r) => r.url.includes("/youtubei/v1/player"))).toBe(false);
  });
});

describe("GET /api/videos/[id]/comments — continuation walking", () => {
  test("first page: 20 comments, pinned first, honest total", async () => {
    const res = await commentsRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/comments"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.items.length).toBe(20);
    expect(page.total).toBe(2_457_856);
    expect(page.items[0].pinned).toBe(true);
    expect(page.items[0].body).toBe("can confirm: he never gave us up");
    expect(page.items[0].likes).toBe(321_000);
    expect(page.items[0].replyCount).toBe(963);
    expect(typeof page.items[0].repliesToken).toBe("string");
    expect(typeof page.nextCursor).toBe("string");
  });

  test("sort=new switches to the Newest continuation token", async () => {
    const res = await commentsRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/comments?sort=new"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) } as any
    );
    expect(res.status).toBe(200);
    // continuation POSTs: the Top token (via the sort-menu probe), then the
    // Newest token, plus the 3 inline-reply threads — Top ≠ Newest
    const continuations = upstream.recorded
      .filter((r) => r.url.includes("/youtubei/v1/next") && r.body?.continuation)
      .map((r) => r.body.continuation as string);
    expect(continuations.length).toBe(5);
    expect(new Set(continuations).size).toBe(5); // all distinct (top, newest, 3 reply threads)
  });

  test("reply threads: parentId serves the nested continuation", async () => {
    const res = await commentsRoute(
      new NextRequest(
        "http://localhost/api/videos/dQw4w9WgXcQ/comments?parentId=Ugzge340dBgB75hWBm54AaABAg"
      ),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(Array.isArray(page.items)).toBe(true);
  });
});

describe("GET /api/videos/[id]/comments/[commentId]/replies", () => {
  test("resolves the thread's replies token and pages through it", async () => {
    const res = await repliesRoute(
      new NextRequest(
        "http://localhost/api/videos/dQw4w9WgXcQ/comments/Ugzge340dBgB75hWBm54AaABAg/replies"
      ),
      {
        params: Promise.resolve({ id: "dQw4w9WgXcQ", commentId: "Ugzge340dBgB75hWBm54AaABAg" }),
      } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.items.length).toBe(20);
    expect(
      page.items.every((c: any) => c.parentId === "Ugzge340dBgB75hWBm54AaABAg")
    ).toBe(true);
    // the last next-POST carried the thread's replies token
    const continuations = upstream.recorded
      .filter((r) => r.url.includes("/youtubei/v1/next") && r.body?.continuation)
      .map((r) => r.body.continuation as string);
    expect(continuations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/videos/[id]/related — secondaryResults rail", () => {
  test("lockup items with durations/views/ages + default limit", async () => {
    const res = await relatedRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/related"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) } as any
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.items.length).toBe(8);
    expect(page.items[0].id).toBe("eOb1Z1dcLOw");
    expect(page.items[0].durationSec).toBe(15746);
    expect(page.items[0].views).toBe(345_000);
    expect(page.items[0].channel.name).toBe("Pop Hits Central");
  });

  test("limit is honored (up to the rail page)", async () => {
    const res = await relatedRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/related?limit=20"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) } as any
    );
    const page = (await res.json()) as any;
    expect(page.items.length).toBe(20);
  });
});

describe("GET /api/watch/[id] — aggregate bootstrap", () => {
  test("metadata + first comments page + related in one payload", async () => {
    const res = await watchRoute(new Request("http://localhost/api/watch/dQw4w9WgXcQ"), {
      params: Promise.resolve({ id: "dQw4w9WgXcQ" }),
    } as any);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.video.title).toContain("Never Gonna Give You Up");
    expect(data.video.views).toBe(1_821_187_782);
    expect(data.related.length).toBe(12);
    expect(data.related[0].id).toBe("eOb1Z1dcLOw");
    expect(data.comments.length).toBe(20);
    expect(data.comments[0].pinned).toBe(true);
    expect(data.isSubscribed).toBe(false);
    expect(data.isOwner).toBe(false);
  });
});
