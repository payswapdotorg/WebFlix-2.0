import { expect, test } from "bun:test";
import { DATE_PRESETS, filterByDatePreset, filterByTab, pageCount, paginate, shareableLink, visibilityBadge } from "@/lib/table";
import { normalizeVideo } from "@/lib/mapping";
import { videosFixture } from "./helpers/fixtures";

const videos = videosFixture.map((v) => normalizeVideo(v)).filter((v) => v !== null);

test("tabs: shorts tab shows only shorts; videos tab shows only plain videos", () => {
  expect(filterByTab(videos, "shorts").map((v) => v.id)).toEqual(["v2"]);
  expect(filterByTab(videos, "videos").every((v) => v.kind === "video")).toBe(true);
  expect(filterByTab(videos, "live").map((v) => v.id)).toEqual(["v5"]);
  expect(filterByTab(videos, "posts")).toEqual([]);
});

test("pagination math", () => {
  expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
  expect(paginate([], 1, 25)).toEqual([]);
  expect(pageCount(0, 25)).toBe(1);
  expect(pageCount(51, 25)).toBe(3);
});

test("date presets (day math, deterministic): month(31d) excludes 40d-old; year includes 40d, excludes 400d", () => {
  const month = filterByDatePreset(videos, "month").map((v) => v.id).sort();
  expect(month).toEqual(["v1", "v2", "v5"]);
  const year = filterByDatePreset(videos, "year").map((v) => v.id).sort();
  expect(year).toContain("v3");
  expect(year).not.toContain("v4");
  expect(filterByDatePreset(videos, "all")).toHaveLength(5);
  expect(DATE_PRESETS.find((p) => p.key === "month")?.days).toBe(31);
});

test("shareable link + visibility badges", () => {
  expect(shareableLink("https://main.test/", "v1")).toBe("https://main.test/watch?v=v1");
  expect(visibilityBadge("public").label).toBe("Public");
  expect(visibilityBadge("unlisted").label).toBe("Unlisted");
  expect(visibilityBadge("private").label).toBe("Private");
});
