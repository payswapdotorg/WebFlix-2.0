/// <reference types="bun-types" />
/**
 * WFX2-B-S tests — the channel-wall resilience (the live production gap):
 * youtube.com walls the @handle SSR scrape AND the channel-renderer search
 * path for server egress — production /api/channel/@handle answered a raw
 * 502. The fix (the cutover's established pattern):
 *
 *  - the channel read path rides `cachedResilient` with an unhealthy-shape
 *    predicate — the 200-but-empty/walled shape is NEVER cached;
 *  - a walled read with a last-good channel page in L2 serves the last-good;
 *  - a COLD walled read (no last-good) honest-degrades: HTTP 200 + the
 *    structured empty payload + `walled: true` — NEVER a naked 502;
 *  - the walled answer never poisons the stored last-good;
 *  - the search channel-renderer wall: zero channel renderers upstream →
 *    the channel last-good cache family serves the exact-handle match;
 *    honest empty otherwise.
 *
 * WFX2-4A adds the BROKER READ RUNG between the last-good and the
 * search-compose rungs: the wall stood, but the logged-in operator
 * session's own page-context fetch still reads the REAL channel page
 * (two brokerFetchPage reads — home + /videos — mapped through the same
 * mapper, `brokered: true`, isSubscribed always false). Broker offline →
 * the ladder is unchanged below it.
 *
 * Fixture bytes via setUpstream() + the Upstash fake via setUpstashRest()
 * (the cutover-routes.test.ts patterns — never the network). The broker
 * client is MOCKED with an injectable brokerFetchPage (the comment-writes/
 * action-routes mock.module pattern — real module re-installed in afterAll,
 * bun's mock.module is process-wide).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";

/* capture the REAL broker module before the mock replaces it (restore) —
 * copied into a fresh object: bun mutates the captured namespace in place
 * when mock.module swaps the registry */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realBroker = { ...require("@/lib/broker") } as Record<string, unknown>;

class MockBrokerError extends Error {
  kind: string;
  status: number;
  constructor(kind: string, message: string, status: number) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
  }
}

const brokerCalls: string[] = [];
/** injectable broker fetch: a path→response fn, or a value for every path */
let brokerResponse: unknown = new MockBrokerError(
  "offline",
  "action backend offline — the lead's broker must be running",
  502
);

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerFetchPage: async (path: string) => {
    brokerCalls.push(path);
    return typeof brokerResponse === "function" ? brokerResponse(path) : brokerResponse;
  },
}));

/* the app modules (imported after the mock) */
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { channelPageCacheKey } from "@/lib/youtube/channels";
import { GET as channelRoute } from "@/app/api/channel/[handle]/route";
import { GET as searchRoute } from "@/app/api/search/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const channel = load("channel_rickastley");
const searchLofi = load("search_lofi"); // zero channel renderers — the wall signature

/** An in-memory fake of the Upstash REST pipeline endpoint. */
function fakeRest() {
  const store = new Map<string, string>();
  const commands: string[][] = [];
  const impl: UpstashRest = async (cmds) => {
    commands.push(...cmds.map((c) => [...c]));
    return cmds.map((cmd) => {
      if (cmd[0] === "GET") return store.has(cmd[1]) ? store.get(cmd[1])! : null;
      if (cmd[0] === "SET") {
        store.set(cmd[1], cmd[2]);
        return "OK";
      }
      if (cmd[0] === "INCR") {
        const value = Number(store.get(cmd[1]) ?? "0") + 1;
        store.set(cmd[1], String(value));
        return value;
      }
      return 1;
    });
  };
  return { impl, store, commands };
}

/** Pre-seed the fake with a last-good envelope (stale soft, live hard). */
function seedLastGood(store: Map<string, string>, key: string, value: unknown): void {
  store.set(
    key,
    JSON.stringify({
      v: 1,
      value,
      softUntil: Date.now() - 60_000,
      hardUntil: Date.now() + 3_600_000,
    })
  );
}

interface Recorded {
  url: string;
  body: any;
}

/** Fixture upstream with an injectable per-test walled flag for the @handle SSR. */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const htmlFor = (data: unknown) =>
    `<!doctype html><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  let ssrWalled = false;
  let searchWalled = false;
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/youtubei/v1/search")) return json(searchLofi);
    if (url.includes("/youtubei/v1/browse")) return json(channel);
    if (url.includes("youtube.com/@")) {
      if (ssrWalled) return new Response("not found", { status: 404 });
      return new Response(htmlFor(channel), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded, wall: (v: boolean) => (ssrWalled = v) };
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
  setUpstream(upstream.impl);
  brokerCalls.length = 0;
  brokerResponse = new MockBrokerError(
    "offline",
    "action backend offline — the lead's broker must be running",
    502
  );
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
});

/* bun's mock.module is process-wide — restore the real broker module so
 * later-loaded files (playback-fallback etc.) exercise the real one */
afterAll(() => {
  mock.module("@/lib/broker", () => realBroker);
});

const ctx = (handle: string) => ({ params: Promise.resolve({ handle }) });

// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle] — the channel-wall fix", () => {
  test("healthy channel: the normal payload (tabs + joinable + walled: false)", async () => {
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.walled).toBe(false);
    expect(page.tabs).toEqual([
      "home",
      "videos",
      "shorts",
      "live",
      "playlists",
      "community",
      "about",
    ]);
    expect(page.joinable).toBe(false); // the fixture channel has no Join button
  });

  test("the wall hits (SSR 404) and NO last-good → HTTP 200 structured empty + walled: true — never a naked 502", async () => {
    upstream.wall(true);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel).toBeNull();
    expect(page.videos).toEqual([]);
    expect(page.shorts).toEqual([]);
    expect(page.walled).toBe(true);
    expect(typeof page.note).toBe("string");
    // the SSR scrape was genuinely attempted (the wall, not a skipped read)
    expect(upstream.recorded.some((r) => r.url.includes("/@RickAstleyYT"))).toBe(true);
  });

  test("the wall hits and a last-good page exists in L2 → the last-good serves (not cached as walled)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    // the healthy shape under the resilient key (the family entry)
    seedLastGood(rest.store, channelPageCacheKey("@RickAstleyYT"), {
      page: {
        channel: {
          id: "UCuAXFkgsw1L7xaCfnd5JJOw",
          handle: "@RickAstleyYT",
          name: "Rick Astley",
          avatarUrl: "https://example.com/a.jpg",
          verified: true,
          subscriberCount: 4550000,
          subscriberCountText: "4.55M subscribers",
          bannerUrl: null,
          description: "last-good description",
          createdAt: null,
          isSubscribed: false,
          isOwner: false,
          videoCount: 437,
        },
        videos: [{ id: "lastgood-video", title: "Last-good row" }],
        shorts: [],
        tabs: ["home", "videos", "about"],
        joinable: false,
      },
      walled: false,
    });
    upstream.wall(true);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.walled).toBe(false);
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.videos[0].id).toBe("lastgood-video"); // the last-good rails
    // the walled answer never poisoned the stored last-good
    const stored = JSON.parse(rest.store.get(channelPageCacheKey("@RickAstleyYT"))!);
    expect(stored.value.walled).toBe(false);
    expect(stored.value.page.videos[0].id).toBe("lastgood-video");
  });

  test("healthy read after a wall (recovered upstream) → fresh payload again", async () => {
    upstream.wall(true);
    await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    upstream.wall(false);
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(page.walled).toBe(false);
  });

  test("WFX2-4A — the wall stands but the broker serves the channel page → the brokered REAL page (walled:false, brokered:true)", async () => {
    upstream.wall(true);
    // the broker's two reads answer the channel_rickastley fixture wrapped
    // as page HTML — the logged-in session's own channel home + videos tab
    const brokerHtml = `<!doctype html><script>var ytInitialData = ${JSON.stringify(channel)};</script>`;
    brokerResponse = () => ({ ok: true, status: 200, body: brokerHtml });
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    // a REAL page (not the walled degrade, not a compose)
    expect(page.walled).toBe(false);
    expect(page.channel.id).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(page.channel.name).toBe("Rick Astley");
    expect(page.channel.handle).toBe("RickAstleyYT");
    expect(page.tabs).toEqual([
      "home",
      "videos",
      "shorts",
      "live",
      "playlists",
      "community",
      "about",
    ]);
    expect(page.videos.length).toBeGreaterThan(0);
    expect(page.shorts.length).toBeGreaterThan(0);
    expect(page.channel.composed).toBeUndefined(); // the search-compose rung never fired
    // the broker transport markers: brokered + the session-state law
    expect(page.channel.brokered).toBe(true);
    expect(page.channel.isSubscribed).toBe(false); // the broker account's state never leaks
    // the two broker reads: the channel home page + the videos tab
    expect(brokerCalls).toEqual(["/@RickAstleyYT", "/@RickAstleyYT/videos"]);
    // a real broker page BEATS the compose rung — the search never fired
    expect(upstream.recorded.some((r) => r.url.includes("/youtubei/v1/search"))).toBe(false);
  });

  test("WFX2-4A — the wall stands and the broker is offline → the honest walled degrade unchanged (the compose rung keeps its turn)", async () => {
    upstream.wall(true);
    brokerResponse = new MockBrokerError(
      "offline",
      "action backend offline — the lead's broker must be running",
      502
    );
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT"),
      ctx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.channel).toBeNull();
    expect(page.videos).toEqual([]);
    expect(page.walled).toBe(true);
    expect(typeof page.note).toBe("string");
    // the broker read WAS attempted before the degrade stood
    expect(brokerCalls).toEqual(["/@RickAstleyYT"]);
    // the compose rung got its turn — and the search_lofi ownership (max
    // share 21%, below every threshold) keeps the compose honestly null
    expect(upstream.recorded.some((r) => r.url.includes("/youtubei/v1/search"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("search channel renderers — the wall fallback (item 14)", () => {
  test("zero channel renderers upstream (wall signature) + channel last-good family → the channel row serves", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    // the channel page family entry under the normalized handle key
    seedLastGood(rest.store, channelPageCacheKey("@lofi"), {
      page: {
        channel: {
          id: "UCSJ4gkVC6NvmIIh7vz4GzZg",
          handle: "@lofi",
          name: "Lofi Girl",
          avatarUrl: "https://example.com/lofi.jpg",
          verified: true,
          subscriberCount: 14_000_000,
          subscriberCountText: "14M subscribers",
          bannerUrl: null,
          description: null,
          createdAt: null,
          isSubscribed: false,
          isOwner: false,
          videoCount: 500,
        },
        videos: [],
        shorts: [],
      },
      walled: false,
    });
    // search_lofi carries ZERO channelRenderers (the recorded wall signature)
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.length).toBeGreaterThan(0); // videos unaffected
    expect(data.channels.length).toBe(1);
    expect(data.channels[0]).toMatchObject({
      id: "UCSJ4gkVC6NvmIIh7vz4GzZg",
      handle: "@lofi",
      name: "Lofi Girl",
      verified: true,
    });
  });

  test("the wall with NO channel last-good → honest empty channels (no fabricated rows)", async () => {
    const res = await searchRoute(new Request("http://localhost/api/search?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.channels).toEqual([]);
  });

  test("a non-handle query never matches the family (exact-handle only — no guessed attribution)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    seedLastGood(rest.store, channelPageCacheKey("@lofi"), {
      page: {
        channel: {
          id: "UCSJ4gkVC6NvmIIh7vz4GzZg",
          handle: "@lofi",
          name: "Lofi Girl",
          avatarUrl: "",
          verified: true,
          subscriberCount: 0,
          subscriberCountText: null,
          bannerUrl: null,
          description: null,
          createdAt: null,
          isSubscribed: false,
          isOwner: false,
          videoCount: 0,
        },
        videos: [],
        shorts: [],
      },
      walled: false,
    });
    const res = await searchRoute(new Request("http://localhost/api/search?q=ambient"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.channels).toEqual([]); // "ambient" ≠ "@lofi" — no row
  });
});
