import { expect, test } from "bun:test";
import { buildDashboard, normalizeChannel, normalizeComment, normalizeVideo, parseDuration } from "@/lib/mapping";
import { channelFixture, commentsFixture, videosFixture } from "./helpers/fixtures";

test("normalizeVideo: string counts → numbers; isShort/isLive → kind; visibility mapping", () => {
  const short = normalizeVideo(videosFixture[1]);
  expect(short).not.toBeNull();
  expect(short?.views).toBe(12000);
  expect(short?.kind).toBe("short");
  const live = normalizeVideo(videosFixture[4]);
  expect(live?.kind).toBe("live");
  expect(live?.durationSeconds).toBe(3723);
  expect(normalizeVideo(videosFixture[2])?.visibility).toBe("unlisted");
  expect(normalizeVideo(videosFixture[3])?.visibility).toBe("private");
});

test("normalizeVideo: title fallback, restrictions honest-none, junk → null", () => {
  const v = normalizeVideo({ id: "x", visibility: "public" });
  expect(v?.title).toBe("(untitled)");
  expect(v?.restrictions).toBe("none");
  expect(normalizeVideo({ nope: true })).toBeNull();
  expect(normalizeVideo(null)).toBeNull();
});

test("parseDuration ISO-8601", () => {
  expect(parseDuration("PT1H2M3S")).toBe(3723);
  expect(parseDuration("P1D")).toBe(86400);
  expect(parseDuration("junk")).toBeNull();
  expect(parseDuration(null)).toBeNull();
});

test("dashboard mapping: newest-first latest video, recent strip, latest post; normalizeChannel + comment defaults", () => {
  const videos = videosFixture.map((v) => normalizeVideo(v)).filter((v) => v !== null);
  const cards = buildDashboard(videos, [{ id: "p1", text: "Hello", publishedAt: null }]);
  expect(cards.latestVideo?.id).toBe("v1");
  expect(cards.recentVideos).toHaveLength(5);
  expect(cards.latestPost?.id).toBe("p1");
  expect(buildDashboard([], []).latestVideo).toBeNull();

  const ch = normalizeChannel(channelFixture);
  expect(ch?.handle).toBe("@operator");
  expect(ch?.subscriberCount).toBe(1200);

  const c = normalizeComment(commentsFixture[3]);
  expect(c?.state).toBe("published"); // honest default — no invented moderation state
  const c2 = normalizeComment(commentsFixture[1]);
  expect(c2?.state).toBe("heldForReview");
  expect(c2?.authorName).toBe("Ben"); // string author form tolerated
});
