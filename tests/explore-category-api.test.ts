/// <reference types="bun-types" />
/**
 * WFX2-P19-EXPL — the explore category route proven at the route level with
 * fixture bytes (the setUpstream seam; no live network):
 *
 *  - the merged seed pool: REAL captures per category seed
 *    (search_music_videos / search_gaming / search_news — public logged-out
 *    recordings) + synthetic-but-real-shaped pages for the remaining seeds
 *    and every continuation hop (disjoint SYNTH ids, the infinite-scroll
 *    fixture idiom);
 *  - the cursor envelopes: {s:"ecat",k,o,t} pool windows → {s:"ecats",k,qi,t}
 *    live search continuations → the honest null end (the feeds.ts rung-3
 *    chain, scoped per category);
 *  - honest answers: unknown key (incl. "Live" — its own surface) → 404;
 *    garbage / cross-category / foreign-surface cursors → 400 (never a 500).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mapVideos } from "@/lib/youtube/mappers";
import { searchContinuationToken } from "@/lib/youtube/search";
import {
  decodeCursor,
  decodeExploreCategoryCursor,
  encodeCursor,
} from "@/lib/youtube/cursors";
import { GET as categoryRoute } from "@/app/api/explore/category/route";
import type { ExploreCategoryPageDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const searchMusic = load("search_music_videos"); // REAL capture — Music seed 0
const searchGaming = load("search_gaming"); // REAL capture — Gaming seed 0
const searchNews = load("search_news"); // REAL capture — News seed 0

// public-mode determinism: this file asserts publicMode:true (no YT_COOKIES)
const hadCookies = process.env.YT_COOKIES;
delete process.env.YT_COOKIES;

// WFX2-P22-C: the lib's own walk (searchContinuationToken is now the exported
// canonical — the test-side mirror is retired; the walk covers BOTH the
// first-page sectionListRenderer shape and continuation pages'
// appendContinuationItemsAction shape).
const continuationTokenOf = searchContinuationToken;

// the REAL captures' own continuation tokens (import-time drift guards)
const T_MUSIC = continuationTokenOf(searchMusic);
const T_GAMING = continuationTokenOf(searchGaming);
if (typeof T_MUSIC !== "string" || typeof T_GAMING !== "string") {
  throw new Error("fixture drift: a category capture lost its continuation token");
}

// synthetic tokens for the remaining seeds + the continuation chain
const T_M2 = "SYNTH-TOKEN-new-music-first-page";
const T_G2 = "SYNTH-TOKEN-gameplay-first-page";
const T_MUSIC_2 = "SYNTH-TOKEN-music-continuation-2";

/** A minimal REAL-shaped videoRenderer (the infinite-scroll fixture idiom). */
function synthVideo(id: string, title: string): any {
  return {
    videoId: id,
    title: { runs: [{ text: title }] },
    longBylineText: {
      runs: [
        {
          text: `Channel ${id}`,
          navigationEndpoint: {
            browseEndpoint: { browseId: `UC-synth-${id}`, canonicalBaseUrl: `/@ch${id}` },
          },
        },
      ],
    },
    viewCountText: { simpleText: "1,234,567 views" },
    publishedTimeText: { simpleText: "3 years ago" },
    lengthText: { simpleText: "10:30" },
  };
}

/** A real-shaped search response body: `videos` renderers + optional token. */
function searchPageBody(videos: any[], nextToken: string | null): any {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videos.map((video) => ({ videoRenderer: video })),
                },
              },
              ...(nextToken
                ? [
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: { continuationCommand: { token: nextToken } },
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      },
    },
  };
}

// Music seeds 1–2 ("new music" 3 videos w/ token, "live music" 2 videos tokenless)
const musicSeed2 = searchPageBody(
  Array.from({ length: 3 }, (_, i) => synthVideo(`SYNTHEM2-${i + 1}`, `New music synth ${i + 1}`)),
  T_M2,
);
const musicSeed3 = searchPageBody(
  Array.from({ length: 2 }, (_, i) => synthVideo(`SYNTHEM3-${i + 1}`, `Live music synth ${i + 1}`)),
  null,
);
// the Music continuation chain: T_MUSIC → (2 videos, T_MUSIC_2) → (1 video, end)
const musicCont1 = searchPageBody(
  Array.from({ length: 2 }, (_, i) => synthVideo(`SYNTHEMC1-${i + 1}`, `Music continuation ${i + 1}`)),
  T_MUSIC_2,
);
const musicCont2 = searchPageBody([synthVideo("SYNTHEMC2", "Music continuation 3")], null);
// seed 1's own chain (after the pool hands off to it)
const m2Cont = searchPageBody([synthVideo("SYNTHEM2C", "New music continuation 1")], null);
// Gaming seeds 1–2 + the Gaming chain (for the 404/cross-category + other-key suites)
const gamingSeed2 = searchPageBody(
  Array.from({ length: 2 }, (_, i) => synthVideo(`SYNTHEG2-${i + 1}`, `Gameplay synth ${i + 1}`)),
  T_G2,
);
const gamingSeed3 = searchPageBody(
  Array.from({ length: 2 }, (_, i) => synthVideo(`SYNTHEG3-${i + 1}`, `Highlights synth ${i + 1}`)),
  null,
);
const gamingCont = searchPageBody([synthVideo("SYNTHEGC1", "Gaming continuation 1")], null);

interface Recorded {
  url: string;
  body: any;
}

/**
 * Fixture upstream: first-page search routes by QUERY (the real captures for
 * the recorded seeds, the synth pages for the rest); continuation search
 * routes by TOKEN (an unknown token answers the honest empty body).
 */
function upstreamFake() {
  const recorded: Recorded[] = [];
  const byQuery = new Map<string, unknown>([
    ["music videos", searchMusic],
    ["new music", musicSeed2],
    ["live music", musicSeed3],
    ["gaming", searchGaming],
    ["gameplay", gamingSeed2],
    ["video game highlights", gamingSeed3],
  ]);
  const byToken = new Map<string, unknown>([
    [T_MUSIC as string, musicCont1],
    [T_MUSIC_2, musicCont2],
    [T_M2, m2Cont],
    [T_GAMING as string, gamingCont],
    // T_G2's chain is never paged in these suites; unknown tokens → {}
  ]);
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/search")) {
      if (body?.continuation) {
        return json(byToken.get(String(body.continuation)) ?? {});
      }
      return json(byQuery.get(String(body?.query ?? "")) ?? {});
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded };
}

let upstream: ReturnType<typeof upstreamFake>;

beforeEach(() => {
  clearCache();
  upstream = upstreamFake();
  setUpstream(upstream.impl);
});

afterEach(() => {
  setUpstream(null);
  if (hadCookies !== undefined) process.env.YT_COOKIES = hadCookies;
  else delete process.env.YT_COOKIES;
});

const categoryPage = async (
  url: string
): Promise<{ res: Response; page: ExploreCategoryPageDTO & { error?: string } }> => {
  const res = await categoryRoute(new Request(url));
  return { res, page: (await res.json()) as ExploreCategoryPageDTO & { error?: string } };
};

// ---------------------------------------------------------------------------

describe("cursor envelopes — the ecat/ecats shapes (cursors.ts, P19)", () => {
  test("both shapes round-trip through base64url(JSON)", () => {
    const pool = { s: "ecat" as const, k: "Music", o: 24, t: [T_MUSIC, T_M2, null] };
    const search = { s: "ecats" as const, k: "Music", qi: 1, t: T_M2 };
    for (const cursor of [pool, search]) {
      const encoded = encodeCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, opaque
      expect(decodeCursor(encoded)).toEqual(cursor);
    }
  });

  test("garbage and malformed shapes never decode (and never throw)", () => {
    for (const garbage of [
      "",
      "not-a-cursor",
      "%%%bad-chars",
      Buffer.from('{"s":"ecat","k":"","o":1,"t":[]}', "utf8").toString("base64url"),
      Buffer.from('{"s":"ecat","k":"Music","o":-1,"t":[]}', "utf8").toString("base64url"),
      Buffer.from('{"s":"ecat","k":"Music","o":1,"t":["x",5]}', "utf8").toString("base64url"),
      Buffer.from('{"s":"ecats","k":"Music","qi":"0","t":"tok"}', "utf8").toString("base64url"),
      Buffer.from('{"s":"ecats","k":"Music","qi":-1,"t":"tok"}', "utf8").toString("base64url"),
      Buffer.from('{"s":"ecats","k":"Music","t":"tok"}', "utf8").toString("base64url"),
      null,
      undefined,
    ]) {
      expect(decodeCursor(garbage as string | null)).toBeNull();
    }
  });

  test("a NATIVE InnerTube token never decodes as a category envelope", () => {
    expect(decodeExploreCategoryCursor(T_MUSIC as string, "Music", 3)).toBeNull();
    expect(decodeExploreCategoryCursor("tok-ladder-1", "Music", 3)).toBeNull();
  });

  test("scoping: the envelope never crosses categories or surfaces", () => {
    const pool = encodeCursor({ s: "ecat", k: "Music", o: 24, t: [T_MUSIC, null, null] });
    expect(decodeExploreCategoryCursor(pool, "Music", 3)?.s).toBe("ecat");
    expect(decodeExploreCategoryCursor(pool, "Gaming", 3)).toBeNull(); // cross-category
    // foreign surfaces' envelopes are not ours
    expect(decodeExploreCategoryCursor(encodeCursor({ s: "page", t: "x" }), "Music", 3)).toBeNull();
    expect(
      decodeExploreCategoryCursor(encodeCursor({ s: "pool", o: 1, t: [] }), "Music", 3)
    ).toBeNull();
    expect(
      decodeExploreCategoryCursor(encodeCursor({ s: "search", qi: 0, t: "x" }), "Music", 3)
    ).toBeNull();
  });

  test("ecats qi is bounded to the category's seed count", () => {
    expect(decodeExploreCategoryCursor(encodeCursor({ s: "ecats", k: "Music", qi: 2, t: "x" }), "Music", 3)?.s).toBe("ecats");
    expect(decodeExploreCategoryCursor(encodeCursor({ s: "ecats", k: "Music", qi: 3, t: "x" }), "Music", 3)).toBeNull();
    expect(decodeExploreCategoryCursor(encodeCursor({ s: "ecats", k: "Music", qi: 99, t: "x" }), "Music", 3)).toBeNull();
  });
});

describe("GET /api/explore/category — the merged seed pool (first page)", () => {
  test("key=Music: real capture + synth seeds merged, interleaved, deduped", async () => {
    const { res, page } = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=24"
    );
    expect(res.status).toBe(200);
    expect(page.category).toBe("Music");
    expect(page.source).toBe("search"); // the compose is the honest data path
    expect(page.publicMode).toBe(true); // no YT_COOKIES in this suite
    expect(page.videos).toHaveLength(24); // 25-video pool → the first 24

    // the interleave (live-surface merge precedent): row order cycles seeds
    const music = mapVideos(searchMusic, { dedupe: true, limit: 24 });
    expect(page.videos[0].id).toBe(music[0].id); // seed 0's head
    expect(page.videos[1].id).toBe("SYNTHEM2-1"); // seed 1 interleaves in
    expect(page.videos[2].id).toBe("SYNTHEM3-1"); // seed 2 interleaves in
    expect(page.videos[3].id).toBe(music[1].id);
    expect(page.videos[4].id).toBe("SYNTHEM2-2");
    expect(page.videos[5].id).toBe("SYNTHEM3-2");
    expect(page.videos[6].id).toBe(music[2].id);
    expect(page.videos[7].id).toBe("SYNTHEM2-3");
    expect(page.videos[8].id).toBe(music[3].id); // seeds 1–2 exhausted → seed 0 tail
    // no duplicates anywhere in the window
    expect(new Set(page.videos.map((v) => v.id)).size).toBe(24);
  });

  test("the first page's cursor is the pool envelope (o=limit, captured tokens)", async () => {
    const { page } = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=24"
    );
    const cursor = decodeExploreCategoryCursor(page.nextCursor, "Music", 3);
    expect(cursor).toEqual({ s: "ecat", k: "Music", o: 24, t: [T_MUSIC, T_M2, null] });
  });

  test("the seed searches ride the EXISTING cached search pages (type=video params)", async () => {
    await categoryPage("http://localhost/api/explore/category?key=Music&limit=24");
    const searches = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/search"));
    expect(searches).toHaveLength(3); // one per seed query
    for (const call of searches) {
      expect(typeof call.body.query).toBe("string");
      expect(call.body.params).toBe("EgIQAQ=="); // the verified type=video filter
    }
    const queries = searches.map((c) => c.body.query);
    expect(queries).toEqual(["music videos", "new music", "live music"]);
  });

  test("the DTO shape the VideoCard grid consumes (mapper honesty)", async () => {
    const { page } = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=24"
    );
    for (const video of page.videos) {
      expect(video.id).toBeTruthy();
      expect(video.title).toBeTruthy();
      expect(video.channel.name).toBeTruthy();
      expect(video.thumbnailUrl).toContain("ytimg");
      expect(typeof video.views).toBe("number");
      expect(video.isShort).toBe(false); // the belt-and-braces filter held
    }
  });
});

describe("GET /api/explore/category — the cursor chain (pool → search → honest end)", () => {
  test("pool windows slice the SAME cached pool, then hand off to the search phase", async () => {
    // page 1 (limit 24 of 25) + page 2 (the 25th video) via the pool cursor
    const first = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=24"
    );
    const cursor1 = first.page.nextCursor as string;
    const second = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(cursor1)}`
    );
    expect(second.res.status).toBe(200);
    const music = mapVideos(searchMusic, { dedupe: true, limit: 24 });
    expect(second.page.videos.map((v) => v.id)).toEqual([music[19].id]); // the pool tail
    // pool exhausted → the search-phase envelope for seed 0 (its first page
    // is already in the pool, so its captured token starts the next)
    const cursor2 = decodeExploreCategoryCursor(second.page.nextCursor, "Music", 3);
    expect(cursor2).toEqual({ s: "ecats", k: "Music", qi: 0, t: T_MUSIC });
  });

  test("the search phase POSTs the envelope's token upstream and keeps the chain", async () => {
    const first = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=24"
    );
    const cursor1 = first.page.nextCursor as string;
    const second = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(cursor1)}`
    );
    const cursor2 = second.page.nextCursor as string;

    const third = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(cursor2)}`
    );
    expect(third.page.videos.map((v) => v.id)).toEqual(["SYNTHEMC1-1", "SYNTHEMC1-2"]);
    const cont = upstream.recorded.find(
      (r) => r.url.includes("/youtubei/v1/search") && r.body?.continuation === T_MUSIC
    );
    expect(cont).toBeDefined(); // the token POSTed upstream verbatim

    // the chain keeps the query's own next token…
    const cursor3 = decodeExploreCategoryCursor(third.page.nextCursor, "Music", 3);
    expect(cursor3).toEqual({ s: "ecats", k: "Music", qi: 0, t: T_MUSIC_2 });

    // …exhausts it…
    const fourth = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(
        third.page.nextCursor as string
      )}`
    );
    expect(fourth.page.videos.map((v) => v.id)).toEqual(["SYNTHEMC2"]);
    // …then advances to the NEXT seed with a captured token (qi 1)
    const cursor4 = decodeExploreCategoryCursor(fourth.page.nextCursor, "Music", 3);
    expect(cursor4).toEqual({ s: "ecats", k: "Music", qi: 1, t: T_M2 });

    // seed 1's chain runs, exhausts, and — seed 2 captured no token — the
    // chain HONESTLY ends (null), never a fabricated loop
    const fifth = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(
        fourth.page.nextCursor as string
      )}`
    );
    expect(fifth.page.videos.map((v) => v.id)).toEqual(["SYNTHEM2C"]);
    expect(fifth.page.nextCursor).toBeNull();
  });

  test("a pool cursor already past the pool transitions to the search phase (never empty-with-a-cursor)", async () => {
    // compose the pool first so the cached entry exists
    await categoryPage("http://localhost/api/explore/category?key=Music&limit=24");
    const past = encodeCursor({ s: "ecat", k: "Music", o: 999, t: [T_MUSIC, T_M2, null] });
    const { res, page } = await categoryPage(
      `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(past)}`
    );
    expect(res.status).toBe(200);
    expect(page.videos.map((v) => v.id)).toEqual(["SYNTHEMC1-1", "SYNTHEMC1-2"]);
    expect(decodeExploreCategoryCursor(page.nextCursor, "Music", 3)).toEqual({
      s: "ecats",
      k: "Music",
      qi: 0,
      t: T_MUSIC_2,
    });
  });

  test("identical seed answers dedupe into one pool (merge/dedupe honesty)", async () => {
    // route every Music seed to the SAME real capture (a cache-hit-like upstream)
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.includes("/youtubei/v1/search")) {
        const data = body?.continuation
          ? {}
          : searchMusic; // unknown queries → the same capture (dedupe target)
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };
    setUpstream(impl);
    const { page } = await categoryPage(
      "http://localhost/api/explore/category?key=Music&limit=48"
    );
    const music = mapVideos(searchMusic, { dedupe: true, limit: 48 });
    expect(page.videos).toHaveLength(music.length); // 3 seeds × the same page → one copy
    expect(new Set(page.videos.map((v) => v.id)).size).toBe(page.videos.length);
  });
});

describe("GET /api/explore/category — honest answers (never a 500)", () => {
  test("unknown key → 404, no upstream call", async () => {
    for (const key of ["Movies", "does-not-exist", "live", ""]) {
      const url = `http://localhost/api/explore/category?key=${encodeURIComponent(key)}`;
      const { res, page } = await categoryPage(url);
      expect(res.status).toBe(404);
      expect(page.error).toBe("Unknown explore category");
    }
    expect(upstream.recorded).toHaveLength(0);
  });

  test("missing key → 404", async () => {
    const { res } = await categoryPage("http://localhost/api/explore/category");
    expect(res.status).toBe(404);
  });

  test("garbage cursor → the honest 400", async () => {
    const { res, page } = await categoryPage(
      "http://localhost/api/explore/category?key=Music&cursor=not-a-cursor"
    );
    expect(res.status).toBe(400);
    expect(page.error).toBe("Invalid category cursor");
    expect(upstream.recorded).toHaveLength(0); // never reached the upstream
  });

  test("a cursor minted for ANOTHER category → 400 (never crosses categories)", async () => {
    const foreign = encodeCursor({ s: "ecat", k: "Music", o: 24, t: [T_MUSIC, null, null] });
    const { res, page } = await categoryPage(
      `http://localhost/api/explore/category?key=Gaming&cursor=${encodeURIComponent(foreign)}`
    );
    expect(res.status).toBe(400);
    expect(page.error).toBe("Invalid category cursor");
  });

  test("a foreign surface's envelope (/api/search 'page') → 400", async () => {
    const foreign = encodeCursor({ s: "page", t: "some-search-token" });
    const { res } = await categoryPage(
      `http://localhost/api/explore/category?key=Music&cursor=${encodeURIComponent(foreign)}`
    );
    expect(res.status).toBe(400);
  });

  test("an ecats cursor with qi past the seed count → 400", async () => {
    const foreign = encodeCursor({ s: "ecats", k: "Music", qi: 7, t: "x" });
    const { res } = await categoryPage(
      `http://localhost/api/explore/category?key=Music&cursor=${encodeURIComponent(foreign)}`
    );
    expect(res.status).toBe(400);
  });

  test("another category's grid composes from its own seeds (Gaming)", async () => {
    // the Gaming pool is 20 real + 2 + 2 synth = 24 videos — a limit-12 first
    // page keeps pool windows in the chain
    const { res, page } = await categoryPage(
      "http://localhost/api/explore/category?key=Gaming&limit=12"
    );
    expect(res.status).toBe(200);
    expect(page.category).toBe("Gaming");
    const gaming = mapVideos(searchGaming, { dedupe: true, limit: 24 });
    expect(page.videos[0].id).toBe(gaming[0].id);
    expect(page.videos[1].id).toBe("SYNTHEG2-1");
    expect(page.videos[2].id).toBe("SYNTHEG3-1");
    const cursor = decodeExploreCategoryCursor(page.nextCursor, "Gaming", 3);
    expect(cursor).toEqual({ s: "ecat", k: "Gaming", o: 12, t: [T_GAMING, T_G2, null] });
  });
});

// ---------------------------------------------------------------------------
// WFX2-P22-C — the append-shape regression on the category grid
// ---------------------------------------------------------------------------

describe("P22-C — the category cursor chain survives append-shape continuation pages", () => {
  test("T_MUSIC (append shape in flight) keeps the SAME seed's chain alive (not one page per query)", async () => {
    // serve the REAL page-2 capture for Music's first continuation, then a
    // page 3 off ITS token — pre-P22-C the append shape read nextCursor:null
    // and the grid's chain advanced/died instead of paging on.
    const searchPage2 = load("search_page2_append");
    const T_PAGE2 = searchContinuationToken(searchPage2) as string;
    expect(typeof T_PAGE2).toBe("string");
    const origImpl = upstream.impl;
    setUpstream(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes("/youtubei/v1/search")) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (body?.continuation === T_MUSIC) {
          return new Response(JSON.stringify(searchPage2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (body?.continuation === T_PAGE2) {
          return new Response(
            JSON.stringify(
              searchPageBody([synthVideo("P22CEXP3", "Category page three")], null),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      return origImpl(url, init);
    });

    // walk the chain until the search phase holds the append token, then page it
    let url = "http://localhost/api/explore/category?key=Music&limit=24";
    for (let i = 0; i < 16; i++) {
      const { page } = await categoryPage(url);
      if (!page.nextCursor) break;
      url = `http://localhost/api/explore/category?key=Music&limit=24&cursor=${encodeURIComponent(page.nextCursor)}`;
      const decoded = decodeExploreCategoryCursor(page.nextCursor, "Music", 3);
      if (decoded?.s === "ecats" && decoded.t === T_PAGE2) {
        const { page: deep } = await categoryPage(url);
        // P22CEXP3 is served ONLY by the T_PAGE2 branch — the append token paged on
        expect(deep.videos.map((v) => v.id)).toContain("P22CEXP3");
        return;
      }
    }
    throw new Error("the category chain never reached the append token — it ended early");
  });
});
