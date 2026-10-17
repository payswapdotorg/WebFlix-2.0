/// <reference types="bun-types" />
/**
 * REA-1 G16/G19 — /api/watch/queue route contracts, exercised against the
 * REAL captured panel fixtures via the test-only `setUpstream()` seam
 * (src/lib/youtube/innertube.ts). NEVER the network (the lane law); no
 * /player endpoint anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { seededShuffle } from "@/lib/playlist/shuffle";

import { GET as queueRoute } from "@/app/api/watch/queue/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const regularPanel = load("next_playlist_panel_lofi");
const mixPanel = load("next_mix_panel_lofi");
const wlAlert = load("browse_vl_ll_public"); // "The playlist does not exist." (the honest WL public state)

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/** Fixture upstream: the measured `next {videoId, playlistId}` seam + the WL browse. */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/youtubei/v1/next")) {
      if (body?.playlistId === "RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM") {
        return json(regularPanel);
      }
      if (body?.playlistId === "RDn61ULEU7CO0") {
        return json(mixPanel);
      }
      // the measured signed-out WL answer: no playlist panel at all
      return json({ responseContext: {} });
    }
    if (url.includes("/youtubei/v1/browse")) {
      if (body?.browseId === "VLWL" || body?.browseId === "VLLL") {
        return json(wlAlert);
      }
      return json({ responseContext: {} });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded };
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
  setUpstream(upstream.impl);
});

afterEach(() => {
  setUpstream(null);
});

const REGULAR = "RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM";
const MIX = "RDn61ULEU7CO0";

const get = (query: string) => queueRoute(new Request(`http://localhost/api/watch/queue?${query}`));

describe("GET /api/watch/queue — the measured next-panel seam", () => {
  test("the regular playlist: the real panel order, currentIndex at the caller's video, the measured request shape", async () => {
    const res = await get(`videoId=1FxeCa6kypU&list=${REGULAR}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlist.title).toBe("Lofi Loft");
    expect(data.items.length).toBe(25);
    expect(data.items[0].videoId).toBe("1FxeCa6kypU");
    expect(data.currentIndex).toBe(0);
    expect(data.shuffled).toBe(false);
    // the upstream request is EXACTLY youtube.com's seam (measured):
    // next {videoId, playlistId, params: "wAEB"}
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/next"));
    expect(call).toBeDefined();
    expect(call!.body.videoId).toBe("1FxeCa6kypU");
    expect(call!.body.playlistId).toBe(REGULAR);
    expect(call!.body.params).toBe("wAEB");
  });

  test("the caller's video mid-list locates the post-fetch position", async () => {
    const res = await get(`videoId=hG6YzmvbosI&list=${REGULAR}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the fixture panel marks 1FxeCa6kypU selected — the honest panel answer
    // for this window; the route still reports the CALLER's location
    expect(data.currentIndex).toBe(data.items.findIndex((it: any) => it.videoId === "hG6YzmvbosI"));
  });

  test("a video not in the served window reports -1 (never a fabricated position)", async () => {
    const res = await get(`videoId=zzzzzzzzzzz&list=${REGULAR}`);
    const data = (await res.json()) as any;
    expect(data.currentIndex).toBe(-1);
  });
});

describe("GET /api/watch/queue — the deterministic local shuffle (G16)", () => {
  test("a seed re-orders the fetched page exactly as the seeded Fisher–Yates dictates", async () => {
    const res = await get(`videoId=1FxeCa6kypU&list=${REGULAR}&shuffle=4242`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.shuffled).toBe(true);
    const expected = seededShuffle(
      regularPanel.contents.twoColumnWatchNextResults.playlist.playlist.contents.map(
        (c: any) => c.playlistPanelVideoRenderer.videoId
      ),
      4242
    );
    expect(data.items.map((it: any) => it.videoId)).toEqual(expected);
    // the same seed is deterministic: a second read equals the first
    const again = (await (await get(`videoId=1FxeCa6kypU&list=${REGULAR}&shuffle=4242`)).json()) as any;
    expect(again.items.map((it: any) => it.videoId)).toEqual(expected);
  });

  test("currentIndex tracks the caller's video through the shuffle", async () => {
    const res = await get(`videoId=1FxeCa6kypU&list=${REGULAR}&shuffle=99`);
    const data = (await res.json()) as any;
    expect(data.items[data.currentIndex]?.videoId).toBe("1FxeCa6kypU");
  });

  test("a TRUE mix (RD<videoId>) is NEVER locally re-shuffled — YouTube's own order stands", async () => {
    const res = await get(`videoId=n61ULEU7CO0&list=${MIX}&shuffle=4242`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.shuffled).toBe(false);
    expect(data.items[0].videoId).toBe("n61ULEU7CO0"); // the seed row (the measured radio start)
    expect(data.playlist.isMix).toBe(true);
    expect(data.playlist.title).toBe("Mix - Best of lofi hip hop 2021 ✨ [beats to relax/study to]");
  });

  test("a garbage shuffle param is ignored (the honest unseeded read)", async () => {
    const res = await get(`videoId=1FxeCa6kypU&list=${REGULAR}&shuffle=junk`);
    const data = (await res.json()) as any;
    expect(data.shuffled).toBe(false);
    expect(data.items[0].videoId).toBe("1FxeCa6kypU");
  });

  test("cursor pages append in the served order — the seed never re-applies (the law)", async () => {
    const res = await get(`videoId=1FxeCa6kypU&list=${REGULAR}&shuffle=4242&cursor=AAAA1234next`);
    const data = (await res.json()) as any;
    expect(data.shuffled).toBe(false);
    expect(data.items[0].videoId).toBe("1FxeCa6kypU"); // the served panel order, untouched
    // the upstream continuation POST is the browse-family {continuation} shape
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/next"));
    expect(call!.body.continuation).toBe("AAAA1234next");
    expect(call!.body.playlistId).toBe(REGULAR);
  });
});

describe("GET /api/watch/queue — the honest states", () => {
  test("WL without a session: the honest loginRequired state (never a fabricated queue)", async () => {
    const res = await get("videoId=dQw4w9WgXcQ&list=WL");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.items).toEqual([]);
    expect(data.playlist.title).toBe("Watch later");
    // the special list rides the session read (browse VLWL), not the next seam
    const call = upstream.recorded.find((r) => r.url.includes("/youtubei/v1/browse"));
    expect(call?.body.browseId).toBe("VLWL");
  });

  test("a list the upstream will not queue for this video → the honest 404", async () => {
    const res = await get("videoId=dQw4w9WgXcQ&list=PLnoSuchList12345");
    expect(res.status).toBe(404);
    const data = (await res.json()) as any;
    expect(data.error).toBe("Queue unavailable for this list");
  });

  test("validation: missing/invalid videoId or list → 400, no upstream call", async () => {
    expect((await get("list=PLFgquLnL59al")).status).toBe(400);
    expect((await get("videoId=short&list=PLFgquLnL59al")).status).toBe(400);
    expect((await get("videoId=dQw4w9WgXcQ&list=xx")).status).toBe(400);
    expect((await get("videoId=dQw4w9WgXcQ")).status).toBe(400);
    expect(upstream.recorded).toHaveLength(0);
  });
});
