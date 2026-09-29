/**
 * WFX2-W tests — subscribe state machine (Subscribe → Subscribed → bell
 * modes → unsubscribe), persisted per channel; subscriber counts stay
 * honest; session identity resolution is user-aware.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { setSubscription } from "../src/lib/watch/subscription-service";
import { resolveViewer, resolveViewerFromHeaders, VIEWER_HEADER } from "../src/lib/watch/session";
import { getVideoDetail } from "../src/lib/watch/video-service";
import { listPlaylists, createPlaylist, togglePlaylistItem } from "../src/lib/watch/playlist-service";
import { ApiError } from "../src/lib/watch/api";

setupTestDb();

describe("subscription state machine", () => {
  test("subscribe → bell update → unsubscribe with honest counts", async () => {
    const { blender, pip } = await fixtures(); // pip is NOT subscribed from seed
    const base = blender.subscriberCount;

    // subscribe (default bell personalized)
    const sub = await setSubscription(blender.id, pip.id, "personalized");
    expect(sub.subscribed).toBe(true);
    expect(sub.bell).toBe("personalized");
    expect(sub.subscriberCount).toBe(base + 1);

    // bell menu: All / Personalized / None (still subscribed)
    const all = await setSubscription(blender.id, pip.id, "all");
    expect(all.subscribed).toBe(true);
    expect(all.bell).toBe("all");
    expect(all.subscriberCount).toBe(base + 1); // no double count

    const none = await setSubscription(blender.id, pip.id, "none");
    expect(none.subscribed).toBe(true);
    expect(none.bell).toBe("none");

    // unsubscribe
    const off = await setSubscription(blender.id, pip.id, "off");
    expect(off.subscribed).toBe(false);
    expect(off.bell).toBeNull();
    expect(off.subscriberCount).toBe(base);
  });

  test("getVideoDetail reflects subscribe state (persisted per channel)", async () => {
    const { bbb, demo, pip } = await fixtures();
    // demo is subscribed from the seed
    const forDemo = await getVideoDetail(bbb.id, demo.id);
    expect(forDemo.state.subscribed).toBe(true);
    expect(["all", "personalized", "none"]).toContain(forDemo.state.bell as string);
    // pip is not
    const forPip = await getVideoDetail(bbb.id, pip.id);
    expect(forPip.state.subscribed).toBe(false);
    expect(forPip.state.bell).toBeNull();
  });
});

describe("demo-user identity (user-aware API shape)", () => {
  test("header overrides identity; fallback is the demo user", async () => {
    const { demo, pip } = await fixtures();
    const viaHeader = await resolveViewerFromHeaders(
      new Headers({ [VIEWER_HEADER]: pip.handle })
    );
    expect(viaHeader?.id).toBe(pip.id);

    const fallback = await resolveViewer(new Headers());
    expect(fallback.id).toBe(demo.id);

    const unknown = await resolveViewerFromHeaders(new Headers({ [VIEWER_HEADER]: "ghost" }));
    expect(unknown).toBeNull();
  });

  test("cookie identity resolves too", async () => {
    const { pip } = await fixtures();
    const viaCookie = await resolveViewerFromHeaders(
      new Headers({ cookie: `wfx2_uid=${pip.id}` })
    );
    expect(viaCookie?.id).toBe(pip.id);
  });
});

describe("playlists (Save dialog backend)", () => {
  test("list shows Watch later first + containsVideo; toggle + create are real", async () => {
    const { bbb, demo } = await fixtures();
    const lists = await listPlaylists(bbb.id, demo.id);
    expect(lists[0].isWatchLater).toBe(true);
    expect(lists[0].containsVideo).toBe(false); // BBB not in watch later from seed
    // seed put ElephantsDream in watch later
    const ed = await (await import("../src/lib/db")).db.video.findFirstOrThrow({
      where: { title: { contains: "Elephants Dream" } },
    });
    const withEd = await listPlaylists(ed.id, demo.id);
    expect(withEd[0].containsVideo).toBe(true);
    expect(withEd[0].itemCount).toBe(1);

    // toggle BBB into watch later
    const toggled = await togglePlaylistItem(lists[0].id, bbb.id, demo.id);
    expect(toggled.containsVideo).toBe(true);
    const after = await listPlaylists(bbb.id, demo.id);
    expect(after[0].containsVideo).toBe(true);

    // create new playlist
    const created = await createPlaylist(demo.id, "My new list", "public");
    expect(created.name).toBe("My new list");
    expect(created.visibility).toBe("public");
    const listsAfter = await listPlaylists(bbb.id, demo.id);
    expect(listsAfter.find((p) => p.name === "My new list")).toBeDefined();
  });

  test("duplicate playlist names are rejected honestly", async () => {
    const { demo } = await fixtures();
    let rejected = false;
    try {
      await createPlaylist(demo.id, "Blender classics", "private");
    } catch (e) {
      rejected = e instanceof ApiError && e.status === 400;
    }
    expect(rejected).toBe(true);
  });
});
