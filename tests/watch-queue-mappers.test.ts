/// <reference types="bun-types" />
/**
 * REA-1 G16/G19 — the watch-queue mappers against the REAL captured `next`
 * panel fixtures (tests/fixtures/yt/next_playlist_panel_lofi.json — a
 * regular playlist in list order — and next_mix_panel_lofi.json — an RD mix
 * in YouTube's own shuffled order). Fixtures-only: no live calls, ever.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { mapWatchQueueResponse, mixSeedVideoId } from "@/lib/youtube/watch-queue";
import { hashtagHref } from "@/lib/watch/chapters";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const regularPanel = load("next_playlist_panel_lofi");
const mixPanel = load("next_mix_panel_lofi");
const noPanel = {
  contents: { twoColumnWatchNextResults: { results: { results: { contents: [] } } } },
};

const REGULAR_ID = "RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM";
const MIX_ID = "RDn61ULEU7CO0";

describe("mapWatchQueueResponse — the regular playlist panel (real capture)", () => {
  test("the panel header: title, owner, the infinite marker, the list id", () => {
    const dto = mapWatchQueueResponse(REGULAR_ID, regularPanel)!;
    expect(dto).not.toBeNull();
    expect(dto.playlist.id).toBe(REGULAR_ID);
    expect(dto.playlist.title).toBe("Lofi Loft");
    expect(dto.playlist.ownerName).toBe("YouTube Music");
    expect(dto.playlist.isInfinite).toBe(true);
    // RDCLAK… is a CURATED music list, not a seed-carrying mix — youtube.com
    // renders it as an ordinary playlist page (measured) → isMix false
    expect(dto.playlist.isMix).toBe(false);
  });

  test("the items: the measured list order, real fields, durations parsed", () => {
    const dto = mapWatchQueueResponse(REGULAR_ID, regularPanel)!;
    expect(dto.items.length).toBe(25);
    expect(dto.items[0]).toMatchObject({
      videoId: "1FxeCa6kypU",
      title: "Still",
      channelName: "idealism",
      durationSec: 214, // 3:34 — the panel's own lengthText
    });
    expect(dto.items[1]).toMatchObject({
      videoId: "hG6YzmvbosI",
      title: "for when it’s warmer",
      channelName: "Sleepy Fish - Topic",
      durationSec: 217,
    });
    expect(dto.items[0].thumbnailUrl).toContain("i.ytimg.com/vi/1FxeCa6kypU");
  });

  test("the selected row (the panel's own ▶) locates currentIndex", () => {
    const dto = mapWatchQueueResponse(REGULAR_ID, regularPanel)!;
    expect(dto.currentIndex).toBe(0);
    expect(dto.items[dto.currentIndex]?.videoId).toBe("1FxeCa6kypU");
  });

  test("the window carries no trailing continuation token (the measured shape — the infinite autoload rides per-navigation refetches)", () => {
    const dto = mapWatchQueueResponse(REGULAR_ID, regularPanel)!;
    expect(dto.nextCursor).toBeNull();
  });

  test("items dedupe by videoId (a repeated row never doubles the queue)", () => {
    const doubled = {
      contents: {
        twoColumnWatchNextResults: {
          playlist: {
            playlist: {
              ...regularPanel.contents.twoColumnWatchNextResults.playlist.playlist,
              contents: [
                ...regularPanel.contents.twoColumnWatchNextResults.playlist.playlist.contents,
                regularPanel.contents.twoColumnWatchNextResults.playlist.playlist.contents[0],
              ],
            },
          },
        },
      },
    };
    const dto = mapWatchQueueResponse(REGULAR_ID, doubled)!;
    expect(dto.items.length).toBe(25);
  });
});

describe("mapWatchQueueResponse — the mix panel (real capture, YouTube's own shuffle)", () => {
  test("the mix presentation: the 'Mix - …' title, YouTube as owner, isInfinite", () => {
    const dto = mapWatchQueueResponse(MIX_ID, mixPanel)!;
    expect(dto.playlist.title).toBe(
      "Mix - Best of lofi hip hop 2021 ✨ [beats to relax/study to]"
    );
    expect(dto.playlist.ownerName).toBe("YouTube");
    expect(dto.playlist.isMix).toBe(true);
    expect(dto.playlist.isInfinite).toBe(true);
    expect(dto.playlist.id).toBe(MIX_ID);
  });

  test("the seed video is the selected first row (the measured radio start)", () => {
    const dto = mapWatchQueueResponse(MIX_ID, mixPanel)!;
    expect(dto.currentIndex).toBe(0);
    expect(dto.items[0]).toMatchObject({
      videoId: "n61ULEU7CO0",
      title: "Best of lofi hip hop 2021 ✨ [beats to relax/study to]",
      channelName: "Lofi Girl",
      durationSec: 22258, // 6:10:58 — the seed video's own length
    });
    expect(dto.items[1]?.videoId).toBe("QEWV6fiYaDU");
  });
});

describe("mapWatchQueueResponse — the honest no-panel answer", () => {
  test("a response with no playlist panel maps to null (never a fabricated queue)", () => {
    expect(mapWatchQueueResponse("WL", noPanel)).toBeNull();
    expect(mapWatchQueueResponse(MIX_ID, {})).toBeNull();
    expect(mapWatchQueueResponse(MIX_ID, null)).toBeNull();
  });
});

describe("mixSeedVideoId — the seed honestly derived from the id family", () => {
  test("RD<videoId> → the suffix (the radio family, measured)", () => {
    expect(mixSeedVideoId("RDn61ULEU7CO0")).toBe("n61ULEU7CO0");
  });

  test("RDAMVM<videoId> → the suffix (the video-radio family)", () => {
    expect(mixSeedVideoId("RDAMVMdQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  test("opaque / curated / non-mix ids derive nothing (null — never a guess)", () => {
    expect(mixSeedVideoId("RDATfmbG9maSBoaXAgaG9w")).toBeNull();
    expect(mixSeedVideoId("RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM")).toBeNull();
    expect(mixSeedVideoId("RDJqYW9vWDZNUGFsZi1lck00Uy1tRERpWnA2TkRY")).toBeNull();
    expect(mixSeedVideoId("PLFgquLnL59alCl_2TQvOiD5")).toBeNull();
    expect(mixSeedVideoId("WL")).toBeNull();
  });
});

describe("hashtagHref — the G17 routing law (shared)", () => {
  test("#tag → the dedicated /hashtag/<tag> browse route", () => {
    expect(hashtagHref("#lofi")).toBe("/hashtag/lofi");
    expect(hashtagHref("#LofiGirl")).toBe("/hashtag/LofiGirl");
  });

  test("unicode tags survive encodeURIComponent; a bare tag passes through", () => {
    expect(hashtagHref("#腦動力LevelUp")).toBe(`/hashtag/${encodeURIComponent("腦動力LevelUp")}`);
    expect(hashtagHref("chill")).toBe("/hashtag/chill");
  });
});
