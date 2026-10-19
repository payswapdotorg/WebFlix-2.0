/// <reference types="bun-types" />
/**
 * WFX2-P19-EXPL — the explore category seed map (src/lib/youtube/
 * explore-categories.ts): the 13 browse categories (Live keeps its own
 * /explore/live surface), each with real seed queries the browse grid is
 * composed from. Mirrors categories.test.ts (the chip-vocabulary battery).
 */
import { describe, expect, test } from "bun:test";
import {
  EXPLORE_CATEGORY_KEYS,
  EXPLORE_CATEGORY_SEEDS,
  exploreCategorySeeds,
  isExploreCategory,
} from "@/lib/youtube/explore-categories";
import { CATEGORIES } from "@/lib/categories";

describe("the explore category vocabulary (13 browse categories)", () => {
  test("the keys = CATEGORIES order minus Live (the hub/sidebar order)", () => {
    expect(EXPLORE_CATEGORY_KEYS).toEqual(CATEGORIES.filter((c) => c !== "Live"));
    expect(EXPLORE_CATEGORY_KEYS).toHaveLength(13);
  });

  test("Live is NOT a browse category (it keeps /explore/live)", () => {
    expect(isExploreCategory("Live")).toBe(false);
    expect(EXPLORE_CATEGORY_SEEDS["Live"]).toBeUndefined();
  });

  test("every browse category is a known WebFlix category", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) {
      expect(CATEGORIES).toContain(key);
    }
  });

  test("isExploreCategory accepts exactly the 13 (and rejects junk)", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) expect(isExploreCategory(key)).toBe(true);
    for (const junk of ["", "live", "music", "Movies", "Random", "Music ", null, undefined]) {
      expect(isExploreCategory(junk as never)).toBe(false);
    }
  });
});

describe("the seed queries (real search terms per category)", () => {
  test("every category carries a non-empty, deduplicated query set", () => {
    for (const key of EXPLORE_CATEGORY_KEYS) {
      const seeds = EXPLORE_CATEGORY_SEEDS[key];
      expect(seeds).toBeDefined();
      expect(seeds.length).toBeGreaterThanOrEqual(2);
      for (const q of seeds) {
        expect(typeof q).toBe("string");
        expect(q.trim().length).toBeGreaterThan(2);
      }
      expect(new Set(seeds).size).toBe(seeds.length); // no duplicate seeds
    }
  });

  test("exploreCategorySeeds returns the map for known keys, null otherwise", () => {
    expect(exploreCategorySeeds("Music")).toBe(EXPLORE_CATEGORY_SEEDS["Music"]);
    expect(exploreCategorySeeds("Gaming")).toEqual(["gaming", "gameplay", "video game highlights"]);
    expect(exploreCategorySeeds("Live")).toBeNull();
    expect(exploreCategorySeeds("does-not-exist")).toBeNull();
    expect(exploreCategorySeeds(null)).toBeNull();
  });

  test("the recorded fixtures' queries are seed[0] of their categories", () => {
    // tests/fixtures/yt/search_music_videos|search_gaming|search_news are the
    // real captures of these seeds (the api suite routes by them)
    expect(EXPLORE_CATEGORY_SEEDS["Music"][0]).toBe("music videos");
    expect(EXPLORE_CATEGORY_SEEDS["Gaming"][0]).toBe("gaming");
    expect(EXPLORE_CATEGORY_SEEDS["News"][0]).toBe("news");
  });
});

// ---------------------------------------------------------------------------
// P25 G13 — the podcasts destination surface (src/lib/youtube/podcasts.ts):
// the MEASURED one-page parse (the sanitized REAL capture
// podcasts_destination_public.json — youtube.com's FEpodcasts_destination
// page, logged-out, 2026-10-19; trimmed to 2–3 cards per shelf).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import {
  mapPodcastCreator,
  mapPodcastShow,
  parsePodcastsPage,
  PODCASTS_SSR_PATH,
} from "@/lib/youtube/podcasts";

const PODCASTS_FIXTURE = "tests/fixtures/yt/podcasts_destination_public.json";
const loadPodcasts = (): any => JSON.parse(readFileSync(PODCASTS_FIXTURE, "utf8"));

describe("the podcasts destination parse (P25 G13 — the measured one-page surface)", () => {
  test("the SSR path is youtube.com's own podcasts destination", () => {
    expect(PODCASTS_SSR_PATH).toBe("/podcasts");
  });

  test("the REAL capture is the FEpodcasts_destination surface (fixture drift guard)", () => {
    const fixture = loadPodcasts();
    const params = fixture?.responseContext?.serviceTrackingParams ?? [];
    const gfeedback = params.find((p: any) => p?.service === "GFEEDBACK");
    const browseId = (gfeedback?.params ?? []).find((q: any) => q?.key === "browse_id")?.value;
    expect(browseId).toBe("FEpodcasts_destination");
    // the measured one-page law: ZERO continuation machinery in the capture
    expect(JSON.stringify(fixture)).not.toContain("continuationItemRenderer");
    expect(JSON.stringify(fixture)).not.toContain("continuationCommand");
  });

  test("the header title + the 13 shelves in document order (the measured page)", () => {
    const page = parsePodcastsPage(loadPodcasts());
    expect(page.title).toBe("Podcasts");
    expect(page.shelves.map((s) => s.title)).toEqual([
      "Popular episodes",
      "Popular podcasts",
      "Live now",
      "Ghost stories",
      "Wealth",
      "Stock markets",
      "Economics",
      "Finances",
      "Psychology",
      "Health care",
      "AI",
      "Vocabulary",
      "Popular podcast creators",
    ]);
  });

  test("episode shelves map through the EXISTING videoRenderer mapper (real /watch targets)", () => {
    const page = parsePodcastsPage(loadPodcasts());
    const popular = page.shelves[0];
    expect(popular.episodes.length).toBeGreaterThan(0);
    expect(popular.shows).toEqual([]);
    expect(popular.creators).toEqual([]);
    for (const v of popular.episodes) {
      expect(v.id).toMatch(/^[\w-]{6,}$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.channel.name.length).toBeGreaterThan(0);
    }
    // the first measured card: Happy Kongner's streamed episode
    expect(popular.episodes[0].id).toBe("lmRCN_E9ZI8");
    expect(popular.episodes[0].viewsText).toBe("10,523 views");
    expect(popular.episodes[0].publishedText).toBe("Streamed 1d ago");
    expect(popular.episodes[0].durationSec).toBe(6 * 3600 + 25 * 60 + 42);
  });

  test("the show lockups map their measured shape (playlist id + publisher + episodes badge + Play-all target)", () => {
    const page = parsePodcastsPage(loadPodcasts());
    const shows = page.shelves[1].shows;
    expect(shows.length).toBeGreaterThan(0);
    const show = shows[0];
    expect(show.playlistId).toMatch(/^PL[\w-]+$/);
    expect(show.title.length).toBeGreaterThan(0);
    // the measured publisher row: name + @handle + the verified badge
    expect(show.publisherName).toBe("娛樂好好玩");
    expect(show.publisherHandle).toBe("@celebuzzhk");
    expect(show.publisherVerified).toBe(true);
    // the measured thumbnail badge + the "Updated today" row
    expect(show.episodeCountText).toBe("139 episodes");
    expect(show.updatedText).toBe("Updated today");
    // the measured Play-all target (the card's own watchEndpoint)
    expect(show.playAllVideoId).toBe("svf7jACondc");
    expect(show.thumbnailUrl).toContain("i.ytimg.com");
  });

  test("the creator cards map their measured shape (channel + counts)", () => {
    const page = parsePodcastsPage(loadPodcasts());
    const creators = page.shelves[12].creators;
    expect(creators.length).toBeGreaterThan(0);
    const creator = creators[0];
    expect(creator.id).toBe("UCLe_q9axMaeTbjN0hy1Z9xA");
    expect(creator.handle).toBe("@CalebHammer");
    expect(creator.name).toBe("Caleb Hammer");
    expect(creator.subscriberCountText).toBe("4M subscribers");
    expect(creator.videoCountText).toBe("5,014 videos");
    expect(creator.avatarUrl).toContain("yt3.googleusercontent.com");
  });

  test("honest mapping: untitled/unidentifiable cards are dropped, never guessed", () => {
    expect(mapPodcastShow({ contentId: "PLxyz", metadata: {} })).toBeNull(); // no title
    expect(mapPodcastShow({ metadata: { lockupMetadataViewModel: { title: { content: "T" } } } })).toBeNull(); // no playlist id
    expect(mapPodcastCreator({ channelId: "UCx" })).not.toBeNull(); // minimal creator maps
    expect(mapPodcastCreator({ title: { simpleText: "no id" } })).toBeNull();
    // a lockup with no metadata rows still maps (fields null, never invented)
    const bare = mapPodcastShow({
      contentId: "PLbare",
      metadata: { lockupMetadataViewModel: { title: { content: "Bare show" } } },
    });
    expect(bare).toMatchObject({
      playlistId: "PLbare",
      title: "Bare show",
      publisherName: null,
      publisherHandle: null,
      episodeCountText: null,
      updatedText: null,
      playAllVideoId: null,
    });
  });

  test("a shelf whose every card fails to map is dropped (never an empty fabricated shelf)", () => {
    const page = parsePodcastsPage({
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  richGridRenderer: {
                    contents: [
                      {
                        richSectionRenderer: {
                          content: {
                            richShelfRenderer: {
                              title: { simpleText: "Broken shelf" },
                              contents: [
                                { richItemRenderer: { content: { videoRenderer: { videoId: "" } } } },
                                { richItemRenderer: { content: { lockupViewModel: { contentId: "" } } } },
                              ],
                            },
                          },
                        },
                      },
                      {
                        richSectionRenderer: {
                          content: {
                            richShelfRenderer: {
                              title: { runs: [{ text: "Good shelf" }] },
                              contents: [
                                {
                                  richItemRenderer: {
                                    content: {
                                      videoRenderer: {
                                        videoId: "ok-video-1",
                                        title: { runs: [{ text: "A real episode" }] },
                                        longBylineText: {
                                          runs: [
                                            {
                                              text: "Some channel",
                                              navigationEndpoint: {
                                                browseEndpoint: {
                                                  browseId: "UC-ok-1",
                                                  canonicalBaseUrl: "/@okchannel",
                                                },
                                              },
                                            },
                                          ],
                                        },
                                      },
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    });
    expect(page.shelves).toHaveLength(1);
    expect(page.shelves[0].title).toBe("Good shelf");
    expect(page.shelves[0].episodes[0].id).toBe("ok-video-1");
    // the header fallback when the response carries none
    expect(page.title).toBe("Podcasts");
  });

  test("the empty response parses to the honest empty page (never a fabricated shelf)", () => {
    const page = parsePodcastsPage({});
    expect(page.title).toBe("Podcasts");
    expect(page.shelves).toEqual([]);
  });
});
