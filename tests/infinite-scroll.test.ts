/// <reference types="bun-types" />
/**
 * WFX2-P6-IS — infinite scroll proven at the route level with fixture bytes
 * (setUpstream seam; no live network). The two surfaces:
 *
 *  PART 1 — /api/videos rung 3 (the production path: browse FEwhat_to_watch
 *  is walled for Vercel egress, so listLiveVideos lands on the search
 *  compose). The compose now paginates through self-contained opaque
 *  cursors (src/lib/youtube/cursors.ts):
 *
 *    {s:"pool",   o, t}  offset windows through the CACHED merged pool
 *                        (t = each seed query's first-page continuation
 *                        token, captured at compose time);
 *    {s:"search", qi, t} live search-continuation paging for seed query qi;
 *                        exhaust → advance qi+1 with its captured first
 *                        token; all exhausted → the honest null end.
 *
 *  Rungs 1–2 keep their NATIVE browse continuation tokens exactly as before
 *  (regression-guarded here), and a native token never decodes as an
 *  envelope, so the discrimination is by shape.
 *
 *  PART 2 — /api/search results pagination: first page unchanged shape
 *  (+nextCursor additive), cursor pages POST the wrapped continuation token,
 *  garbage cursors answer the honest 400 (never a 500).
 *
 * Fixtures: search_lofi (REAL search capture — query 0's compose page), the
 * REAL walled browse nudge (home_feed), reel_sequence_synth (the shorts
 * seed); the second/third compose queries + every continuation page ride
 * inline synthetic-but-real-shaped bodies (marked by their SYNTH/ISQ ids).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mapVideos } from "@/lib/youtube/mappers";
import {
  decodeComposeCursor,
  decodeCursor,
  decodeSearchCursor,
  encodeCursor,
} from "@/lib/youtube/cursors";
import { GET as getHome } from "@/app/api/home/route";
import { GET as listVideosRoute } from "@/app/api/videos/route";
import { GET as searchRoute } from "@/app/api/search/route";
import type { HomeFeedDTO, VideoPageDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const searchLofi = load("search_lofi"); // REAL search capture (45 mappable cards)
const nudge = load("home_feed"); // REAL walled browse shape (logged-out nudge)
const reelSeq = load("reel_sequence_synth");

/** Mirror of the lib's searchContinuationToken walk (test-side extraction). */
function continuationTokenOf(body: any): string | null {
  const sections: any[] = [];
  (function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if ((node as Record<string, unknown>).sectionListRenderer) {
      sections.push((node as Record<string, unknown>).sectionListRenderer);
    }
    Object.values(node).forEach(walk);
  })(body);
  for (const section of sections) {
    for (const item of section?.continuationItems ?? section?.contents ?? []) {
      const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === "string" && token) return token;
    }
    const token = section?.continuations?.[0]?.nextContinuationData?.continuation;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

// The compose's first seed query rides the REAL capture; its captured token:
const T_LOFI = continuationTokenOf(searchLofi) as string;
if (typeof T_LOFI !== "string") {
  // a hard import-time guard: the whole suite hangs off the real token
  throw new Error("fixture drift: search_lofi lost its continuation token");
}

// Synthetic first pages for seeds 1–2 (disjoint ids + DISTINCT captured
// tokens, so the search-phase advance is observable upstream).
const T_SYNTH_1 = "SYNTH-TOKEN-trending-music-first-page";
const T_SYNTH_2 = "SYNTH-TOKEN-popular-gaming-first-page";
// The continuation chain the fake upstream serves (per token):
const T_LOFI_2 = "SYNTH-TOKEN-lofi-continuation-2";
const T_SYNTH_1B = "SYNTH-TOKEN-trending-music-continuation-2";

/** A minimal REAL-shaped videoRenderer (search result card). */
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

const synthA = searchPageBody(
  Array.from({ length: 8 }, (_, i) => synthVideo(`SYNTHQA00${i + 1}`, `Trending music synth ${i + 1}`)),
  T_SYNTH_1,
);
const synthB = searchPageBody(
  Array.from({ length: 8 }, (_, i) => synthVideo(`SYNTHQB00${i + 1}`, `Popular gaming synth ${i + 1}`)),
  T_SYNTH_2,
);

// The expected pool, in query-merge order (seed 0's page maps at the compose
// limit 24 → the first 24 of the real capture, then the two synthetic sets).
const lofi24 = mapVideos(searchLofi, { dedupe: true, limit: 24 });
const synthAIds = Array.from({ length: 8 }, (_, i) => `SYNTHQA00${i + 1}`);
const synthBIds = Array.from({ length: 8 }, (_, i) => `SYNTHQB00${i + 1}`);
const POOL_IDS = [...lofi24.map((v) => v.id), ...synthAIds, ...synthBIds];

interface Recorded {
  url: string;
  body: any;
}

/**
 * Fixture upstream: browse serves the walled nudge (the production reality
 * this lane fixes); first-page search routes by QUERY; continuation search
 * routes by TOKEN (an unknown token answers the honest empty body).
 */
function upstreamFake(opts: { browse?: unknown } = {}) {
  const recorded: Recorded[] = [];
  const continuation = new Map<string, unknown>([
    // seed 0's chain ("most viewed youtube videos" — the real capture's token)
    [T_LOFI, searchPageBody([synthVideo("ISQA1", "Lofi continuation 1"), synthVideo("ISQA2", "Lofi continuation 2")], T_LOFI_2)],
    [T_LOFI_2, searchPageBody([synthVideo("ISQA3", "Lofi continuation 3")], null)],
    // seed 1's chain ("trending music")
    [T_SYNTH_1, searchPageBody([synthVideo("ISQB1", "Music continuation 1")], T_SYNTH_1B)],
    [T_SYNTH_1B, searchPageBody([synthVideo("ISQB2", "Music continuation 2")], null)],
    // seed 2's chain ("popular gaming") — exhausts immediately
    [T_SYNTH_2, searchPageBody([synthVideo("ISQC1", "Gaming continuation 1")], null)],
  ]);
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/browse")) return json(opts.browse ?? nudge);
    if (url.includes("/youtubei/v1/search")) {
      if (body?.continuation) {
        return json(continuation.get(String(body.continuation)) ?? {});
      }
      const query = String(body?.query ?? "");
      if (query === "trending music") return json(synthA);
      if (query === "popular gaming") return json(synthB);
      return json(searchLofi); // seed 0 + the byw second pass ride the REAL capture
    }
    if (url.includes("/reel/reel_watch_sequence")) return json(reelSeq);
    return new Response("not found", { status: 404 });
  };
  const calls = {
    browse: () => recorded.filter((r) => r.url.includes("/youtubei/v1/browse")),
    search: () => recorded.filter((r) => r.url.includes("/youtubei/v1/search")),
    continuations: () =>
      recorded.filter((r) => r.url.includes("/youtubei/v1/search") && r.body?.continuation),
  };
  return { impl, recorded, calls };
}

const videosPage = async (url: string): Promise<{ res: Response; page: VideoPageDTO }> => {
  const res = await listVideosRoute(new Request(url));
  return { res, page: (await res.json()) as VideoPageDTO };
};

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  setUpstream(null);
});

// ---------------------------------------------------------------------------

describe("cursor codec — opacity + round-trips (the client just passes it back)", () => {
  test("every shape round-trips through base64url(JSON)", () => {
    const pool = { s: "pool" as const, o: 24, t: [T_LOFI, T_SYNTH_1, null] };
    const search = { s: "search" as const, qi: 2, t: T_SYNTH_2 };
    const page = { s: "page" as const, t: T_LOFI };
    for (const cursor of [pool, search, page]) {
      const encoded = encodeCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, opaque
      expect(decodeCursor(encoded)).toEqual(cursor);
    }
  });

  test("garbage never decodes (and never throws)", () => {
    for (const garbage of [
      "",
      "not-a-cursor",
      "%%%bad-chars",
      Buffer.from("hi", "utf8").toString("base64url"), // valid base64url, not JSON
      Buffer.from('{"x":1}', "utf8").toString("base64url"), // JSON, no shape
      Buffer.from('{"s":"pool","o":-1,"t":[]}', "utf8").toString("base64url"),
      Buffer.from('{"s":"search","qi":"0","t":"tok"}', "utf8").toString("base64url"),
      Buffer.from('{"s":"page","t":""}', "utf8").toString("base64url"),
      `${encodeCursor({ s: "page", t: "x" }).repeat(200)}AAAA`, // over the length guard
      null,
      undefined,
    ]) {
      expect(decodeCursor(garbage as string | null)).toBeNull();
    }
  });

  test("a NATIVE InnerTube continuation token never decodes as an envelope", () => {
    // the real capture's 592-char token must keep flowing to the native path
    expect(decodeCursor(T_LOFI)).toBeNull();
    expect(decodeComposeCursor(T_LOFI, 3)).toBeNull();
    expect(decodeComposeCursor("tok-ladder-1", 3)).toBeNull();
  });

  test("shape discrimination: compose bounds qi, search accepts only page", () => {
    expect(decodeComposeCursor(encodeCursor({ s: "search", qi: 99, t: "x" }), 3)).toBeNull();
    expect(decodeComposeCursor(encodeCursor({ s: "search", qi: 2, t: "x" }), 3)?.s).toBe("search");
    expect(decodeComposeCursor(encodeCursor({ s: "page", t: "x" }), 3)).toBeNull();
    expect(decodeSearchCursor(encodeCursor({ s: "pool", o: 1, t: [] }))).toBeNull();
    expect(decodeSearchCursor(encodeCursor({ s: "page", t: "x" }))?.t).toBe("x");
  });
});

describe("PART 1 — /api/videos rung 3: the pool cursor", () => {
  test("first composed page emits a pool cursor (o=limit, captured tokens inside)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const { res, page } = await videosPage("http://localhost/api/videos?limit=12");
    expect(res.status).toBe(200);
    expect(page.videos.map((v) => v.id)).toEqual(POOL_IDS.slice(0, 12)); // the pool's first window
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor).not.toBeNull();
    expect(cursor?.s).toBe("pool");
    expect((cursor as { o: number }).o).toBe(12); // resumes after this window
    expect((cursor as { t: (string | null)[] }).t).toEqual([T_LOFI, T_SYNTH_1, T_SYNTH_2]);
  });

  test("pool cursor slices the NEXT window from the SAME cached pool (no new upstream pages)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const { page: page1 } = await videosPage("http://localhost/api/videos?limit=12");
    const searchAfterFirst = up.calls.search().length;
    expect(searchAfterFirst).toBe(3); // exactly the 3 compose first pages

    const { res, page: page2 } = await videosPage(
      `http://localhost/api/videos?limit=12&cursor=${page1.nextCursor}`
    );
    expect(res.status).toBe(200);
    expect(page2.videos.map((v) => v.id)).toEqual(POOL_IDS.slice(12, 24)); // the next window
    expect(up.calls.search()).toHaveLength(searchAfterFirst); // the cached pool served — zero new fetches

    // a window may straddle queries — the cross-query slice stays in pool order
    const { page: page3 } = await videosPage(
      `http://localhost/api/videos?limit=12&cursor=${page2.nextCursor}`
    );
    expect(page3.videos.map((v) => v.id)).toEqual(POOL_IDS.slice(24, 36));
    // within every page the ids are unique (the dedupe shape the client trusts)
    for (const page of [page1, page2, page3]) {
      expect(new Set(page.videos.map((v) => v.id)).size).toBe(page.videos.length);
    }
  });

  test("pool exhaustion → the search-mode cursor, carrying the FIRST tokened query's captured token", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    // limit=36: page 1 = pool[0:36] (pool cursor), page 2 = the last 4 pool
    // videos → the window exhausts the pool → the search-phase handoff
    const { page: page1 } = await videosPage("http://localhost/api/videos?limit=36");
    expect(page1.videos).toHaveLength(36);
    expect(decodeCursor(page1.nextCursor)?.s).toBe("pool");

    const { res, page: page2 } = await videosPage(
      `http://localhost/api/videos?limit=36&cursor=${page1.nextCursor}`
    );
    expect(res.status).toBe(200);
    expect(page2.videos.map((v) => v.id)).toEqual(POOL_IDS.slice(36)); // the last pool window
    const cursor = decodeCursor(page2.nextCursor);
    expect(cursor?.s).toBe("search"); // the transition — a live search cursor…
    expect((cursor as { qi: number }).qi).toBe(0); // …for the first seed query…
    expect((cursor as { t: string }).t).toBe(T_LOFI); // …seeded by its CAPTURED first token
  });

  test("a pool cursor already past the end transitions immediately (never an empty page with a cursor)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    await videosPage("http://localhost/api/videos"); // warm the pool
    const pastEnd = encodeCursor({ s: "pool", o: 10_000, t: [T_LOFI, T_SYNTH_1, T_SYNTH_2] });
    const { res, page } = await videosPage(
      `http://localhost/api/videos?limit=12&cursor=${pastEnd}`
    );
    expect(res.status).toBe(200);
    // the first search-continuation page is fetched NOW (videos, not a stub)
    expect(page.videos.map((v) => v.id)).toEqual(["ISQA1", "ISQA2"]);
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor?.s).toBe("search");
    expect((cursor as { t: string }).t).toBe(T_LOFI_2);
  });

  test("every query tokenless → the honest null end (no fake loop past the pool)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    await videosPage("http://localhost/api/videos"); // warm the pool
    const tokenless = encodeCursor({ s: "pool", o: 10_000, t: [null, null, null] });
    const { res, page } = await videosPage(
      `http://localhost/api/videos?limit=12&cursor=${tokenless}`
    );
    expect(res.status).toBe(200);
    expect(page.videos).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("PART 1 — /api/videos rung 3: the search-mode chain", () => {
  /** Fetch one search-cursor page directly (the client just passes it back). */
  const searchPage = async (cursor: string) =>
    videosPage(`http://localhost/api/videos?limit=12&cursor=${encodeURIComponent(cursor)}`);

  test("continuation flows → query exhausts → advance qi with the CAPTURED first token → final exhaust = null", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);

    // seed query 0's chain: its own continuation carries it…
    const a = await searchPage(encodeCursor({ s: "search", qi: 0, t: T_LOFI }));
    expect(a.res.status).toBe(200);
    expect(a.page.videos.map((v) => v.id)).toEqual(["ISQA1", "ISQA2"]);
    expect(decodeCursor(a.page.nextCursor)).toEqual({ s: "search", qi: 0, t: T_LOFI_2 });

    // …until it exhausts (no token) → advance to query 1's CAPTURED token
    const b = await searchPage(a.page.nextCursor as string);
    expect(b.page.videos.map((v) => v.id)).toEqual(["ISQA3"]);
    expect(decodeCursor(b.page.nextCursor)).toEqual({ s: "search", qi: 1, t: T_SYNTH_1 });

    // query 1 pages once more on its own continuation…
    const c = await searchPage(b.page.nextCursor as string);
    expect(c.page.videos.map((v) => v.id)).toEqual(["ISQB1"]);
    expect(decodeCursor(c.page.nextCursor)).toEqual({ s: "search", qi: 1, t: T_SYNTH_1B });

    // …exhausts → advance to query 2's captured token
    const d = await searchPage(c.page.nextCursor as string);
    expect(d.page.videos.map((v) => v.id)).toEqual(["ISQB2"]);
    expect(decodeCursor(d.page.nextCursor)).toEqual({ s: "search", qi: 2, t: T_SYNTH_2 });

    // query 2 exhausts immediately → every query exhausted → the honest end
    const e = await searchPage(d.page.nextCursor as string);
    expect(e.page.videos.map((v) => v.id)).toEqual(["ISQC1"]);
    expect(e.page.nextCursor).toBeNull();

    // the advances really rode the captured first tokens upstream, in order
    const chain = up.calls.continuations().map((r) => r.body.continuation);
    expect(chain).toEqual([T_LOFI, T_LOFI_2, T_SYNTH_1, T_SYNTH_1B, T_SYNTH_2]);
  });

  test("the full walk: pool windows → search chain → terminates honestly (no cursor ever repeats)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const { page: first } = await videosPage("http://localhost/api/videos?limit=12");

    const seenCursors = new Set<string>();
    const allIds: string[] = [...first.videos.map((v) => v.id)];
    let cursor: string | null = first.nextCursor;
    let pages = 0;
    while (cursor !== null && pages < 40) {
      expect(seenCursors.has(cursor)).toBe(false); // no fabricated loops
      seenCursors.add(cursor);
      const { res, page } = await videosPage(
        `http://localhost/api/videos?limit=12&cursor=${encodeURIComponent(cursor)}`
      );
      expect(res.status).toBe(200);
      expect(new Set(page.videos.map((v) => v.id)).size).toBe(page.videos.length);
      allIds.push(...page.videos.map((v) => v.id));
      cursor = page.nextCursor;
      pages += 1;
    }
    // terminated honestly, within the pool + the 5-page search chain
    expect(cursor).toBeNull();
    expect(pages).toBe(8); // 3 more pool windows + 5 search-continuation pages
    // everything served is REAL: the pool ids + the chain's continuation ids
    const expected = new Set([...POOL_IDS, "ISQA1", "ISQA2", "ISQA3", "ISQB1", "ISQB2", "ISQC1"]);
    expect(allIds.every((id) => expected.has(id))).toBe(true);
    expect(new Set(allIds).size).toBe(expected.size); // the walk covered it all
  });
});

describe("PART 1 — rungs 1–2 regression: native browse continuations keep flowing", () => {
  test("browse-healthy default feed returns the NATIVE token; cursor pages POST it as a browse continuation", async () => {
    const up = upstreamFake({ browse: searchLofi }); // healthy-shaped browse body
    setUpstream(up.impl);
    const { res, page } = await videosPage("http://localhost/api/videos");
    expect(res.status).toBe(200);
    expect(page.videos.length).toBeGreaterThan(0);
    // the native feed continuation token — raw, NOT an envelope
    expect(page.nextCursor).toBe(T_LOFI);
    expect(decodeCursor(page.nextCursor)).toBeNull();
    expect(up.calls.search()).toHaveLength(0); // the compose never fired

    // the native cursor page POSTs upstream as a browse continuation
    const { page: page2 } = await videosPage(
      `http://localhost/api/videos?cursor=${encodeURIComponent(T_LOFI)}`
    );
    expect(page2.videos.length).toBeGreaterThan(0);
    const continuationBrowse = up.calls.browse().find((r) => r.body?.continuation);
    expect(continuationBrowse?.body.continuation).toBe(T_LOFI);
    expect(up.calls.search()).toHaveLength(0); // a continuation NEVER composes
  });

  test("an unshaped cursor string stays on the native browse path (no 500, no compose)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const { res } = await videosPage("http://localhost/api/videos?cursor=tok-ladder-1");
    expect(res.status).toBe(200);
    const continuationBrowse = up.calls.browse().find((r) => r.body?.continuation);
    expect(continuationBrowse?.body.continuation).toBe("tok-ladder-1");
    expect(up.calls.search()).toHaveLength(0);
  });
});

describe("PART 1 — the composed home feed hands the grid the compose cursor", () => {
  test("recommendedCursor resumes AFTER the feed's own rails — zero overlap, all real", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const feed = (await (
      await getHome(new Request("http://localhost/api/home"))
    ).json()) as HomeFeedDTO;

    expect(feed.source).toBe("search-compose");
    const cursor = decodeCursor(feed.recommendedCursor);
    expect(cursor).not.toBeNull();
    // either compose shape — a pool cursor at the consumed prefix, or (when
    // the rails consumed the whole pool) the direct search-phase handoff
    expect(cursor?.s === "pool" || cursor?.s === "search").toBe(true);

    // the grid's first scrolled page continues right after the shown prefix
    const { res, page } = await videosPage(
      `http://localhost/api/videos?limit=12&cursor=${feed.recommendedCursor}`
    );
    expect(res.status).toBe(200);
    const shown = new Set<string>([
      ...(feed.hero ? [feed.hero.id] : []),
      ...feed.recommended.map((v) => v.id),
    ]);
    expect(page.videos.length).toBeGreaterThan(0);
    for (const video of page.videos) {
      expect(shown.has(video.id)).toBe(false); // never repeats the feed's own rails
    }
    if (cursor?.s === "pool") {
      // …the pool resumes at the consumed prefix — exact window, all REAL
      expect(page.videos.map((v) => v.id)).toEqual(POOL_IDS.slice(cursor.o, cursor.o + 12));
      for (const video of page.videos) expect(POOL_IDS.includes(video.id)).toBe(true);
      expect((cursor as { t: (string | null)[] }).t).toEqual([T_LOFI, T_SYNTH_1, T_SYNTH_2]);
    } else {
      // the rails consumed the whole pool → the grid starts on the search
      // chain, seeded by the FIRST tokened query's captured token
      expect(page.videos.map((v) => v.id)).toEqual(["ISQA1", "ISQA2"]);
      expect((cursor as { qi: number }).qi).toBe(0);
      expect((cursor as { t: string }).t).toBe(T_LOFI);
    }
  });
});

describe("PART 2 — /api/search: infinite results", () => {
  test("first page: every existing field identical, +nextCursor wrapping the real continuation", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the unchanged no-cursor shape…
    expect(data.query).toBe("lofi");
    expect(data.videos.length).toBe(40);
    expect(data.videos[0].id).toBe("rFZHOHl-L8A");
    expect(data.videos[0].channel.name).toBe("Lofi Girl");
    expect(Array.isArray(data.channels)).toBe(true);
    expect(typeof data.resultCountText).toBe("string");
    // …plus the additive cursor
    expect(decodeCursor(data.nextCursor)).toEqual({ s: "page", t: T_LOFI });
    // exactly one upstream search (the cached first page)
    expect(up.calls.search()).toHaveLength(1);
  });

  test("empty q → the empty page with nextCursor null, zero upstream", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const res = await searchRoute(new Request("http://localhost/api/search?q="));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(up.recorded).toHaveLength(0);
  });

  test("cursor page: the wrapped token POSTs upstream as {continuation} — videos + nextCursor back", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const first = (await (
      await searchRoute(new Request("http://localhost/api/search?q=lofi"))
    ).json()) as any;

    const res = await searchRoute(
      new Request(`http://localhost/api/search?q=lofi&cursor=${first.nextCursor}`)
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the continuation page's videos (raw server page — the client dedupes)
    expect(data.videos.map((v: any) => v.id)).toEqual(["ISQA1", "ISQA2"]);
    // the first-page-only fields stay first-page-only
    expect(data.channels).toEqual([]);
    expect(data.playlists).toEqual([]);
    expect(data.resultCountText).toBeNull();
    expect(data.correction).toBeNull();
    // the next cursor wraps the page's own continuation token
    expect(decodeCursor(data.nextCursor)).toEqual({ s: "page", t: T_LOFI_2 });

    // upstream got ONLY the continuation (the token encodes the query itself)
    const cont = up.calls.continuations();
    expect(cont).toHaveLength(1);
    expect(cont[0].body.continuation).toBe(T_LOFI);
    expect(cont[0].body.query).toBeUndefined();
    expect(cont[0].body.params).toBeUndefined();

    // …and the chain ends honestly when the token chain does
    const last = await searchRoute(
      new Request(`http://localhost/api/search?q=lofi&cursor=${data.nextCursor}`)
    );
    const lastData = (await last.json()) as any;
    expect(lastData.videos.map((v: any) => v.id)).toEqual(["ISQA3"]);
    expect(lastData.nextCursor).toBeNull();
  });

  test("filtered search: the cursor belongs to the filtered query (token-only upstream)", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    const first = (await (
      await searchRoute(new Request("http://localhost/api/search?q=lofi&type=shorts"))
    ).json()) as any;
    // the filtered first page went upstream with the verified params…
    const firstCall = up.calls.search().find((r) => !r.body?.continuation);
    expect(firstCall?.body.params).toBe("EgIQCQ==");
    // …and its cursor pages the SAME filtered chain (the token is self-contained)
    const res = await searchRoute(
      new Request(`http://localhost/api/search?q=lofi&type=shorts&cursor=${first.nextCursor}`)
    );
    expect(res.status).toBe(200);
    const cont = up.calls.continuations();
    expect(cont).toHaveLength(1);
    expect(cont[0].body.continuation).toBe(T_LOFI);
    expect(cont[0].body.params).toBeUndefined();
  });

  test("garbage cursor → the honest 400 (never a 500), zero upstream", async () => {
    const up = upstreamFake();
    setUpstream(up.impl);
    for (const garbage of [
      "not-a-cursor",
      "%%%bad",
      Buffer.from('{"s":"page"}', "utf8").toString("base64url"), // decodes, wrong shape
      encodeCursor({ s: "pool", o: 1, t: [T_LOFI] }), // a /api/videos envelope, cross-wired
    ]) {
      const res = await searchRoute(
        new Request(`http://localhost/api/search?q=lofi&cursor=${encodeURIComponent(garbage)}`)
      );
      expect(res.status).toBe(400); // honest rejection — the route never throws on cursors
      expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
    }
    expect(up.recorded).toHaveLength(0);
  });
});
