/// <reference types="bun-types" />
/**
 * WFX2-A-B mapper tests — pure functions against the recorded fixtures in
 * tests/fixtures/yt/ (real youtube.com responses; never the network).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  walkTree,
  runsText,
  parseDuration,
  parseCompactCount,
  parseViewCount,
  parseSpelledCount,
  viewsFromTexts,
  parseSubscriberCount,
  parseVideoCount,
  relativeAgeToDate,
  mapVideos,
  mapShorts,
  mapVideoRenderer,
  mapLockupViewModel,
  mapShortsLockupViewModel,
  mapChannelHeader,
  videoThumbnailUrl,
  shortsThumbnailUrl,
} from "@/lib/youtube/mappers";
import { mapRelatedPage } from "@/lib/youtube/related";
import { mapAutoplay } from "@/lib/youtube/autoplay";
import { commentsTokenFromWatchResponse, mapCommentsPage } from "@/lib/youtube/comments";
import { mapWatchMetadata } from "@/lib/youtube/watch";
import { mapHomeShelves } from "@/lib/youtube/feeds";
import { extractYtInitialData } from "@/lib/youtube/ssr";
import { parseAutocomplete } from "@/lib/youtube/suggest";
import { buildSearchParam, parseSearchFilters } from "@/lib/youtube/filters";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

// ---------------------------------------------------------------------------
// parsing tables
// ---------------------------------------------------------------------------

describe("duration parsing", () => {
  test.each([
    ["12:34", 754],
    ["0:47", 47],
    ["1:02:03", 3723],
    ["3:31:19", 12679],
    ["9:26", 566],
    ["4:22:26", 15746],
    ["9 minutes, 26 seconds", 566],
    ["4 hours, 22 minutes, 26 seconds", 15746],
    ["LIVE", null],
    ["", null],
    [null, null],
    ["99:99", null],
  ] as [string, number | null][])("%s → %s", (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });
});

describe("view-count parsing", () => {
  test.each([
    ["5,561,627 views", 5561627],
    ["1.2M views", 1_200_000],
    ["1.8B views", 1_800_000_000],
    ["918 views", 918],
    ["89K views", 89_000],
    ["No views", 0],
    ["9,619 watching", null],
    ["", null],
  ] as [string, number | null][])("%s → %s", (text, expected) => {
    expect(parseViewCount(text)).toBe(expected);
  });

  test("accessibility text expands to exact numbers", () => {
    expect(parseSpelledCount("345 thousand views")).toBe(345_000);
    expect(parseSpelledCount("2.55 million subscribers")).toBe(2_550_000);
    expect(viewsFromTexts("345K", "345 thousand views")).toBe(345_000);
    expect(viewsFromTexts("1.3B", null)).toBe(1_300_000_000);
    expect(viewsFromTexts(null, null)).toBe(0);
  });

  test("compact counts", () => {
    expect(parseCompactCount("321K")).toBe(321_000);
    expect(parseCompactCount("7.9K")).toBe(7_900);
    expect(parseCompactCount("141")).toBe(141);
    expect(parseCompactCount("4.55M")).toBe(4_550_000);
    expect(parseCompactCount("n/a")).toBe(null);
  });

  test("subscriber + video counts", () => {
    expect(parseSubscriberCount("4.55M subscribers")).toBe(4_550_000);
    expect(parseSubscriberCount("918 subscribers")).toBe(918);
    expect(parseSubscriberCount("15.8M subscribers")).toBe(15_800_000);
    expect(parseVideoCount("437 videos")).toBe(437);
  });
});

describe("relative age passthrough → approximate dates", () => {
  test.each([
    ["16 years ago", 16 * 31_536_000],
    ["3 months ago", 3 * 2_592_000],
    ["15y ago", 15 * 31_536_000],
    ["4mo ago", 4 * 2_592_000],
    ["Streamed 2y ago", 2 * 31_536_000],
    ["1 day ago", 86_400],
  ] as [string, number][])("%s ≈ %ss ago", (text, seconds) => {
    const iso = relativeAgeToDate(text, new Date(0));
    expect(iso).not.toBeNull();
    const delta = Math.abs(-new Date(iso!).getTime() - seconds * 1000);
    expect(delta).toBeLessThan(1000);
  });

  test("unparseable ages stay null (never invented)", () => {
    expect(relativeAgeToDate(null)).toBeNull();
    expect(relativeAgeToDate("Oct 25, 2009")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// search_lofi — videoRenderer + shortsLockupViewModel
// ---------------------------------------------------------------------------

describe("search_lofi fixture → VideoDTOs", () => {
  const response = load("search_lofi");
  const videos = mapVideos(response);
  const shorts = mapShorts(response);

  test("maps the real result set (45 cards incl. shorts, 25 shorts)", () => {
    expect(videos.length).toBe(45);
    expect(shorts.length).toBe(25);
  });

  test("first result is the live Lofi Girl radio (honest live mapping)", () => {
    const v0 = videos[0];
    expect(v0.id).toBe("rFZHOHl-L8A");
    expect(v0.title).toContain("lofi hip hop radio");
    expect(v0.channel.name).toBe("Lofi Girl");
    expect(v0.channel.id).toBe("UCSJ4gkVC6NrvII8umztf0Ow");
    expect(v0.isLive).toBe(true);
    expect(v0.durationSec).toBeNull();
    expect(v0.viewsText).toBe("9,619 watching");
    expect(v0.views).toBe(0); // live viewcounts are not view totals — never invented
  });

  test("regular result carries id/title/channel/duration/views/age", () => {
    const v = videos.find((x) => x.id === "BYTxPFj44uo")!;
    expect(v).toBeDefined();
    expect(v.title).toContain("Why the rush?");
    expect(v.durationSec).toBe(12679); // "3:31:19"
    expect(v.views).toBe(5_561_627);
    expect(v.viewsText).toBe("5,561,627 views");
    expect(v.publishedText).toBe("1y ago");
    expect(v.channel.name).toBe("chill chill journal");
    expect(v.thumbnailUrl).toBe(videoThumbnailUrl("BYTxPFj44uo"));
    expect(v.videoUrl).toBe("https://www.youtube.com/watch?v=BYTxPFj44uo");
    expect(v.isLive).toBe(false);
  });

  test("shorts map with vertical thumbnails and no duration", () => {
    const s = shorts.find((x) => x.id === "vCxGMKtyAHE")!;
    expect(s).toBeDefined();
    expect(s.isShort).toBe(true);
    expect(s.thumbnailUrl).toBe(shortsThumbnailUrl("vCxGMKtyAHE"));
    expect(s.durationSec).toBeNull();
    expect(s.title.length).toBeGreaterThan(0);
    expect(s.views).toBe(816);
  });

  test("raw videoRenderer mapper (title via runs, owner badges → verified)", () => {
    const raw = walkTree(response, "videoRenderer").find(
      (r: any) => r.videoId === "BYTxPFj44uo"
    )!;
    const dto = mapVideoRenderer(raw)!;
    expect(dto.title).toContain("Why the rush?");
    expect(dto.channel.verified).toBe(true); // BADGE_STYLE_TYPE_VERIFIED_ARTIST
    expect(dto.badges).toContain("verified_artist");
  });
});

// ---------------------------------------------------------------------------
// next_dQw4 — watch metadata + related + autoplay + comments token
// ---------------------------------------------------------------------------

describe("next_dQw4 fixture → watch metadata", () => {
  const response = load("next_dQw4");
  const meta = mapWatchMetadata("dQw4w9WgXcQ", response);

  test("title / views / likes / dates come from the real response", () => {
    expect(meta.video.title).toBe(
      "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"
    );
    expect(meta.video.views).toBe(1_821_187_782);
    expect(meta.video.viewsText).toBe("1,821,187,782 views");
    expect(meta.video.likes).toBe(19_427_647); // exact via accessibility text
    expect(meta.video.likeCountText).toBe("19M");
    expect(meta.video.publishedText).toBe("16 years ago");
    expect(meta.video.createdAt).toBe("2009-10-25T00:00:00.000Z");
  });

  test("channel block (name, handle, id, subs, avatar)", () => {
    expect(meta.video.channel.name).toBe("Rick Astley");
    expect(meta.video.channel.handle).toBe("@RickAstleyYT");
    expect(meta.video.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(meta.video.channel.subscriberCount).toBe(4_550_000);
    expect(meta.video.channel.subscriberCountText).toBe("4.55M subscribers");
    expect(meta.video.channel.avatarUrl).toMatch(/^https:\/\//);
  });

  test("description carried whole; duration unknown (next carries none)", () => {
    expect(meta.video.description.length).toBeGreaterThan(1000);
    expect(meta.video.description).toContain("Never Gonna Give You Up");
    expect(meta.video.durationSec).toBeNull();
  });

  test("related rail: 26 lockup items with durations, views, ages, avatars", () => {
    const related = mapRelatedPage(response);
    expect(related.items.length).toBe(26);
    const first = related.items[0];
    expect(first.id).toBe("eOb1Z1dcLOw");
    expect(first.durationSec).toBe(15746); // "4:22:26"
    expect(first.views).toBe(345_000);
    expect(first.viewsText).toBe("345K views");
    expect(first.publishedText).toBe("4mo ago");
    expect(first.channel.name).toBe("Pop Hits Central");
    expect(first.channel.avatarUrl).toMatch(/^https:\/\//);
  });

  test("autoplay set → next-up DTO", () => {
    const ap = mapAutoplay(response);
    expect(ap.video?.id).toBe("lMRr7O2ineA");
    expect(ap.video?.title).toContain("it's summer 1985");
    expect(ap.countDownSecs).toBe(5);
  });

  test("comments continuation token extracted from comment-item-section", () => {
    const token = commentsTokenFromWatchResponse(response);
    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// comments_dQw4 — continuation walking
// ---------------------------------------------------------------------------

describe("comments_dQw4 fixture → CommentDTOs", () => {
  const response = load("comments_dQw4");
  const page = mapCommentsPage(response, null);

  test("20 comments per page + honest header total + next-page cursor", () => {
    expect(page.items.length).toBe(20);
    expect(page.total).toBe(2_457_856);
    expect(typeof page.nextCursor).toBe("string");
  });

  test("pinned first comment mapped from commentEntityPayload", () => {
    const c0 = page.items[0];
    expect(c0.id).toBe("Ugzge340dBgB75hWBm54AaABAg");
    expect(c0.pinned).toBe(true);
    expect(c0.body).toBe("can confirm: he never gave us up");
    expect(c0.likes).toBe(321_000);
    expect(c0.likesText).toBe("321K");
    expect(c0.replyCount).toBe(963);
    expect(c0.author.name).toBe("@YouTube");
    expect(c0.author.handle).toBe("@YouTube");
    expect(c0.author.avatarUrl).toMatch(/^https:\/\//);
    expect(c0.publishedText).toBe("1 year ago");
    expect(c0.edited).toBe(false);
  });

  test("a reply token rides on the thread (nested continuationCommand)", () => {
    expect(typeof page.items[0].repliesToken).toBe("string");
    expect(page.items[0].repliesToken!.length).toBeGreaterThan(50);
  });

  test("edited detection from the publishedTime suffix", () => {
    const edited = page.items.find((c) => c.edited);
    expect(edited).toBeDefined();
    expect(edited!.publishedText).toBe("6 years ago (edited)");
  });

  test("sort-token variants: Top vs Newest continuation tokens", () => {
    expect(page.sortTokens.top).toBeTruthy();
    expect(page.sortTokens.newest).toBeTruthy();
    expect(page.sortTokens.top).not.toBe(page.sortTokens.newest);
  });
});

// ---------------------------------------------------------------------------
// comments_replies_dQw4 — the 2026 REPLIES page (appendContinuationItemsAction
// + BARE commentViewModel rows; entities in the same response's mutations)
// ---------------------------------------------------------------------------

describe("comments_replies_dQw4 fixture (replies page) → reply CommentDTOs", () => {
  const response = load("comments_replies_dQw4");
  const PARENT = "Ugzge340dBgB75hWBm54AaABAg"; // the pinned @YouTube thread
  const page = mapCommentsPage(response, PARENT);

  test("10 bare commentViewModel rows map through the shared entity lookup", () => {
    expect(page.items.length).toBe(10);
    for (const r of page.items) {
      expect(r.parentId).toBe(PARENT);
      expect(r.body).not.toBe("");
      expect(r.author.name).not.toBe("");
      expect(r.author.avatarUrl).toMatch(/^https:\/\//);
      // no thread envelope on replies pages → no nested replies token
      expect(r.repliesToken).toBeNull();
    }
  });

  test("first reply fields from its commentEntityPayload (keyed by commentKey)", () => {
    const r0 = page.items[0];
    expect(r0.id).toBe("Ugzge340dBgB75hWBm54AaABAg.AHE8_QAWJx9AHE9eIiztxR");
    expect(r0.body).toBe("YOUTUBE AND ONE LIKE WOOHAAAAH");
    expect(r0.author.handle).toBe("@linganguliguliwatcha");
    expect(r0.likesText).toBe("7.5K");
    expect(r0.likes).toBe(7_500);
    expect(r0.publishedText).toBe("1 year ago");
    expect(r0.edited).toBe(false);
  });

  test("toolbar state + surface: unhearted, no viewer like, no replyCommand (logged-out)", () => {
    for (const r of page.items) {
      expect(r.heartedByCreator).toBe(false);
      expect(r.yourLike).toBeNull();
      // logged-out surfaces carry prepareAccountCommand (sign-in modal), not
      // replyCommand — the honest null DTO
      expect(r.replyParams).toBeNull();
    }
  });

  test("pagination: next cursor read from the Show-more-replies button form", () => {
    expect(typeof page.nextCursor).toBe("string");
    expect(page.nextCursor!.length).toBeGreaterThan(50);
    // replies pages carry no header row
    expect(page.total).toBeNull();
    expect(page.sortTokens.top).toBeNull();
  });
});

describe("appendContinuationItemsAction — top-level page 2+ shape (thread envelopes)", () => {
  test("commentThreadRenderer rows inside appendContinuationItemsAction map (live page-2 shape)", () => {
    // hand-built from the live 2026 shape: later TOP-LEVEL pages also arrive
    // as appendContinuationItemsAction (targetId "comments-section"), still
    // with commentThreadRenderer envelopes — reusing the real fixture's rows
    const real = load("comments_dQw4");
    const threads = real.onResponseReceivedEndpoints[1].reloadContinuationItemsCommand.continuationItems.filter(
      (it: any) => it.commentThreadRenderer,
    );
    const synthetic = {
      frameworkUpdates: real.frameworkUpdates,
      onResponseReceivedEndpoints: [
        {
          appendContinuationItemsAction: {
            targetId: "comments-section",
            continuationItems: threads,
          },
        },
      ],
    };
    const page = mapCommentsPage(synthetic, null);
    expect(page.items.length).toBe(20);
    expect(page.items[0].id).toBe("Ugzge340dBgB75hWBm54AaABAg");
    expect(page.items[0].pinned).toBe(true);
    expect(page.items[0].repliesToken).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// home_feed — the real (empty) unauthenticated feed
// ---------------------------------------------------------------------------

describe("home_feed fixture (feedNudge) → graceful empty rails", () => {
  const response = load("home_feed");

  test("no shelves, no videos, no shorts — honest empty mapping", () => {
    expect(mapHomeShelves(response)).toHaveLength(0);
    expect(mapVideos(response)).toHaveLength(0);
    expect(mapShorts(response)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ssr_trending + ssr_subscriptions
// ---------------------------------------------------------------------------

describe("ssr_trending fixture → rail", () => {
  const response = load("ssr_trending");
  const videos = mapVideos(response);
  const shorts = mapShorts(response);

  test("maps videos and shorts from the real trending grid", () => {
    expect(videos.length).toBe(38);
    expect(shorts.length).toBe(18);
  });

  test("lockupViewModel fields (duration badge, views, age, channel avatar)", () => {
    const mj = videos.find((v) => v.id === "h_D3VFfhvs4")!;
    expect(mj.title).toBe("Michael Jackson - Smooth Criminal (Official Video)");
    expect(mj.channel.name).toBe("Michael Jackson");
    expect(mj.durationSec).toBe(566); // "9:26"
    expect(mj.views).toBe(1_300_000_000); // "1.3B"
    expect(mj.publishedText).toBe("15y ago");
    expect(mj.channel.avatarUrl).toMatch(/^https:\/\//);
  });

  test("raw lockup mapper", () => {
    const raw = walkTree(response, "lockupViewModel").find(
      (l: any) => l.contentId === "h_D3VFfhvs4"
    )!;
    const dto = mapLockupViewModel(raw)!;
    expect(dto.id).toBe("h_D3VFfhvs4");
    expect(dto.durationSec).toBe(566);
  });
});

describe("ssr_subscriptions fixture → items", () => {
  test("95 items mapped (matches the verification log count)", () => {
    const response = load("ssr_subscriptions");
    expect(mapVideos(response).length).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// channel_rickastley — header + videos
// ---------------------------------------------------------------------------

describe("channel_rickastley fixture → channel page", () => {
  const response = load("channel_rickastley");

  test("pageHeaderViewModel → header fields", () => {
    const header = mapChannelHeader(response)!;
    expect(header.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(header.handle).toBe("@RickAstleyYT");
    expect(header.name).toBe("Rick Astley");
    expect(header.subscriberCount).toBe(4_550_000);
    expect(header.subscriberCountText).toBe("4.55M subscribers");
    expect(header.videoCountText).toBe("437 videos");
    expect(header.avatarUrl).toMatch(/^https:\/\//);
    expect(header.bannerUrl).toMatch(/^https:\/\//);
    expect(header.description).toContain("Rick Astley");
  });

  test("videos + shorts from the home-tab shelves", () => {
    const videos = mapVideos(response);
    const shorts = mapShorts(response);
    expect(videos.length).toBe(79);
    expect(shorts.length).toBe(20);
    expect(videos[0].channel.name).toBe("Rick Astley");
  });
});

// ---------------------------------------------------------------------------
// SSR extraction + autocomplete parsing
// ---------------------------------------------------------------------------

describe("SSR ytInitialData extraction", () => {
  test("the verified regex pulls the JSON out of page HTML", () => {
    const data = { contents: { hello: "world" }, deep: [1, 2, 3] };
    const html = `<!doctype html><html><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script><script>other stuff</script></html>`;
    expect(extractYtInitialData(html)).toEqual(data);
  });

  test("missing payload throws (never returns invented data)", () => {
    expect(() => extractYtInitialData("<html>no data</html>")).toThrow();
  });
});

describe("autocomplete JSONP parsing", () => {
  test("fixture body → clean suggestion array", () => {
    const raw = load("autocomplete_lofi").raw as string;
    const suggestions = parseAutocomplete(raw);
    expect(suggestions[0]).toBe("lofi hip hop");
    expect(suggestions).toContain("lofi hip hop radio");
    expect(suggestions.length).toBe(14);
  });

  test("garbage bodies → empty array", () => {
    expect(parseAutocomplete("")).toEqual([]);
    expect(parseAutocomplete("not jsonp at all")).toEqual([]);
    expect(parseAutocomplete("callback([broken")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filter params builder — the ground-truth table (fixture + live verified)
// ---------------------------------------------------------------------------

describe("search filter params (base64 protobuf)", () => {
  test.each([
    ["type=video", { type: "video" }, "EgIQAQ=="],
    ["type=channel", { type: "channel" }, "EgIQAg=="],
    ["type=playlist", { type: "playlist" }, "EgIQAw=="],
    ["type=movie", { type: "movie" }, "EgIQBA=="],
    ["type=shorts", { type: "shorts" }, "EgIQCQ=="],
    ["uploadDate=hour", { uploadDate: "hour" }, "EgIIAQ=="],
    ["uploadDate=today", { uploadDate: "today" }, "EgIIAg=="],
    ["uploadDate=week", { uploadDate: "week" }, "EgIIAw=="],
    ["uploadDate=month", { uploadDate: "month" }, "EgIIBA=="],
    ["uploadDate=year", { uploadDate: "year" }, "EgIIBQ=="],
    ["duration=short (under 3 min)", { duration: "short" }, "EgIYBA=="],
    ["duration=long (over 20 min)", { duration: "long" }, "EgIYAg=="],
    ["sort=views", { sort: "views" }, "CAM="],
    ["sort=date", { sort: "date" }, "CAI="],
    ["sort=rating", { sort: "rating" }, "CAE="],
    ["sort=relevance", {}, ""],
    ["video+today", { type: "video", uploadDate: "today" }, "EgQIAhAB"],
    ["video+hour", { type: "video", uploadDate: "hour" }, "EgQIARAB"],
    ["video+long", { type: "video", duration: "long" }, "EgQQARgC"],
    ["views+video", { sort: "views", type: "video" }, "CAMSAhAB"],
    ["views+video+week", { sort: "views", type: "video", uploadDate: "week" }, "CAMSBAgDEAE="],
    ["shorts+today", { type: "shorts", uploadDate: "today" }, "EgQIAhAJ"],
  ] as [string, Record<string, string>, string][])("%s → %s", (_label, filters, expected) => {
    expect(buildSearchParam(filters as any)).toBe(expected);
  });

  test("loose query params: unknown values are ignored", () => {
    expect(
      parseSearchFilters({ sort: "bogus", uploadDate: "today", duration: "x", type: "video" })
    ).toEqual({ uploadDate: "today", type: "video" });
  });
});
