/// <reference types="bun-types" />
/**
 * WFX2-B-W discovery tests — search filters (composition + URL round-trips),
 * trending categories, in-channel search, the Live surface, playlist pages,
 * and the search-parity mappers. Fixtures only: the upstream is mocked via
 * the test-only `setUpstream()` seam (lane law — tests never touch
 * youtube.com).
 *
 * Filter-param ground truth: every expected string is either the recorded
 * menu param (search_lofi.json / live probing) or composed with A-B's
 * builder (which A-B live-verified — evidence/wfx2ab/CORE.md §3).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { buildSearchParam } from "@/lib/youtube/filters";
import {
  FILTER_GROUPS,
  appliedFilterChips,
  clearFilters,
  filtersFromParams,
  filtersToEntries,
  hasActiveFilters,
  searchHref,
  withGroupValue,
} from "@/lib/youtube/search-filters";
import {
  TRENDING_CATEGORIES,
  chipParamsFor,
  extractTrendingChips,
  normalizeTrendingCategory,
  trendingCategoryPath,
} from "@/lib/youtube/trending-categories";
import {
  CHANNEL_SEARCH_TAB_PARAM,
  channelSearchTabParams,
} from "@/lib/youtube/channel-search";
import { mapSearchCorrection, mapSearchPlaylists, searchResultCountText } from "@/lib/youtube/search-parity";
import { categoryDestination } from "@/lib/categories";

import { GET as searchRoute } from "@/app/api/search/route";
import { GET as trendingRoute } from "@/app/api/trending/route";
import { GET as channelSearchRoute } from "@/app/api/channel/[handle]/search/route";
import { GET as liveRoute } from "@/app/api/live/route";
import { GET as playlistRoute } from "@/app/api/playlist/[id]/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/** Fixture-backed upstream: routes requests to recorded fixture bytes and records every request. */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const search = load("search_lofi");
  const misspelled = load("search_misspelled");
  const searchLive = load("search_live");
  const searchPlaylists = load("search_playlists_lofi");
  const searchChannels = load("search_channels_lofi");
  const trending = load("ssr_trending");
  const channel = load("channel_rickastley");
  const channelSearch = load("channel_search_rickastley");
  const playlist = load("playlist_browse_lofi");

  const htmlFor = (data: unknown) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script></body></html>`;

  /** The empty public-mode nudge page (what the live /feed/trending/* serves logged-out). */
  const nudgeHtml =
    `<!doctype html><html><head></head><body><script>var ytInitialData = ` +
    `{"responseContext":{},"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"selected":true,"content":{"richGridRenderer":{"contents":[]}}}}]}}};` +
    `</script></body></html>`;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    // InnerTube search — routed by the request's params/query
    if (url.includes("/youtubei/v1/search")) {
      const params = body?.params;
      if (params === "EgJAAQ==") return json(searchLive); // Features → Live
      if (params === "EgIQAw==") return json(searchPlaylists); // type=playlist
      if (params === "EgIQAg==") return json(searchChannels); // type=channel
      if (typeof body?.query === "string" && body.query.includes("astely")) return json(misspelled);
      return json(search);
    }
    // InnerTube browse — VL playlists, channel search tab, channels, home
    if (url.includes("/youtubei/v1/browse")) {
      const browseId = body?.browseId ?? "";
      if (browseId.startsWith("VL")) return json(playlist);
      if (body?.params === CHANNEL_SEARCH_TAB_PARAM || typeof body?.query === "string") {
        return json(channelSearch);
      }
      return json(browseId.startsWith("UC") ? channel : search);
    }
    // SSR pages — /feed/trending serves the recorded grid; its category pages
    // serve the public nudge (live-verified logged-out behavior)
    if (url.includes("/feed/trending")) {
      const isCategoryPage = /\/feed\/trending\/(music|gaming|movies)/.test(url);
      return new Response(isCategoryPage ? nudgeHtml : htmlFor(trending), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("youtube.com/@RickAstleyYT")) {
      return new Response(htmlFor(channel), { status: 200, headers: { "Content-Type": "text/html" } });
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
// 1. filter params composition — every option + combinations
// ---------------------------------------------------------------------------

describe("buildSearchParam — the full filter composition table", () => {
  // single options: the recorded menu params, byte-for-byte
  test("upload date: every option matches the recorded menu params", () => {
    expect(buildSearchParam({ uploadDate: "hour" })).toBe("EgIIAQ==");
    expect(buildSearchParam({ uploadDate: "today" })).toBe("EgIIAg==");
    expect(buildSearchParam({ uploadDate: "week" })).toBe("EgIIAw==");
    expect(buildSearchParam({ uploadDate: "month" })).toBe("EgIIBA==");
    expect(buildSearchParam({ uploadDate: "year" })).toBe("EgIIBQ==");
  });

  test("type: every option matches the recorded menu params", () => {
    expect(buildSearchParam({ type: "video" })).toBe("EgIQAQ==");
    expect(buildSearchParam({ type: "shorts" })).toBe("EgIQCQ==");
    expect(buildSearchParam({ type: "channel" })).toBe("EgIQAg==");
    expect(buildSearchParam({ type: "playlist" })).toBe("EgIQAw==");
    expect(buildSearchParam({ type: "movie" })).toBe("EgIQBA==");
  });

  test("duration: every option matches the recorded menu params", () => {
    expect(buildSearchParam({ duration: "short" })).toBe("EgIYBA=="); // Under 3 minutes
    expect(buildSearchParam({ duration: "medium" })).toBe("EgIYBQ=="); // 3 - 20 minutes
    expect(buildSearchParam({ duration: "long" })).toBe("EgIYAg=="); // Over 20 minutes
  });

  test("Features → Live matches the recorded menu param (Filters{8:1})", () => {
    expect(buildSearchParam({ live: true })).toBe("EgJAAQ==");
  });

  test("sort: the four semantics (relevance omitted, views/date/rating enums)", () => {
    expect(buildSearchParam({ sort: "relevance" })).toBe("");
    expect(buildSearchParam({ sort: "views" })).toBe("CAM=");
    expect(buildSearchParam({ sort: "date" })).toBe("CAI=");
    expect(buildSearchParam({ sort: "rating" })).toBe("CAE=");
  });

  test("verbatim (skip autocorrection) matches the recorded originalQueryEndpoint param", () => {
    // recorded in search_misspelled.json: originalQueryEndpoint.searchEndpoint.params
    expect(buildSearchParam({ verbatim: true })).toBe("QgIIAQ==");
  });

  test("empty filters → empty params", () => {
    expect(buildSearchParam({})).toBe("");
    expect(buildSearchParam({ sort: "relevance" })).toBe("");
  });

  // combinations (composition verified live by A-B; the builder table extended)
  test("combined: sort=views + uploadDate=week + type=video", () => {
    expect(buildSearchParam({ sort: "views", uploadDate: "week", type: "video" })).toBe(
      "CAMSBAgDEAE="
    );
  });

  test("combined: sort=views + uploadDate=today + type=video (A-B live-verified string)", () => {
    expect(buildSearchParam({ sort: "views", uploadDate: "today", type: "video" })).toBe(
      "CAMSBAgCEAE="
    );
  });

  test("combined: uploadDate=hour + type=video", () => {
    expect(buildSearchParam({ uploadDate: "hour", type: "video" })).toBe("EgQIARAB");
  });

  test("combined: type=shorts + uploadDate=today", () => {
    expect(buildSearchParam({ type: "shorts", uploadDate: "today" })).toBe("EgQIAhAJ");
  });

  test("combined: sort=views + duration=medium + type=video (the 3-20 minute filter composes)", () => {
    expect(buildSearchParam({ sort: "views", duration: "medium", type: "video" })).toBe(
      "CAMSBBABGAU="
    );
  });

  test("combined: live + uploadDate=today", () => {
    expect(buildSearchParam({ live: true, uploadDate: "today" })).toBe("EgQIAkAB");
  });

  test("combined: all four groups at once", () => {
    expect(
      buildSearchParam({ sort: "views", uploadDate: "today", type: "video", duration: "long" })
    ).toBe("CAMSBggCEAEYAg==");
  });

  test("combined: verbatim rides alongside filters", () => {
    // bytes: 12 02 10 01 (Filters{type=video}) + 42 02 08 01 (SearchParam{8:{1:1}})
    expect(buildSearchParam({ verbatim: true, type: "video" })).toBe("EgIQAUICCAE=");
    expect(
      buildSearchParam({ verbatim: true, sort: "views", uploadDate: "week", type: "video" })
    ).toBe("CAMSBAgDEAFCAggB");
  });
});

// ---------------------------------------------------------------------------
// 2. URL state ↔ filter state round-trips
// ---------------------------------------------------------------------------

describe("search-filters — URL ↔ state round-trips", () => {
  test("every option round-trips through URL entries", () => {
    const singles: Parameters<typeof filtersToEntries>[1][] = [
      { uploadDate: "hour" },
      { uploadDate: "today" },
      { uploadDate: "week" },
      { uploadDate: "month" },
      { uploadDate: "year" },
      { type: "video" },
      { type: "shorts" },
      { type: "channel" },
      { type: "playlist" },
      { type: "movie" },
      { duration: "short" },
      { duration: "medium" },
      { duration: "long" },
      { sort: "date" },
      { sort: "views" },
      { sort: "rating" },
    ];
    for (const state of singles) {
      const entries = filtersToEntries("lofi", state);
      const back = filtersFromParams(Object.fromEntries(entries));
      expect(back.q).toBe("lofi");
      expect(back.state).toEqual(state);
    }
  });

  test("full state round-trips (all groups + verbatim)", () => {
    const state = { uploadDate: "week", type: "video", duration: "medium", sort: "views", verbatim: true };
    const entries = filtersToEntries("lofi", state);
    expect(entries).toEqual([
      ["q", "lofi"],
      ["date", "week"],
      ["type", "video"],
      ["duration", "medium"],
      ["sort", "views"],
      ["verbatim", "1"],
    ]);
    const back = filtersFromParams(Object.fromEntries(entries));
    expect(back.state).toEqual(state);
  });

  test("relevance sort is the default (not emitted in URLs)", () => {
    expect(filtersToEntries("lofi", { sort: "relevance" })).toEqual([["q", "lofi"]]);
    expect(filtersFromParams({ q: "lofi", sort: "relevance" }).state.sort).toBeUndefined();
  });

  test("uploadDate is accepted as the date alias (A-B route contract)", () => {
    const back = filtersFromParams({ q: "lofi", uploadDate: "today" });
    expect(back.state.uploadDate).toBe("today");
    expect(back.state.duration).toBeUndefined();
  });

  test("unknown/garbage values are dropped, never thrown", () => {
    const back = filtersFromParams({
      q: "lofi",
      date: "yesteryear",
      type: "hologram",
      duration: "medium",
      sort: "vibes",
    });
    expect(back.state).toEqual({ duration: "medium" });
  });

  test("searchHref builds shareable filtered URLs", () => {
    expect(searchHref("lofi", {})).toBe("/search?q=lofi");
    expect(searchHref("lofi", { type: "shorts", uploadDate: "today" })).toBe(
      "/search?q=lofi&date=today&type=shorts"
    );
    expect(searchHref("rick astely", { verbatim: true })).toBe(
      "/search?q=rick%20astely&verbatim=1"
    );
  });

  test("withGroupValue — real single-select semantics (group replacement)", () => {
    const state = { uploadDate: "today", type: "video" };
    // same group → replaced
    expect(withGroupValue(state, "uploadDate", "week").uploadDate).toBe("week");
    // other groups untouched
    expect(withGroupValue(state, "uploadDate", "week").type).toBe("video");
    // deselect (the panel passes null when the active option is clicked)
    expect(withGroupValue(state, "uploadDate", null).uploadDate).toBeUndefined();
  });

  test("clearFilters drops every filter (keeps only verbatim)", () => {
    expect(clearFilters({ uploadDate: "today", type: "video", sort: "views", verbatim: true })).toEqual({
      verbatim: true,
    });
  });

  test("hasActiveFilters + appliedFilterChips", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ sort: "relevance" })).toBe(false);
    expect(hasActiveFilters({ duration: "medium" })).toBe(true);
    const chips = appliedFilterChips({ uploadDate: "today", duration: "medium" });
    expect(chips).toEqual([
      { group: "uploadDate", value: "today", label: "Today" },
      { group: "duration", value: "medium", label: "3 - 20 minutes" },
    ]);
  });

  test("the panel vocabulary mirrors the real menu labels", () => {
    const uploadDate = FILTER_GROUPS.find((g) => g.id === "uploadDate")!;
    expect(uploadDate.options.map((o) => o.label)).toEqual([
      "Last hour",
      "Today",
      "This week",
      "This month",
      "This year",
    ]);
    const duration = FILTER_GROUPS.find((g) => g.id === "duration")!;
    expect(duration.options.map((o) => o.label)).toEqual([
      "Under 3 minutes",
      "3 - 20 minutes",
      "Over 20 minutes",
    ]);
    const sort = FILTER_GROUPS.find((g) => g.id === "sort")!;
    expect(sort.options.map((o) => o.label)).toEqual([
      "Relevance",
      "Upload date",
      "View count",
      "Rating",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. trending categories
// ---------------------------------------------------------------------------

describe("trending categories", () => {
  test("the real youtube.com category set (Now / Music / Gaming / Movies)", () => {
    expect(TRENDING_CATEGORIES.map((c) => c.key)).toEqual(["Now", "Music", "Gaming", "Movies"]);
  });

  test("normalizeTrendingCategory — unknown → Now", () => {
    expect(normalizeTrendingCategory(null)).toBe("Now");
    expect(normalizeTrendingCategory("News")).toBe("Now");
    expect(normalizeTrendingCategory("Music")).toBe("Music");
  });

  test("category paths are the real semantic trending URLs", () => {
    expect(trendingCategoryPath("Now")).toBe("/feed/trending");
    expect(trendingCategoryPath("Music")).toBe("/feed/trending/music");
    expect(trendingCategoryPath("Gaming")).toBe("/feed/trending/gaming");
    expect(trendingCategoryPath("Movies")).toBe("/feed/trending/movies");
  });

  test("extractTrendingChips parses the chip-bar shape (bp params per category)", () => {
    const chips = extractTrendingChips(load("trending_chips_synth"));
    expect(chips).toEqual([
      { label: "Music", params: "4gSMBgpzZWFyY2gtbXVzaWM%3D" },
      { label: "Gaming", params: "4gSMBgpzZWFyY2gtZ2FtaW5n%3D" },
      { label: "Movies", params: "4gSMBgpzZWFyY2gtbW92aWVz%3D" },
    ]);
    expect(chipParamsFor(chips, "Music")).toBe("4gSMBgpzZWFyY2gtbXVzaWM%3D");
    expect(chipParamsFor(chips, "Now")).toBeNull(); // no chip → semantic path takes over
  });

  test("the recorded public trending page carries no browse-endpoint chips (home-feed shape)", () => {
    // honest ground truth: ssr_trending.json is the FEwhat_to_watch redirect
    // capture — its chips are continuation tokens, not category endpoints
    expect(extractTrendingChips(load("ssr_trending"))).toEqual([]);
  });

  test("GET /api/trending — Now maps the SSR grid (source: trending)", async () => {
    const res = await trendingRoute(new Request("http://localhost/api/trending"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.category).toBe("Now");
    expect(data.source).toBe("trending");
    expect(data.videos.length).toBeGreaterThan(30); // the recorded grid
    const ssr = upstream.recorded.find((r) => r.url.includes("/feed/trending") && !r.url.includes("/feed/trending/"));
    expect(ssr?.url).toContain("/feed/trending");
  });

  test("GET /api/trending?category=Music — nudge page → search-backed fallback (source: search)", async () => {
    const res = await trendingRoute(new Request("http://localhost/api/trending?category=Music"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.category).toBe("Music");
    expect(data.source).toBe("search");
    expect(data.videos.length).toBeGreaterThan(0);
    // the SSR category page was hit first (the real URL)
    const ssr = upstream.recorded.find((r) => r.url.includes("/feed/trending/music"));
    expect(ssr).toBeTruthy();
    // then the popular-this-week search: sort=views + week + type=video
    const searchCall = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/search") && r.body?.query === "music"
    );
    expect(searchCall?.body.params).toBe("CAMSBAgDEAE=");
  });

  test("unknown category normalizes to Now (no dead links from old URLs)", async () => {
    const res = await trendingRoute(new Request("http://localhost/api/trending?category=News"));
    const data = (await res.json()) as any;
    expect(data.category).toBe("Now");
  });
});

// ---------------------------------------------------------------------------
// 4. search parity mappers (correction, count, playlists)
// ---------------------------------------------------------------------------

describe("search parity mappers", () => {
  test("showingResultsForRenderer → the correction (recorded misspelled search)", () => {
    const correction = mapSearchCorrection(load("search_misspelled"));
    expect(correction).toEqual({
      kind: "showingResultsFor",
      correctedQuery: "rick astley never gonna",
      originalQuery: "rick astely never gonna",
    });
  });

  test("didYouMeanRenderer → the 'Did you mean' variant", () => {
    const response = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        didYouMeanRenderer: {
                          correctedQuery: { runs: [{ text: "lofi " }, { text: "hip hop", italics: true }] },
                          correctedQueryEndpoint: { searchEndpoint: { query: "lofi hip hop" } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    expect(mapSearchCorrection(response)).toEqual({
      kind: "didYouMean",
      correctedQuery: "lofi hip hop",
      originalQuery: null,
    });
  });

  test("no correction renderers → null (regular searches)", () => {
    expect(mapSearchCorrection(load("search_lofi"))).toBeNull();
  });

  test("resultCountText from estimatedResults (recorded: 3839607)", () => {
    expect(searchResultCountText(load("search_misspelled"))).toBe("About 3,839,607 results");
    expect(searchResultCountText(load("search_lofi"))).toBe("About 6,457,504 results");
    expect(searchResultCountText({})).toBeNull();
  });

  test("playlist lockups → PlaylistLiteDTO (recorded type=playlist search: 20 playlists)", () => {
    const playlists = mapSearchPlaylists(load("search_playlists_lofi"));
    expect(playlists.length).toBe(20);
    const first = playlists[0];
    expect(first.id).toBe("PLKF4F4n54F99H4YEa9bBmNC-xCXmNaW5B");
    expect(first.title).toBe("Japanese Lofi for Coding 💻✨ Deep Focus & Flow-State");
    expect(first.videoCountText).toBe("52 videos");
    expect(first.videoCount).toBe(52);
    expect(first.thumbnailUrl).toContain("i.ytimg.com/vi/");
    expect(first.channelName).toBe("Sorameji Lofi");
    expect(first.isMix).toBe(false);
  });

  test("regular search results may carry the real mix lockup (RD… radio)", () => {
    // search_lofi (a regular, unfiltered query) includes YouTube's own mix
    // result for the query — RDrFZHOHl… — exactly like youtube.com
    const playlists = mapSearchPlaylists(load("search_lofi"));
    expect(playlists).toHaveLength(1);
    expect(playlists[0].id).toBe("RDrFZHOHl-L8A");
    expect(playlists[0].isMix).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. /api/search route — filters, typed results, parity fields
// ---------------------------------------------------------------------------

describe("GET /api/search — filters + typed result cards", () => {
  test("type=playlist → playlist result cards + the playlist params upstream", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi&type=playlist"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlists.length).toBe(12); // capped at 12 cards
    expect(data.playlists[0].videoCountText).toBe("52 videos");
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("EgIQAw==");
  });

  test("type=channel → channel cards with description + video count metadata", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi&type=channel"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channels.length).toBeGreaterThan(3); // channel-type searches are not capped at the mixed-row limit
    const first = data.channels[0];
    expect(first.id.startsWith("UC")).toBe(true);
    expect(typeof first.description).toBe("string");
    expect(typeof first.subscriberCountText).toBe("string");
  });

  test("live=1 → live-filtered results with isLive + watching counts", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q=live&live=1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.videos.every((v: any) => v.isLive)).toBe(true);
    expect(data.videos.some((v: any) => /watching/.test(v.viewsText ?? ""))).toBe(true);
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("EgJAAQ=="); // the recorded Features→Live menu param
  });

  test("misspelled query → the correction + result count in the response", async () => {
    const res = await searchRoute(
      new Request("http://localhost/api/search?q=rick%20astely%20never%20gonna")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.correction).toEqual({
      kind: "showingResultsFor",
      correctedQuery: "rick astley never gonna",
      originalQuery: "rick astely never gonna",
    });
    expect(data.resultCountText).toBe("About 3,839,607 results");
  });

  test("combined filters compose upstream (sort=views + date=week + type=video)", async () => {
    await searchRoute(
      new Request("http://localhost/api/search?q=lofi&sort=views&date=week&type=video")
    );
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("CAMSBAgDEAE=");
  });

  test("date=… alias and uploadDate=… are both accepted", async () => {
    await searchRoute(new Request("http://localhost/api/search?q=lofi&date=today"));
    let call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("EgIIAg==");
    upstream.recorded.length = 0;
    clearCache();
    await searchRoute(new Request("http://localhost/api/search?q=lofi&uploadDate=today"));
    call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.params).toBe("EgIIAg==");
  });
});

// ---------------------------------------------------------------------------
// 6. in-channel search
// ---------------------------------------------------------------------------

describe("in-channel search", () => {
  test("the channel's own Search tab params are extracted from its response", () => {
    // recorded in channel_rickastley.json: expandableTabRenderer title "Search"
    expect(channelSearchTabParams(load("channel_rickastley"))).toBe(CHANNEL_SEARCH_TAB_PARAM);
    expect(CHANNEL_SEARCH_TAB_PARAM).toBe("EgZzZWFyY2jyBgQKAloA");
    expect(channelSearchTabParams({})).toBeNull();
  });

  test("GET /api/channel/[handle]/search — browse with the search tab params + query", async () => {
    const res = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search?q=never"),
      { params: Promise.resolve({ handle: "@RickAstleyYT" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.query).toBe("never");
    expect(data.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(data.videos.length).toBeGreaterThan(20);
    // channel-scoped: every result is Rick Astley's own upload
    expect(
      data.videos.some((v: any) => /Rick Astley/.test(v.channel.name))
    ).toBe(true);
    const browse = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/browse") && typeof r.body?.query === "string"
    );
    expect(browse?.body.browseId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(browse?.body.params).toBe(CHANNEL_SEARCH_TAB_PARAM);
    expect(browse?.body.query).toBe("never");
  });

  test("missing q → 400, no upstream call", async () => {
    const res = await channelSearchRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/search"),
      { params: Promise.resolve({ handle: "@RickAstleyYT" }) }
    );
    expect(res.status).toBe(400);
    expect(upstream.recorded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. the Live surface + the public playlist page
// ---------------------------------------------------------------------------

describe("GET /api/live — the Live surface", () => {
  test("live-scoped searches (the Features→Live param) merged, all live", async () => {
    const res = await liveRoute(new Request("http://localhost/api/live"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.videos.every((v: any) => v.isLive)).toBe(true);
    const ids = data.videos.map((v: any) => v.id);
    expect(new Set(ids).size).toBe(ids.length); // de-duplicated across the query set
    // every live-scoped search carried the recorded Live filter param
    const liveSearches = upstream.recorded.filter(
      (r) => r.url.includes("/youtubei/v1/search") && r.body?.params === "EgJAAQ=="
    );
    expect(liveSearches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("GET /api/playlist/[id] — the public playlist page", () => {
  test("browse VL… → header + the video grid (recorded playlist)", async () => {
    const res = await playlistRoute(
      new Request(
        "http://localhost/api/playlist/PLKF4F4n54F99H4YEa9bBmNC-xCXmNaW5B"
      ),
      { params: Promise.resolve({ id: "PLKF4F4n54F99H4YEa9bBmNC-xCXmNaW5B" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlist.title).toBe("Japanese Lofi for Coding 💻✨ Deep Focus & Flow-State");
    expect(data.playlist.channelName).toBe("Sorameji Lofi");
    expect(data.playlist.videoCountText).toBe("52 videos");
    expect(data.videos.length).toBeGreaterThan(40);
    const browse = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse?.body.browseId).toBe("VLPLKF4F4n54F99H4YEa9bBmNC-xCXmNaW5B");
  });

  test("invalid playlist id → 404, no upstream call", async () => {
    const res = await playlistRoute(
      new Request("http://localhost/api/playlist/not-a-playlist"),
      { params: Promise.resolve({ id: "not-a-playlist" }) }
    );
    expect(res.status).toBe(404);
    expect(upstream.recorded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. sidebar EXPLORE wiring destinations
// ---------------------------------------------------------------------------

describe("categoryDestination — sidebar EXPLORE links land on real-data pages", () => {
  test("Music / Gaming → the trending category pages", () => {
    expect(categoryDestination("Music")).toBe("/trending?category=Music");
    expect(categoryDestination("Gaming")).toBe("/trending?category=Gaming");
  });

  test("Live → the Live surface", () => {
    expect(categoryDestination("Live")).toBe("/explore/live");
  });

  test("the rest → scoped search with the category pre-applied", () => {
    expect(categoryDestination("News")).toBe("/search?q=News&type=video");
    expect(categoryDestination("Podcasts")).toBe("/search?q=Podcasts&type=video");
    expect(categoryDestination("Cooking")).toBe("/search?q=Cooking&type=video");
  });
});
