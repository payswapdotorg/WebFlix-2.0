/// <reference types="bun-types" />
/**
 * WFX2-C-W — the cutover wiring proven at the route level, with BOTH seams:
 * fixture bytes via setUpstream() (InnerTube-facing routes) or a patched
 * global fetch (the A-S lane's fetcher-parameter libs), plus the Upstash
 * fake via setUpstashRest(). No live network anywhere (lane law).
 *
 * Covers the production findings this lane fixes:
 *  - /api/videos?q= is search-backed (search is not walled for Vercel);
 *  - the home browse payload is cached to L2 with the walled-shape guard;
 *  - a walled browse (200-maps-empty) serves the L2 last-good rails;
 *  - walled browse with no last-good stays honestly empty;
 *  - live-status + shorts seed + comments first pages ride the adapter.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache, TTL } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { GET as getHome } from "@/app/api/home/route";
import { GET as listVideosRoute } from "@/app/api/videos/route";
import { GET as getLiveStatus } from "@/app/api/videos/[id]/live-status/route";
import { GET as getShorts } from "@/app/api/shorts/route";
import { GET as commentsRoute } from "@/app/api/videos/[id]/comments/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

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
      softUntil: Date.now() - 60_000, // soft-expired → stale-while-revalidate path
      hardUntil: Date.now() + 3_600_000, // inside the hard window → last-good candidate
    }),
  );
}

const realFetch = globalThis.fetch;
let upstreamCalls: { url: string; body: any }[] = [];

/** Route a patched global fetch to fixtures by URL substring (A-S pattern). */
function patchUpstream(routes: Record<string, unknown>) {
  upstreamCalls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    let body: any = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (url instanceof Request) body = JSON.parse(await url.text());
    upstreamCalls.push({ url: u, body });
    for (const [needle, fixture] of Object.entries(routes)) {
      if (u.includes(needle)) {
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

let recorded: { url: string; body: any }[] = [];
const searchLofi = load("search_lofi");
const nextDQw4 = load("next_dQw4");
const commentsDQw4 = load("comments_dQw4");
const updatedMeta = load("updated_metadata_synth");
const reelSeq = load("reel_sequence_synth");

beforeEach(() => {
  clearCache();
  recorded = [];
  setUpstream(async (url: string, init?: RequestInit) => {
    recorded.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/youtubei/v1/search")) return json(searchLofi);
    if (url.includes("/youtubei/v1/browse")) return json(searchLofi); // healthy-shaped browse body
    if (url.includes("/youtubei/v1/next")) {
      return json(recorded.at(-1)?.body?.videoId ? nextDQw4 : commentsDQw4);
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("GET /api/videos?q= — the production fix", () => {
  test("q= is search-backed with type=video params (search is not walled)", async () => {
    const res = await listVideosRoute(new Request("http://localhost/api/videos?q=lofi"));
    expect(res.status).toBe(200);
    const page = (await res.json()) as { videos: any[]; nextCursor: string | null };
    expect(page.videos.length).toBeGreaterThan(0);
    const call = recorded.find((r) => r.url.includes("/youtubei/v1/search"));
    expect(call?.body.query).toBe("lofi");
    expect(call?.body.params).toBe("EgIQAQ=="); // {type: video} — the verified encoding
  });

  test("the first page is cached: a second hit makes zero upstream calls", async () => {
    await listVideosRoute(new Request("http://localhost/api/videos?q=lofi"));
    const afterFirst = recorded.filter((r) => r.url.includes("/youtubei/v1/search")).length;
    expect(afterFirst).toBe(1);
    const res2 = await listVideosRoute(new Request("http://localhost/api/videos?q=lofi"));
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as { videos: any[] };
    expect(page2.videos.length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.url.includes("/youtubei/v1/search")).length).toBe(1);
  });
});

describe("GET /api/home — the walled-browse fix", () => {
  test("a healthy browse payload is written to L2 as the versioned envelope", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.recommended.length).toBeGreaterThan(0);
    const set = rest.commands.find((c) => c[0] === "SET" && c[1] === "yt:home:feed");
    expect(set).toBeDefined();
    const envelope = JSON.parse(set![2]);
    expect(envelope.v).toBe(1);
    // hard window = the explicit 2h home override; soft = the 5-minute feed TTL
    expect(envelope.hardUntil - envelope.softUntil).toBe(TTL.HOME_HARD_MS - TTL.FEED_MS);
  });

  test("a walled browse (200-maps-empty) serves the L2 last-good rails", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    seedLastGood(rest.store, "yt:home:feed", searchLofi);
    // the live egress is walled: browse answers 200 with a body that maps to nothing
    setUpstream(async () => new Response(JSON.stringify({}), { status: 200 }));
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.recommended.length).toBeGreaterThan(0); // the last-good rails served
    expect(feed.hero !== null || feed.shorts.length > 0).toBe(true);
    // the walled answer never poisoned the stored last-good
    const stored = JSON.parse(rest.store.get("yt:home:feed")!);
    expect(stored.value).toEqual(searchLofi);
  });

  test("a walled browse with NO last-good stays honestly empty (feedNudge contract)", async () => {
    setUpstream(async () => new Response(JSON.stringify({}), { status: 200 }));
    const res = await getHome(new Request("http://localhost/api/home"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.hero).toBeNull();
    expect(feed.recommended).toEqual([]);
    expect(feed.shorts).toEqual([]);
    expect(feed.chips[0]).toBe("All");
  });
});

describe("GET /api/videos/[id]/live-status — adapter-cached poll", () => {
  test("two polls within the TTL make exactly one upstream call", async () => {
    patchUpstream({ "/updated_metadata": updatedMeta });
    const ctx = { params: Promise.resolve({ id: "gCNeDWCI0vo" }) };
    const res1 = await getLiveStatus(
      new NextRequest("http://localhost/api/videos/gCNeDWCI0vo/live-status"),
      ctx,
    );
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as any;
    expect(data1.isLive).toBe(true);
    expect(data1.concurrentViewers).toBe(6027);

    const res2 = await getLiveStatus(
      new NextRequest("http://localhost/api/videos/gCNeDWCI0vo/live-status"),
      { params: Promise.resolve({ id: "gCNeDWCI0vo" }) },
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(data1);
    expect(upstreamCalls.filter((c) => c.url.includes("/updated_metadata"))).toHaveLength(1);
  });
});

describe("GET /api/shorts — seed through the adapter", () => {
  test("seed cached: second hit makes zero upstream calls", async () => {
    patchUpstream({
      "/youtubei/v1/search": searchLofi,
      "/reel/reel_watch_sequence": reelSeq,
    });
    const res1 = await getShorts(new NextRequest("http://localhost/api/shorts"));
    expect(res1.status).toBe(200);
    const feed1 = (await res1.json()) as any;
    expect(feed1.items.length).toBeGreaterThan(0);
    expect(upstreamCalls).toHaveLength(2); // search + reel_watch_sequence

    const res2 = await getShorts(new NextRequest("http://localhost/api/shorts"));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(feed1);
    expect(upstreamCalls).toHaveLength(2); // nothing new — served from the cache
  });

  test("an empty seed never overwrites the last-good in L2", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    const lastGood = { items: [{ id: "keepme", title: "Kept", viewsText: "1 view" }], nextCursor: "c" };
    seedLastGood(rest.store, "shorts:seed", lastGood);
    patchUpstream({ "/youtubei/v1/search": {} }); // upstream yields nothing mappable
    const res = await getShorts(new NextRequest("http://localhost/api/shorts"));
    expect(res.status).toBe(200);
    const feed = (await res.json()) as any;
    expect(feed.items[0].id).toBe("keepme"); // last-good served
    expect(JSON.parse(rest.store.get("shorts:seed")!).value).toEqual(lastGood); // not poisoned
  });
});

describe("GET /api/videos/[id]/comments — first page through the adapter", () => {
  test("a second identical request skips the tokens + page fetches (only inline replies refetch)", async () => {
    const ctx = { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) };
    const nextCalls = () => recorded.filter((r) => r.url.includes("/youtubei/v1/next")).length;

    const res1 = await commentsRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/comments"),
      ctx,
    );
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as any;
    expect(page1.items.length).toBeGreaterThan(0);
    const callsAfterFirst = nextCalls();

    const res2 = await commentsRoute(
      new NextRequest("http://localhost/api/videos/dQw4w9WgXcQ/comments"),
      { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) },
    );
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as any;
    // transparent to the DTO shape — same comments in the same order
    // (createdAt is synthesized from "N years ago" per render → compare structure)
    expect(page2.items.map((c: any) => c.id)).toEqual(page1.items.map((c: any) => c.id));
    expect(page2.items.map((c: any) => c.body)).toEqual(page1.items.map((c: any) => c.body));
    expect(page2.items).toHaveLength(page1.items.length);
    expect(nextCalls()).toBeGreaterThan(callsAfterFirst); // inline replies still refetch
    expect(nextCalls()).toBeLessThan(callsAfterFirst * 2); // …but the page + tokens were cached
  });
});
