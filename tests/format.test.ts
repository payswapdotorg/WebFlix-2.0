/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  formatCount,
  formatViews,
  formatRelativeDate,
  historyGroupLabel,
  formatSubscribers,
  watchProgress,
} from "@/lib/format";

const NOW = new Date("2026-09-28T22:30:00Z");

describe("VideoCard duration badge formatting (formatDuration)", () => {
  test("sub-minute → m:ss", () => {
    expect(formatDuration(47)).toBe("0:47");
    expect(formatDuration(15)).toBe("0:15");
    expect(formatDuration(0)).toBe("0:00");
  });
  test("minutes → m:ss with padded seconds", () => {
    expect(formatDuration(596)).toBe("9:56");
    expect(formatDuration(604)).toBe("10:04");
    expect(formatDuration(599)).toBe("9:59");
  });
  test("hours → h:mm:ss", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(734)).toBe("12:14");
  });
  test("negative clamps to 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("compact view counts (formatCount / formatViews)", () => {
  test("hundreds stay literal", () => {
    expect(formatCount(918)).toBe("918");
    expect(formatViews(918)).toBe("918 views");
  });
  test("thousands → K with one decimal, .0 trimmed", () => {
    expect(formatCount(1204)).toBe("1.2K");
    expect(formatCount(89_412)).toBe("89.4K");
    expect(formatCount(2000)).toBe("2K");
  });
  test("millions → M (ZTube style 12.8M)", () => {
    expect(formatCount(12_845_390)).toBe("12.8M");
    expect(formatCount(8_237_604)).toBe("8.2M");
    expect(formatViews(12_845_390)).toBe("12.8M views");
  });
  test("billions → B", () => {
    expect(formatCount(1_500_000_000)).toBe("1.5B");
  });
  test("singular view", () => {
    expect(formatViews(1)).toBe("1 view");
  });
  test("subscriber formatting", () => {
    expect(formatSubscribers(2_410_000)).toBe("2.41M subscribers");
  });
});

describe("relative date (formatRelativeDate)", () => {
  const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  test("just now / minutes", () => {
    expect(formatRelativeDate(minutes(1), NOW)).toBe("1 minute ago");
    expect(formatRelativeDate(minutes(30), NOW)).toBe("30 minutes ago");
    expect(formatRelativeDate(NOW, NOW)).toBe("just now");
  });
  test("hours", () => {
    expect(formatRelativeDate(minutes(60), NOW)).toBe("1 hour ago");
    expect(formatRelativeDate(minutes(300), NOW)).toBe("5 hours ago");
  });
  test("days", () => {
    expect(formatRelativeDate(days(1), NOW)).toBe("1 day ago");
    expect(formatRelativeDate(days(3), NOW)).toBe("3 days ago");
  });
  test("weeks (day 7–29)", () => {
    expect(formatRelativeDate(days(7), NOW)).toBe("1 week ago");
    expect(formatRelativeDate(days(20), NOW)).toBe("2 weeks ago");
  });
  test("months (ZTube: 3 months ago)", () => {
    expect(formatRelativeDate(days(92), NOW)).toBe("3 months ago");
    expect(formatRelativeDate(days(30), NOW)).toBe("1 month ago");
  });
  test("years", () => {
    expect(formatRelativeDate(days(365), NOW)).toBe("1 year ago");
    expect(formatRelativeDate(days(730), NOW)).toBe("2 years ago");
    expect(formatRelativeDate(days(400), NOW)).toBe("1 year ago");
  });
  test("accepts ISO strings", () => {
    expect(formatRelativeDate(days(2).toISOString(), NOW)).toBe("2 days ago");
  });
});

describe("history grouping + watch progress", () => {
  test("history group labels", () => {
    expect(historyGroupLabel(new Date(NOW.getTime() - 3_600_000), NOW)).toBe("Today");
    expect(historyGroupLabel(new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe("Yesterday");
    expect(historyGroupLabel(new Date(NOW.getTime() - 6 * 86_400_000), NOW)).toBe("This week");
    expect(historyGroupLabel(new Date(NOW.getTime() - 10 * 86_400_000), NOW)).toBe("Last week");
    expect(historyGroupLabel(new Date(NOW.getTime() - 45 * 86_400_000), NOW)).toBe("Last month");
  });
  test("watch progress clamps", () => {
    expect(watchProgress(312, 596)).toBeCloseTo(0.5235, 3);
    expect(watchProgress(999, 596)).toBe(1);
    expect(watchProgress(0, 596)).toBe(0);
    expect(watchProgress(10, 0)).toBe(0);
  });
});
