/// <reference types="bun-types" />
/**
 * WFX2-B-B route tests — the personal-surface routes.
 *
 * WFX2-P36 re-point: the shared-operator reads/writes are RETIRED — these
 * routes now answer the honest per-user envelopes (per-user official reads
 * for subscriptions channels / playlists; honest empty + notice for the
 * no-official-API surfaces history / liked; honest 501 youtube-unsupported
 * for the no-API writes). The per-user OAuth binding rides the REAL
 * connection store (Map fallback, env-clean) with real encryptSecret blobs;
 * the official-API seam is mocked at the module boundary (the action-routes
 * mock.module idiom, restored in afterAll). The fixture upstream stays for
 * the routes that still read public InnerTube surfaces — and its `recorded`
 * log now doubles as the proof that the retired operator reads NEVER fire.
 * NEVER the network.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mintSessionCookie } from "./helpers";
import { putYouTubeConnection, resetYoutubeConnectionStore } from "@/lib/auth/youtube-connection-store";
import { encryptSecret } from "@/lib/youtube/oauth";

// ---------------------------------------------------------------------------
// WFX2-P36 — the per-user official-API seam, mocked at the module boundary
// (the action-routes mock.module idiom, restored in afterAll): the per-user
// official reads answer programmable typed results, and each call's
// accessToken is RECORDED so the tests can pin that the ACTING user's own
// token served the read — never the operator's.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOfficial = { ...require("@/lib/youtube/official-actions") } as Record<string, unknown>;
const officialCalls: string[] = [];
let officialChannelsResult: unknown = { ok: true, data: [] };
let officialPlaylistsResult: unknown = { ok: true, data: [] };
mock.module("@/lib/youtube/official-actions", () => ({
  ...realOfficial,
  officialListSubscribedChannels: async (accessToken: string) => {
    officialCalls.push(`subscriptions:${accessToken}`);
    return officialChannelsResult;
  },
  officialListPlaylists: async (accessToken: string) => {
    officialCalls.push(`playlists:${accessToken}`);
    return officialPlaylistsResult;
  },
}));

import { GET as historyRoute, DELETE as historyDelete, PATCH as historyPatch } from "@/app/api/history/route";
import { GET as playlistsRoute } from "@/app/api/playlists/route";
import { GET as playlistItemsRoute, DELETE as playlistDelete } from "@/app/api/playlists/[id]/route";
import { GET as playlistPageRoute } from "@/app/api/playlist/[id]/route";
import { POST as watchLaterPostRoute } from "@/app/api/playlists/watch-later/route";
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

// env-clean: the per-user connection store must ride its Map fallback (never
// a live Upstash), so the REST env vars are saved + deleted for this file and
// restored in afterAll (bun --isolate gives each file its own process).
const savedUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const savedUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

/** Connect the ACTING user's (or another user's) own YouTube account in the
 * Map-fallback store: real encryptSecret token blobs, a non-expiring access
 * token (the transparent refresh must never fire — no network), status
 * "connected". The P36 per-user binding. */
async function connectUser(userId = "u_wfx2_test"): Promise<void> {
  await putYouTubeConnection({
    userId,
    channelId: "UCown0000000000000001",
    channelTitle: `Channel of ${userId}`,
    channelThumbUrl: null,
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    accessTokenEnc: await encryptSecret(`access-token-${userId}`),
    refreshTokenEnc: await encryptSecret(`refresh-token-${userId}`),
    accessExpiresAt: Date.now() + 3_600_000,
    status: "connected",
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
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
  resetYoutubeConnectionStore(); // the per-user connection store is per-test
  officialCalls.length = 0;
  officialChannelsResult = { ok: true, data: [] };
  officialPlaylistsResult = { ok: true, data: [] };
});

afterEach(() => {
  setUpstream(null);
  resetYoutubeConnectionStore();
  delete process.env.YT_COOKIES;
  delete process.env.BROKER_URL;
  delete process.env.BROKER_SECRET;
});

// ---------------------------------------------------------------------------

describe("GET /api/history — the honest per-user envelope (WFX2-P36: no official history API)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture; LOGIN_INFO=fixture";
    setUpstream(upstream.impl);
  });

  test("no connected account → the honest empty + notice (connected:false) — never the operator's 95-item history", async () => {
    const res = await historyRoute(req("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      groups: [],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: null,
      searchHistoryPaused: null,
      total: 0,
      session: true, // the deployment read-session flag is disclosed…
      connected: false, // …but the acting user has no connected account
    });
    expect(data.notice).toBe(
      "Your YouTube watch history has no official API — WebFlix never reads one person's history for another. Open youtube.com/feed/history for yours."
    );
    // the retired operator SSR read NEVER fires — zero upstream calls
    expect(upstream.recorded).toHaveLength(0);
  });

  test("the acting user's own connected account → the SAME honest empty + notice (connected:true — a connection never fabricates history)", async () => {
    await connectUser();
    const res = await historyRoute(req("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      groups: [],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: null,
      searchHistoryPaused: null,
      total: 0,
      session: true,
      connected: true,
    });
    expect(data.notice).toContain("no official API");
    expect(data.notice).toContain("youtube.com/feed/history");
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/history — public mode (the read-session flag honestly false)", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("no YT_COOKIES → the same honest envelope with session:false — the WebFlix gate owns sign-in, never a login lie", async () => {
    const res = await historyRoute(req("http://localhost/api/history"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      groups: [],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: null,
      searchHistoryPaused: null,
      total: 0,
      session: false,
      connected: false,
    });
    expect(data.notice).toContain("no official API");
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("DELETE / PATCH /api/history — the honest unsupported lane (WFX2-P36)", () => {
  test("DELETE ?videoId= → the honest 501 youtube-unsupported with the handoff (the broker drive retired)", async () => {
    const res = await historyDelete(
      req("http://localhost/api/history?videoId=dQw4w9WgXcQ")
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind: string };
    expect(body.kind).toBe("youtube-unsupported");
    expect(body.error).toContain("Removing a video from your YouTube watch history");
    expect(body.error).toContain("youtube.com/feed/history");
  });

  test("DELETE with an invalid videoId → 400 (validated before the unsupported verdict)", async () => {
    const res = await historyDelete(
      req("http://localhost/api/history?videoId=%20%20")
    );
    expect(res.status).toBe(400);
  });

  test("PATCH {paused:true} → the honest 501 youtube-unsupported (the pause toggles are YouTube account settings)", async () => {
    const res = await historyPatch(
      req("http://localhost/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true, type: "watch" }),
      })
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind: string };
    expect(body.kind).toBe("youtube-unsupported");
    expect(body.error).toContain("Pausing or resuming your watch history");
    expect(body.error).toContain("youtube.com/feed/history");
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/subscriptions — the per-user official read (WFX2-P36)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("the acting user's own channels via officialListSubscribedChannels + the honest combined-feed notice", async () => {
    await connectUser();
    officialChannelsResult = {
      ok: true,
      data: [
        {
          channelId: "UCalice0000000001",
          title: "Alice's Channel",
          thumbUrl: "https://example.com/a.jpg",
          subscribedAt: "2026-01-01T00:00:00Z",
        },
        { channelId: "UCbob000000000002", title: "Bob Builds", thumbUrl: null, subscribedAt: null },
      ],
    };
    const res = await subscriptionsRoute(req("http://localhost/api/subscriptions"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channels).toHaveLength(2);
    expect(data.channels[0]).toMatchObject({
      id: "UCalice0000000001",
      handle: "Alice's Channel",
      name: "Alice's Channel",
      avatarUrl: "https://example.com/a.jpg",
    });
    expect(data.channels[1]).toMatchObject({ id: "UCbob000000000002", name: "Bob Builds", avatarUrl: "" });
    expect(data.videos).toEqual([]); // the combined latest-videos feed has no official API
    expect(data.nextCursor).toBeNull();
    expect(data.loginRequired).toBe(false);
    expect(data.connected).toBe(true);
    expect(data.notice).toBe(
      "Your channels, read through your connected account. The combined latest-videos feed has no official YouTube API — open youtube.com/feed/subscriptions for it."
    );
    // the official read rode the ACTING user's own token — never the operator's
    expect(officialCalls).toEqual(["subscriptions:access-token-u_wfx2_test"]);
    // the retired operator SSR feed NEVER fires
    expect(upstream.recorded).toHaveLength(0);
  });

  test("a failed official read → the honest failure notice (connected:true, empty channels — never the operator's feed)", async () => {
    await connectUser();
    officialChannelsResult = { ok: false, kind: "http-error", status: 500, message: "the YouTube API answered 500" };
    const res = await subscriptionsRoute(req("http://localhost/api/subscriptions"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channels).toEqual([]);
    expect(data.videos).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(data.loginRequired).toBe(false);
    expect(data.connected).toBe(true);
    expect(data.notice).toBe(
      "Your subscription list could not be read just now (the YouTube API answered honestly with an error) — try again shortly"
    );
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/subscriptions — no connected account (the honest connect ask)", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("the acting user has no connection → empty channels + the connect notice — never the operator's feed", async () => {
    const res = await subscriptionsRoute(req("http://localhost/api/subscriptions"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channels).toEqual([]);
    expect(data.videos).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(data.loginRequired).toBe(false);
    expect(data.connected).toBe(false);
    expect(data.notice).toBe("Connect your YouTube account to see your subscriptions — Settings → YouTube connection");
    expect(upstream.recorded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlists — the per-user official read (WFX2-P36)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  test("the acting user's own playlists via officialListPlaylists + the per-user notice — never the operator's list", async () => {
    await connectUser();
    officialPlaylistsResult = {
      ok: true,
      data: [
        {
          id: "PLown0000000001",
          title: "My Private List",
          visibility: "private",
          itemCount: 6,
          thumbUrl: "https://example.com/t.jpg",
          description: null,
        },
        {
          id: "PLown0000000002",
          title: "Road Trip",
          visibility: "public",
          itemCount: 12,
          thumbUrl: null,
          description: null,
        },
      ],
    };
    const res = await playlistsRoute(req("http://localhost/api/playlists"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.loginRequired).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.session).toBe(true);
    expect(data.connected).toBe(true);
    expect(data.playlists).toHaveLength(2);
    expect(data.playlists[0]).toMatchObject({
      id: "PLown0000000001",
      title: "My Private List",
      visibility: "private",
      isWatchLater: false,
      createdAt: "", // the official row carries no creation date — honest empty
      videoCount: 6,
      coverUrl: "https://example.com/t.jpg",
    });
    expect(data.notice).toBe(
      "Your playlists, read through your own connected YouTube account — WebFlix never reads someone else's."
    );
    // the official read rode the ACTING user's own token
    expect(officialCalls).toEqual(["playlists:access-token-u_wfx2_test"]);
    // the retired operator SSR /feed/playlists read NEVER fires
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/playlists — no connected account (the honest connect ask)", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
  });

  test("the acting user has no connection → empty playlists + the connect notice — never a login lie", async () => {
    const res = await playlistsRoute(req("http://localhost/api/playlists"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlists).toEqual([]);
    expect(data.loginRequired).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.session).toBe(false);
    expect(data.connected).toBe(false);
    expect(data.notice).toBe("Connect your YouTube account to see your playlists — Settings → YouTube connection");
    expect(upstream.recorded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlists — a failed official read (the honest unavailable)", () => {
  test("connected + the official read fails → unavailable:true + the honest failure notice — never the operator's rows", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    await connectUser();
    officialPlaylistsResult = { ok: false, kind: "http-error", status: 503, message: "the YouTube API answered 503" };
    setUpstream(upstream.impl);
    const res = await playlistsRoute(req("http://localhost/api/playlists"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.playlists).toEqual([]);
    expect(data.unavailable).toBe(true);
    expect(data.loginRequired).toBe(false);
    expect(data.session).toBe(true);
    expect(data.connected).toBe(true);
    expect(data.notice).toBe(
      "Your playlists could not be read just now (the official YouTube API answered with an error) — try again shortly"
    );
    expect(upstream.recorded).toHaveLength(0);
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

  test("WL without a session → the A3 honest notice envelope (never the operator's Watch later)", async () => {
    delete process.env.YT_COOKIES;
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      playlist: null,
      videos: [],
      nextCursor: null,
      loginRequired: false,
      unavailable: false,
      special: true,
    });
    expect(data.notice).toBe(
      "YouTube's Watch Later / Liked lists have no official API — your WebFlix Watch later lives in the save button (local), and YouTube's own page has the rest"
    );
    // the operator's VLWL browse NEVER fires
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
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

  test("P22-B re-point: WL with a session → the SAME honest notice (the session-gated operator read is retired)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    const res = await playlistItemsRoute(
      req("http://localhost/api/playlists/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.special).toBe(true);
    expect(data.loginRequired).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.playlist).toBeNull();
    expect(data.videos).toEqual([]);
    expect(data.notice).toContain("no official API");
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/playlist/[id] — the special lists through the playlist PAGE route (WFX2-P37: WL serves the WEBFLIX-LOCAL list)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    setUpstream(upstream.impl);
  });

  const expectGuestNotice = (data: any) => {
    expect(data).toMatchObject({
      playlist: null,
      videos: [],
      nextCursor: null,
      loginRequired: false,
      unavailable: false,
      special: true,
    });
    expect(data.notice).toBe(
      "Sign in to see your WebFlix Watch later — the list lives on your account"
    );
  };

  test("WL WITHOUT a session → the honest sign-in notice (never a browse, never the operator's list)", async () => {
    delete process.env.YT_COOKIES;
    const res = await playlistPageRoute(
      new Request("http://localhost/api/playlist/WL") as never,
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    expectGuestNotice(await res.json());
    // the special-list browse (the operator's VLWL read) never fires
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("WL WITH a session + an empty store → the LOCAL list payload (playlist serves — the pre-P37 explainer hid the user's own saves)", async () => {
    const res = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      special: true,
      local: true,
      nextCursor: null,
    });
    expect(data.playlist).toMatchObject({
      id: "WL",
      title: "Watch later",
      channelName: "Test Operator",
      videoCountText: "0 videos",
    });
    expect(data.videos).toEqual([]);
    // the local list is a DB read — the special-list browse NEVER fires
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("the FULL local round-trip: save (with the display snapshot) → the WL page lists the row → remove → the row leaves", async () => {
    // 1) the save button's write (the display snapshot rides along — P37)
    const saved = await watchLaterPostRoute(req("http://localhost/api/playlists/watch-later", {
      method: "POST",
      body: JSON.stringify({
        videoId: "p37wlvid01",
        title: "P37 Local List Video",
        channelName: "P37 QA Channel",
      }),
    }));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as any).added).toBe(true);

    // 2) the page's list shows THE USER'S OWN row with the real title
    const page = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    expect(page.status).toBe(200);
    const data = (await page.json()) as any;
    expect(data.local).toBe(true);
    expect(data.videos).toHaveLength(1);
    expect(data.videos[0]).toMatchObject({
      id: "p37wlvid01",
      title: "P37 Local List Video",
    });
    expect(data.videos[0].channel).toMatchObject({ name: "P37 QA Channel" });
    expect(data.videos[0].thumbnailUrl).toContain("i.ytimg.com/vi/p37wlvid01");
    expect(data.playlist.videoCountText).toBe("1 video");

    // 3) the row menu's remove → the row leaves the list
    const removed = await watchLaterPostRoute(req("http://localhost/api/playlists/watch-later", {
      method: "POST",
      body: JSON.stringify({ videoId: "p37wlvid01", add: false }),
    }));
    expect(((await removed.json()) as any).added).toBe(false);
    const after = await playlistPageRoute(
      req("http://localhost/api/playlist/WL"),
      { params: Promise.resolve({ id: "WL" }) }
    );
    const afterData = (await after.json()) as any;
    expect(afterData.videos).toEqual([]);
    expect(afterData.playlist.videoCountText).toBe("0 videos");
    // the local round-trip is a DB lane — the browse read NEVER fires
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("an upstream that WOULD serve a WL playlist changes nothing — the local list answers with ZERO browse calls (the operator read stays retired)", async () => {
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
    expect(data.local).toBe(true); // the WebFlix-local list — not the upstream's
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("LL → the honest notice (no local liked store — likes are official-tier only)", async () => {
    const res = await playlistPageRoute(
      req("http://localhost/api/playlist/LL"),
      { params: Promise.resolve({ id: "LL" }) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      playlist: null,
      videos: [],
      special: true,
    });
    expect(data.notice).toContain("no official API");
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/liked — the honest per-user notice envelope (WFX2-P36: no official liked-list API)", () => {
  beforeEach(() => {
    setUpstream(upstream.impl);
  });

  test("no YT session, no connected account → the honest notice (session:false, connected:false)", async () => {
    delete process.env.YT_COOKIES;
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({
      videos: [],
      playlist: null,
      nextCursor: null,
      loginRequired: false,
      unavailable: false,
      session: false,
      connected: false,
    });
    expect(data.notice).toBe(
      "The list of videos you liked on YouTube has no official API — your likes still act on your account (the like button); the list lives on youtube.com/feed/liked"
    );
    // the operator's VLLL browse NEVER fires
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("the operator read session configured → the liked list still NEVER serves (the retired cross-user leak, closed)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(true);
    expect(data.connected).toBe(false);
    expect(data.videos).toEqual([]);
    expect(data.playlist).toBeNull();
    expect(data.loginRequired).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.notice).toContain("no official API");
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("the acting user's own connected account → connected:true, still the honest empty + notice (a connection never fabricates the list)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    await connectUser();
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.connected).toBe(true);
    expect(data.videos).toEqual([]);
    expect(data.playlist).toBeNull();
    expect(data.session).toBe(true);
    expect(data.notice).toContain("your likes still act on your account");
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(0);
  });

  test("another user's connection never leaks — the acting user still honestly not-connected (the per-user isolation law)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    await connectUser("u_someone_else");
    const res = await likedRoute(req("http://localhost/api/liked"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.connected).toBe(false);
    expect(data.videos).toEqual([]);
    expect(data.notice).toContain("no official API");
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

describe("POST /api/notifications/read — the honest unsupported lane (WFX2-P36)", () => {
  test("→ the honest 501 youtube-unsupported with the handoff (the broker bell-drive retired)", async () => {
    const res = await notificationsReadRoute(
      req("http://localhost/api/notifications/read", { method: "POST" })
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind: string };
    expect(body.kind).toBe("youtube-unsupported");
    expect(body.error).toContain("Marking your YouTube notifications read");
    expect(body.error).toContain("open the bell on youtube.com");
  });
});

// ---------------------------------------------------------------------------

// WFX2-P37 — the /api/me per-user truth: the operator seam (the YT_COOKIES
// channel lookup + the operator's subscriptions feed served as "yours") is
// RETIRED from this route. The pins below replace the pre-P37 operator-seam
// ladder pins (the operator's channel winning, the lookup fallbacks): the
// route now answers the ACTING user's own identity + their own connected
// subscriptions — the operator's data can never wear another user's name.
describe("GET /api/me — the per-user truth (P37: the operator seam retired)", () => {
  afterEach(() => {
    meLookup = null;
    resetYoutubeConnectionStore();
    officialCalls.length = 0;
    officialChannelsResult = { ok: true, data: [] };
    delete process.env.YT_COOKIES;
  });

  test("guest → the demo identity + the DB channel + the honest empty subscriptions (an operator lookup resolving changes NOTHING)", async () => {
    delete process.env.YT_COOKIES;
    meLookup = {
      browseId: "UCop",
      handle: "@opchan",
      header: { name: "Operator Channel" },
      homeResponse: null,
    };
    const res = await meRoute(new Request("http://localhost/api/me") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the demo identity's DB channel (the honest anonymous lane)
    expect(data.ownedChannel).toEqual({ handle: "codecraft", name: "CodeCraft" });
    // the operator's subscriptions are NEVER served — even with the lookup
    // resolved and cookies present, the guest gets the honest empty list
    expect(data.subscriptions).toEqual([]);
    expect(officialCalls).toEqual([]);
  });

  test("YT_COOKIES set + the operator lookup resolved + NO signed-in user → still the DB mirror (the seam is GONE, not gated)", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    meLookup = {
      browseId: "UCop",
      handle: "@opchan",
      header: { name: "Operator Channel" },
      homeResponse: null,
    };
    const res = await meRoute(new Request("http://localhost/api/me") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the pre-P37 pin here was "@opchan / Operator Channel wins" — the P37
    // retirement pin: the operator's channel NEVER answers for anyone else
    expect(data.ownedChannel).toEqual({ handle: "codecraft", name: "CodeCraft" });
    expect(data.subscriptions).toEqual([]);
  });

  test("signed-in + not connected → THEIR identity, no owned channel, the honest empty subscriptions", async () => {
    delete process.env.YT_COOKIES;
    const res = await meRoute(req("http://localhost/api/me"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // the acting user's OWN shadow identity — never the demo row, never the
    // operator's data wearing their name
    expect(data.user.id).toBe("wf-u_wfx2_test");
    expect(data.user.name).toBe("Test Operator");
    expect(data.user.handle).toContain("wf_");
    // no channel owned by the shadow user — the honest null (the row hides)
    expect(data.ownedChannel).toBeNull();
    // not connected → the honest empty list, and NO official call fired
    expect(data.subscriptions).toEqual([]);
    expect(officialCalls).toEqual([]);
  });

  test("signed-in + connected → THEIR OWN subscriptions through THEIR token (the acting-user read)", async () => {
    delete process.env.YT_COOKIES;
    await connectUser();
    officialChannelsResult = {
      ok: true,
      data: [
        {
          channelId: "UCperuser1",
          title: "Per-User Channel",
          thumbUrl: "https://example.test/thumb.jpg",
          subscribedAt: null,
        },
      ],
    };
    const res = await meRoute(req("http://localhost/api/me"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0]).toMatchObject({
      id: "UCperuser1",
      handle: "UCperuser1",
      name: "Per-User Channel",
      avatarUrl: "https://example.test/thumb.jpg",
      bell: "personalized",
    });
    // the ACTING user's own token served the read — never the operator's
    expect(officialCalls).toEqual(["subscriptions:access-token-u_wfx2_test"]);
  });

  test("signed-in + connected + a failed official read → the honest empty list (never the operator's, never a fabricated row)", async () => {
    delete process.env.YT_COOKIES;
    await connectUser();
    officialChannelsResult = { ok: false, kind: "http-error", status: 403, message: "forbidden" };
    const res = await meRoute(req("http://localhost/api/me"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.subscriptions).toEqual([]);
    expect(officialCalls).toEqual(["subscriptions:access-token-u_wfx2_test"]);
  });
});

afterAll(() => {
  mock.module("@/lib/youtube/studio", () => realStudio);
  mock.module("@/lib/youtube/official-actions", () => realOfficial);
  if (savedUpstashUrl) process.env.UPSTASH_REDIS_REST_URL = savedUpstashUrl;
  else delete process.env.UPSTASH_REDIS_REST_URL;
  if (savedUpstashToken) process.env.UPSTASH_REDIS_REST_TOKEN = savedUpstashToken;
  else delete process.env.UPSTASH_REDIS_REST_TOKEN;
});
