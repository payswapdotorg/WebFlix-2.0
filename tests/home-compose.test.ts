/// <reference types="bun-types" />
/**
 * WFX2-HR — the default home's three-rung ladder, proven at the route level
 * with fixture bytes (setUpstream seam + the Upstash fake; no live network):
 *
 *   rung 1  browse-fresh      — a healthy FEwhat_to_watch answer → source "browse";
 *   rung 2  browse-last-good  — the adapter's stale L2 envelope served while the
 *                               egress is walled → source "last-good";
 *   rung 3  search-compose    — real search results merged + deduped into every
 *                               home rail → source "search-compose" (never
 *                               "browse"), honest-empty ONLY when search itself
 *                               fails, 502 when it hard-fails.
 *
 * Fixtures: search_lofi (REAL search — the compose source), home_feed (the
 * REAL logged-out browse nudge — the walled shape), reel_sequence_synth +
 * search_compose_synth (SYNTHETIC-but-shaped-from-real, marked `_synthetic`).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { decodeCursor } from "@/lib/youtube/cursors";
import { GET as getHome } from "@/app/api/home/route";
import { GET as listVideosRoute } from "@/app/api/videos/route";
import { GET as getShorts } from "@/app/api/shorts/route";
import { getHomeFeed } from "@/lib/youtube/feeds";
import { mapVideos } from "@/lib/youtube/mappers";
import type { HomeFeedDTO, VideoDTO, VideoPageDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const searchLofi = load("search_lofi"); // REAL search capture
const nudge = load("home_feed"); // REAL walled browse shape (logged-out nudge)
const reelSeq = load("reel_sequence_synth");
const searchSynth = load("search_compose_synth"); // synthetic — disjoint ids

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  body: any;
}

/**
 * Fixture upstream with per-query search routing: `browse` serves the walled
 * nudge by default (the production reality this lane fixes); `search` routes
 * each query to a fixture (default: the real search capture).
 */
function upstreamFake(opts: {
  browse?: unknown;
  browseStatus?: number;
  search?: (query: string) => { status?: number; body?: unknown } | null;
} = {}) {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/browse")) {
      return opts.browseStatus && opts.browseStatus !== 200
        ? new Response("walled", { status: opts.browseStatus })
        : json(opts.browse ?? nudge);
    }
    if (url.includes("/youtubei/v1/search")) {
      const route = opts.search?.(String(body?.query ?? ""));
      if (route) return json(route.body ?? {}, route.status ?? 200);
      return json(searchLofi);
    }
    if (url.includes("/reel/reel_watch_sequence")) return json(reelSeq);
    return new Response("not found", { status: 404 });
  };
  const calls = {
    browse: () => recorded.filter((r) => r.url.includes("/youtubei/v1/browse")),
    search: () => recorded.filter((r) => r.url.includes("/youtubei/v1/search")),
  };
  return { impl, recorded, calls };
}

/** An in-memory fake of the Upstash REST pipeline endpoint. */
function fakeRest() {
  const store = new Map<string, string>();
  const commands: string[][] = [];
  const impl: UpstashRest = async (cmds) => {
    commands.push(...cmds.map((c) => [...c]));
    return cmds.map((cmd) => {
      if (cmd[0] === "GET") return store.has(cmd[1]) ? store.get(cmd[1])! : null;
      if (cmd[0] === "SET") {
        store.set(cmd[1], cmd[2]);
        return "OK";
      }
      if (cmd[0] === "INCR") {
        const value = Number(store.get(cmd[1]) ?? "0") + 1;
        store.set(cmd[1], String(value));
        return value;
      }
      return 1;
    });
  };
  return { impl, store, commands };
}

/** Pre-seed the fake with a last-good envelope (stale soft, live hard). */
function seedLastGood(store: Map<string, string>, key: string, value: unknown): void {
  store.set(
    key,
    JSON.stringify({
      v: 1,
      value,
      softUntil: Date.now() - 60_000, // soft-expired → the last-good/SWR path
      hardUntil: Date.now() + 3_600_000, // inside the 24h hard window
    }),
  );
}

const feedOf = async (url = "http://localhost/api/home"): Promise<HomeFeedDTO> =>
  (await (await getHome(new Request(url))).json()) as HomeFeedDTO;

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("the three-rung ladder — order + the source flag", () => {
  test("rung 1 browse-healthy: source=browse, rails mapped, the compose never fires", async () => {
    const up = upstreamFake({ browse: searchLofi }); // healthy-shaped browse body
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.source).toBe("browse");
    expect(feed.hero?.id).toBe("l_7e2ZamUpI"); // first non-short, non-live real result
    expect(feed.recommended.length).toBeGreaterThan(0);
    expect(feed.shorts.length).toBeGreaterThan(0);
    // the ladder's first rung went upstream with the right browseId…
    expect(up.calls.browse()).toHaveLength(1);
    expect(up.calls.browse()[0].body.browseId).toBe("FEwhat_to_watch");
    // …and rung 3 never fired — ZERO search calls while browse is healthy
    expect(up.calls.search()).toHaveLength(0);
  });

  test("rung 1 fresh-cache second hit: zero upstream calls, source stays browse", async () => {
    const up = upstreamFake({ browse: searchLofi });
    setUpstream(up.impl);
    await feedOf();
    up.recorded.length = 0; // reset the tape

    const feed = await feedOf();
    expect(feed.source).toBe("browse");
    expect(up.recorded).toHaveLength(0); // everything served from the adapter's L1
  });

  test("rung 2 browse-last-good: the stale L2 envelope serves, source=last-good, compose skipped", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    seedLastGood(rest.store, "yt:home:feed", searchLofi); // a warm from an unwalled runner
    const up = upstreamFake(); // live egress walled: browse answers the nudge
    setUpstream(up.impl);

    const feed = await feedOf();
    expect(feed.source).toBe("last-good");
    expect(feed.hero?.id).toBe("l_7e2ZamUpI"); // the last-good payload's rails served
    expect(feed.recommended.length).toBeGreaterThan(0);
    // the ladder stopped at rung 2 — the compose (search) never fired
    expect(up.calls.search()).toHaveLength(0);
    // and the walled answer never poisoned the stored last-good
    expect(JSON.parse(rest.store.get("yt:home:feed")!).value).toEqual(searchLofi);
  });

  test("rung 3 compose: walled browse + healthy search → every rail real, source=search-compose", async () => {
    const up = upstreamFake(); // browse → the real nudge; search → the real capture
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.source).toBe("search-compose"); // never claims browse when composed
    expect(feed.hero?.id).toBeTypeOf("string");
    expect(feed.recommended.length).toBeGreaterThan(0);
    expect(feed.shorts.length).toBeGreaterThan(0);
    expect(feed.becauseYouWatched?.videos.length).toBeGreaterThan(0);
    expect(feed.chips[0]).toBe("All");
    // the ladder order: browse went upstream FIRST, then the compose queries
    expect(up.recorded[0].url).toContain("/youtubei/v1/browse");
    expect(up.recorded[0].body.browseId).toBe("FEwhat_to_watch");
    const queries = up.calls.search().map((r) => r.body.query);
    expect(queries).toContain("most viewed youtube videos");
    expect(queries).toContain("trending music");
    expect(queries).toContain("popular gaming");
  });

  test("hard browse failure (503) with no last-good also lands on rung 3", async () => {
    const up = upstreamFake({ browseStatus: 503 });
    setUpstream(up.impl);
    const feed = await feedOf();
    expect(feed.source).toBe("search-compose");
    expect(feed.recommended.length).toBeGreaterThan(0);
    expect(up.calls.search().length).toBeGreaterThanOrEqual(3);
  });
});

describe("the compose mapping — REAL search data → the home rails", () => {
  /** Upstream where "trending music" returns the synthetic (disjoint) set. */
  const mergeUpstream = () =>
    upstreamFake({
      search: (query) =>
        query === "trending music" ? { body: searchSynth } : null, // default: search_lofi
    });

  test("per-query result sets merge in query order and dedupe by id", async () => {
    const up = mergeUpstream();
    setUpstream(up.impl);
    // P81-b — the ORDER law is a property of the DERIVATION (seed null = the
    // legacy unrotated order); the route itself now rotates per request, so
    // the order/set pins run at the library level.
    const feed = await getHomeFeed("All");

    // every synthetic (disjoint) result from the second query reached the feed
    const synthIds = Array.from({ length: 8 }, (_, i) => `SYNTHHR000${i + 1}`);
    const railIds = new Set<string>([
      ...(feed.hero ? [feed.hero.id] : []),
      ...feed.recommended.map((v) => v.id),
    ]);
    for (const id of synthIds) expect(railIds.has(id)).toBe(true);

    // query order preserved: the first recommended entry is from query 1's set
    expect(feed.recommended[0].id).not.toMatch(/^SYNTHHR/);
    // the duplicate query 3 (same results as query 1) added nothing new —
    // exactly 3 first-pass pages went upstream, merged + deduped
    const firstPass = up
      .calls.search()
      .map((r) => r.body.query)
      .filter((q: string) =>
        ["most viewed youtube videos", "trending music", "popular gaming"].includes(q)
      );
    expect(firstPass).toHaveLength(3);
  });

  test("no video appears in two rails; recommended ids are unique and non-short", async () => {
    const up = mergeUpstream();
    setUpstream(up.impl);
    const feed = await feedOf();

    const all = [
      ...(feed.hero ? [feed.hero] : []),
      ...feed.recommended,
      ...feed.shorts,
      ...(feed.becauseYouWatched?.videos ?? []),
    ];
    expect(new Set(all.map((v) => v.id)).size).toBe(all.length); // rails are disjoint
    expect(new Set(feed.recommended.map((v) => v.id)).size).toBe(feed.recommended.length);
    for (const v of feed.recommended) expect(v.isShort).toBe(false);
    expect(feed.shorts.every((s) => s.isShort)).toBe(true);
  });

  test("hero = the top pick of the composed set, in the browse hero's DTO shape", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.hero).not.toBeNull();
    const hero = feed.hero as VideoDTO;
    // the first non-short, non-live REAL search result of the merged set
    expect(hero.id).toBe("l_7e2ZamUpI");
    expect(hero.title).toContain("Chillhop Drive 90's");
    expect(hero.channel.name).toBe("chilli music");
    expect(hero.isShort).toBe(false);
    expect(hero.isLive).toBe(false);
    expect(hero.thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
    expect(hero.videoUrl).toBe(`https://www.youtube.com/watch?v=${hero.id}`);
  });

  test("shorts rail = the existing seed mapped to the canonical shorts-card DTO", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.shorts.length).toBe(12); // browse-mode rail size
    expect(feed.shorts[0].id).toBe("vCxGMKtyAHE"); // the real seed's first short
    expect(feed.shorts[0].isShort).toBe(true);
    expect(feed.shorts[0].thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\/.+\/oardefault\.jpg$/);
    expect(feed.shorts[0].videoUrl).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
    expect(feed.shorts[0].title).not.toBe("");
  });

  test("because-you-watched: second-pass queries = the top results' REAL channels", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.becauseYouWatched).not.toBeNull();
    const byw = feed.becauseYouWatched as NonNullable<HomeFeedDTO["becauseYouWatched"]>;
    // the label is the rail's seed — the top pick's real title
    expect(byw.label).toContain("Chillhop Drive 90's");
    expect(byw.videos.length).toBeGreaterThan(0);
    expect(byw.videos.every((v) => v.id !== feed.hero?.id)).toBe(true); // hero excluded
    expect(byw.videos.every((v) => !v.isShort)).toBe(true);
    // the second-pass queries went upstream: the top results' channel names
    const queries = up.calls.search().map((r) => r.body.query);
    expect(queries).toContain("chilli music");
    expect(queries).toContain("Chillhop Music");
  });

  test("partial search failure (2 of 3 queries down): the merge still composes", async () => {
    const up = upstreamFake({
      search: (query) =>
        query === "trending music" || query === "popular gaming"
          ? { status: 503 }
          : null,
    });
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.source).toBe("search-compose");
    expect(feed.recommended.length).toBeGreaterThan(0); // the one healthy query carried it
  });
});

describe("GET /api/videos — the default feed climbs the same ladder", () => {
  test("walled browse + healthy search → the composed default feed (never empty)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const res = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as VideoPageDTO;
    expect(page.videos.length).toBeGreaterThan(0);
    // WFX2-P6-IS: a composed page carries the rung-3 pool cursor now — an
    // opaque envelope resuming the merged pool (not a browse continuation)
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor?.s).toBe("pool");
    expect(cursor?.s === "pool" ? cursor.o : 0).toBe(12); // resumes after the first window
    // it shares the home feed's data: the same compose queries went upstream
    const queries = up.calls.search().map((r) => r.body.query);
    expect(queries).toContain("most viewed youtube videos");
    expect(queries).toContain("trending music");
    expect(queries).toContain("popular gaming");
  });

  test("limit honored: limit=24 serves exactly 24 real search results; default serves 12", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);

    const res24 = await listVideosRoute(new Request("http://localhost/api/videos?limit=24"));
    expect(res24.status).toBe(200);
    const page24 = (await res24.json()) as VideoPageDTO;
    expect(page24.videos).toHaveLength(24);
    expect(new Set(page24.videos.map((v) => v.id)).size).toBe(24); // deduped real ids

    const resDefault = await listVideosRoute(new Request("http://localhost/api/videos"));
    const pageDefault = (await resDefault.json()) as VideoPageDTO;
    expect(pageDefault.videos).toHaveLength(12);
  });

  test("browse-healthy default feed: browse serves, ZERO search calls", async () => {
    const up = upstreamFake({ browse: searchLofi });
    setUpstream(up.impl);
    const res = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as VideoPageDTO;
    expect(page.videos.length).toBeGreaterThan(0);
    expect(up.calls.search()).toHaveLength(0);
  });

  test("cursor pages stay browse continuations — a continuation never composes", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const res = await listVideosRoute(
      new Request("http://localhost/api/videos?cursor=tok-ladder-1")
    );
    expect(res.status).toBe(200);
    // the token was POSTed upstream as a browse continuation…
    const continuation = up.calls.browse().find((r) => r.body?.continuation);
    expect(continuation?.body.continuation).toBe("tok-ladder-1");
    // …and the compose never fired for a cursor page
    expect(up.calls.search()).toHaveLength(0);
  });
});

describe("honesty — empty ONLY when search itself fails", () => {
  test("search answers 200-but-empty → the honest empty feed (never fake data)", async () => {
    const up = upstreamFake({ search: () => ({ body: {} }) });
    setUpstream(up.impl);
    const feed = await feedOf();

    expect(feed.source).toBe("search-compose"); // the compose ran — and found nothing
    expect(feed.hero).toBeNull();
    expect(feed.recommended).toEqual([]);
    expect(feed.shorts).toEqual([]);
    expect(feed.becauseYouWatched).toBeNull();
    expect(feed.chips[0]).toBe("All"); // the payload stays structurally valid
  });

  test("search hard-fails (503) → /api/home and /api/videos answer the honest 502", async () => {
    const up = upstreamFake({ browseStatus: 503, search: () => ({ status: 503 }) });
    setUpstream(up.impl);

    const home = await getHome(new Request("http://localhost/api/home"));
    expect(home.status).toBe(502);
    expect(typeof ((await home.json()) as { error: string }).error).toBe("string");

    const videos = await listVideosRoute(new Request("http://localhost/api/videos"));
    expect(videos.status).toBe(502);
    expect(typeof ((await videos.json()) as { error: string }).error).toBe("string");
  });
});

describe("caching laws — no new uncached upstream paths", () => {
  test("a second composed home makes ZERO new search calls (existing keys serve)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    await feedOf();
    const searchesAfterFirst = up.calls.search().length;
    const browseAfterFirst = up.calls.browse().length;
    expect(searchesAfterFirst).toBeGreaterThanOrEqual(6); // 3 compose + seed + byw pages

    const feed = await feedOf();
    expect(feed.source).toBe("search-compose");
    expect(up.calls.search()).toHaveLength(searchesAfterFirst); // all pages cache-hit
    expect(up.calls.browse()).toHaveLength(browseAfterFirst + 1); // the wall never caches
  });

  test("the compose's shorts ride the EXISTING shorts:seed entry (/api/shorts hits cache)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    await feedOf(); // warms the seed through the shared key

    // the shorts route's own fetcher (the global fetch) must never fire —
    // the seed entry the compose stored serves it from the adapter's L1
    let globalFetchCalls = 0;
    globalThis.fetch = (async () => {
      globalFetchCalls += 1;
      return new Response(JSON.stringify(searchLofi), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await getShorts(new NextRequest("http://localhost/api/shorts"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { id: string }[] };
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].id).toBe("vCxGMKtyAHE"); // the same real seed
    expect(globalFetchCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P81-b — the home variety layer (the "always the same videos" fix):
// per-request seeded rotation over the FULL pool + the viewer's WebFlix-local
// exclusion (VideoSignal: not-interested + dont-recommend-channel) on every
// rail. Rotation is POST-cache derivation — the shared upstream keys stay
// unseeded (the caching-laws describe above still applies untouched).
// ---------------------------------------------------------------------------

/** deep-clone helper (structured enough for the fixture JSON) */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** the first videoRenderer node anywhere in the fixture (the clone base) */
function firstVideoRenderer(node: unknown): any {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (obj.videoRenderer) return obj.videoRenderer;
  for (const key of Object.keys(obj)) {
    const found = firstVideoRenderer(obj[key]);
    if (found) return found;
  }
  return null;
}

const baseVR = firstVideoRenderer(searchLofi);

/**
 * A synthetic search page: `count` DISTINCT videoRenderers (id prefix+index),
 * every item wearing the SAME channel (browseId `channelBrowseId`) so the
 * channel-exclusion pin can remove a whole page's worth of pool items.
 */
function synthSearchPage(prefix: string, count: number, channelBrowseId: string): unknown {
  const items = Array.from({ length: count }, (_, i) => {
    const vr = clone(baseVR);
    vr.videoId = `${prefix}${String(i).padStart(11 - prefix.length, "0")}`;
    if (vr.title?.runs?.[0]) vr.title.runs[0].text = `${prefix} item ${i}`;
    // the mapper's search path reads ownerText/longBylineText/shortBylineText
    // runs (the fixture carries longBylineText — patch every byline shape)
    for (const byline of ["ownerText", "longBylineText", "shortBylineText"]) {
      const run = (vr as Record<string, any>)?.[byline]?.runs?.[0];
      if (run) {
        run.text = `Channel ${prefix}`;
        if (!run.navigationEndpoint) run.navigationEndpoint = {};
        run.navigationEndpoint.browseEndpoint = {
          browseId: channelBrowseId,
          canonicalBaseUrl: `/@${channelBrowseId}`,
        };
      }
    }
    return { videoRenderer: vr };
  });
  return { contents: items };
}

const PAGE_A = synthSearchPage("aaa", 20, "CHAN_AAAA");
const PAGE_B = synthSearchPage("bbb", 20, "CHAN_BBBB");
const PAGE_C = synthSearchPage("ccc", 20, "CHAN_CCCC");

const varietyUpstream = () => {
  const up = upstreamFake({
    search: (query: string) => {
      // the REAL compose queries → one synthetic page each (distinct pools)
      if (query === "most viewed youtube videos") return { body: PAGE_A };
      if (query === "trending music") return { body: PAGE_B };
      if (query === "popular gaming") return { body: PAGE_C };
      return { body: PAGE_A }; // the because-you-watched channel second pass
    },
  });
  return up;
};

describe("P81-b — the home variety layer (rotation + exclusion)", () => {
  test("seed null → the legacy unrotated order (the merge order, rails removed)", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const feed = await getHomeFeed("All", { seed: null });
    expect(feed.source).toBe("search-compose");
    // the pool merge order is a-page → b-page → c-page; minus rails/shorts
    // the first recommended item is the pool's first eligible video
    const pool = [...mapVideos(PAGE_A, { dedupe: true }), ...mapVideos(PAGE_B, { dedupe: true }), ...mapVideos(PAGE_C, { dedupe: true })];
    const eligible = pool.filter(
      (v) => v.id !== feed.hero?.id && !v.isShort && !feed.becauseYouWatched?.videos.some((b) => b.id === v.id),
    );
    expect(feed.recommended[0]?.id).toBe(eligible[0]?.id);
  });

  test("the same seed → the same order (the deterministic law)", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const a = await getHomeFeed("All", { seed: 424242 });
    const b = await getHomeFeed("All", { seed: 424242 });
    expect(a.recommended.map((v) => v.id)).toEqual(b.recommended.map((v) => v.id));
  });

  test("different seeds → different orders (per-request reshuffle, youtube parity)", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      const feed = await getHomeFeed("All", { seed });
      orders.add(feed.recommended.map((v) => v.id).join(","));
    }
    expect(orders.size).toBeGreaterThanOrEqual(3); // 5 seeds → ≥3 distinct orders
  });

  test("the full-pool law: a wide pool surfaces DIFFERENT ITEMS per seed (not a re-order of the same 24)", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const union = new Set<string>();
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const feed = await getHomeFeed("All", { seed });
      expect(feed.recommended.length).toBe(24); // the rail stays full
      for (const v of feed.recommended) union.add(v.id);
    }
    // the pool is ~60 eligible items; six seeds must surface well past 24
    expect(union.size).toBeGreaterThan(24);
  });

  test("the exclusion law: a hidden video leaves EVERY rail", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const base = await getHomeFeed("All", { seed: 777 });
    const hiddenId = base.recommended[3]!.id; // any pool item
    const feed = await getHomeFeed("All", {
      seed: 777,
      excludeVideoIds: new Set([hiddenId]),
    });
    const allIds = [
      feed.hero?.id,
      ...feed.recommended.map((v) => v.id),
      ...(feed.becauseYouWatched?.videos.map((v) => v.id) ?? []),
      ...feed.shorts.map((v) => v.id),
    ].filter((x): x is string => typeof x === "string");
    expect(allIds).not.toContain(hiddenId);
  });

  test("the channel exclusion law: a hidden channel's videos leave the pool", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    // CHAN_AAAA owns every 'aaa' page item
    const feed = await getHomeFeed("All", {
      seed: 888,
      excludeChannelIds: new Set(["CHAN_AAAA"]),
    });
    const ids = feed.recommended.map((v) => v.id);
    expect(ids.some((id) => id.startsWith("aaa"))).toBe(false);
    expect(ids.some((id) => id.startsWith("bbb"))).toBe(true);
    expect(ids.some((id) => id.startsWith("ccc"))).toBe(true);
  });

  test("the route serves the variety feed (per-request seed, signed-out = no exclusion)", async () => {
    const up = varietyUpstream();
    setUpstream(up.impl);
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as HomeFeedDTO;
    expect(feed.source).toBe("search-compose");
    expect(feed.recommended.length).toBe(24);
  });
});
