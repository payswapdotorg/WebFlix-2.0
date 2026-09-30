/// <reference types="bun-types" />
/**
 * WFX2-C-F tests — the channel search-compose lane (the wall-proof channel
 * family): youtube.com walls every channel-read path for server egress, but
 * the plain video search still returns real videoRenderers that each carry
 * real channel fields. The lane composes the channel family from that data
 * with exact-id honesty:
 *
 *  - the supermajority resolver: a name search's results grouped by the
 *    channelId they actually carry — the id owning >= 60% of the results
 *    that have channel fields IS the channel; below the threshold → null
 *    (the honest degrade stands; never a name-similarity guess);
 *  - the composed channel page: the ladder's third rung
 *    (browse-fresh → browse-last-good → search-compose → honest-degrade) —
 *    `composed: true`, real header fields, honest nulls for the fields
 *    search cannot carry (subs/banner/description), id-filtered videos;
 *  - in-channel search within the walls ("${query} ${channelName}" + the
 *    exact-id filter, honest cursor pagination);
 *  - channelFromLastGood normalization: space-stripped handle matching +
 *    the cached page's channel NAME match — all exact-normalized.
 *
 * Fixture bytes via setUpstream() + the Upstash fake via setUpstashRest()
 * (the channel-wall.test.ts patterns — never the network). The two new
 * fixtures are synthetic (`_synthetic: true`, *_synth.json — the repo
 * convention): search_compose_dominant_synth (7/10 results owned by Rick
 * Astley's UC id) and search_compose_inchannel_synth (the composed
 * in-channel search page + a real continuation token).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setUpstashRest, cachePeek, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { channelPageCacheKey, channelFromLastGood } from "@/lib/youtube/channels";
import {
  resolveChannelCacheKey,
  resolveChannelFromSearch,
  resolveFromSearchResponse,
} from "@/lib/youtube/channel-compose";
import { CHANNEL_SEARCH_TAB_PARAM } from "@/lib/youtube/channel-search";
import { GET as channelRoute } from "@/app/api/channel/[handle]/route";
import { GET as searchRoute } from "@/app/api/search/route";
import { GET as channelSearchRoute } from "@/app/api/channel/[handle]/search/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const channel = load("channel_rickastley"); // the full healthy browse/SSR fixture
const channelSearch = load("channel_search_rickastley"); // the healthy in-channel Search tab
const searchLofi = load("search_lofi"); // REAL mixed capture: 19 renderers, max share 21%, zero channelRenderers
const dominantSynth = load("search_compose_dominant_synth"); // synthetic — 7/10 owned by UC_RICK
const inchannelSynth = load("search_compose_inchannel_synth"); // synthetic — the composed in-channel page + cursor

const RICK_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";
const CURSOR = "COMPOSE-INCHANNEL-CURSOR-SYNTH";

interface Recorded {
  url: string;
  body: any;
}

/**
 * Fixture-backed upstream: the search endpoint is routed by the flattened
 * query — "rickastleyyt"/"rickastley" (the resolver's name searches for the
 * @handle / bare-name forms) and "neverrickastley" (the composed in-channel
 * search) hit the synthetics; everything else returns the REAL mixed
 * search_lofi capture (below the threshold). The @handle SSR scrape is
 * injectably walled (the live egress behavior).
 */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const htmlFor = (data: unknown) =>
    `<!doctype html><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  let ssrWalled = false;
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/youtubei/v1/search")) {
      const flatQuery = String(body?.query ?? "").toLowerCase().replace(/\s+/g, "");
      if (flatQuery === "rickastleyyt" || flatQuery === "rickastley" || flatQuery === "togetherrickastley") {
        return json(dominantSynth); // the dominant-id name search
      }
      if (flatQuery === "neverrickastley" || body?.continuation) {
        return json(inchannelSynth); // the composed in-channel search + continuations
      }
      return json(searchLofi); // the real mixed capture — below the threshold
    }
    if (url.includes("/youtubei/v1/browse")) {
      // the healthy in-channel search mechanism (the channel's own Search tab)
      if (body?.params === CHANNEL_SEARCH_TAB_PARAM || typeof body?.query === "string") {
        return json(channelSearch);
      }
      return json(channel);
    }
    if (url.includes("youtube.com/@")) {
      if (ssrWalled) return new Response("not found", { status: 404 });
      return new Response(htmlFor(channel), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded, wall: (v: boolean) => (ssrWalled = v) };
}

/** An in-memory fake of the Upstash REST pipeline endpoint. */
function fakeRest() {
  const store = new Map<string, string>();
  const impl: UpstashRest = async (cmds) => {
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
  return { impl, store };
}

/** Pre-seed the fake with a last-good envelope (stale soft, live hard). */
function seedLastGood(store: Map<string, string>, key: string, value: unknown): void {
  store.set(
    key,
    JSON.stringify({
      v: 1,
      value,
      softUntil: Date.now() - 60_000,
      hardUntil: Date.now() + 3_600_000,
    })
  );
}

/** A minimal cached-page envelope value for the family lookups. */
function familyPage(overrides: Record<string, unknown> = {}) {
  return {
    page: {
      channel: {
        id: RICK_ID,
        handle: "@RickAstleyYT",
        name: "Rick Astley",
        avatarUrl: "https://example.com/rick.jpg",
        verified: true,
        subscriberCount: 4_550_000,
        subscriberCountText: "4.55M subscribers",
        bannerUrl: null,
        description: "the last-good description",
        createdAt: null,
        isSubscribed: false,
        isOwner: false,
        videoCount: 437,
        ...overrides,
      },
      videos: [{ id: "lastgood-video", title: "Last-good row" }],
      shorts: [],
      tabs: ["home", "videos", "about"],
      joinable: false,
    },
    walled: false,
  };
}

let upstream: ReturnType<typeof fixtureUpstream>;
const searchCalls = () => upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/search"));

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
  setUpstream(upstream.impl);
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
});

const ctx = (handle: string) => ({ params: Promise.resolve({ handle }) });

// ---------------------------------------------------------------------------
// 1. the supermajority resolver
// ---------------------------------------------------------------------------

describe("the supermajority resolver (resolveFromSearchResponse)", () => {
  test("a dominant-id search resolves — real fields, id-owned videos only", () => {
    const r = resolveFromSearchResponse(dominantSynth);
    expect(r).not.toBeNull();
    expect(r!.channelId).toBe(RICK_ID);
    expect(r!.channelName).toBe("Rick Astley");
    expect(r!.channelHandle).toBe("@RickAstleyYT");
    expect(r!.avatarUrl).toContain("rick-compose-synth-avatar"); // the renderer's channel avatar
    expect(r!.verified).toBe(true); // the results' owner badges
    expect(r!.videos).toHaveLength(7);
    expect(r!.videos.every((v) => v.channel.id === RICK_ID)).toBe(true); // exact-id
  });

  test("a mixed search below the threshold → null (the honest degrade stands)", () => {
    // the REAL recorded capture: 19 renderers, the top channel owns 4 (21%)
    expect(resolveFromSearchResponse(searchLofi)).toBeNull();
  });

  test("exactly 60% (the inclusive >= threshold) resolves", () => {
    const resp = synthSearch([
      ["UCdom000000000000000000", 6],
      ["UCaaa0000000000000000A", 4],
    ]);
    const r = resolveFromSearchResponse(resp);
    expect(r?.channelId).toBe("UCdom000000000000000000");
  });

  test("just below the threshold (59/99) → null — never a plurality guess", () => {
    const resp = synthSearch([
      ["UCdom000000000000000000", 59],
      ["UCaaa0000000000000000A", 20],
      ["UCbbb0000000000000000B", 20],
    ]);
    expect(resolveFromSearchResponse(resp)).toBeNull();
  });

  test("results without channel fields never count in the denominator", () => {
    const resp = [
      ...synthSearch([["UCdom000000000000000000", 6]]),
      ...Array.from({ length: 8 }, (_, i) => ({
        videoRenderer: { videoId: `nofields-${i}`, title: { runs: [{ text: `promo ${i}` }] } },
      })),
    ];
    const r = resolveFromSearchResponse(resp); // 6/6 = 100% of results WITH fields
    expect(r?.channelId).toBe("UCdom000000000000000000");
    expect(r?.videos).toHaveLength(6);
  });

  test("UC… handle: the dominant id must BE the requested id (exact-id honesty)", () => {
    expect(resolveFromSearchResponse(dominantSynth, RICK_ID)?.channelId).toBe(RICK_ID);
    expect(resolveFromSearchResponse(dominantSynth, "UCdifferent0000000000X")).toBeNull();
  });
});

/** Build a synthetic search response with per-channelId result counts. */
function synthSearch(counts: [string, number][]): unknown[] {
  const renderer = (id: string, i: number) => ({
    videoRenderer: {
      videoId: `v-${id}-${i}`,
      title: { runs: [{ text: `result ${i}` }] },
      ownerText: {
        runs: [{ text: `channel ${id}`, navigationEndpoint: { browseEndpoint: { browseId: id } } }],
      },
    },
  });
  return counts.flatMap(([id, n]) => Array.from({ length: n }, (_, i) => renderer(id, i)));
}

describe("the cached resolver (resolveChannelFromSearch)", () => {
  test("repeated resolutions never re-search (the resolve cache key)", async () => {
    const first = await resolveChannelFromSearch("@RickAstleyYT");
    const second = await resolveChannelFromSearch("@RickAstleyYT");
    expect(first?.channelId).toBe(RICK_ID);
    expect(second?.channelId).toBe(RICK_ID);
    expect(searchCalls()).toHaveLength(1); // one search, two resolutions
    expect(searchCalls()[0]?.body?.query).toBe("RickAstleyYT"); // the "@" stripped
  });

  test("the resolve key is the normalized handle; @/bare/name forms all resolve", async () => {
    expect(resolveChannelCacheKey("@Rick Astley")).toBe("yt:channel:resolve:@rick astley");
    for (const form of ["@Rick Astley", "Rick Astley", "rickastley"]) {
      const r = await resolveChannelFromSearch(form);
      expect(r?.channelId).toBe(RICK_ID); // every form → the same real channel
      expect(r?.channelName).toBe("Rick Astley");
    }
    // the query sent upstream never carries the "@"
    expect(searchCalls().every((c) => !String(c.body?.query ?? "").startsWith("@"))).toBe(true);
  });

  test("below the threshold the cached null serves — no re-search", async () => {
    expect(await resolveChannelFromSearch("@lofi")).toBeNull();
    expect(await resolveChannelFromSearch("@lofi")).toBeNull();
    expect(searchCalls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. the composed channel page — the ladder's third rung
// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle] — the search-compose rung", () => {
  test("walled browse + dominant name search → the composed page (composed: true, honest nulls, id-filtered videos)", async () => {
    upstream.wall(true);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.walled).toBe(false);
    expect(page.channel.composed).toBe(true);
    expect(page.channel.id).toBe(RICK_ID);
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.channel.handle).toBe("@RickAstleyYT");
    expect(page.channel.avatarUrl).toContain("rick-compose-synth-avatar");
    // the fields search cannot carry are honest nulls — never invented
    expect(page.channel.subscriberCount).toBe(0);
    expect(page.channel.subscriberCountText).toBeNull();
    expect(page.channel.bannerUrl).toBeNull();
    expect(page.channel.description).toBeNull();
    // only the tabs the compose can actually fill
    expect(page.tabs).toEqual(["videos"]);
    expect(page.joinable).toBe(false); // honest: membership needs the walled paths
    // the videos are the id-filtered real search results
    expect(page.videos).toHaveLength(7);
    expect(page.videos.every((v: any) => v.channel.id === RICK_ID)).toBe(true);
    expect(page.shorts).toEqual([]); // honest empty
    expect(page.channel.videoCount).toBe(7);
  });

  test("walled browse + a name search below the threshold → the honest degrade stands (the compose tried)", async () => {
    upstream.wall(true);
    const res = await channelRoute(new Request("http://localhost/api/channel/@lofi"), ctx("@lofi"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel).toBeNull();
    expect(page.videos).toEqual([]);
    expect(page.walled).toBe(true);
    expect(typeof page.note).toBe("string");
    // the ladder genuinely attempted both rungs: the scrape AND the name search
    expect(upstream.recorded.some((r) => r.url.includes("/@lofi"))).toBe(true);
    expect(searchCalls().some((c) => c.body?.query === "lofi")).toBe(true);
  });

  test("the ladder order: a browse last-good outranks the compose (no search call)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    seedLastGood(rest.store, channelPageCacheKey("@RickAstleyYT"), familyPage());
    upstream.wall(true);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.walled).toBe(false);
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.videos[0].id).toBe("lastgood-video"); // the last-good rails
    expect(page.channel.composed).toBeUndefined(); // NOT the composed page
    expect(searchCalls()).toHaveLength(0); // the compose never preempted the last-good
  });

  test("the composed page is kept in the channel family — the second read is cache-served", async () => {
    upstream.wall(true);
    const first = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    const firstPage = (await first.json()) as any;
    expect(firstPage.channel.composed).toBe(true);
    expect(searchCalls()).toHaveLength(1); // the resolve search

    // the family entry holds the composed page
    const peeked = await cachePeek<{ page: any; walled: boolean }>(
      channelPageCacheKey("@RickAstleyYT")
    );
    expect(peeked?.value.page.channel.composed).toBe(true);
    expect(peeked?.value.walled).toBe(false);

    const callsBefore = upstream.recorded.length;
    const second = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    const secondPage = (await second.json()) as any;
    expect(secondPage.channel.composed).toBe(true);
    expect(secondPage.channel.id).toBe(RICK_ID);
    expect(upstream.recorded.length).toBe(callsBefore); // zero new upstream calls
  });

  test("a healthy browse never composes (the first rung stands)", async () => {
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.walled).toBe(false);
    expect(page.channel.composed).toBeUndefined();
    expect(page.channel.subscriberCountText).toBeTruthy(); // the real header data
    expect(searchCalls()).toHaveLength(0); // no compose attempt
  });
});

// ---------------------------------------------------------------------------
// 3. in-channel search within the walls
// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle]/search — the compose path", () => {
  test("walled channel → resolve per A, search \"${query} ${channelName}\", filter to the exact id", async () => {
    upstream.wall(true);
    const res = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search?q=never"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.query).toBe("never");
    expect(data.channelId).toBe(RICK_ID);
    expect(data.channelName).toBe("Rick Astley");
    // the id-filtered results — the foreign row is dropped
    expect(data.videos).toHaveLength(4);
    expect(data.videos.every((v: any) => v.channel.id === RICK_ID)).toBe(true);
    // the upstream calls: the resolver's name search + the composed search
    expect(searchCalls().some((c) => c.body?.query === "RickAstleyYT")).toBe(true);
    expect(searchCalls().some((c) => c.body?.query === "never Rick Astley")).toBe(true);
  });

  test("cursor honesty: a cursor only when the upstream provides one", async () => {
    upstream.wall(true);
    const withToken = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search?q=never"),
      ctx("@RickAstleyYT")
    );
    expect(((await withToken.json()) as any).nextCursor).toBe(CURSOR); // the real token

    const withoutToken = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search?q=together"),
      ctx("@RickAstleyYT")
    );
    const data = (await withoutToken.json()) as any;
    expect(data.nextCursor).toBeNull(); // no continuation upstream → null
    expect(data.videos).toHaveLength(7); // the dominant fixture, id-filtered
  });

  test("following the cursor sends the continuation upstream (honest pagination)", async () => {
    upstream.wall(true);
    const res = await channelSearchRoute(
      new Request(`http://localhost/api/channel/@RickAstleyYT/search?cursor=${CURSOR}`),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.every((v: any) => v.channel.id === RICK_ID)).toBe(true);
    expect(data.nextCursor).toBe(CURSOR);
    expect(searchCalls().some((c) => c.body?.continuation === CURSOR)).toBe(true);
  });

  test("walled + a name search below the threshold → 404 (the honest empty)", async () => {
    upstream.wall(true);
    const res = await channelSearchRoute(
      new Request("http://localhost/api/channel/@lofi/search?q=chill"),
      ctx("@lofi")
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("Channel not found");
  });

  test("the healthy mechanism is untouched: browse with the channel's own Search tab params", async () => {
    const res = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search?q=never"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channelId).toBe(RICK_ID);
    expect(data.videos.length).toBeGreaterThan(20); // the channel-scoped fixture
    const browse = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/browse") && typeof r.body?.query === "string"
    );
    expect(browse?.body.browseId).toBe(RICK_ID);
    expect(browse?.body.params).toBe(CHANNEL_SEARCH_TAB_PARAM);
    expect(browse?.body.query).toBe("never");
    // the healthy path never touches the name-search resolver
    expect(searchCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. channelFromLastGood — the extended normalization
// ---------------------------------------------------------------------------

describe("channelFromLastGood — space-stripped + NAME matching (exact-normalized)", () => {
  test("space-stripped handle matching: \"Rick Astley\" probes \"rickastley\"", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    // a page cached under the space-free handle key (someone read /channel/rickastley)
    seedLastGood(
      rest.store,
      channelPageCacheKey("rickastley"),
      familyPage({ handle: "@RickAstleyYT", name: "Rick Astley" })
    );
    const row = await channelFromLastGood("Rick Astley");
    expect(row).not.toBeNull();
    expect(row!.id).toBe(RICK_ID);
    expect(row!.name).toBe("Rick Astley");
    expect(row!.handle).toBe("@RickAstleyYT");
  });

  test("the cached page's channel NAME match: the query equals the name (case/space-normalized)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    // the page's own handle differs from the query — the NAME carries the match
    seedLastGood(
      rest.store,
      channelPageCacheKey("rick astley"),
      familyPage({ handle: "@rickastleyyt", name: "Rick Astley" })
    );
    const row = await channelFromLastGood("rick  astley"); // spacing/case noise
    expect(row?.name).toBe("Rick Astley");
    expect(row?.id).toBe(RICK_ID);
  });

  test("no normalized match → null (never similarity guessing)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    seedLastGood(rest.store, channelPageCacheKey("@lofi"), familyPage());
    expect(await channelFromLastGood("Rick Astley")).toBeNull(); // neither key nor name matches
    expect(await channelFromLastGood("rick astley fun zone")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. the search route's channel results — the end-to-end story
// ---------------------------------------------------------------------------

describe("GET /api/search — composed pages serve the channel rows", () => {
  test("a composed channel page in the family → the search-route channel row (both query forms)", async () => {
    upstream.wall(true);
    // a bare-name channel read composes and stores under the requested key
    // AND the resolved real-handle key
    const channelRes = await channelRoute(
      new Request("http://localhost/api/channel/Rick%20Astley"),
      ctx("Rick Astley")
    );
    const channelPage = (await channelRes.json()) as any;
    expect(channelPage.channel.composed).toBe(true);
    expect(channelPage.channel.id).toBe(RICK_ID);

    // the name query finds the composed page (the requested-key store)
    const byName = await searchRoute(new Request("http://localhost/api/search?q=Rick+Astley"));
    const nameData = (await byName.json()) as any;
    expect(nameData.videos.length).toBeGreaterThan(0); // the search results serve
    expect(nameData.channels).toHaveLength(1);
    expect(nameData.channels[0]).toMatchObject({
      id: RICK_ID,
      name: "Rick Astley",
      handle: "@RickAstleyYT",
    });

    // the real-handle query finds it too (the real-handle family store)
    const byHandle = await searchRoute(
      new Request("http://localhost/api/search?q=RickAstleyYT")
    );
    const handleData = (await byHandle.json()) as any;
    expect(handleData.channels).toHaveLength(1);
    expect(handleData.channels[0].id).toBe(RICK_ID);
  });
});
