/**
 * WFX2-P7-AN tests — the watch analytics depth battery.
 *  1. The WatchDailyStat increment law (the autosave path is the single
 *     watch-time source; the /api/view dedupe ping never touches the daily
 *     table; the delta is max(0, new − existing); videosWatched only when
 *     the AUTOSAVE creates the ViewEvent).
 *  2. GET /api/watch/insights — totals / zero-filled 28d series / streak
 *     math / top videos against the seeded db.
 *  3. POST /api/watch/watched-map — cap 50 → 400, map correctness,
 *     per-viewer gating.
 * Each test uses its own freshly created user (the order-independence law).
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { db } from "../src/lib/db";
import { saveProgress, utcDayKey } from "../src/lib/watch/progress-service";
import { getWatchInsights } from "../src/lib/watch/insights-service";
import { registerView } from "../src/lib/watch/video-service";
import { GET as getInsights } from "../src/app/api/watch/insights/route";
import { POST as postWatchedMap } from "../src/app/api/watch/watched-map/route";
import type { NextRequest } from "next/server";

setupTestDb();

let userSeq = 0;
/** A fresh viewer per test — order-independent, never collides with seeds. */
async function freshUser(): Promise<{ id: string }> {
  const u = await db.user.create({
    data: {
      handle: `insights${++userSeq}`,
      name: `Insights ${userSeq}`,
      avatarUrl: "",
    },
  });
  return { id: u.id };
}

const dayKey = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
};

const insightsReq = (user?: string): NextRequest =>
  new Request("http://localhost/api/watch/insights", {
    headers: user ? { "x-wfx2-user": user } : {},
  }) as unknown as NextRequest;

const mapReq = (videoIds: string[], user?: string): NextRequest =>
  new Request("http://localhost/api/watch/watched-map", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-wfx2-user": user } : {}) },
    body: JSON.stringify({ videoIds }),
  }) as unknown as NextRequest;

// ---- 1. the increment law -------------------------------------------------

describe("WatchDailyStat increment law (the autosave path)", () => {
  test("first watch creates the row: full amount + videosWatched 1", async () => {
    const { sintel } = await fixtures();
    const user = await freshUser();
    await saveProgress(sintel.id, user.id, 30, 30);
    const row = await db.watchDailyStat.findUniqueOrThrow({
      where: { userId_day: { userId: user.id, day: utcDayKey() } },
    });
    expect(row.sec).toBe(30);
    expect(row.videosWatched).toBe(1);
  });

  test("cumulative autosave grows by the delta, never negative; a second video accumulates", async () => {
    const { sintel, bbb } = await fixtures();
    const user = await freshUser();
    await saveProgress(sintel.id, user.id, 100, 100);
    await saveProgress(sintel.id, user.id, 150, 150); // +50 delta
    await saveProgress(sintel.id, user.id, 120, 120); // re-watch from earlier — no delta
    const row1 = await db.watchDailyStat.findUniqueOrThrow({
      where: { userId_day: { userId: user.id, day: utcDayKey() } },
    });
    expect(row1.sec).toBe(150);
    expect(row1.videosWatched).toBe(1); // same video — no second count
    await saveProgress(bbb.id, user.id, 40, 40);
    const row2 = await db.watchDailyStat.findUniqueOrThrow({
      where: { userId_day: { userId: user.id, day: utcDayKey() } },
    });
    expect(row2.sec).toBe(190);
    expect(row2.videosWatched).toBe(2); // first watch of the second video
  });

  test("THE PING LAW: registerView (/api/view semantics) never touches WatchDailyStat", async () => {
    const { sintel } = await fixtures();
    const user = await freshUser();
    await registerView(sintel.id, user.id, new Date());
    const rows = await db.watchDailyStat.findMany({ where: { userId: user.id } });
    expect(rows.length).toBe(0); // a view ping is view-dedupe, not watch-time
    // an autosave afterwards lands through the one legal writer — but the
    // ViewEvent already exists (ping-created) → the UPDATE path: seconds
    // accrue, videosWatched stays 0 (the ping is not a first-watch count)
    await saveProgress(sintel.id, user.id, 10, 10);
    const row = await db.watchDailyStat.findUniqueOrThrow({
      where: { userId_day: { userId: user.id, day: utcDayKey() } },
    });
    expect(row.sec).toBe(10);
    expect(row.videosWatched).toBe(0);
  });
});

// ---- 2. GET /api/watch/insights -------------------------------------------

describe("GET /api/watch/insights (totals, zero-filled series, streak, top videos)", () => {
  test("aggregates a viewing history: totals + zero-fill + streak math + ordering", async () => {
    const { sintel, bbb } = await fixtures();
    const user = await freshUser();
    // ViewEvents: sintel 500s, bbb 100s → all-time 600s, 2 videos
    await db.viewEvent.create({
      data: { videoId: sintel.id, userId: user.id, watchedSec: 500, lastPositionSec: 500 },
    });
    await db.viewEvent.create({
      data: { videoId: bbb.id, userId: user.id, watchedSec: 100, lastPositionSec: 100 },
    });
    // daily stats: a 4-day streak ending today (days 0..3) with a gap before
    for (const [offset, sec] of [[0, 200], [1, 150], [2, 100], [3, 50], [6, 90]] as const) {
      await db.watchDailyStat.create({
        data: { userId: user.id, day: dayKey(offset), sec, videosWatched: 1 },
      });
    }
    const res = await getInsights(insightsReq(user.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: {
        watchedSecAllTime: number;
        videosWatched: number;
        activeDays: number;
        avgSecPerActiveDay: number;
        streakDays: number;
      };
      series28d: { day: string; sec: number }[];
      topVideos: { videoId: string; watchedSec: number; title: string; channelName: string }[];
    };
    expect(body.totals.watchedSecAllTime).toBe(600);
    expect(body.totals.videosWatched).toBe(2);
    expect(body.totals.activeDays).toBe(5);
    expect(body.totals.avgSecPerActiveDay).toBe(120); // 600 / 5
    expect(body.totals.streakDays).toBe(4); // days 0-3 consecutive; day 6 is gap-broken past
    // the series: 28 entries, oldest first, today last, gap days zero-filled
    expect(body.series28d.length).toBe(28);
    expect(body.series28d[27].day).toBe(dayKey(0));
    expect(body.series28d[27].sec).toBe(200);
    expect(body.series28d[26].sec).toBe(150);
    expect(body.series28d[24].sec).toBe(50);
    expect(body.series28d[23].sec).toBe(0); // the gap before the streak — a real zero
    expect(body.series28d[21].sec).toBe(90); // day 6
    expect(body.series28d[0].day).toBe(dayKey(27));
    // top videos ordered by watchedSec, joined with the real video/channel
    expect(body.topVideos.map((v) => v.videoId)).toEqual([sintel.id, bbb.id]);
    expect(body.topVideos[0].watchedSec).toBe(500);
    expect(body.topVideos[0].title).toContain("Sintel");
    expect(body.topVideos[0].channelName).toBeTruthy();
  });

  test("streak ending yesterday counts; ending two days ago does not", async () => {
    const userA = await freshUser();
    await db.watchDailyStat.create({
      data: { userId: userA.id, day: dayKey(1), sec: 60, videosWatched: 1 },
    });
    const endedYesterday = await getWatchInsights(userA.id);
    expect(endedYesterday.totals.streakDays).toBe(1);

    const userB = await freshUser();
    await db.watchDailyStat.create({
      data: { userId: userB.id, day: dayKey(2), sec: 60, videosWatched: 1 },
    });
    const endedTwoAgo = await getWatchInsights(userB.id);
    expect(endedTwoAgo.totals.streakDays).toBe(0);
  });

  test("a deleted video's ViewEvent cascades away — never a ghost in topVideos", async () => {
    const { sintel } = await fixtures();
    const user = await freshUser();
    await db.viewEvent.create({
      data: { videoId: sintel.id, userId: user.id, watchedSec: 999, lastPositionSec: 999 },
    });
    // deleting the video cascades the ViewEvent — the honest "gone means gone"
    await db.video.delete({ where: { id: sintel.id } });
    const res = await getInsights(insightsReq(user.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { topVideos: { videoId: string }[] };
    expect(body.topVideos.find((v) => v.videoId === sintel.id)).toBeUndefined();
  });

  test("the empty history is the honest empty payload", async () => {
    const user = await freshUser();
    const res = await getInsights(insightsReq(user.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { watchedSecAllTime: number; streakDays: number; activeDays: number };
      series28d: { sec: number }[];
      topVideos: unknown[];
    };
    expect(body.totals.watchedSecAllTime).toBe(0);
    expect(body.totals.activeDays).toBe(0);
    expect(body.totals.streakDays).toBe(0);
    expect(body.series28d.every((p) => p.sec === 0)).toBe(true);
    expect(body.topVideos.length).toBe(0);
  });
});

// ---- 3. POST /api/watch/watched-map ----------------------------------------

describe("POST /api/watch/watched-map", () => {
  test("returns the viewer's map; unwatched ids are absent; empty batch → empty map", async () => {
    const { sintel, bbb } = await fixtures();
    const user = await freshUser();
    await db.viewEvent.create({
      data: { videoId: sintel.id, userId: user.id, watchedSec: 77, lastPositionSec: 77 },
    });
    const res = await postWatchedMap(mapReq([sintel.id, bbb.id], user.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map: Record<string, number> };
    expect(body.map[sintel.id]).toBe(77);
    expect(body.map[bbb.id]).toBeUndefined();
    const empty = await postWatchedMap(mapReq([], user.id));
    expect(((await empty.json()) as { map: unknown }).map).toEqual({});
  });

  test("session gating: another viewer's events never leak into the map", async () => {
    const { sintel } = await fixtures();
    const owner = await freshUser();
    const other = await freshUser();
    await db.viewEvent.create({
      data: { videoId: sintel.id, userId: owner.id, watchedSec: 55, lastPositionSec: 55 },
    });
    const res = await postWatchedMap(mapReq([sintel.id], other.id));
    const body = (await res.json()) as { map: Record<string, number> };
    expect(body.map[sintel.id]).toBeUndefined();
  });

  test("cap 50: 51 ids → 400; a malformed body → 400", async () => {
    const user = await freshUser();
    const tooMany = await postWatchedMap(
      mapReq(Array.from({ length: 51 }, (_, i) => `v${i}`), user.id)
    );
    expect(tooMany.status).toBe(400);
    const malformed = new Request("http://localhost/api/watch/watched-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoIds: "not-an-array" }),
    }) as unknown as NextRequest;
    const res = await postWatchedMap(malformed);
    expect(res.status).toBe(400);
  });
});
