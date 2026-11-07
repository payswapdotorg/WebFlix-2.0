/// <reference types="bun-types" />
/**
 * P100 — the live provider mapper battery. Two providers, two provenances:
 *  - mapApifyLiveRow: the EMPIRICALLY captured actor shape (the P100 report's
 *    probe E4 — a real live row was captured for @lofigirl mid-probe);
 *  - mapWebcastRoom: the DOCUMENTED webcast room/info contract (status 2/4,
 *    live_room_stats, stream_url) — contract-ready for the moment any
 *    provider yields a room_id.
 * Both are defensive: malformed rows answer honest nulls, never throw.
 */
import { describe, expect, test } from "bun:test";

import { mapApifyLiveRow, mapWebcastRoom } from "@/lib/tiktok/live";

// ---- the empirical Apify row (P100 report §1, probe E4) --------------------
const APIFY_LIVE_ROW = {
  handle: "lofigirl",
  unique_id: "lofigirl",
  nickname: "Lofi Girl",
  is_live: true,
  follower_count: 13700000,
  verified: true,
  avatar_url: "https://p16-common-sign.tiktokcdn-eu.com/lofi.jpg",
  room_title: "christmas lofi radio 🎄",
  viewer_count: 278,
  total_enter_count: null,
  like_count: null,
  started_at: "2026-11-07T00:12:00.000Z",
  cover_url: "https://p16-common-sign.tiktokcdn-eu.com/lofi-cover.jpg",
  room_url: "https://www.tiktok.com/@lofigirl/live",
  stream_urls: null,
  _metadata: { page: 1, fetched_at: "2026-11-07T07:45:00.000Z", input_identifier: "lofigirl" },
};

describe("mapApifyLiveRow — the empirical actor shape", () => {
  test("a live row maps to a fully honest LIVE status DTO", () => {
    const dto = mapApifyLiveRow(APIFY_LIVE_ROW, "lofigirl");
    expect(dto).not.toBeNull();
    expect(dto!.handle).toBe("lofigirl");
    expect(dto!.live).toBe(true);
    expect(dto!.probing).toBeFalsy();
    expect(dto!.source).toBe("apify");
    expect(dto!.room).toEqual({
      title: "christmas lofi radio 🎄",
      viewers: 278,
      startedAt: "2026-11-07T00:12:00.000Z",
      coverUrl: "https://p16-common-sign.tiktokcdn-eu.com/lofi-cover.jpg",
      liveUrl: "https://www.tiktok.com/@lofigirl/live",
    });
    expect(dto!.stream).toBeNull();
    expect(dto!.fetchedAt).toBe("2026-11-07T07:45:00.000Z");
  });

  test("an offline row is real data: live:false with no invented room", () => {
    const dto = mapApifyLiveRow(
      { ...APIFY_LIVE_ROW, is_live: false, viewer_count: 1 },
      "lofigirl"
    );
    expect(dto!.live).toBe(false);
    expect(dto!.room).toBeNull();
    expect(dto!.stream).toBeNull();
  });

  test("a never-live row (all nulls) maps to the honest offline DTO", () => {
    const dto = mapApifyLiveRow(
      {
        handle: "bloomberg",
        unique_id: "bloomberg",
        nickname: null,
        is_live: false,
        room_title: null,
        viewer_count: null,
        started_at: null,
        cover_url: null,
        room_url: null,
        stream_urls: null,
        _metadata: { fetched_at: "2026-11-07T07:46:00.000Z" },
      },
      "bloomberg"
    );
    expect(dto!.live).toBe(false);
    expect(dto!.room).toBeNull();
    expect(dto!.fetchedAt).toBe("2026-11-07T07:46:00.000Z");
  });

  test("a row whose identity mismatches the probe handle answers null", () => {
    expect(mapApifyLiveRow(APIFY_LIVE_ROW, "nowthispolitics")).toBeNull();
    // matching is case-insensitive on the handle identity
    expect(mapApifyLiveRow(APIFY_LIVE_ROW, "LoFiGirl")).not.toBeNull();
  });

  test("a future stream-yielding actor drops in: stream_urls arrays map", () => {
    const dto = mapApifyLiveRow(
      {
        ...APIFY_LIVE_ROW,
        stream_urls: [
          "https://pull-f5-va01.ttlivecdn.com/live/playlist.m3u8",
          "https://pull-f5-va01.ttlivecdn.com/live/live.flv",
        ],
      },
      "lofigirl"
    );
    expect(dto!.stream).toEqual({
      hlsUrl: "https://pull-f5-va01.ttlivecdn.com/live/playlist.m3u8",
      flvUrl: "https://pull-f5-va01.ttlivecdn.com/live/live.flv",
    });
  });

  test("malformed rows never throw — honest nulls all the way down", () => {
    // a row without an identity can never answer for a handle
    expect(mapApifyLiveRow({ garbage: true }, "lofigirl")).toBeNull();
    // a malformed row WITH the right identity is a real (offline) answer
    const dto = mapApifyLiveRow({ unique_id: "lofigirl" }, "lofigirl");
    expect(dto).not.toBeNull();
    expect(dto!.live).toBe(false);
    expect(dto!.room).toBeNull();
    expect(dto!.stream).toBeNull();
    expect(mapApifyLiveRow(null, "lofigirl")).toBeNull();
    expect(mapApifyLiveRow(undefined, "lofigirl")).toBeNull();
    expect(mapApifyLiveRow(42, "lofigirl")).toBeNull();
  });

  test("viewer counts that lie about their type stay null", () => {
    const dto = mapApifyLiveRow({ ...APIFY_LIVE_ROW, viewer_count: "lots" }, "lofigirl");
    expect(dto!.room!.viewers).toBeNull();
  });
});

// ---- the documented webcast room/info contract (P100 report §4) ------------
const WEBCAST_LIVE = {
  status: 2,
  title: "christmas lofi radio 🎄",
  start_time: 1794036720,
  live_room_stats: { user_count: 1234, total_user: 5000 },
  owner: { unique_id: "lofigirl", nickname: "Lofi Girl" },
  stream_url: {
    hls_pull_url: "https://pull-f5-va01.ttlivecdn.com/live/lofi.m3u8",
    rtmp_pull_url: "https://pull-f5-va01.ttlivecdn.com/live/lofi.flv",
  },
};

describe("mapWebcastRoom — the documented webcast contract", () => {
  test("status 2 maps LIVE with the stream URLs extracted", () => {
    const dto = mapWebcastRoom(WEBCAST_LIVE, "lofigirl");
    expect(dto!.live).toBe(true);
    expect(dto!.source).toBe("webcast");
    expect(dto!.room!.viewers).toBe(1234);
    expect(dto!.stream).toEqual({
      hlsUrl: "https://pull-f5-va01.ttlivecdn.com/live/lofi.m3u8",
      flvUrl: "https://pull-f5-va01.ttlivecdn.com/live/lofi.flv",
    });
    // the outbound live URL is built by the URL law, not trusted from input
    expect(dto!.room!.liveUrl).toBe("https://www.tiktok.com/@lofigirl/live");
  });

  test("status 4 (offline) maps the honest offline DTO", () => {
    const dto = mapWebcastRoom({ ...WEBCAST_LIVE, status: 4 }, "lofigirl");
    expect(dto!.live).toBe(false);
    expect(dto!.room).toBeNull();
    expect(dto!.stream).toBeNull();
  });

  test("the structured error envelope (status_code 10011) answers null", () => {
    expect(
      mapWebcastRoom({ data: { message: "Request params error" }, status_code: 10011 }, "lofigirl")
    ).toBeNull();
  });

  test("garbage answers null, never throws", () => {
    expect(mapWebcastRoom(null, "lofigirl")).toBeNull();
    expect(mapWebcastRoom("nope", "lofigirl")).toBeNull();
    expect(mapWebcastRoom({}, "lofigirl")).toBeNull();
  });

  test("a live room without stream_url keeps the panel honest (no stream)", () => {
    const dto = mapWebcastRoom(
      { ...WEBCAST_LIVE, stream_url: undefined },
      "lofigirl"
    );
    expect(dto!.live).toBe(true);
    expect(dto!.stream).toBeNull();
  });
});
