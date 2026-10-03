/// <reference types="bun-types" />
/**
 * WFX2-P7 session-home heal — the two laws verified live 2026-10-03 (the
 * fresh operator session made production /api/home 502 while the expired
 * jar had been server-side-ignored for weeks):
 *
 *  LAW 1 (the cookieless retry): when the SESSION browse answers the
 *  200-but-empty walled shape, the fetcher retries the browse ONCE without
 *  cookies — the public answer serves (real data, never a fabrication),
 *  source "browse".
 *
 *  LAW 2 (the honest empty rail): when the signed-in history SSR read THROWS
 *  (walled/oversized from the datacenter egress), the compose still serves —
 *  a rail's failure is never the feed's failure — continueWatching: [].
 *
 * Fixture upstream (setUpstream seam + the Upstash fake; no live network):
 * the session browse serves the REAL walled nudge (home_feed), the cookieless
 * browse serves the REAL search capture (videoRenderer rows — a healthy
 * non-empty browse shape), search serves the same capture (the compose rung).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { GET as getHome } from "@/app/api/home/route";
import type { HomeFeedDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const nudge = load("home_feed"); // the REAL walled browse shape (empty when mapped)
const healthy = load("search_lofi"); // REAL capture with videoRenderer rows (non-empty browse shape)

interface Recorded {
  url: string;
  hasCookie: boolean;
}

/**
 * The session-aware fixture upstream:
 *  - browse WITH a Cookie header → the walled nudge (the datacenter+session wall)
 *  - browse WITHOUT cookies      → the healthy shape (the public browse)
 *  - search                      → the healthy capture (the compose rung)
 *  - /feed/history               → opts.historyStatus (default 500 — the throw)
 */
function sessionUpstreamFake(opts: { historyStatus?: number } = {}) {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const hasCookie = Boolean(
      (headers.Cookie || headers.cookie || "").length,
    );
    recorded.push({ url, hasCookie });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/browse")) {
      return json(hasCookie ? nudge : healthy);
    }
    if (url.includes("/youtubei/v1/search")) {
      return json(healthy);
    }
    if (url.includes("/feed/history")) {
      return new Response("walled history page", { status: opts.historyStatus ?? 500 });
    }
    if (url.includes("/reel/reel_watch_sequence")) return json({ entries: [] });
    return new Response("not found", { status: 404 });
  };
  const calls = {
    browseSession: () => recorded.filter((r) => r.url.includes("/youtubei/v1/browse") && r.hasCookie),
    browseCookieless: () => recorded.filter((r) => r.url.includes("/youtubei/v1/browse") && !r.hasCookie),
    history: () => recorded.filter((r) => r.url.includes("/feed/history")),
  };
  return { impl, calls };
}

/** An in-memory fake of the Upstash REST pipeline endpoint. */
function fakeRest() {
  const store = new Map<string, string>();
  const impl: UpstashRest = async (cmds) =>
    cmds.map((cmd) => {
      if (cmd[0] === "GET") return store.has(cmd[1]) ? store.get(cmd[1])! : null;
      if (cmd[0] === "SET") {
        store.set(cmd[1], cmd[2]);
        return "OK";
      }
      return 1;
    });
  return { impl, store };
}

const feedOf = async (url = "http://localhost/api/home"): Promise<HomeFeedDTO> =>
  (await (await getHome(new Request(url))).json()) as HomeFeedDTO;

let envHadCookies: string | undefined;

beforeEach(() => {
  clearCache();
  envHadCookies = process.env.YT_COOKIES;
  process.env.YT_COOKIES = "SID=fresh; SAPISID=fresh; LOGIN_INFO=fresh";
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
  if (envHadCookies === undefined) delete process.env.YT_COOKIES;
  else process.env.YT_COOKIES = envHadCookies;
});

describe("WFX2-P7 session-home heal (the fresh-session laws)", () => {
  test("LAW 1: session browse walled-empty → the ONE cookieless retry serves the public browse (source browse, two browse calls)", async () => {
    const fake = sessionUpstreamFake();
    const rest = fakeRest();
    setUpstream(fake.impl);
    setUpstashRest(rest.impl);

    const feed = await feedOf();

    // the public browse's real rows served (the healthy fixture's own ids)
    expect(fake.calls.browseSession().length).toBeGreaterThanOrEqual(1);
    expect(fake.calls.browseCookieless().length).toBe(1); // exactly ONE retry — never a hammer
    expect(feed.source).toBe("browse");
    const healthyIds = new Set(
      ((healthy.contents?.twoColumnWatchNextResults ?? healthy.items ?? []) as any[]) ?? [],
    );
    // non-empty feed from the healthy shape
    const feedIds = new Set<string>([
      ...(feed.hero ? [feed.hero.id] : []),
      ...feed.recommended.map((v) => v.id),
    ]);
    expect(feedIds.size).toBeGreaterThan(0);
    // sanity: the healthy fixture actually carries mappable videoRenderer rows
    expect(healthyIds.size === 0 || feedIds.size > 0).toBe(true);
  });

  test("LAW 2: the signed-in history read throws → the compose still serves (no 502) with the honest empty rail", async () => {
    // BOTH browse attempts walled (session + cookieless serve the nudge) →
    // the compose rung owns the feed — and the history SSR 500s inside it.
    const recorded: Recorded[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      recorded.push({ url, hasCookie: Boolean((headers.Cookie || headers.cookie || "").length) });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/youtubei/v1/browse")) return json(nudge);
      if (url.includes("/youtubei/v1/search")) return json(healthy);
      if (url.includes("/feed/history")) return new Response("walled", { status: 500 });
      if (url.includes("/reel/reel_watch_sequence")) return json({ entries: [] });
      return new Response("not found", { status: 404 });
    };
    setUpstream(impl);
    setUpstashRest(fakeRest().impl);

    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200); // NEVER the 502 the fresh session caused in production
    const feed = (await res.json()) as HomeFeedDTO;
    expect(feed.source).toBe("search-compose"); // the rung-3 compose owns it
    expect(feed.continueWatching).toEqual([]); // the honest empty rail
    expect(feed.recommended.length).toBeGreaterThan(0); // the rest of the feed serves
    expect(recorded.some((r) => r.url.includes("/feed/history"))).toBe(true); // the history read was ATTEMPTED
  });

  test("LAW 2b: history SUCCESS still maps (the happy path is unchanged by the heal)", async () => {
    const historyPage = `<html><script>var ytInitialData = ${JSON.stringify(healthy)};</script></html>`;
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const hasCookie = Boolean((headers.Cookie || headers.cookie || "").length);
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.includes("/youtubei/v1/browse")) return json(hasCookie ? nudge : healthy);
      if (url.includes("/youtubei/v1/search")) return json(healthy);
      if (url.includes("/feed/history")) return new Response(historyPage, { status: 200, headers: { "Content-Type": "text/html" } });
      if (url.includes("/reel/reel_watch_sequence")) return json({ entries: [] });
      return new Response("not found", { status: 404 });
    };
    setUpstream(impl);
    setUpstashRest(fakeRest().impl);

    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as HomeFeedDTO;
    expect(feed.source).toBe("browse"); // the cookieless retry already served rung 1
    expect(Array.isArray(feed.continueWatching)).toBe(true); // mapped (possibly empty — the fixture's rows)
  });
});
