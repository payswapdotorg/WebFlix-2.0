/**
 * WFX2-W tests — related rail (exclusion, category-first ranking, cursor
 * pagination, not-interested signals) + share timestamp parsing.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { getRelated, markNotInterested } from "../src/lib/watch/video-service";
import { parseTimestampParam, formatTimestampParam } from "../src/lib/watch/share";
import { ApiError } from "../src/lib/watch/api";

setupTestDb();

describe("related rail", () => {
  test("excludes the current video; same category first, then views desc", async () => {
    const { bbb, demo } = await fixtures();
    const db = (await import("../src/lib/db")).db;
    const page = await getRelated(bbb.id, demo.id, undefined, 20);
    expect(page.items.find((v) => v.id === bbb.id)).toBeUndefined();

    // rank rule: every same-category item precedes every other-category item;
    // within each group, views desc
    const info = new Map(
      (await db.video.findMany()).map((v) => [v.id, { cat: v.category, views: v.views }])
    );
    const cats = page.items.map((v) => info.get(v.id)!.cat);
    const firstOther = cats.findIndex((c) => c !== "Film & Animation");
    expect(firstOther).toBeGreaterThan(2); // BBB is Film & Animation → head is same-category
    for (const c of cats.slice(0, firstOther)) expect(c).toBe("Film & Animation");
    for (const c of cats.slice(firstOther)) expect(c).not.toBe("Film & Animation");

    for (const [from, to] of [
      [0, firstOther],
      [firstOther, page.items.length],
    ]) {
      for (let i = from + 1; i < to; i++) {
        expect(page.items[i - 1].views).toBeGreaterThanOrEqual(page.items[i].views);
      }
    }
  });

  test("cursor pagination serves the second page (12+ items total)", async () => {
    const { bbb, demo } = await fixtures();
    const page1 = await getRelated(bbb.id, demo.id, undefined, 8);
    expect(page1.items.length).toBe(8);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await getRelated(bbb.id, demo.id, page1.nextCursor!, 8);
    expect(page2.items.length).toBe(4); // 12 others total
    expect(page2.nextCursor).toBeNull();
    // no overlap between pages
    const ids = new Set(page1.items.map((v) => v.id));
    for (const v of page2.items) expect(ids.has(v.id)).toBe(false);
    expect(page1.items.length + page2.items.length).toBeGreaterThanOrEqual(12);
  });

  test("autoplay-next head = first item of the first page", async () => {
    const { bbb, demo } = await fixtures();
    const page1 = await getRelated(bbb.id, demo.id, undefined, 8);
    const all = await getRelated(bbb.id, demo.id, undefined, 20);
    expect(page1.items[0].id).toBe(all.items[0].id);
  });

  test("'not interested' hides the video from the viewer's rail only", async () => {
    const { bbb, demo, pip } = await fixtures();
    const oceanVideo = await (await import("../src/lib/db")).db.video.findFirstOrThrow({
      where: { title: { contains: "Deep Blue" } },
    });
    await markNotInterested(oceanVideo.id, demo.id);
    const forDemo = await getRelated(bbb.id, demo.id, undefined, 20);
    expect(forDemo.items.find((v) => v.id === oceanVideo.id)).toBeUndefined();
    const forPip = await getRelated(bbb.id, pip.id, undefined, 20);
    expect(forPip.items.find((v) => v.id === oceanVideo.id)).toBeDefined();
  });

  test("unknown video → 404", async () => {
    const { demo } = await fixtures();
    let notFound = false;
    try {
      await getRelated("does-not-exist", demo.id);
    } catch (e) {
      notFound = e instanceof ApiError && e.status === 404;
    }
    expect(notFound).toBe(true);
  });
});

describe("share timestamp parsing (?t=)", () => {
  test.each([
    ["90", 90],
    ["90s", 90],
    ["1m30s", 90],
    ["1h2m3s", 3723],
    ["1:30", 90],
    ["1:02:03", 3723],
    ["0", 0],
  ])("t=%s → %d seconds", (input, expected) => {
    expect(parseTimestampParam(input)).toBe(expected);
  });

  test.each([
    ["abc", null],
    ["", null],
    [null, null],
    [undefined, null],
    ["1x2", null],
  ])("t=%s → null (invalid)", (input, expected) => {
    expect(parseTimestampParam(input as string | null)).toBe(expected);
  });

  test("format → parse round-trips", () => {
    expect(formatTimestampParam(90)).toBe("1m30s");
    expect(formatTimestampParam(3723)).toBe("1h2m3s");
    expect(formatTimestampParam(7)).toBe("7s");
    expect(parseTimestampParam(formatTimestampParam(215))).toBe(215);
  });
});
