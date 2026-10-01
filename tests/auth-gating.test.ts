/// <reference types="bun-types" />
/**
 * WFX2-P2-AU tests — the GATING contract: guests (no WebFlix session) get
 * the uniform 401 `{ error: "unauthenticated" }` on the personal + write
 * routes BEFORE any broker/InnerTube call (guests never hit the broker);
 * signed-in requests (minted session cookie) get EXACTLY the prior DTOs.
 *
 * The signed-in /api/history case rides the same REAL fixture bytes as
 * personal-routes.test.ts via the setUpstream seam — never the network.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mintSessionCookie } from "./helpers";

import { GET as historyRoute } from "@/app/api/history/route";
import { GET as subscriptionsRoute } from "@/app/api/subscriptions/route";
import { GET as studioRoute } from "@/app/api/studio/route";
import { POST as likeRoute } from "@/app/api/videos/[id]/like/route";
import { POST as commentRoute } from "@/app/api/comments/route";
import { POST as watchLaterRoute } from "@/app/api/playlists/watch-later/route";
import { GET as playlistItemsRoute } from "@/app/api/playlists/[id]/route";

let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie();
});

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  setUpstream(null);
  delete process.env.YT_COOKIES;
  delete process.env.BROKER_URL;
  delete process.env.BROKER_SECRET;
});

const guestReq = (url: string, init?: RequestInit): never => new Request(url, init) as never;
const authedReq = (url: string, init?: RequestInit): never =>
  new Request(url, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), cookie: AUTH_COOKIE },
  }) as never;

// ---------------------------------------------------------------------------

describe("guests → the uniform 401 on personal + write routes (never the broker)", () => {
  test("GET /api/history", async () => {
    const res = await historyRoute(guestReq("http://localhost/api/history"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
  });

  test("GET /api/subscriptions + GET /api/studio", async () => {
    expect((await subscriptionsRoute(guestReq("http://localhost/api/subscriptions"))).status).toBe(401);
    expect((await studioRoute(guestReq("http://localhost/api/studio"))).status).toBe(401);
  });

  test("POST /api/videos/[id]/like + POST /api/comments (write tier — no broker call)", async () => {
    // no BROKER_URL set: without the gate these would 502 (broker offline);
    // the 401 proves the gate fired BEFORE any broker resolution
    expect(
      (await likeRoute(guestReq("http://localhost/api/videos/dQw4w9WgXcQ/like", { method: "POST" }), {
        params: Promise.resolve({ id: "dQw4w9WgXcQ" }),
      } as never)).status
    ).toBe(401);
    expect(
      (await commentRoute(
        guestReq("http://localhost/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: "dQw4w9WgXcQ", body: "guest write" }),
        })
      )).status
    ).toBe(401);
  });

  test("POST /api/playlists/watch-later", async () => {
    const res = await watchLaterRoute(
      guestReq("http://localhost/api/playlists/watch-later", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: "dQw4w9WgXcQ", add: true }),
      })
    );
    expect(res.status).toBe(401);
  });
});

describe("signed-in → EXACTLY the prior behavior (DTOs unchanged)", () => {
  const FIXTURE_DIR = "tests/fixtures/yt";
  const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));
  const htmlFor = (data: unknown) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script></body></html>`;

  test("GET /api/history with the fixture upstream → the unchanged 200 DTO", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture; LOGIN_INFO=fixture";
    setUpstream(async (url: string) => {
      if (url.includes("/feed/history")) {
        return new Response(htmlFor(load("ssr_history")), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const res = await historyRoute(authedReq("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the exact contract personal-routes.test.ts asserts for the signed-in app
    expect(data.loginRequired).toBe(false);
    expect(data.session).toBe(true);
    expect(data.groups.length).toBeGreaterThan(10);
    expect(data.groups[0].label).toBe("Today");
    expect(data.groups[0].items[0].id).toBe("dQw4w9WgXcQ");
  });

  test("GET /api/playlists/[id] stays PUBLIC for guests (playlist viewing is public, per youtube.com)", async () => {
    // the /[id] GET is intentionally NOT account-gated — only its writes are
    setUpstream(async (url: string) => {
      if (url.includes("/youtubei/v1/browse")) {
        return new Response(JSON.stringify(load("browse_vl_public")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const res = await playlistItemsRoute(guestReq("http://localhost/api/playlists/PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi"), {
      params: Promise.resolve({ id: "PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi" }),
    } as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.videos).toHaveLength(25);
  });
});
