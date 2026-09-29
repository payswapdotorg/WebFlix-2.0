/**
 * WFX2-B-B executor tests — the additive personal-surface kinds (pure
 * contract checks: requiredUrl + buildScript; no CDP, no network).
 */
import { describe, expect, test } from "bun:test";

import { requiredUrl, buildScript } from "./executor";
import { ACTION_KINDS, type BrokerActionRequest } from "./types";

const req = (kind: string, target: Record<string, string | undefined>, payload?: Record<string, unknown>): BrokerActionRequest =>
  ({ kind, target, payload } as BrokerActionRequest);

describe("ACTION_KINDS — the WFX2-B-B additions are registered", () => {
  test("all 8 new kinds are in the list", () => {
    for (const kind of [
      "history-remove",
      "history-clear-all",
      "history-pause",
      "search-history-pause",
      "playlist-remove-item",
      "playlist-create",
      "playlist-delete",
      "notifications-mark-read",
    ]) {
      expect(ACTION_KINDS).toContain(kind);
    }
  });
});

describe("requiredUrl — the new kinds land on the right youtube.com page", () => {
  test("history kinds → /feed/history", () => {
    for (const kind of ["history-remove", "history-clear-all", "history-pause", "search-history-pause"]) {
      expect(requiredUrl(req(kind, { videoId: "dQw4w9WgXcQ" }))).toBe("https://www.youtube.com/feed/history");
    }
  });
  test("playlist item/delete → /playlist?list=<id>", () => {
    expect(requiredUrl(req("playlist-remove-item", { playlistId: "PLabc", videoId: "x" }))).toBe(
      "https://www.youtube.com/playlist?list=PLabc"
    );
    expect(requiredUrl(req("playlist-delete", { playlistId: "PLabc" }))).toBe(
      "https://www.youtube.com/playlist?list=PLabc"
    );
  });
  test("playlist-create → /feed/playlists", () => {
    expect(requiredUrl(req("playlist-create", {}))).toBe("https://www.youtube.com/feed/playlists");
  });
  test("notifications-mark-read → youtube home", () => {
    expect(requiredUrl(req("notifications-mark-read", {}))).toBe("https://www.youtube.com/");
  });
});

describe("buildScript — the new kinds build page scripts", () => {
  test("history-remove targets the videoId in the card finder", () => {
    const built = buildScript(req("history-remove", { videoId: "dQw4w9WgXcQ" }));
    expect(built).not.toBeNull();
    expect(built!.script).toContain("dQw4w9WgXcQ");
    expect(built!.script).toContain("remove from watch history");
  });

  test("history-clear-all clicks the real control + confirm", () => {
    const built = buildScript(req("history-clear-all", {}));
    expect(built!.script).toContain("clear all watch history");
    expect(built!.script).toContain("#confirm-button");
  });

  test("history-pause defaults to paused=true and honors paused:false (resume)", () => {
    const pause = buildScript(req("history-pause", {}));
    expect(pause!.script).toContain("resume watch history"); // desired end-state label
    const resume = buildScript(req("history-pause", {}, { paused: false }));
    expect(resume!.script).toContain("pause watch history");
  });

  test("search-history-pause builds the kebab-menu script", () => {
    const built = buildScript(req("search-history-pause", {}, { paused: true }));
    expect(built!.script).toContain("search history");
  });

  test("playlist-remove-item carries both ids + the edit_playlist fallback", () => {
    const built = buildScript(req("playlist-remove-item", { playlistId: "PLabc", videoId: "dQw4w9WgXcQ" }));
    expect(built!.script).toContain("PLabc");
    expect(built!.script).toContain("dQw4w9WgXcQ");
    expect(built!.script).toContain("ACTION_REMOVE_VIDEO");
  });

  test("playlist-create requires a title (null without one)", () => {
    expect(buildScript(req("playlist-create", {}))).toBeNull();
    const built = buildScript(req("playlist-create", {}, { title: "My List", visibility: "public" }));
    expect(built!.script).toContain("My List");
    expect(built!.script).toContain("public");
    // invalid visibility falls back to private (YouTube's own default)
    const fallback = buildScript(req("playlist-create", {}, { title: "X", visibility: "banana" }));
    expect(fallback!.script).toContain("private");
  });

  test("playlist-delete carries the id + the delete_playlist fallback", () => {
    const built = buildScript(req("playlist-delete", { playlistId: "PLabc" }));
    expect(built!.script).toContain("PLabc");
    expect(built!.script).toContain("delete_playlist");
  });

  test("notifications-mark-read opens the bell and re-reads the count", () => {
    const built = buildScript(req("notifications-mark-read", {}));
    expect(built!.script).toContain("notification/get_unseen_count");
    expect(built!.script).toContain("ytd-notification-topbar-button-renderer");
  });
});
