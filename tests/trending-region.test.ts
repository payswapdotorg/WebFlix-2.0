/// <reference types="bun-types" />
/**
 * WFX2-P23-C tests — the trending REGION family (G7):
 *  - the static region map + the normalize law (invalid → the egress default)
 *  - the region-parameterized read: the SSR path carries ?gl=<REGION> (the
 *    page's own query param — measured) and the public-mode search fallback
 *    carries context.client.gl (measured — US/GB/JP reshape the ranked set)
 *  - the cache separates regions (never a cross-region serve)
 *  - the route threads ?region= and answers the region it read
 *  - the persisted region store (the channel-prefs idiom)
 * Fixture upstream via the test-only setUpstream() seam — never the network.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { GET as trendingRoute } from "@/app/api/trending/route";
import { getTrendingPage } from "@/lib/youtube/trending-categories";
import {
  TRENDING_REGIONS,
  TRENDING_REGION_CODES,
  normalizeTrendingRegion,
  trendingRegionName,
} from "@/lib/youtube/trending-regions";
import { createTrendingRegionStore } from "@/app/trending/region-store";

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/** Fixture upstream: SSR pages + the search fallback, everything recorded. */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const gridHtml = (ids: string[]) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ` +
    JSON.stringify({
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                selected: true,
                content: {
                  richGridRenderer: {
                    contents: ids.map((id) => ({
                      richItemRenderer: {
                        content: {
                          videoRenderer: {
                            videoId: id,
                            title: { runs: [{ text: `Trending ${id}` }] },
                            viewCount: {
                              videoViewCountRenderer: {
                                shortViewCount: { simpleText: "1.2M views" },
                              },
                            },
                          },
                        },
                      },
                    })),
                  },
                },
              },
            },
          ],
        },
      },
    }) +
    `;</script></body></html>`;
  const nudgeHtml =
    `<!doctype html><html><head></head><body><script>var ytInitialData = ` +
    `{"responseContext":{},"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"selected":true,"content":{"richGridRenderer":{"contents":[]}}}}]}}};` +
    `</script></body></html>`;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/youtubei/v1/search")) {
      return json({
        contents: {
          twoColumnSearchResultsRenderer: {
            primaryContents: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          videoRenderer: {
                            videoId: "searchregion01",
                            title: { runs: [{ text: "Popular this week" }] },
                            viewCount: {
                              videoViewCountRenderer: {
                                shortViewCount: { simpleText: "900K views" },
                              },
                            },
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
      });
    }
    // SSR pages — the plain path serves a grid; ?gl= paths serve region-tagged
    // grids so the region separation is observable; category paths the nudge
    if (url.includes("/feed/trending")) {
      const isCategoryPage = /\/feed\/trending\/(music|gaming|movies)/.test(url);
      if (isCategoryPage) return new Response(nudgeHtml, { status: 200, headers: { "Content-Type": "text/html" } });
      const glMatch = url.match(/[?&]gl=([A-Z]{2})/);
      const gl = glMatch ? glMatch[1] : "DEFAULT";
      return new Response(gridHtml([`region${gl}`]), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
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

describe("the region static map (the house static-map pattern)", () => {
  test("the map carries the YouTube Content-location country set (2-letter codes)", () => {
    expect(TRENDING_REGIONS.length).toBeGreaterThanOrEqual(100);
    for (const r of TRENDING_REGIONS) {
      expect(r.code).toMatch(/^[A-Z]{2}$/);
      expect(r.name.length).toBeGreaterThan(2);
    }
    expect(TRENDING_REGION_CODES).toContain("US");
    expect(TRENDING_REGION_CODES).toContain("GB");
    expect(TRENDING_REGION_CODES).toContain("JP");
    expect(TRENDING_REGION_CODES).toContain("HK");
  });

  test("normalizeTrendingRegion: valid passes (case-insensitive), invalid/unset → null", () => {
    expect(normalizeTrendingRegion("GB")).toBe("GB");
    expect(normalizeTrendingRegion("jp")).toBe("JP");
    expect(normalizeTrendingRegion("XX")).toBeNull();
    expect(normalizeTrendingRegion("")).toBeNull();
    expect(normalizeTrendingRegion(null)).toBeNull();
    expect(normalizeTrendingRegion(undefined)).toBeNull();
    expect(normalizeTrendingRegion("12")).toBeNull();
    expect(normalizeTrendingRegion("USA")).toBeNull();
  });

  test("trendingRegionName resolves the map's own name", () => {
    expect(trendingRegionName("GB")).toBe("United Kingdom");
    expect(trendingRegionName("us")).toBe("United States");
    // unknown codes fall back to the raw upper-case (never a fake name)
    expect(trendingRegionName("ZZ")).toBe("ZZ");
  });
});

describe("getTrendingPage — the region-parameterized read", () => {
  test("the SSR read carries ?gl=<REGION> (the page's own query param — measured)", async () => {
    const page = await getTrendingPage("Now", "GB");
    expect(page.source).toBe("trending");
    expect(page.region).toBe("GB");
    // the region-shaped grid served (the fixture tags its ids by gl)
    expect(page.videos[0]?.id).toBe("regionGB");
    const ssr = upstream.recorded.find(
      (r) => r.url.includes("/feed/trending") && !r.url.includes("/feed/trending/"),
    );
    expect(ssr?.url).toContain("gl=GB");
    expect(ssr?.url).toContain("hl=en");
  });

  test("no region → the pre-P23-C read (no ?gl= — the egress default)", async () => {
    const page = await getTrendingPage("Now", null);
    expect(page.region).toBeNull();
    const ssr = upstream.recorded.find(
      (r) => r.url.includes("/feed/trending") && !r.url.includes("/feed/trending/"),
    );
    expect(ssr?.url).not.toContain("gl=");
  });

  test("invalid region values normalize to the egress default (no dead ?gl=XX)", async () => {
    const page = await getTrendingPage("Now", "XX");
    expect(page.region).toBeNull();
    const ssr = upstream.recorded.find(
      (r) => r.url.includes("/feed/trending") && !r.url.includes("/feed/trending/"),
    );
    expect(ssr?.url).not.toContain("gl=");
  });

  test("regions never cross-serve (the cache key carries the region path)", async () => {
    await getTrendingPage("Now", "US");
    await getTrendingPage("Now", "JP");
    const us = await getTrendingPage("Now", "US");
    expect(us.videos[0]?.id).toBe("regionUS");
    const jp = await getTrendingPage("Now", "JP");
    expect(jp.videos[0]?.id).toBe("regionJP");
  });

  test("the public-mode search fallback carries the region (context.client.gl — measured)", async () => {
    const page = await getTrendingPage("Music", "GB");
    expect(page.source).toBe("search");
    expect(page.region).toBe("GB");
    const searchCall = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/search") && r.body?.query === "music",
    );
    expect(searchCall?.body?.context?.client?.gl).toBe("GB");
    expect(page.videos.length).toBeGreaterThan(0);
  });

  test("the fallback without a region sends no gl override", async () => {
    await getTrendingPage("Music", null);
    const searchCall = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/search") && r.body?.query === "music",
    );
    expect(searchCall?.body?.context?.client?.gl).toBe("US"); // the WEB default
  });
});

describe("GET /api/trending?region= — the route threading", () => {
  test("?region=GB reads + answers the region it read", async () => {
    const res = await trendingRoute(
      new Request("http://localhost/api/trending?region=GB"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.region).toBe("GB");
    const ssr = upstream.recorded.find(
      (r) => r.url.includes("/feed/trending") && !r.url.includes("/feed/trending/"),
    );
    expect(ssr?.url).toContain("gl=GB");
  });

  test("an invalid region → the egress default (region: null in the response)", async () => {
    const res = await trendingRoute(
      new Request("http://localhost/api/trending?region=XX"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.region).toBeNull();
  });

  test("no region param → the pre-P23-C response shape (region: null)", async () => {
    const res = await trendingRoute(new Request("http://localhost/api/trending"));
    const data = (await res.json()) as any;
    expect(data.region).toBeNull();
    expect(data.category).toBe("Now");
  });
});

describe("the region pref store (the channel-prefs idiom)", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  test("setRegion persists under wf-trending-region; a fresh store rehydrates", async () => {
    const storage = memory();
    const store = createTrendingRegionStore(storage);
    expect(store.getState().region).toBeNull();
    store.getState().setRegion("GB");
    expect(store.getState().region).toBe("GB");
    // persisted shape survives a fresh store
    const store2 = createTrendingRegionStore(storage);
    await store2.persist.rehydrate();
    expect(store2.getState().region).toBe("GB");
  });

  test("invalid stored values drop on rehydrate (only real codes survive)", async () => {
    const storage = memory();
    storage.setItem(
      "wf-trending-region",
      JSON.stringify({ state: { region: "ZZ" } }),
    );
    const store = createTrendingRegionStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().region).toBeNull();
  });

  test("setRegion(null) clears (back to the egress default)", async () => {
    const storage = memory();
    const store = createTrendingRegionStore(storage);
    store.getState().setRegion("JP");
    store.getState().setRegion(null);
    expect(store.getState().region).toBeNull();
  });
});
