/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the library lane battery: the curated universe (seed /
 * env override / dedupe / cap) and the keyless oEmbed lane through the
 * INJECTED upstream seam (the lane law: NO network). The honest-degrade
 * ladder is pinned: walled egress / non-JSON / id mismatch → the unavailable
 * DTO, never a fake row; the remote oEmbed `html` is never rendered.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { clearCache } from "@/lib/youtube/cache";
import { curatedPostIds, getTikTokVideo, getTikTokRail, searchTikTokLibrary, TIKTOK_SEED } from "@/lib/tiktok/library";
import { getTikTokChannelFeedPage } from "@/lib/tiktok/channels";
import { setTikTokUpstream, type TikTokUpstreamFetch } from "@/lib/tiktok/upstream";

const FIXTURE = JSON.parse(readFileSync("tests/fixtures/tiktok/oembed.json", "utf8")) as Record<string, unknown>;
const DOCS_ID = "6718335390845095173";

function jsonUpstream(payload: unknown, status = 200): TikTokUpstreamFetch {
  return () => Promise.resolve(new Response(JSON.stringify(payload), { status }));
}

beforeEach(() => {
  clearCache();
  setTikTokUpstream(null);
  delete process.env.TIKTOK_CURATED_IDS;
});
afterEach(() => setTikTokUpstream(null));

describe("curatedPostIds — the curated universe", () => {
  test("default = the cited universe (docs example first, 17 posts)", () => {
    expect(curatedPostIds()).toEqual([...TIKTOK_SEED]);
    expect(TIKTOK_SEED.length).toBe(17);
    expect(TIKTOK_SEED).toContain(DOCS_ID);
  });

  test("TIKTOK_CURATED_IDS overrides: URLs and bare ids, deduped in order", () => {
    const env: Record<string, string | undefined> = {
      TIKTOK_CURATED_IDS: `https://www.tiktok.com/@a/video/1111111111111111111, 2222222222222222222 ,https://vm.tiktok.com/ZMabc/,1111111111111111111`,
    };
    // the vm short link honestly parses to nothing and is dropped
    expect(curatedPostIds(env)).toEqual(["1111111111111111111", "2222222222222222222"]);
  });

  test("the cap holds at 40", () => {
    // NOTE: build ids as STRINGS — 3e18 exceeds Number.MAX_SAFE_INTEGER and
    // arithmetic collapses them all to one value.
    const env = { TIKTOK_CURATED_IDS: Array.from({ length: 60 }, (_, i) => `3${String(i).padStart(18, "0")}`).join(",") };
    expect(curatedPostIds(env).length).toBe(40);
  });

  test("a garbage env falls back to the cited universe (never an empty hub by accident)", () => {
    const env = { TIKTOK_CURATED_IDS: "garbage,,https://youtube.com/watch?v=x" };
    expect(curatedPostIds(env)).toEqual([...TIKTOK_SEED]);
  });
});

describe("getTikTokVideo — the keyless oEmbed lane (injected seam)", () => {
  test("fixture answer maps to the full DTO; the remote html is never used", async () => {
    setTikTokUpstream(jsonUpstream(FIXTURE));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeFalse();
    expect(dto.postId).toBe(DOCS_ID);
    expect(dto.author).toBe("scout2015");
    expect(dto.title).toBe("Baby cat being cute on the couch");
    expect(dto.thumbnailUrl).toContain("tiktokcdn");
    // WebFlix builds its own embed URL from the documented params…
    expect(dto.embedUrl).toBe(
      `https://www.tiktok.com/player/v1/${DOCS_ID}?music_info=1&description=1&rel=0&controls=1&timestamp=1&closed_caption=1`
    );
    // …and the outbound deep link rides the author shape.
    expect(dto.deepLinkUrl).toBe(`https://www.tiktok.com/@scout2015/video/${DOCS_ID}`);
    expect(dto.source).toBe("tiktok-oembed");
  });

  test("a minimal documented-shape answer still renders an honest card", async () => {
    setTikTokUpstream(
      jsonUpstream({
        version: "1.0",
        type: "video",
        embed_product_id: DOCS_ID,
        provider_name: "TikTok",
      })
    );
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeFalse();
    expect(dto.title).toBeNull();
    expect(dto.author).toBeNull();
    expect(dto.embedUrl).toContain("player/v1");
  });

  test("id mismatch (a foreign row) = honest absence — the cited fallback renders NO fabricated data", async () => {
    setTikTokUpstream(jsonUpstream({ ...FIXTURE, embed_product_id: "9999999999999999999" }));
    const dto = await getTikTokVideo(DOCS_ID);
    // The oEmbed answer lied about the product id → the whole body is refused;
    // DOCS_ID is curated, so the P59 fallback card serves (factual handle,
    // no fabricated title) instead of the old unavailable DTO.
    expect(dto.unavailable).toBeFalse();
    expect(dto.source).toBe("tiktok-curated");
    expect(dto.author).toBe("scout2015");
    expect(dto.title).toBeNull();
    expect(dto.thumbnailUrl).toBeNull();
  });

  test("walled egress (5xx): a cited post falls back to its factual handle, embed URL intact", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("walled", { status: 302 })));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeFalse();
    expect(dto.source).toBe("tiktok-curated");
    expect(dto.author).toBe("scout2015");
    expect(dto.authorUrl).toBe("https://www.tiktok.com/@scout2015");
    expect(dto.deepLinkUrl).toBe(`https://www.tiktok.com/@scout2015/video/${DOCS_ID}`);
    expect(dto.title).toBeNull();
    expect(dto.embedUrl).toContain(`player/v1/${DOCS_ID}`);
  });

  test("walled egress for a NON-curated id degrades to the honest unavailable card", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("walled", { status: 302 })));
    const dto = await getTikTokVideo("9123456789012345678");
    expect(dto.unavailable).toBeTrue();
    expect(dto.unavailableReason).toContain("unreachable");
    expect(dto.author).toBeNull();
    expect(dto.embedUrl).toContain("player/v1/9123456789012345678");
  });

  test("a network throw: a cited post still serves its fallback card", async () => {
    setTikTokUpstream(() => Promise.reject(new Error("egress wall")));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeFalse();
    expect(dto.source).toBe("tiktok-curated");
  });

  test("a non-post-id short-circuits without any fetch", async () => {
    let calls = 0;
    setTikTokUpstream(() => {
      calls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const dto = await getTikTokVideo("bogus");
    expect(dto.unavailable).toBeTrue();
    expect(calls).toBe(0);
  });
});

describe("the rail + the search lane", () => {
  test("the rail composes every curated post with provenance", async () => {
    setTikTokUpstream(jsonUpstream(FIXTURE));
    const rail = await getTikTokRail();
    expect(rail.universeSize).toBe(17);
    // Only the docs id matches the fixture's embed_product_id — every other
    // row is refused as a foreign body and falls back to its cited handle.
    expect(rail.videos[0].postId).toBe(DOCS_ID);
    expect(rail.videos[0].source).toBe("tiktok-oembed");
    expect(rail.source).toBe("tiktok-oembed");
    expect(rail.unavailable).toBeFalse();
  });

  test("an all-walled rail serves the cited fallback cards (honest, renderable)", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("no", { status: 500 })));
    const rail = await getTikTokRail();
    expect(rail.unavailable).toBeFalse();
    expect(rail.source).toBe("tiktok-curated");
    expect(rail.universeSize).toBe(17);
    expect(rail.videos.every((v) => v.source === "tiktok-curated" && !v.unavailable)).toBeTrue();
    expect(rail.videos.every((v) => v.author !== null)).toBeTrue();
    expect(rail.videos.every((v) => v.title === null)).toBeTrue();
  });

  test("search answers only real metadata matches (render-when-answers)", async () => {
    setTikTokUpstream(jsonUpstream(FIXTURE));
    const hit = await searchTikTokLibrary("cute couch");
    expect(hit.videos.length).toBe(1);
    expect(hit.note).toContain("curated");
    const miss = await searchTikTokLibrary("zzzqqq");
    expect(miss.videos).toEqual([]);
    expect(miss.note).toBeNull();
    // A walled lane carries no titles → text matches honestly miss…
    clearCache();
    setTikTokUpstream(() => Promise.resolve(new Response("no", { status: 500 })));
    const walled = await searchTikTokLibrary("cute");
    expect(walled.videos).toEqual([]);
    // …but a cited HANDLE still answers, with the fallback's provenance.
    const byHandle = await searchTikTokLibrary("scout2015");
    expect(byHandle.videos.length).toBe(1);
    expect(byHandle.source).toBe("tiktok-curated");
    expect(byHandle.videos[0].author).toBe("scout2015");
  });
});

// ---------------------------------------------------------------------------
// P96-a — getTikTokChannelFeedPage (the gap report's G17, the
// profile-playback gap): the channel matcher's { items, nextCursor } feed.
// A routing upstream varies the author BY post id so the scope law is
// pinned against a genuinely two-creator universe (no network — the lane
// law holds; every response still carries the matching embed_product_id).
// ---------------------------------------------------------------------------
const ROUTE_IDS = { scout1: "6718335390845095173", scout2: "7206561191609716014", scout3: "7157587293451062574", other: "7322301313134415134" };

function authorUpstream(): TikTokUpstreamFetch {
  const authorByPost: Record<string, string> = {
    [ROUTE_IDS.scout1]: "scout2015",
    [ROUTE_IDS.scout2]: "scout2015",
    [ROUTE_IDS.scout3]: "scout2015",
    [ROUTE_IDS.other]: "othercreator",
  };
  return (url: string) => {
    // the oEmbed request carries the target percent-encoded inside
    // `?url=` — decode before extracting the id (either URL shape)
    let target = url;
    try {
      const q = url.split("url=")[1];
      if (q) target = decodeURIComponent(q);
    } catch {
      /* keep the raw url */
    }
    const m = target.match(/\/(?:video|player\/v1)\/(\d+)/);
    const id = m?.[1] ?? "";
    const author = authorByPost[id];
    if (!author) return Promise.resolve(new Response("nope", { status: 404 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          version: "1.0",
          type: "video",
          title: `Post ${id}`,
          author_url: `https://www.tiktok.com/@${author}`,
          author_name: author,
          embed_product_id: id,
        }),
        { status: 200 },
      ),
    );
  };
}

async function scopedPage(handle: string, opts: Parameters<typeof getTikTokChannelFeedPage>[0] = {}) {
  return getTikTokChannelFeedPage({ handle, ...opts });
}

describe("getTikTokChannelFeedPage — the P96-a scoped-feed law", () => {
  test("the scope pages over the creator's verifiable posts only", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const page = await scopedPage("scout2015");
    expect(page).not.toBeNull();
    expect(page!.items.map((v) => v.postId)).toEqual([
      ROUTE_IDS.scout1,
      ROUTE_IDS.scout2,
      ROUTE_IDS.scout3,
    ]);
    // the scope's own universe is exhausted → the honest end
    expect(page!.nextCursor).toBeNull();
  });

  test("the handle match is case-insensitive (the channel page's own law)", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const page = await scopedPage("Scout2015");
    expect(page!.items).toHaveLength(3);
  });

  test("a DIFFERENT creator's scope answers only their rows", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const page = await scopedPage("othercreator");
    expect(page!.items.map((v) => v.postId)).toEqual([ROUTE_IDS.other]);
    expect(page!.nextCursor).toBeNull();
  });

  test("a valid handle with zero shelf posts answers the honest empty page", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const page = await scopedPage("nobodyhere");
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  test("an in-scope deep-link post splices FIRST; a FOREIGN post is never smuggled in", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const inScope = await scopedPage("scout2015", { post: ROUTE_IDS.scout2 });
    expect(inScope!.items[0].postId).toBe(ROUTE_IDS.scout2);
    expect(inScope!.items.map((v) => v.postId)).toEqual([
      ROUTE_IDS.scout2,
      ROUTE_IDS.scout1,
      ROUTE_IDS.scout3,
    ]);
    // the foreign post (othercreator's) does NOT lead scout2015's scope
    const foreign = await scopedPage("scout2015", { post: ROUTE_IDS.other });
    expect(foreign!.items.map((v) => v.postId)).toEqual([
      ROUTE_IDS.scout1,
      ROUTE_IDS.scout2,
      ROUTE_IDS.scout3,
    ]);
  });

  test("cursor paging continues AFTER the cursor with no overlap; a foreign cursor honestly ends", async () => {
    clearCache();
    process.env.TIKTOK_CURATED_IDS = Object.values(ROUTE_IDS).join(",");
    setTikTokUpstream(authorUpstream());
    const page1 = await scopedPage("scout2015", { limit: 2 });
    expect(page1!.items.map((v) => v.postId)).toEqual([ROUTE_IDS.scout1, ROUTE_IDS.scout2]);
    expect(page1!.nextCursor).toBe(ROUTE_IDS.scout2);
    const page2 = await scopedPage("scout2015", { cursor: page1!.nextCursor });
    expect(page2!.items.map((v) => v.postId)).toEqual([ROUTE_IDS.scout3]);
    expect(page2!.nextCursor).toBeNull();
    // a cursor the scope does not own → the honest end (never a restart loop)
    const foreignCursor = await scopedPage("scout2015", { cursor: ROUTE_IDS.other });
    expect(foreignCursor).toEqual({ items: [], nextCursor: null });
  });

  test("an empty handle answers null (the route's isTikTokHandle gate owns the 400)", async () => {
    clearCache();
    setTikTokUpstream(authorUpstream());
    // the library nulls only on the un-parseable form; a format-weird but
    // non-empty string rides the honest-empty page and the ROUTE's own
    // isTikTokHandle gate answers 400 before the library is reached
    expect(await scopedPage("")).toBeNull();
    expect(await scopedPage("@")).toBeNull();
  });

  test("the import hint admits a walled post the URL law cannot verify otherwise", async () => {
    clearCache();
    const walledId = "7371838707747278122";
    process.env.TIKTOK_CURATED_IDS = `${ROUTE_IDS.scout1},${walledId}`;
    // the routing upstream 404s the walled id (the honest unavailable DTO)
    setTikTokUpstream(authorUpstream());
    const page = await scopedPage("scout2015", {
      hintByPostId: new Map([[walledId, "scout2015"]]),
    });
    expect(page!.items.map((v) => v.postId)).toEqual([ROUTE_IDS.scout1, walledId]);
    // the hinted row rides the factual importedFallback DTO, not a fake one
    expect(page!.items[1].author).toBe("scout2015");
  });
});
