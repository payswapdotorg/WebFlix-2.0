/// <reference types="bun-types" />
/**
 * WFX2-A-B home + videos API — the swapped live routes exercised against
 * fixture bytes (tests/fixtures/yt/) via the setUpstream() seam. The seed
 * database no longer powers these routes; this file keeps its place in the
 * `test:boot` phase but needs no database.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { GET as getHome } from "@/app/api/home/route";
import { GET as listVideosRoute } from "@/app/api/videos/route";
import type { HomeFeedDTO, VideoPageDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

let recorded: { url: string; body: any }[] = [];

beforeEach(() => {
  clearCache();
  recorded = [];
  const search = load("search_lofi");
  const home = load("home_feed");
  setUpstream(async (url: string, init?: RequestInit) => {
    recorded.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/search")) return json(search);
    if (url.includes("/youtubei/v1/browse")) return json(home);
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  setUpstream(null);
});

describe("GET /api/home — shape (every rail present + typed, live mapping)", () => {
  test("responds 200 with every WebFlix rail in the payload", async () => {
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as HomeFeedDTO;

    expect(Array.isArray(feed.chips)).toBe(true);
    expect(feed.chips[0]).toBe("All");
    expect(feed.chips).toHaveLength(15);

    expect(feed.hero === null || typeof feed.hero.id === "string").toBe(true);
    expect(Array.isArray(feed.trending)).toBe(true);
    expect(Array.isArray(feed.continueWatching)).toBe(true);
    expect(Array.isArray(feed.shorts)).toBe(true);
    expect(Array.isArray(feed.recommended)).toBe(true);
    expect(feed.recommendedCursor === null || typeof feed.recommendedCursor === "string").toBe(true);
    expect(
      feed.becauseYouWatched === null ||
        (typeof feed.becauseYouWatched.label === "string" &&
          Array.isArray(feed.becauseYouWatched.videos))
    ).toBe(true);
  });

  test("the recorded unauthenticated feed (feedNudge) composes from real search — never empty", async () => {
    // YouTube's own logged-out response for FEwhat_to_watch is a nudge —
    // no shelves, no hero. WFX2-HR rung 3: with browse walled and no
    // last-good, the home composes from REAL search results instead of
    // serving empty rails (search is not walled).
    const feed = (await (await getHome(new Request("http://localhost/api/home"))).json()) as HomeFeedDTO;
    // the browse call actually went upstream with the right browseId FIRST (ladder order)
    const browse = recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse?.body.browseId).toBe("FEwhat_to_watch");
    expect(browse?.body.context.client.clientName).toBe("WEB");
    expect(browse?.body.context.client.clientVersion).toBe("2.20260925.08.00");
    // …then the compose fired and filled every rail from real search data
    expect(feed.source).toBe("search-compose");
    expect(feed.hero?.id).toBeTypeOf("string");
    expect(feed.recommended.length).toBeGreaterThan(0);
    expect(feed.shorts.length).toBeGreaterThan(0);
    expect(feed.becauseYouWatched?.videos.length).toBeGreaterThan(0);
    expect(feed.chips[0]).toBe("All");
    const composeQueries = recorded
      .filter((r) => r.url.includes("/youtubei/v1/search"))
      .map((r) => r.body.query);
    expect(composeQueries).toContain("most viewed youtube videos");
    expect(composeQueries).toContain("trending music");
    expect(composeQueries).toContain("popular gaming");
  });

  test("category mode is search-backed: recommended fills from real search results", async () => {
    const res = await getHome(new Request("http://localhost/api/home?category=Music"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as HomeFeedDTO;
    expect(feed.hero).toBeNull(); // chips swap to a flat grid (UI contract)
    expect(feed.recommended.length).toBeGreaterThan(0);
    for (const v of feed.recommended) {
      expect(typeof v.id).toBe("string");
      expect(typeof v.title).toBe("string");
      expect(v.thumbnailUrl).toMatch(/^https:\/\//);
      expect(v.videoUrl).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
      expect(typeof v.channel.name).toBe("string");
    }
    expect(feed.becauseYouWatched).toBeNull();
    const call = recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.query).toBe("Music");
  });

  test("video DTOs are typed and complete (search-backed cards)", async () => {
    const feed = (await (await getHome(new Request("http://localhost/api/home?category=Music"))).json()) as HomeFeedDTO;
    expect(feed.recommended.length).toBeGreaterThan(0);
    for (const v of feed.recommended) {
      expect(typeof v.id).toBe("string");
      expect(typeof v.title).toBe("string");
      expect(v.thumbnailUrl).toMatch(/^https:\/\//);
      expect(v.videoUrl).toMatch(/^https:\/\//);
      expect(v.durationSec === null || v.durationSec >= 0).toBe(true);
      expect(v.views).toBeGreaterThanOrEqual(0);
      expect(["public", "unlisted", "private"]).toContain(v.visibility);
      expect(typeof v.isShort).toBe("boolean");
      expect(typeof v.isLive).toBe("boolean");
      expect(v.createdAt === null || !Number.isNaN(Date.parse(v.createdAt))).toBe(true);
      expect(v.channel).toBeDefined();
      expect(typeof v.channel.handle).toBe("string");
      expect(typeof v.channel.name).toBe("string");
    }
  });
});

describe("GET /api/videos — continuation-token pagination (live)", () => {
  test("default page: browse walled → search-backed compose (never empty)", async () => {
    const res1 = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as VideoPageDTO;
    // the nudge browse maps to nothing — the compose fills the default feed
    expect(page1.videos.length).toBeGreaterThan(0);
    expect(page1.nextCursor).toBeNull(); // a composed page carries no browse continuation
    const browse = recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse?.body.browseId).toBe("FEwhat_to_watch");
    const search = recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(search?.body.query).toBeTypeOf("string");
  });

  test("category page: search-backed, cursor POSTs the continuation upstream", async () => {
    const res1 = await listVideosRoute(new Request("http://localhost/api/videos?category=Music"));
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as VideoPageDTO;
    expect(page1.videos.length).toBeGreaterThan(0);

    // the cursor is an opaque InnerTube continuation token passed straight through
    const res2 = await listVideosRoute(
      new Request(`http://localhost/api/videos?category=Music&cursor=tok-1`)
    );
    expect(res2.status).toBe(200);
    const call = recorded.find((r) => r.url.includes("/youtubei/v1/search") && r.body?.continuation);
    expect(call?.body.continuation).toBe("tok-1");
  });

  test("upstream failure → JSON error (no seed fallback, no crash)", async () => {
    setUpstream(async () => new Response("boom", { status: 503 }));
    const res = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});
