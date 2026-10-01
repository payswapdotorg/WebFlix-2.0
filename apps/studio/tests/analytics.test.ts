import { expect, test } from "bun:test";
import { dailySeries, filterByRange, totals } from "@/lib/analytics";
import { normalizeVideo } from "@/lib/mapping";
import { daysAgo, iso, videosFixture } from "./helpers/fixtures";

const videos = videosFixture.map((v) => normalizeVideo(v)).filter((v) => v !== null);

test("filterByRange: 90d keeps 4 of 5 (excludes 400d-old); lifetime keeps all", () => {
  expect(filterByRange(videos, "90").map((v) => v.id).sort()).toEqual(["v1", "v2", "v3", "v5"]);
  expect(filterByRange(videos, "lifetime")).toHaveLength(5);
});

test("dailySeries(28d): 28 points; real counts land on publish-day buckets; nothing invented outside", () => {
  const series = dailySeries(videos, "28");
  expect(series).toHaveLength(28);
  const day2 = series.find((p) => p.date === iso(2).slice(0, 10));
  expect(day2?.views).toBe(5000);
  const sum = series.reduce((acc, p) => acc + p.views, 0);
  expect(sum).toBe(5000 + 12000 + 2200); // v3 (40d) and v4 (400d) are outside the window — never back-filled
  expect(series.reduce((a, p) => a + p.uploads, 0)).toBe(3);
});

test("totals: real sums + est. watch time derived from views × duration only", () => {
  const t = totals(videos);
  expect(t.views).toBe(20000);
  expect(t.likes).toBe(1530);
  expect(t.comments).toBe(72);
  const expectedHours = (5000 * 480 + 12000 * 45 + 800 * 300 + 0 + 2200 * 3723) / 3600;
  expect(t.estWatchHours ?? 0).toBeCloseTo(expectedHours, 5);
  expect(totals([]).estWatchHours).toBeNull();
  // lifetime series spans from earliest upload (v4, 400d), capped at 730 buckets
  const s = dailySeries(videos, "lifetime");
  expect(s.length).toBeGreaterThanOrEqual(400);
  expect(s.length).toBeLessThanOrEqual(402);
  expect(s.length).toBeLessThanOrEqual(730);
  expect(new Date(daysAgo(0)).getTime()).toBeGreaterThan(0); // sanity
});
