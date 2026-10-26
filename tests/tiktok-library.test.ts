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
  test("default = the in-repo seed (TikTok's own docs example)", () => {
    expect(curatedPostIds()).toEqual([...TIKTOK_SEED]);
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

  test("a garbage env falls back to the seed (never an empty hub by accident)", () => {
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

  test("id mismatch (a foreign row) = honest absence, never rendered", async () => {
    setTikTokUpstream(jsonUpstream({ ...FIXTURE, embed_product_id: "9999999999999999999" }));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeTrue();
    expect(dto.title).toBeNull();
  });

  test("walled egress (5xx) degrades honestly; the embed URL stays built", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("walled", { status: 302 })));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeTrue();
    expect(dto.unavailableReason).toContain("unreachable");
    expect(dto.embedUrl).toContain(`player/v1/${DOCS_ID}`);
  });

  test("a network throw degrades honestly too", async () => {
    setTikTokUpstream(() => Promise.reject(new Error("egress wall")));
    const dto = await getTikTokVideo(DOCS_ID);
    expect(dto.unavailable).toBeTrue();
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
    expect(rail.universeSize).toBe(1);
    expect(rail.videos[0].postId).toBe(DOCS_ID);
    expect(rail.source).toBe("tiktok-oembed");
    expect(rail.unavailable).toBeFalse();
  });

  test("an all-walled rail is honestly unavailable (never fake rows)", async () => {
    setTikTokUpstream(() => Promise.resolve(new Response("no", { status: 500 })));
    const rail = await getTikTokRail();
    expect(rail.unavailable).toBeTrue();
    expect(rail.source).toBe("tiktok-curated");
    expect(rail.videos.every((v) => v.unavailable)).toBeTrue();
  });

  test("search answers only real metadata matches (render-when-answers)", async () => {
    setTikTokUpstream(jsonUpstream(FIXTURE));
    const hit = await searchTikTokLibrary("cute couch");
    expect(hit.videos.length).toBe(1);
    expect(hit.note).toContain("curated");
    const miss = await searchTikTokLibrary("zzzqqq");
    expect(miss.videos).toEqual([]);
    expect(miss.note).toBeNull();
    // A walled lane carries no metadata → no matches, honestly. (The cache
    // still serves the warm answer inside its TTL — clear it to model a cold
    // walled window.)
    clearCache();
    setTikTokUpstream(() => Promise.resolve(new Response("no", { status: 500 })));
    const walled = await searchTikTokLibrary("cute");
    expect(walled.videos).toEqual([]);
  });
});
