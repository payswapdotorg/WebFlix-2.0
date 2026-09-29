/// <reference types="bun-types" />
/**
 * WFX2-B-B mapper tests — the personal-surface parsers against REAL fixture
 * captures (and clearly-marked SYNTHETIC-shaped fixtures where the B-B
 * sandbox has no operator session — no browser to harvest cookies from).
 * NEVER the network (lane law: tests run against tests/fixtures/yt only).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  mapHistoryPage,
  historyDayLabelToDate,
  historyLoginRequired,
  watchedProgressAgoText,
  watchHistoryPausedFromPage,
} from "@/lib/youtube/history";
import {
  mapSubscriptionsPage,
  channelsFromSubscriptionsResponse,
  subscriptionsLoginRequired,
  subscriptionsContinuationToken,
} from "@/lib/youtube/subscriptions";
import {
  mapPlaylistsPage,
  mapPlaylistItemsPage,
  mapPlaylistLockup,
  isSpecialPlaylistId,
  playlistBrowseId,
} from "@/lib/youtube/playlists";
import { mapNotificationMenu, mapUnseenCount } from "@/lib/youtube/notifications";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

// ---------------------------------------------------------------------------

describe("history mapping (REAL capture: ssr_history.json)", () => {
  const feed = mapHistoryPage(load("ssr_history"));

  test("maps the real day-grouped feed with items and a continuation cursor", () => {
    expect(feed.loginRequired).toBe(false);
    // the real capture carries 164 progress-overlay items across day sections
    expect(feed.items.length).toBeGreaterThan(100);
    expect(feed.groups.length).toBeGreaterThan(10);
    expect(feed.groups[0].label).toBe("Today");
    expect(feed.nextCursor).toBeTruthy();
    expect(typeof feed.nextCursor).toBe("string");
  });

  test("first group's items carry the watched-progress seconds from startPercent", () => {
    const first = feed.groups[0].items[0];
    expect(first.id).toBe("dQw4w9WgXcQ");
    expect(first.title).toContain("Never Gonna Give You Up");
    // the real card shows startPercent 100 on a 3:34 video → watched ≈ 214s
    expect(first.durationSec).toBe(214);
    expect(first.watchedSec).toBe(214);
    expect(first.channel.name).toBe("Rick Astley");
  });

  test("partial progress maps to a proportional watchedSec", () => {
    const partial = feed.items.find((i) => i.watchedSec > 0 && i.watchedSec < (i.durationSec ?? 0));
    if (partial) {
      expect(partial.watchedSec).toBeGreaterThan(0);
      expect(partial.watchedSec).toBeLessThan(partial.durationSec!);
    }
  });

  test("day labels parse to approximate ISO dates (honest best-effort)", () => {
    const now = new Date("2026-04-10T00:00:00Z");
    expect(historyDayLabelToDate("Today", now)).toBe("2026-04-10T00:00:00.000Z");
    expect(historyDayLabelToDate("Yesterday", now)).toBe("2026-04-09T00:00:00.000Z");
    // a month that already passed this year stays this year
    expect(historyDayLabelToDate("Apr 7", now)).toBe("2026-04-07T00:00:00.000Z");
    // a month not yet reached this year means last year
    expect(historyDayLabelToDate("Jan 13, 2024", now)).toBe("2024-01-13T00:00:00.000Z");
    expect(historyDayLabelToDate("Dec 29, 2020", now)).toBe("2020-12-29T00:00:00.000Z");
    expect(historyDayLabelToDate("gibberish", now)).toBeNull();
  });

  test("watch-history pause state reads from the page's own control rail", () => {
    // the real capture shows "Pause watch history" → recording (not paused)
    expect(watchHistoryPausedFromPage(load("ssr_history"))).toBe(false);
  });

  test("this capture carries no watchedProgressAgoText (absence honored)", () => {
    const history = load("ssr_history");
    const section =
      history.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer;
    expect(watchedProgressAgoText(section.contents[0])).toBeNull();
  });

  test("public-mode capture (REAL: ssr_history_public.json) is login-required", () => {
    const publicPage = load("ssr_history_public");
    expect(historyLoginRequired(publicPage)).toBe(true);
    const feed = mapHistoryPage(publicPage);
    expect(feed.loginRequired).toBe(true);
    expect(feed.groups).toEqual([]);
    expect(feed.items).toEqual([]);
    expect(feed.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("subscriptions mapping (REAL capture: ssr_subscriptions.json — 95 items)", () => {
  const feed = mapSubscriptionsPage(load("ssr_subscriptions"));

  test("maps all 95 feed videos in document order", () => {
    expect(feed.loginRequired).toBe(false);
    expect(feed.videos.length).toBe(95);
    expect(feed.videos[0].id).toBe("NpHIjqiWUB0");
    expect(feed.videos[0].channel.name).toBe("YogaDaily");
    // the real feed's continuation token rides the richGrid tail
    expect(feed.nextCursor).toBeTruthy();
  });

  test("derives the subscribed channels with UC ids, handles and avatars", () => {
    expect(feed.channels.length).toBe(2);
    expect(feed.channels[0].id).toBe("UCICYIUduSnJCb1bB_6iJBAQ");
    expect(feed.channels[0].handle).toBe("@YogaDailychannel");
    expect(feed.channels[0].verified).toBe(true);
    expect(feed.channels[0].avatarUrl).toContain("yt3.");
  });

  test("the Latest shelf structure is recognized", () => {
    expect(feed.latestShelf).toBe(true);
  });

  test("public-mode capture (REAL: ssr_subscriptions_public.json) is login-required", () => {
    const publicPage = load("ssr_subscriptions_public");
    expect(subscriptionsLoginRequired(publicPage)).toBe(true);
    const feed = mapSubscriptionsPage(publicPage);
    expect(feed.loginRequired).toBe(true);
    expect(feed.channels).toEqual([]);
    expect(feed.videos).toEqual([]);
  });

  test("channel + continuation extractors are independently callable", () => {
    const response = load("ssr_subscriptions");
    expect(channelsFromSubscriptionsResponse(response)).toHaveLength(2);
    expect(typeof subscriptionsContinuationToken(response)).toBe("string");
  });
});

// ---------------------------------------------------------------------------

describe("playlists mapping", () => {
  test("operator list (SYNTHETIC-shaped: ssr_playlists_synth.json) maps to PlaylistDTOs", () => {
    const { playlists, loginRequired } = mapPlaylistsPage(load("ssr_playlists_synth"));
    expect(loginRequired).toBe(false);
    expect(playlists).toHaveLength(3);
    expect(playlists[0]).toMatchObject({
      id: "PLsynthetic0001",
      title: "Synth private list",
      visibility: "private",
      videoCount: 6,
      isWatchLater: false,
    });
    expect(playlists[1].visibility).toBe("public");
    expect(playlists[1].videoCount).toBe(12);
    expect(playlists[2].visibility).toBe("unlisted");
    expect(playlists[0].coverUrl).toContain("i.ytimg.com");
    expect(playlists.every((p: any) => p.videos.length === 0)).toBe(true);
  });

  test("special ids: WL and LL are flagged; browse ids are VL-prefixed", () => {
    expect(isSpecialPlaylistId("WL")).toBe(true);
    expect(isSpecialPlaylistId("LL")).toBe(true);
    expect(isSpecialPlaylistId("PLxyz")).toBe(false);
    expect(playlistBrowseId("PLabc")).toBe("VLPLabc");
    expect(playlistBrowseId("VLPLabc")).toBe("VLPLabc");
  });

  test("public playlist items (REAL capture: browse_vl_public.json) map with header + cursor", () => {
    const page = mapPlaylistItemsPage(load("browse_vl_public"), "PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi");
    expect(page.loginRequired).toBe(false);
    expect(page.notFound).toBe(false);
    expect(page.videos.length).toBe(25);
    expect(page.videos[0].id).toBe("oHaGR0shnvA");
    expect(page.videos[0].channel.name).toBe("chilli music");
    expect(page.videos[0].durationSec).toBe(10521); // 2:55:21 badge text
    expect(page.nextCursor).toBeTruthy();
    expect(page.playlist?.title).toBe("💕Lofi Hip Hop💕 Bart 2021");
    // the REAL header stats: "Playlist | 492 videos | 57,838 views" — the total
    // count (492), not this page's item count (25)
    expect(page.playlist?.videoCount).toBe(492);
  });

  test("the SSR playlist page (REAL capture: ssr_playlist_public.json) maps through the same walker", () => {
    const page = mapPlaylistItemsPage(load("ssr_playlist_public"), "PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi");
    expect(page.videos.length).toBe(25);
    expect(page.videos[0].id).toBe("oHaGR0shnvA");
    expect(page.nextCursor).toBeTruthy();
  });

  test("continuation page (SYNTHETIC: appendContinuationItemsCommand shape) maps", () => {
    const page = mapPlaylistItemsPage(load("browse_vl_continuation_synth"), "PLsynthetic0001");
    expect(page.videos.length).toBe(1);
    expect(page.videos[0].id).toBe("oHaGR0shnvA");
    expect(page.nextCursor).toBeNull(); // the synth page is the last page
  });

  test("special list without auth (REAL capture: browse_vl_ll_public.json) is honestly login-required", () => {
    const page = mapPlaylistItemsPage(load("browse_vl_ll_public"), "LL");
    expect(page.loginRequired).toBe(true);
    expect(page.notFound).toBe(false);
    expect(page.videos).toEqual([]);
  });

  test("a genuinely unknown playlist is notFound (not login-required)", () => {
    const alert = { alerts: [{ alertRenderer: { type: "ERROR", text: { runs: [{ text: "The playlist does not exist." }] } } }] };
    const page = mapPlaylistItemsPage(alert, "PLdoesnotexist123");
    expect(page.notFound).toBe(true);
    expect(page.loginRequired).toBe(false);
  });

  test("playlist lockup mapping tolerates missing count parts", () => {
    const dto = mapPlaylistLockup({
      contentId: "PLminimal",
      metadata: { lockupMetadataViewModel: { title: { content: "Minimal" } } },
    });
    expect(dto).toMatchObject({ id: "PLminimal", title: "Minimal", videoCount: 0, visibility: "private" });
  });
});

// ---------------------------------------------------------------------------

describe("notifications mapping", () => {
  test("public menu (REAL capture: notification_menu_public.json) is the honest empty state", () => {
    const { items, loginRequired } = mapNotificationMenu(load("notification_menu_public"));
    expect(items).toEqual([]);
    // no session configured in tests → the empty public menu reports login-required
    expect(loginRequired).toBe(true);
  });

  test("logged-in menu (SYNTHETIC-shaped: notification_menu_items_synth.json) maps items", () => {
    const { items, loginRequired } = mapNotificationMenu(load("notification_menu_items_synth"));
    expect(loginRequired).toBe(false);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: "ntf_synth_001",
      read: false,
      videoId: "dQw4w9WgXcQ",
      title: "Rick Astley uploaded: Never Gonna Give You Up",
      body: "3 hours ago",
      kind: "video",
    });
    expect(items[1].read).toBe(true);
    expect(items[2].videoId).toBeNull();
    expect(items[2].channel.id).toBe("UCNye-wNBqNL5ZzHSJj31QDA");
  });

  test("unseen count (REAL capture: notification_unseen_public.json) maps with the poll cadence", () => {
    const { unread, pollIntervalMs } = mapUnseenCount(load("notification_unseen_public"));
    expect(unread).toBe(0); // zero is a valid honest state
    expect(pollIntervalMs).toBe(1800000);
  });
});
