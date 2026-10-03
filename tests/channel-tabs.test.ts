/// <reference types="bun-types" />
/**
 * WFX2-B-S tests — the channel page's deep parity surfaces:
 *  - /api/channel/[handle]/tab?tab=… — per-tab browse with the response-own
 *    tab params (asserted on the recorded upstream bodies);
 *  - the tab mappers (playlists lockups, community posts, About panel,
 *    membership/join detection) against the sanitized real captures;
 *  - the About panel continuation mechanism (the channel home's
 *    engagement-panel token → browse {continuation} → aboutChannelViewModel);
 *  - the Join honest degrade (public mode: YouTube's own logged-out Join
 *    modal state, never fabricated tiers);
 *  - the walled tab honest degrade ({tab, walled: true} — HTTP 200).
 *
 * WFX2-P6-CH — the Videos tab's sort chips:
 *  - mapChannelSortChips: both live-verified chip-bar shapes (the 2026
 *    chipViewModel.tapCommand.innertubeCommand.continuationCommand.token
 *    form + the legacy chipCloudChipRenderer fallback), label-dedup, dead
 *    chips never surface, no chip bar → [];
 *  - the wiring: ?tab=videos surfaces the payload's own chip bar;
 *    ?tab=videos&chip=<token> refetches via browse {continuation} (the
 *    re-marked bar + the sorted grid; each chip token its own cache entry);
 *    absent chip bar → sortChips stays absent (honest omission);
 *  - the page DTO (/api/channel/[handle]) carries the videos browse's chips
 *    and the BARE handle (the doubled-@ fix).
 *
 * Fixture bytes via the test-only setUpstream() seam (lane law — never the
 * network).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { GET as tabRoute } from "@/app/api/channel/[handle]/tab/route";
import { GET as joinRoute } from "@/app/api/channel/[handle]/join/route";
import { GET as channelRoute } from "@/app/api/channel/[handle]/route";
import {
  mapPlaylistLockup,
  mapBackstagePost,
  mapCommunityPosts,
  mapChannelPlaylists,
  mapAboutChannel,
  extractRedirectTarget,
  aboutContinuationToken,
  tabParamFromResponse,
  mapChannelSortChips,
} from "@/lib/youtube/channel-tabs";
import { channelJoinable, channelTabsFromResponse } from "@/lib/youtube/mappers";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

interface Recorded {
  url: string;
  body: any;
}

function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const channel = load("channel_rickastley");
  const playlists = load("channel_playlists_rickastley");
  const posts = load("channel_posts_rickastley");
  const about = load("channel_about_rickastley");
  const shorts = load("channel_shorts_rickastley");

  const htmlFor = (data: unknown) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script></body></html>`;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/youtubei/v1/browse")) {
      // the About panel continuation fetch
      if (body?.continuation) {
        return json(about);
      }
      const params = String(body?.params ?? "");
      if (params.includes("EglwbGF5bGlzdH")) return json(playlists);
      if (params.includes("EgVwb3N0c")) return json(posts);
      if (params.includes("EgZzaG9ydH")) return json(shorts);
      // videos tab + channel home
      if (params.includes("EgZ2aWRlb3M") || params === "") return json(channel);
      return json(channel);
    }
    // SSR channel page (the @handle resolution path)
    if (url.includes("youtube.com/@")) {
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

const tabCtx = (handle: string) => ({ params: Promise.resolve({ handle }) });

// ---------------------------------------------------------------------------
// pure mappers (sanitized real captures)
// ---------------------------------------------------------------------------

describe("channel tab mappers", () => {
  test("playlists tab: playlist lockups map (id, title, N videos badge, thumbnail)", () => {
    const playlists = load("channel_playlists_rickastley");
    const items = mapChannelPlaylists(playlists);
    expect(items.length).toBe(8);
    expect(items[0]).toMatchObject({
      id: "PLlaN88a7y2_qHDbY9eQbuNTAuEJUSEeuu",
      title: "Rick Astley Live at The O2",
      videoCount: 3,
      videoCountText: "3 videos",
    });
    expect(items[0].thumbnailUrl).toMatch(/^https:\/\//);
  });

  test("mapPlaylistLockup: null on missing contentId (never a guessed row)", () => {
    expect(mapPlaylistLockup({ contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST" })).toBeNull();
  });

  test("community tab: backstage posts map (text, likes label, replies)", () => {
    const posts = load("channel_posts_rickastley");
    const items = mapCommunityPosts(posts);
    expect(items.length).toBe(5);
    expect(items[0].id).toBe("Ugkx6HzKUems4roLJrhsxgkRwC0sz_cHiVHX");
    expect(items[0].text).toContain("We’re excited to announce");
    expect(items[0].likesText).toBe("4.4K likes");
    expect(items[0].authorName).toBe("Rick Astley");
  });

  test("mapBackstagePost: null without postId", () => {
    expect(mapBackstagePost({ contentText: { runs: [{ text: "x" }] } })).toBeNull();
  });

  test("about panel: aboutChannelViewModel maps (stats, country, links, redirect unwrap)", () => {
    const about = load("channel_about_rickastley");
    const dto = mapAboutChannel(about);
    expect(dto).not.toBeNull();
    expect(dto!.joinedDateText).toBe("Joined Feb 1, 2015");
    expect(dto!.viewCountText).toBe("2,570,271,276 views");
    expect(dto!.subscriberCountText).toBe("4.55M subscribers");
    expect(dto!.videoCountText).toBe("437 videos");
    expect(dto!.country).toBe("United Kingdom");
    expect(dto!.links.length).toBe(11);
    const link = dto!.links[0];
    expect(link.title).toBe("Swinging Christmas tickets");
    expect(link.url).toBe("https://lnk.to/RASC26"); // de-tokenized from the /redirect?q= form
  });

  test("extractRedirectTarget: unwraps /redirect?q= — null for direct urls", () => {
    expect(extractRedirectTarget("https://www.youtube.com/redirect?q=https%3A%2F%2Flnk.to%2FRASC26&x=1")).toBe(
      "https://lnk.to/RASC26"
    );
    expect(extractRedirectTarget("https://example.com/direct")).toBeNull();
  });

  test("the channel home's engagement panel carries the About continuation token", () => {
    const channel = load("channel_rickastley");
    const token = aboutContinuationToken(channel);
    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(20);
  });

  test("tabParamFromResponse: the response-own tab params win (Posts)", () => {
    const channel = load("channel_rickastley");
    expect(tabParamFromResponse(channel, "community")).toBe("EgVwb3N0c_IGBAoCSgA%3D");
    expect(tabParamFromResponse(channel, "videos")).toBe("EgZ2aWRlb3PyBgQKAjoA");
    expect(tabParamFromResponse(channel, "about")).toBeNull();
  });

  test("channelTabsFromResponse: the tab family in YouTube's order (+About)", () => {
    const channel = load("channel_rickastley");
    const tabs = channelTabsFromResponse(channel);
    expect(tabs).toEqual(["home", "videos", "shorts", "live", "playlists", "community", "about"]);
  });

  test("channelJoinable: false for a channel without the Join button renderer", () => {
    const channel = load("channel_rickastley");
    expect(channelJoinable(channel)).toBe(false);
  });

  test("channelJoinable: true when the header actions row carries a Join button", () => {
    const joinable = {
      pageHeaderRenderer: {
        content: {
          pageHeaderViewModel: {
            actions: {
              flexibleActionsViewModel: {
                actionsRows: [
                  {
                    actions: [
                      { buttonViewModel: { title: "Subscribe" } },
                      { buttonViewModel: { title: "Join" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    };
    expect(channelJoinable(joinable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the tab route (lazy-load per tab)
// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle]/tab — per-tab browse", () => {
  test("tab=videos: browse with the response-own Videos tab params; videos mapped", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("videos");
    expect(data.videos.length).toBeGreaterThan(0);
    const browse = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/browse") && typeof r.body?.params === "string"
    );
    expect(browse).toBeDefined();
    expect(browse!.body.params).toBe("EgZ2aWRlb3PyBgQKAjoA");
  });

  test("tab=playlists: the playlists-tab lockups serve", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=playlists"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlists.length).toBe(8);
    expect(data.playlists[0].id).toBe("PLlaN88a7y2_qHDbY9eQbuNTAuEJUSEeuu");
  });

  test("tab=community: the Posts tab (backstagePostRenderer rows)", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("community");
    expect(data.posts.length).toBe(5);
    expect(data.posts[0].likesText).toBe("4.4K likes");
    const browse = upstream.recorded.filter(
      (r) => r.url.includes("/youtubei/v1/browse") && r.body?.params
    );
    expect(browse.some((r) => String(r.body.params).includes("EgVwb3N0c"))).toBe(true);
  });

  test("tab=shorts: the Shorts tab lockups serve", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=shorts"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("shorts");
    expect(data.shorts.length).toBeGreaterThan(0);
  });

  test("tab=about: the engagement-panel continuation → aboutChannelViewModel", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=about"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("about");
    expect(data.about.joinedDateText).toBe("Joined Feb 1, 2015");
    expect(data.about.viewCountText).toBe("2,570,271,276 views");
    expect(data.about.links.length).toBe(11);
    // the continuation fetch actually happened (browse {continuation})
    const cont = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/browse") && r.body?.continuation);
    expect(cont).toBeDefined();
    expect(typeof cont!.body.continuation).toBe("string");
  });

  test("unknown tab → 400", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=nonsense"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(400);
  });

  test("a second identical tab read is cached (one resolve + one tab browse)", async () => {
    await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=playlists"),
      tabCtx("@RickAstleyYT")
    );
    const afterFirst = upstream.recorded.length;
    const res2 = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=playlists"),
      tabCtx("@RickAstleyYT")
    );
    expect(res2.status).toBe(200);
    expect(upstream.recorded.length).toBe(afterFirst); // nothing new upstream
  });

  test("walled tab (upstream dead) → HTTP 200 {tab, walled: true} — the honest degrade", async () => {
    clearCache();
    setUpstream(async () => new Response("not found", { status: 404 }));
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=playlists"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("playlists");
    expect(data.walled).toBe(true);
    expect(data.playlists).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WFX2-P6-CH — the Videos tab's sort chips
// ---------------------------------------------------------------------------

/**
 * A SYNTHETIC chip bar injected on the real sanitized capture — the
 * live-verified 2026 shape (richGridRenderer.header.chipBarViewModel
 * .chips[].chipViewModel with tapCommand.innertubeCommand
 * .continuationCommand.token; see ChannelSortChipDTO in types.ts). The
 * tokens are shape-real placeholders ("SORT_LATEST" family); at runtime the
 * tokens come from the live payload itself.
 */
function withChipBar(base: any, selected: string): any {
  const clone = JSON.parse(JSON.stringify(base));
  const chips = ["Latest", "Popular", "Oldest"].map((label) => ({
    chipViewModel: {
      text: label,
      selected: label === selected,
      tapCommand: {
        innertubeCommand: {
          continuationCommand: { token: `SORT_${label.toUpperCase()}` },
        },
      },
    },
  }));
  const tabs = clone.contents.twoColumnBrowseResultsRenderer.tabs;
  const videosTab = tabs.find((t: any) => t?.tabRenderer?.title === "Videos");
  videosTab.tabRenderer.content = {
    richGridRenderer: { header: { chipBarViewModel: { chips } }, contents: [] },
  };
  return clone;
}

/** The real capture with the upstream header's handle text replaced (the
 * doubled-@ forms the live bug carried: "@name" / "@/name"). */
function withUpstreamHandle(base: any, handle: string): any {
  const clone = JSON.parse(JSON.stringify(base));
  const rows =
    clone.header.pageHeaderRenderer.content.pageHeaderViewModel.metadata.contentMetadataViewModel
      .metadataRows;
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      if (String(part?.text?.content ?? "").startsWith("@")) {
        part.text.content = handle;
        return clone;
      }
    }
  }
  return clone;
}

describe("mapChannelSortChips (WFX2-P6-CH — both chip-bar shapes)", () => {
  test("the 2026 chipViewModel shape maps: label, token, selected marker, document order", () => {
    const response = withChipBar(load("channel_rickastley"), "Latest");
    const chips = mapChannelSortChips(response);
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.label)).toEqual(["Latest", "Popular", "Oldest"]);
    expect(chips[0]).toMatchObject({ label: "Latest", token: "SORT_LATEST", selected: true });
    expect(chips[1]).toMatchObject({ label: "Popular", token: "SORT_POPULAR", selected: false });
    expect(chips[2]).toMatchObject({ label: "Oldest", token: "SORT_OLDEST", selected: false });
  });

  test("the legacy chipCloudChipRenderer shape maps (isSelected marker, runs text)", () => {
    const legacy = {
      feedFilterChipBarRenderer: {
        contents: [
          {
            chipCloudChipRenderer: {
              text: { simpleText: "Latest" },
              isSelected: true,
              navigationEndpoint: { continuationCommand: { token: "LEG_LATEST" } },
            },
          },
          {
            chipCloudChipRenderer: {
              text: { runs: [{ text: "Popular" }] },
              navigationEndpoint: { continuationCommand: { token: "LEG_POPULAR" } },
            },
          },
        ],
      },
    };
    expect(mapChannelSortChips(legacy)).toEqual([
      { label: "Latest", token: "LEG_LATEST", selected: true },
      { label: "Popular", token: "LEG_POPULAR", selected: false },
    ]);
  });

  test("dead chips never surface (no token / no label) + label dedup across shapes", () => {
    const response = {
      richGridRenderer: {
        header: {
          chipBarViewModel: {
            chips: [
              {
                chipViewModel: {
                  text: "Latest",
                  selected: true,
                  tapCommand: {
                    innertubeCommand: { continuationCommand: { token: "T1" } },
                  },
                },
              },
              { chipViewModel: { text: "Popular" } }, // no token → dead
              {
                chipViewModel: {
                  // no label → dead
                  tapCommand: { innertubeCommand: { continuationCommand: { token: "T2" } } },
                },
              },
              {
                chipViewModel: {
                  text: "Latest", // duplicate label → deduped
                  tapCommand: {
                    innertubeCommand: { continuationCommand: { token: "T3" } },
                  },
                },
              },
            ],
          },
        },
      },
    };
    expect(mapChannelSortChips(response)).toEqual([
      { label: "Latest", token: "T1", selected: true },
    ]);
  });

  test("no chip bar → [] (the honest empty — the UI hides the chip row)", () => {
    expect(mapChannelSortChips(load("channel_rickastley"))).toEqual([]);
    expect(mapChannelSortChips({})).toEqual([]);
    expect(mapChannelSortChips({ contents: { twoColumnBrowseResultsRenderer: { tabs: [] } } })).toEqual([]);
  });
});

describe("GET /api/channel/[handle]/tab — the sort-chip wiring (WFX2-P6-CH)", () => {
  /** Chip-bearing upstream: the videos browse answers the chip bar; a
   * continuation answers the re-marked bar (the sorted grid). */
  function chipFixtureUpstream() {
    const recorded: Recorded[] = [];
    const channel = load("channel_rickastley");
    const videosLatest = withChipBar(channel, "Latest");
    const videosPopular = withChipBar(channel, "Popular");

    const htmlFor = (data: unknown) =>
      `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
        data
      )};</script></body></html>`;

    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      recorded.push({ url, body });
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      if (url.includes("/youtubei/v1/browse")) {
        // the clicked chip's own continuation (browse {continuation})
        if (body?.continuation) {
          return json(String(body.continuation) === "SORT_POPULAR" ? videosPopular : videosLatest);
        }
        const params = String(body?.params ?? "");
        if (params.startsWith("EgZ2aWRlb3")) return json(videosLatest); // the videos tab
        return json(channel); // channel home
      }
      // SSR channel page (the @handle resolution path)
      if (url.includes("youtube.com/@")) {
        return new Response(htmlFor(channel), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    };
    return { impl, recorded };
  }

  let chipUpstream: ReturnType<typeof chipFixtureUpstream>;

  beforeEach(() => {
    chipUpstream = chipFixtureUpstream();
    setUpstream(chipUpstream.impl);
  });

  test("?tab=videos surfaces the payload's own chip bar (Latest selected on the default fetch)", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("videos");
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.sortChips).toHaveLength(3);
    expect(data.sortChips[0]).toMatchObject({ label: "Latest", token: "SORT_LATEST", selected: true });
    expect(data.sortChips[1]).toMatchObject({ label: "Popular", token: "SORT_POPULAR", selected: false });
  });

  test("?tab=videos&chip=SORT_POPULAR — browse {continuation}: the re-marked bar + the sorted grid", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos&chip=SORT_POPULAR"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("videos");
    expect(data.videos.length).toBeGreaterThan(0);
    // the response re-marks the chosen sort
    expect(data.sortChips).toHaveLength(3);
    const popular = data.sortChips.find((c: any) => c.label === "Popular");
    const latest = data.sortChips.find((c: any) => c.label === "Latest");
    expect(popular.selected).toBe(true);
    expect(latest.selected).toBe(false);
    // the fetch was the chip's own continuation (no browseId, no params)
    const cont = chipUpstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/browse") && r.body?.continuation
    );
    expect(cont).toBeDefined();
    expect(cont!.body.continuation).toBe("SORT_POPULAR");
    expect(cont!.body.browseId).toBeUndefined();
    expect(cont!.body.params).toBeUndefined();
  });

  test("each chip token is its own cache entry (a chip read never aliases the default tab)", async () => {
    await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos"),
      tabCtx("@RickAstleyYT")
    );
    const afterDefault = chipUpstream.recorded.length;
    // the default entry is cached, but the chip read must still browse
    await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos&chip=SORT_POPULAR"),
      tabCtx("@RickAstleyYT")
    );
    const contCalls = chipUpstream.recorded.filter(
      (r) => r.url.includes("/youtubei/v1/browse") && r.body?.continuation
    );
    expect(contCalls).toHaveLength(1);
    // and the same chip read is cached on repeat (no new upstream calls)
    const afterChip = chipUpstream.recorded.length;
    const again = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos&chip=SORT_POPULAR"),
      tabCtx("@RickAstleyYT")
    );
    expect(again.status).toBe(200);
    expect(chipUpstream.recorded.length).toBe(afterChip);
    expect(afterChip).toBeGreaterThan(afterDefault);
  });

  test("no chip bar upstream → sortChips stays absent (honest omission — never fabricated chips)", async () => {
    // the default fixture upstream (no chip bar anywhere in the payload)
    setUpstream(fixtureUpstream().impl);
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=videos"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("videos");
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.sortChips).toBeUndefined();
  });

  test("the page DTO (/api/channel/[handle]) carries the videos browse's chips + the BARE handle", async () => {
    // the upstream header carries the doubled-@ form the live bug showed
    const channel = withUpstreamHandle(load("channel_rickastley"), "@/RickAstleyYT");
    const videosLatest = withChipBar(channel, "Latest");
    const recorded: Recorded[] = [];
    const htmlFor = (data: unknown) =>
      `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
        data
      )};</script></body></html>`;
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      recorded.push({ url, body });
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/youtubei/v1/browse")) {
        const params = String(body?.params ?? "");
        if (params.startsWith("EgZ2aWRlb3")) return json(videosLatest); // the videos tab
        return json(channel); // channel home
      }
      if (url.includes("youtube.com/@")) {
        return new Response(htmlFor(channel), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    };
    setUpstream(impl);

    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    // the bare-handle law: "@/RickAstleyYT" upstream → "RickAstleyYT" on the
    // DTO (the page prefixes the single "@" itself)
    expect(page.channel.handle).toBe("RickAstleyYT");
    // the chips ride the same videos-tab browse the videos rail came from
    expect(page.sortChips).toHaveLength(3);
    expect(page.sortChips[0]).toMatchObject({ label: "Latest", token: "SORT_LATEST", selected: true });
  });

  test("the page DTO hides sortChips when the videos browse carries no chip bar", async () => {
    // the default fixture upstream (no chip bar anywhere in the payload)
    setUpstream(fixtureUpstream().impl);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel.handle).toBe("RickAstleyYT");
    expect(page.sortChips).toBeUndefined();
  });
});

describe("GET /api/channel/[handle]/join — memberships (Join)", () => {
  test("channel without memberships → joinable: false", async () => {
    const res = await joinRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/join"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.joinable).toBe(false);
    expect(data.tiers).toBeNull();
  });

  test("public mode + joinable channel → YouTube's logged-out Join modal state, no tiers", async () => {
    // a joinable channel fixture (// synthetic header actions with a Join button)
    clearCache();
    const channel = load("channel_rickastley");
    channel.header.pageHeaderRenderer.content.pageHeaderViewModel.actions = {
      flexibleActionsViewModel: {
        actionsRows: [
          {
            actions: [
              { buttonViewModel: { title: "Subscribe" } },
              { buttonViewModel: { title: "Join" } },
            ],
          },
        ],
      },
    };
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.includes("/youtubei/v1/browse")) {
        return new Response(JSON.stringify(channel), { status: 200 });
      }
      if (url.includes("youtube.com/@")) {
        const html = `<!doctype html><script>var ytInitialData = ${JSON.stringify(channel)};</script>`;
        return new Response(html, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    setUpstream(impl);
    const res = await joinRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/join"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.joinable).toBe(true);
    expect(data.signinRequired).toBe(true); // public mode — no YT_COOKIES
    expect(data.tiers).toBeNull(); // never fabricated
    expect(data.note).toBe("Sign in to become a member.");
  });
});
