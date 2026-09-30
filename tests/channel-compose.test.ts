/// <reference types="bun-types" />
/**
 * WFX2-C-F tests — the channel search-compose lane (the wall-proof channel
 * family): youtube.com walls every channel-read path for server egress, but
 * the plain video search still returns real videoRenderers that each carry
 * real channel fields. The lane composes the channel family from that data
 * with exact-id honesty:
 *
 *  - the dominance resolver (WFX2-CF-2): a name search's results grouped by
 *    the channelId they actually carry — the id owning >= 40% of the results
 *    that have channel fields AND >= 2x the runner-up's count, OR an
 *    absolute >= 60% supermajority, IS the channel; below both → null (the
 *    honest degrade stands; never a name-similarity guess, never a mere
 *    plurality);
 *  - the composed channel page: the ladder's third rung
 *    (browse-fresh → browse-last-good → search-compose → honest-degrade) —
 *    `composed: true`, real header fields WATCH-ENRICHED through the
 *    unwalled watch path (WFX2-CF-2: the resolved channel's top video
 *    rides getVideoDetail / the yt:watch:<videoId> cache family — its
 *    `next` payload carries the real subs/verified/handle/avatar), honest
 *    nulls for the fields no path carries (banner/description),
 *    id-filtered videos;
 *  - in-channel search within the walls ("${query} ${channelName}" + the
 *    exact-id filter, honest cursor pagination);
 *  - channelFromLastGood normalization: space-stripped handle matching +
 *    the cached page's channel NAME match — all exact-normalized.
 *
 * Fixture bytes via setUpstream() + the Upstash fake via setUpstashRest()
 * (the channel-wall.test.ts patterns — never the network). The synthetic
 * fixtures (`_synthetic: true`, *_synth.json — the repo convention):
 * search_compose_dominant_synth (7/10 results owned by Rick Astley's UC
 * id), search_compose_inchannel_synth (the composed in-channel search page
 * + a real continuation token), and — WFX2-CF-2 — next_compose_rick_synth
 * (the composed top video's watch payload, carrying the live-verified real
 * Rick owner fields: @RickAstleyYT, 4.55M subscribers, verified artist).
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
const watchSynth = load("next_compose_rick_synth"); // synthetic — the top video's `next` payload (real Rick owner fields)

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
 * injectably walled (the live egress behavior). WFX2-CF-2: the watch
 * (`next`) endpoint serves the composed top video's synthetic watch payload —
 * injectably walled (the enrichment's honest-degrade path) and the owner
 * browseId spoofable (the enrichment's exact-id guard).
 */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const htmlFor = (data: unknown) =>
    `<!doctype html><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  let ssrWalled = false;
  let watchWalled = false;
  let watchOwnerSpoof: string | null = null;
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
      return json(searchLofi); // the real mixed capture — below both thresholds
    }
    if (url.includes("/youtubei/v1/next")) {
      // WFX2-CF-2 — the composed header's watch-meta enrichment call
      if (watchWalled) return new Response("not found", { status: 404 });
      return json(
        watchOwnerSpoof ? withWatchOwnerBrowseId(watchSynth, watchOwnerSpoof) : watchSynth
      );
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
  return {
    impl,
    recorded,
    wall: (v: boolean) => (ssrWalled = v),
    wallWatch: (v: boolean) => (watchWalled = v),
    spoofWatchOwner: (id: string | null) => (watchOwnerSpoof = id),
  };
}

/** Clone the watch synthetic with a different owner browseId — the
 * enrichment's exact-id guard probe (a watch payload attributing the top
 * video to another channel must enrich nothing). */
function withWatchOwnerBrowseId(payload: any, browseId: string): any {
  const clone = JSON.parse(JSON.stringify(payload));
  const owner =
    clone?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(
      (c: any) => c?.videoSecondaryInfoRenderer
    )?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer;
  owner.navigationEndpoint.browseEndpoint.browseId = browseId;
  owner.title.runs[0].navigationEndpoint.browseEndpoint.browseId = browseId;
  return clone;
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
const nextCalls = () => upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/next"));

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
// 1. the dominance resolver (WFX2-CF-2)
// ---------------------------------------------------------------------------

describe("the dominance resolver (resolveFromSearchResponse)", () => {
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

  test("a mixed search below BOTH thresholds → null (the honest degrade stands)", () => {
    // the REAL recorded capture: 19 renderers, the top channel owns 4 (21%)
    // — under the 40% floor, however weak the field
    expect(resolveFromSearchResponse(searchLofi)).toBeNull();
  });

  test("supermajority-pass: exactly 60% (the inclusive >= threshold) resolves", () => {
    const resp = synthSearch([
      ["UCdom000000000000000000", 6],
      ["UCaaa0000000000000000A", 4],
    ]);
    const r = resolveFromSearchResponse(resp);
    expect(r?.channelId).toBe("UCdom000000000000000000");
  });

  test("supermajority overrides the lead requirement: 60% vs a 35% runner-up resolves", () => {
    // 12/20 = 60% — but 12 < 2x7: only the supermajority branch carries it
    const resp = synthSearch([
      ["UCdom000000000000000000", 12],
      ["UCaaa0000000000000000A", 7],
      ["UCbbb0000000000000000B", 1],
    ]);
    expect(resolveFromSearchResponse(resp)?.channelId).toBe("UCdom000000000000000000");
  });

  test("dominant-2x-pass: the live finding's arithmetic — 44% over a 16% runner-up resolves", () => {
    // the lead's live capture: "Rick Astley" from either egress attributes
    // 11/25 (44%) to the REAL channel with the runner-up at 4/25 (16%) — a
    // 2-4x lead the bare supermajority declined (the CF-2 fix)
    const resp = synthSearch([
      ["UCdom000000000000000000", 11],
      ["UCaaa0000000000000000A", 4],
      ["UCbbb0000000000000000B", 4],
      ["UCccc0000000000000000C", 2],
      ["UCddd0000000000000000D", 2],
      ["UCeee0000000000000000E", 2],
    ]);
    expect(resolveFromSearchResponse(resp)?.channelId).toBe("UCdom000000000000000000");
  });

  test("dominant-2x-pass: just below the supermajority (59/99) with a 3x lead resolves", () => {
    // the old rule declined this shape — the honest degrade served instead
    // of the clearly-dominant real channel
    const resp = synthSearch([
      ["UCdom000000000000000000", 59],
      ["UCaaa0000000000000000A", 20],
      ["UCbbb0000000000000000B", 20],
    ]);
    expect(resolveFromSearchResponse(resp)?.channelId).toBe("UCdom000000000000000000");
  });

  test("dominant-but-weak-lead-fail: >= 40% but under 2x the runner-up → null", () => {
    // 9/20 = 45% — but 9 < 2x6: a plurality-ish lead is NOT dominance
    const resp = synthSearch([
      ["UCdom000000000000000000", 9],
      ["UCaaa0000000000000000A", 6],
      ["UCbbb0000000000000000B", 5],
    ]);
    expect(resolveFromSearchResponse(resp)).toBeNull();
  });

  test("below the 40% floor → null, however weak the field", () => {
    // 3/10 = 30% with 3 >= 2x2 — the floor still declines it
    const resp = synthSearch([
      ["UCdom000000000000000000", 3],
      ["UCaaa0000000000000000A", 2],
      ["UCbbb0000000000000000B", 2],
      ["UCccc0000000000000000C", 2],
      ["UCddd0000000000000000D", 1],
    ]);
    expect(resolveFromSearchResponse(resp)).toBeNull();
  });

  test("a 50/50 tie resolves to nothing (the runner-up equals the dominant)", () => {
    const resp = synthSearch([
      ["UCdom000000000000000000", 5],
      ["UCaaa0000000000000000A", 5],
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

  test("below both thresholds the cached null serves — no re-search", async () => {
    expect(await resolveChannelFromSearch("@lofi")).toBeNull();
    expect(await resolveChannelFromSearch("@lofi")).toBeNull();
    expect(searchCalls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. the composed channel page — the ladder's third rung
// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle] — the search-compose rung", () => {
  test("walled browse + dominant name search → the composed page (composed: true, watch-enriched header, id-filtered videos)", async () => {
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
    // WFX2-CF-2: the header is watch-enriched — the resolved channel's top
    // video went through the unwalled watch path, whose `next` payload
    // carries the REAL subs/avatar/verified
    expect(page.channel.subscriberCount).toBe(4_550_000);
    expect(page.channel.subscriberCountText).toBe("4.55M subscribers");
    expect(page.channel.verified).toBe(true);
    expect(page.channel.avatarUrl).toContain("rick-compose-watch-synth-avatar");
    // the fields NO path carries stay honest nulls — never invented
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
// 2b. the watch-meta header enrichment (WFX2-CF-2)
// ---------------------------------------------------------------------------

describe("the watch-meta header enrichment (WFX2-CF-2)", () => {
  test("the top video's watch payload enriches the header through the EXISTING watch cache family", async () => {
    upstream.wall(true);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    const page = (await res.json()) as any;
    // one `next` call for the resolved channel's top video — getVideoDetail
    // riding the yt:watch:<videoId> cache key family
    expect(nextCalls()).toHaveLength(1);
    expect(nextCalls()[0]?.body?.videoId).toBe("rickcompose01");
    const cachedWatch = await cachePeek<Record<string, any>>("yt:watch:rickcompose01");
    expect(cachedWatch).not.toBeNull(); // the enrichment rode the real watch key
    // the header carries the watch payload's REAL owner fields
    expect(page.channel.subscriberCount).toBe(4_550_000);
    expect(page.channel.subscriberCountText).toBe("4.55M subscribers");
    expect(page.channel.handle).toBe("@RickAstleyYT");
    expect(page.channel.avatarUrl).toContain("rick-compose-watch-synth-avatar");
    expect(page.channel.verified).toBe(true);
    // the fields no path carries stay honest — never invented
    expect(page.channel.bannerUrl).toBeNull();
    expect(page.channel.description).toBeNull();
  });

  test("the watch call fails → the search-carried fields + honest nulls stand (never fabricated)", async () => {
    upstream.wall(true);
    upstream.wallWatch(true); // the `next` endpoint 404s
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200); // the composed page still serves
    const page = (await res.json()) as any;
    expect(page.channel.composed).toBe(true);
    // the call was genuinely attempted (twice — the transport's built-in
    // single retry on any error, then the honest give-up)
    expect(nextCalls()).toHaveLength(2);
    // honest nulls — never invented numbers
    expect(page.channel.subscriberCount).toBe(0);
    expect(page.channel.subscriberCountText).toBeNull();
    // the search-carried fields survive untouched
    expect(page.channel.avatarUrl).toContain("rick-compose-synth-avatar");
    expect(page.channel.handle).toBe("@RickAstleyYT");
    expect(page.channel.verified).toBe(true);
  });

  test("exact-id honesty: a watch payload owned by ANOTHER channel enriches nothing", async () => {
    upstream.wall(true);
    upstream.spoofWatchOwner("UCspoofed00000000000000"); // the owner browseId disagrees
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    const page = (await res.json()) as any;
    expect(page.channel.composed).toBe(true);
    // no enrichment from a foreign owner — the honest nulls stand
    expect(page.channel.subscriberCount).toBe(0);
    expect(page.channel.subscriberCountText).toBeNull();
    expect(page.channel.avatarUrl).toContain("rick-compose-synth-avatar");
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
      // WFX2-CF-2: the watch-enriched composed page serves the rows — the
      // REAL subscriber data, not the honest-null degrade
      subscriberCount: 4_550_000,
      subscriberCountText: "4.55M subscribers",
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
