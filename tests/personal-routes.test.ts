/// <reference types="bun-types" />
/**
 * WFX2-B-B route tests — the live personal-surface routes exercised against
 * fixture bytes via the test-only `setUpstream()` seam (the pattern from
 * A-B's yt-routes.test.ts). NEVER the network.
 *
 * Session handling: `YT_COOKIES` is set in the "live session" describes so
 * hasSession() is true (personal mode); it is deleted in the public-mode
 * describes so the honest login-required degradation is exercised.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mintSessionCookie } from "./helpers";

import { GET as historyRoute, DELETE as historyDelete, PATCH as historyPatch } from "@/app/api/history/route";
import { GET as playlistsRoute } from "@/app/api/playlists/route";
import { GET as playlistItemsRoute, DELETE as playlistDelete } from "@/app/api/playlists/[id]/route";
import { GET as playlistPageRoute } from "@/app/api/playlist/[id]/route";
import { GET as likedRoute } from "@/app/api/liked/route";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as notificationsRoute } from "@/app/api/notifications/route";
import { POST as notificationsReadRoute } from "@/app/api/notifications/read/route";
import { GET as subscriptionsRoute } from "@/app/api/subscriptions/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

// ---------------------------------------------------------------------------
// P22-B: the /api/me ownedChannel seam — the operator-channel lookup is
// MOCKED at the module seam (the playlist-edit broker idiom): the me route's
// branching (the operator's REAL channel first, the DB mirror as the
// fallback, honest null when neither resolves) is what's under test — the
// ladder itself lives in operator.ts and is live-verified on the deploy.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realStudio = { ...require("@/lib/youtube/studio") } as Record<string, unknown>;
let meLookup: {
  browseId: string;
  handle: string;
  header: { name: string } | null;
  homeResponse: unknown;
} | null = null;
mock.module("@/lib/youtube/studio", () => ({
  ...realStudio,
  operatorChannelLookup: async () => meLookup,
}));

/** NextRequest-compatible request factory (the routes type against NextRequest).
 * WFX2-P2-AU: every request carries the minted WebFlix session cookie —
 * these tests exercise the SIGNED-IN surface behind the auth gate. */
let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie();
});
const req = (url: string, init?: RequestInit): never =>
  new Request(url, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), cookie: AUTH_COOKIE },
  }) as never;

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/** Fixture-backed upstream serving every personal surface. */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const history = load("ssr_history");
  const historyPublic = load("ssr_history_public");
  const subs = load("ssr_subscriptions");
  const subsPublic = load("ssr_subscriptions_public");
  const playlistsSynth = load("ssr_playlists_synth");
  const playlistsPublic = load("ssr_playlists_public");
  const vlPublic = load("browse_vl_public");
  const vlContinuation = load("browse_vl_continuation_synth");
  const vlLL = load("browse_vl_ll_public");
  const notifMenu = load("notification_menu_public");
  const notifMenuItems = load("notification_menu_items_synth");
  const notifUnseen = load("notification_unseen_public");

  const htmlFor = (data: unknown) =>
    `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
      data
    )};</script></body></html>`;

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    const html = (data: unknown) =>
      new Response(htmlFor(data), { status: 200, headers: { "Content-Type": "text/html" } });

    // SSR pages
    if (url.includes("/feed/history")) {
      return body === null && init?.headers && (init.headers as Record<string, string>).Cookie
        ? html(history)
        : html(history);
    }
    if (url.includes("/feed/subscriptions")) return html(subs);
    if (url.includes("/feed/playlists")) return html(playlistsSynth);
    if (url.includes("/playlist?list=")) return html(vlPublic);

    // InnerTube POST endpoints
    if (url.includes("/youtubei/v1/browse")) {
      const browseId = body?.browseId ?? "";
      if (browseId === "VLWL" || browseId === "VLLL") return json(vlLL);
      if (browseId === "VLPLdoesnotexist123") {
        return json({ alerts: [{ alertRenderer: { type: "ERROR", text: { runs: [{ text: "The playlist does not exist." }] } } }] });
      }
      if (browseId.startsWith("VL")) return json(vlPublic);
      // continuation pages
      return json(vlContinuation);
    }
    if (url.includes("/youtubei/v1/notification/get_notification_menu")) {
      return json(notifMenuItems);
    }
    if (url.includes("/youtubei/v1/notification/get_unseen_count")) {
      return json(notifUnseen);
    }
    return new Response("not found", { status: 404 });
  };

  // cookie-aware: public mode (no session) serves the public captures
  const implPublic = async (url: string, init?: RequestInit): Promise<Response> => {
    recorded.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    const html = (data: unknown) =>
      new Response(htmlFor(data), { status: 200, headers: { "Content-Type": "text/html" } });
    if (url.includes("/feed/history")) return html(historyPublic);
    if (url.includes("/feed/subscriptions")) return html(subsPublic);
    if (url.includes("/feed/playlists")) return html(playlistsPublic);
    if (url.includes("/playlist?list=")) return html(load("ssr_playlist_public"));
    if (url.includes("/youtubei/v1/browse")) {
      const browseId = body2(init);
      if (browseId === "VLWL" || browseId === "VLLL") return json(vlLL);
      return json(vlPublic);
    }
    if (url.includes("/youtubei/v1/notification/")) {
      return url.includes("get_unseen_count") ? json(notifUnseen) : json(notifMenu);
    }
    return new Response("not found", { status: 404 });
  };

  function body2(init?: RequestInit): any {
    return init?.body ? JSON.parse(String(init.body)) : null;
  }

  return { impl, implPublic, recorded };
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
});

afterEach(() => {
  setUpstream(null);
  delete process.env.YT_COOKIES;
  delete process.env.BROKER_URL;
  delete process.env.BROKER_SECRET;
});

// ---------------------------------------------------------------------------

describe("GET /api/history — live session (fixture: real 95-item-day-grouped capture)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture; LOGIN_INFO=fixture";
    setUpstream(upstream.impl);
  });

  test("maps the real day-grouped history with a continuation cursor", async () => {
    const res = await historyRoute(req("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.session).toBe(true);
    expect(data.groups.length).toBeGreaterThan(10);
    expect(data.groups[0].label).toBe("Today");
    expect(data.total).toBeGreaterThan(100);
    expect(typeof data.nextCursor).toBe("string");
    // the first item carries watched-progress from the real startPercent overlay
    const first = data.groups[0].items[0];
    expect(first.id).toBe("dQw4w9WgXcQ");
    expect(first.watchedSec).toBe(214);
    // the real capture's control rail reads "Pause watch history" → recording
    expect(data.watchHistoryPaused).toBe(false);
    // one SSR call for the page
    const ssr = upstream.recorded.filter((r) => r.url.includes("/feed/history"));
    expect(ssr).toHaveLength(1);
  });

  test("?cursor= pages via browse {continuation}", async () => {
    const res = await historyRoute(
      req("http://localhost/api/history?cursor=4qmFsgJ0ZXN0")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.groups.length).toBeGreaterThan(0);
    const browse = upstream.recorded.filter(
      (r) => r.url.includes("/youtubei/v1/browse") && r.body?.continuation === "4qmFsgJ0ZXN0"
    );
    expect(browse).toHaveLength(1);
  });
});

describe("GET /api/history — public mode (honest degradation)", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("the logged-out promo page maps to the honest login-required state", async () => {
    const res = await historyRoute(req("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.groups).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(data.total).toBe(0);
  });
});

describe("DELETE / PATCH /api/history — broker tier", () => {
  beforeEach(() => {
    delete process.env.BROKER_URL; // broker offline → honest 502
  });

  test("DELETE ?videoId= without the broker → the honest offline 502", async () => {
    const res = await historyDelete(
      req("http://localhost/api/history?videoId=dQw4w9WgXcQ")
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("offline");
  });

  test("DELETE with an invalid videoId → 400 without a broker call", async () => {
    const res = await historyDelete(
      req("http://localhost/api/history?videoId=%20%20")
    );
    expect(res.status).toBe(400);
  });

  test("PATCH {paused:true} without the broker → the honest offline 502", async () => {
    const res = await historyPatch(
      req("http://localhost/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true, type: "watch" }),
      })
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("offline");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/subscriptions — live session (fixture: real 95-item capture)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("maps the real feed: 95 videos, 2 channels, cursor", async () => {
    const res = await subscriptionsRoute(req("http://localhost/api/subscriptions"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.videos).toHaveLength(95);
    expect(data.channels).toHaveLength(2);
    expect(data.channels[0].id).toBe("UCICYIUduSnJCb1bB_6iJBAQ");
    expect(typeof data.nextCursor).toBe("string");
  });

  test("?cursor= pages via browse {continuation}", async () => {
    const res = await subscriptionsRoute(
      req("http://localhost/api/subscriptions?cursor=4qmFsgJ0ZXN0")
    );
    expect(res.status).toBe(200);
    const browse = upstream.recorded.filter(
      (r) => r.url.includes("/youtubei/v1/browse") && r.body?.continuation === "4qmFsgJ0ZXN0"
    );
    expect(browse).toHaveLength(1);
  });
});

describe("GET /api/subscriptions — public mode", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("the logged-out promo → honest login-required empties", async () => {
    const res = await subscriptionsRoute(req("http://localhost/api/subscriptions"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.channels).toEqual([]);
    expect(data.videos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlists — live session (SYNTHETIC-shaped operator list)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("maps the operator playlists list", async () => {
    const res = await playlistsRoute(req("http://localhost/api/playlists"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.playlists).toHaveLength(3);
    expect(data.playlists[0]).toMatchObject({
      id: "PLsynthetic0001",
      title: "Synth private list",
      visibility: "private",
      videoCount: 6,
    });
    const ssr = upstream.recorded.filter((r) => r.url.includes("/feed/playlists"));
    expect(ssr).toHaveLength(1);
  });
});

describe("GET /api/playlists — public mode", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("the public skeleton page → honest login-required empties", async () => {
    const res = await playlistsRoute(req("http://localhost/api/playlists"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.playlists).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlists/[id] — browse VL items", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("public playlist items via browse VL (REAL fixture): items + header + cursor", async () => {
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi"),
      { params: Promise.resolve({ id: "PLfvAqoENo7embtefW2ac_8zISVwgvg_Vi" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.videos).toHaveLength(25);
    expect(data.videos[0].id).toBe("oHaGR0shnvA");
    expect(data.playlist.title).toBe("💕Lofi Hip Hop💕 Bart 2021");
    expect(typeof data.nextCursor).toBe("string");
    // the upstream call carried the VL browseId
    const browse = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse).toHaveLength(1);
    expect(browse[0].body.browseId).toBe("VLPLfvAqoENo7embtefW2ac_8zISVwgvg_Vi");
  });

  test("?cursor= pages via browse {continuation} (SYNTHETIC continuation fixture)", async () => {
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/PLsynthetic0001?cursor=4qmFsgJ0ZXN0"),
      { params: Promise.resolve({ id: "PLsynthetic0001" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos).toHaveLength(1);
    expect(data.videos[0].id).toBe("oHaGR0shnvA");
    expect(data.nextCursor).toBeNull();
  });

  test("WL without a session → honest loginRequired (REAL auth-gated capture)", async () => {
    delete process.env.YT_COOKIES;
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.special).toBe(true);
    expect(data.videos).toEqual([]);
  });

  test("an unknown regular playlist id → honest 404", async () => {
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/PLdoesnotexist123"),
      { params: Promise.resolve({ id: "PLdoesnotexist123" }) }
    );
    expect(res.status).toBe(404);
  });

  test("DELETE WL → honest 400 (YouTube's own lists are undeletable)", async () => {
    const res = await playlistDelete(
      req("http://localhost/api/playlists/WL", { method: "DELETE" }),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(400);
  });

  test("P22-B: WL with a session + the not-exist alert → honest unavailable (the dialog's flag)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.unavailable).toBe(true);
    expect(data.loginRequired).toBe(false);
    expect(data.special).toBe(true);
    expect(data.videos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlist/[id] — the special lists through the playlist PAGE route (P22-B)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("WL + the not-exist alert WITH a session → the honest unavailable special page (never a login ask)", async () => {
    const res = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.special).toBe(true);
    expect(data.unavailable).toBe(true);
    expect(data.loginRequired).toBe(false);
    // the honest identity of the list survives the failed read
    expect(data.playlist.channelName).toBe("You");
    expect(data.playlist.title).toBe("Watch later");
    expect(data.playlist.viewsText).toBeNull();
    expect(data.videos).toEqual([]);
    // the read went through the special-list browse (the session semantics)
    const browse = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse.at(-1)?.body.browseId).toBe("VLWL");
  });

  test("WL without a session → the honest login-required special page", async () => {
    delete process.env.YT_COOKIES;
    const res = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.special).toBe(true);
    expect(data.loginRequired).toBe(true);
    expect(data.unavailable).toBe(false);
    expect(data.playlist.title).toBe("Watch later");
  });

  test("a SERVED WL read maps onto the playlist page DTO (You owner row + count + the videos)", async () => {
    // a custom upstream serving a REAL served playlist fixture for VLWL —
    // the served path: the upstream's own title wins (the fallback only
    // applies when the read carries no header), the owner row is "You"
    // (youtube.com labels the WL page's owner "You" — measured 2026-10-11)
    const served = load("browse_vl_public");
    setUpstream(async (url: string, init?: RequestInit) => {
      if (url.includes("/youtubei/v1/browse")) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (body?.browseId === "VLWL") {
          return new Response(JSON.stringify(served), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    const res = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.special).toBe(true);
    expect(data.unavailable).toBe(false);
    expect(data.loginRequired).toBe(false);
    expect(data.playlist.channelName).toBe("You");
    // the served read's OWN title wins (the fallback only applies when the
    // read carries no header) — here the fixture's real title, a known
    // fixture artifact on the WL route
    expect(data.playlist.title).toBe("💕Lofi Hip Hop💕 Bart 2021");
    expect(typeof data.playlist.videoCountText).toBe("string");
    expect(data.playlist.videoCountText).toContain("videos");
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.videos[0].id).toBe("oHaGR0shnvA");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/liked — the LL surface", () => {
  beforeEach(() => {
    setUpstream(upstream.impl);
  });

  test("without a session: the real auth-gated VL response → honest loginRequired", async () => {
    delete process.env.YT_COOKIES;
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.videos).toEqual([]);
    // the upstream call was browse VLLL (the verified mechanism)
    const browse = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse).toHaveLength(1);
    expect(browse[0].body.browseId).toBe("VLLL");
  });

  test("with a session the same VL path is used (cookies ride the InnerTube call)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const browse = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browse[0].body.browseId).toBe("VLLL");
  });

  test("P22-B: with a session, the not-exist alert is honestly UNAVAILABLE — never login-required (the production deploy's shape)", async () => {
    // the fixture upstream answers the "playlist does not exist" alert for
    // VLLL regardless of cookies — exactly what the production deploy does
    // WITH the operator session configured (measured live 2026-10-11). The
    // split: a session IS configured → the read was not served.
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.unavailable).toBe(true);
    expect(data.loginRequired).toBe(false);
    expect(data.session).toBe(true);
    expect(data.videos).toEqual([]);
    expect(data.playlist).toBeNull();
  });

  test("without a session, the same alert stays honestly login-required", async () => {
    delete process.env.YT_COOKIES;
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(true);
    expect(data.unavailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/notifications — the verified endpoints", () => {
  beforeEach(() => {
    setUpstream(upstream.impl);
  });

  test("menu + unseen map to the bell contract (unread from items when present)", async () => {
    const res = await notificationsRoute(req("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the session-mode fixture upstream serves the synth items menu (3 items, 2 unread)
    expect(data.items).toHaveLength(3);
    expect(data.unread).toBe(2);
    expect(data.pollIntervalMs).toBe(1800000);
    // both verified endpoints were called
    expect(
      upstream.recorded.filter((r) => r.url.includes("notification/get_notification_menu"))
    ).toHaveLength(1);
    expect(upstream.recorded.filter((r) => r.url.includes("notification/get_unseen_count"))).toHaveLength(1);
  });

  test("public menu → honest empty + loginRequired, unread 0", async () => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
    const res = await notificationsRoute(req("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.items).toEqual([]);
    expect(data.unread).toBe(0); // zero is valid
    expect(data.loginRequired).toBe(true);
  });
});

describe("POST /api/notifications/read — broker tier", () => {
  test("without the broker → the honest offline 502", async () => {
    delete process.env.BROKER_URL;
    const res = await notificationsReadRoute(
      req("http://localhost/api/notifications/read", { method: "POST" })
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("offline");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/me — the ownedChannel seam (P22-B)", () => {
  afterEach(() => {
    meLookup = null;
  });

  test("public mode (no YT session) → the DB mirror fallback (the seeded demo channel)", async () => {
    delete process.env.YT_COOKIES;
    const res = await meRoute();
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the operator seam is skipped entirely without a session — the honest
    // DB fallback (the demo account's owned channel) carries "Your channel"
    expect(data.ownedChannel).toEqual({ handle: "codecraft", name: "CodeCraft" });
    expect(data.subscriptions).toEqual([]);
  });

  test("with a session + the operator resolved → the operator's REAL channel wins over the DB mirror", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    meLookup = {
      browseId: "UCop",
      handle: "@opchan",
      header: { name: "Operator Channel" },
      homeResponse: null,
    };
    const res = await meRoute();
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ownedChannel).toEqual({ handle: "@opchan", name: "Operator Channel" });
  });

  test("with a session + the lookup unresolved → the honest DB fallback (never a guess)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    meLookup = null;
    const res = await meRoute();
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ownedChannel).toEqual({ handle: "codecraft", name: "CodeCraft" });
  });

  test("with a session + a headerless lookup → the honest DB fallback (header required)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    meLookup = {
      browseId: "UCop",
      handle: "@opchan",
      header: null,
      homeResponse: null,
    };
    const res = await meRoute();
    const data = (await res.json()) as any;
    expect(data.ownedChannel).toEqual({ handle: "codecraft", name: "CodeCraft" });
  });
});

afterAll(() => {
  mock.module("@/lib/youtube/studio", () => realStudio);
});
