/// <reference types="bun-types" />
/**
 * WFX2-A-S — shorts DTO mapping tests. FIXTURES ONLY (no live network).
 *
 * Fixtures:
 * - tests/fixtures/yt/search_lofi.json — REAL search capture (25
 *   shortsLockupViewModel items across 2 shorts shelves + sequenceParams).
 * - tests/fixtures/yt/reel_sequence_synth.json — SYNTHETIC-BUT-SHAPED-FROM-
 *   REAL reel_watch_sequence response (marked in-file; the real capture is
 *   in evidence/wfx2as/).
 * - tests/fixtures/yt/next_dQw4.json + comments_dQw4.json — REAL watch-next
 *   + comments captures (per-short metadata + first comments page).
 */
import { describe, expect, test } from "bun:test";
import {
  extractShortsFromSearch,
  getShortMeta,
  mapCommentsPage,
  mapReelSequence,
  mapShortsLockup,
  reelSequenceBody,
  splitAccessibilityText,
} from "@/lib/youtube/shorts";

const searchLofi = await Bun.file("tests/fixtures/yt/search_lofi.json").json();
const reelSeq = await Bun.file(
  "tests/fixtures/yt/reel_sequence_synth.json",
).json();
const nextDQw4 = await Bun.file("tests/fixtures/yt/next_dQw4.json").json();
const commentsDQw4 = await Bun.file(
  "tests/fixtures/yt/comments_dQw4.json",
).json();

describe("shorts seed extraction — REAL search_lofi fixture", () => {
  const { items, sequenceParams } = extractShortsFromSearch(searchLofi);

  test("finds all 25 shorts shelf items (2 shelves: 5 + 20)", () => {
    expect(items).toHaveLength(25);
  });

  test("extracts a sequenceParams token from the first reelWatchEndpoint", () => {
    expect(sequenceParams).toBeTypeOf("string");
    expect(sequenceParams!.length).toBeGreaterThan(30);
  });

  test("DTO fields: id, title, viewsText, thumbnail from the lockup", () => {
    const first = items[0];
    expect(first.id).toBe("vCxGMKtyAHE");
    expect(first.title).toBe(
      "🎧 Lofi Hip-Hop Radio 🌙 24/7 Live | Chill Beats for Study, Work & Relax",
    );
    expect(first.viewsText).toBe("816 views");
    expect(first.thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\//);
    expect(first.likesText).toBeNull();
    expect(first.commentsCountText).toBeNull();
    // channel unknown at seed time (client hydrates per short)
    expect(first.channel).toEqual({
      id: "",
      handle: null,
      name: null,
      avatarUrl: null,
    });
  });

  test("ids are unique", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  test("accessibilityText splitter handles the real formats", () => {
    expect(
      splitAccessibilityText(
        "🎧 Lofi Hip-Hop Radio 🌙 24/7 Live | Chill Beats, 816 views - play Short",
      ),
    ).toEqual({
      title: "🎧 Lofi Hip-Hop Radio 🌙 24/7 Live | Chill Beats",
      viewsText: "816 views",
    });
    expect(splitAccessibilityText("no views marker - play Short")).toEqual({
      title: "no views marker",
      viewsText: null,
    });
    expect(splitAccessibilityText("just a string")).toEqual({
      title: "just a string",
      viewsText: null,
    });
  });

  test("mapShortsLockup returns null for non-lockup input", () => {
    expect(mapShortsLockup(null)).toBeNull();
    expect(mapShortsLockup({ shortsLockupViewModel: {} })).toBeNull();
    expect(mapShortsLockup({})).toBeNull();
  });
});

describe("reel sequence mapping — SYNTHETIC-shaped-from-real fixture", () => {
  test("maps entries to bare ShortDTOs (ids only) + next cursor", () => {
    const feed = mapReelSequence(reelSeq);
    expect(feed.items).toHaveLength(4);
    expect(feed.items.every((i) => i.title === "")).toBe(true);
    expect(feed.items[0].id).toBeTypeOf("string");
    expect(feed.items[0].id.length).toBe(11);
    expect(feed.nextCursor).toBeTypeOf("string");
  });

  test("reelSequenceBody puts sequenceParams at TOP LEVEL (verified live)", () => {
    const body = reelSequenceBody("TOKEN123");
    expect(body.sequenceParams).toBe("TOKEN123");
    expect((body as Record<string, unknown>).params).toBeUndefined();
    expect((body as Record<string, unknown>).context).toBeDefined();
  });

  test("mapReelSequence tolerates empty responses", () => {
    expect(mapReelSequence({})).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("comments page mapping — REAL comments_dQw4 fixture", () => {
  const page = mapCommentsPage(commentsDQw4);

  test("maps 20 top-level comments with entity payloads", () => {
    expect(page.comments).toHaveLength(20);
    const first = page.comments[0];
    expect(first.authorName).toBe("@YouTube");
    expect(first.authorHandle).toBe("@YouTube");
    expect(first.body).toBe("can confirm: he never gave us up");
    expect(first.publishedTime).toBe("1 year ago");
    expect(first.isVerified).toBe(true);
    expect(first.authorAvatarUrl).toMatch(/^https:\/\//);
    expect(first.authorChannelId).toBe("UCBR8-60-B28hp2BmDPdntcQ");
  });

  test("comments count text from commentsHeaderRenderer", () => {
    expect(page.commentsCountText).toBe("2,457,856 Comments");
  });

  test("reply count parsed from viewReplies text (963 replies)", () => {
    expect(page.comments[0].replyCount).toBe(963);
  });

  test("creator heart + pin markers", () => {
    expect(page.comments[0].heartedByCreator).toBe(true);
    expect(page.comments[0].pinned).toBe(true);
  });

  test("next comments page token present", () => {
    expect(page.nextToken).toBeTypeOf("string");
  });
});

describe("getShortMeta — REAL next_dQw4 + comments_dQw4 via stubbed fetcher", () => {
  test("full per-short metadata mapping (no live network)", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      const isNext = u.includes("/youtubei/v1/next");
      // first next() call = watch page; second = comments continuation
      const isCommentsCall = isNext && calls.filter((c) => c.includes("/next")).length > 1;
      const body = isCommentsCall ? commentsDQw4 : nextDQw4;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const meta = await getShortMeta("dQw4w9WgXcQ", fetcher);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("dQw4w9WgXcQ");
    expect(meta!.title).toBe(
      "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    );
    expect(meta!.channel.name).toBe("Rick Astley");
    expect(meta!.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(meta!.channel.handle).toBe("RickAstleyYT");
    expect(meta!.channel.avatarUrl).toMatch(/^https:\/\//);
    expect(meta!.viewsText).toBe("1.8B views");
    expect(meta!.dateText).toBe("Oct 25, 2009");
    expect(meta!.commentsCountText).toBe("2,457,856 Comments");
    expect(meta!.comments).toHaveLength(20);
    expect(meta!.commentsNextToken).toBeTypeOf("string");
    // exactly two upstream calls: next + comments continuation
    expect(calls).toHaveLength(2);
  });

  test("returns null when next() fails", async () => {
    const fetcher = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await getShortMeta("dQw4w9WgXcQ", fetcher)).toBeNull();
  });

  test("comments failure degrades to metadata-only", async () => {
    let nextCall = 0;
    const fetcher = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/next")) {
        nextCall += 1;
        if (nextCall === 1) return new Response(JSON.stringify(nextDQw4), { status: 200 });
        return new Response("{}", { status: 500 });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const meta = await getShortMeta("dQw4w9WgXcQ", fetcher);
    expect(meta).not.toBeNull();
    expect(meta!.title).toContain("Never Gonna Give You Up");
    expect(meta!.comments).toHaveLength(0);
  });
});
