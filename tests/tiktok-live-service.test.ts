/// <reference types="bun-types" />
/**
 * P100 — the live status service battery: the Apify run→poll→dataset state
 * machine against a scripted fake fetch (the live-upstream seam), the cache
 * laws (TTL by liveness, in-flight coalescing, failure backoff), and the
 * honest disabled-lane error. No network anywhere (lane law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearTikTokLiveCache,
  isTikTokLiveProbeInFlight,
  isTikTokLiveProbeLaneConfigured,
  liveStatusTtlMs,
  peekTikTokLiveStatus,
  probeTikTokLiveStatus,
  setTikTokLiveProbePolling,
  TikTokLiveUnavailableError,
} from "@/lib/tiktok/live";
import { setTikTokLiveProbeUpstream, type TikTokProbeFetch } from "@/lib/tiktok/live-upstream";

const LIVE_ROW = {
  handle: "lofigirl",
  unique_id: "lofigirl",
  nickname: "Lofi Girl",
  is_live: true,
  room_title: "christmas lofi radio 🎄",
  viewer_count: 278,
  started_at: "2026-11-07T00:12:00.000Z",
  cover_url: "https://p16-common-sign.tiktokcdn-eu.com/lofi-cover.jpg",
  room_url: "https://www.tiktok.com/@lofigirl/live",
  stream_urls: null,
  _metadata: { fetched_at: "2026-11-07T07:45:00.000Z" },
};

/** A scripted probe transport: routes by URL shape, records every call. */
function scriptedTransport(
  handlers: Array<{ match: (url: string, init?: RequestInit) => boolean; respond: () => Response | Promise<Response> }>,
  calls: string[] = [],
  inits: RequestInit[] = []
): TikTokProbeFetch {
  return (url, init) => {
    const u = String(url);
    calls.push(u);
    inits.push(init ?? {});
    const hit = handlers.find((h) => h.match(u, init));
    if (!hit) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(hit.respond());
  };
}

const RUN_MATCH = (url: string, init?: RequestInit) =>
  url.includes("/acts/") && url.includes("/runs") && (init?.method ?? "GET") === "POST";
const POLL_MATCH = (url: string) => url.includes("/actor-runs/");
const DATA_MATCH = (url: string) => url.includes("/datasets/");

function runJson(runId: string, datasetId: string, status = "SUCCEEDED") {
  return new Response(JSON.stringify({ data: { id: runId, status, defaultDatasetId: datasetId } }), {
    status: 200,
  });
}

beforeEach(() => {
  process.env.APIFY_API_KEY = "test-key";
  delete process.env.APIFY_LIVE_ACTOR_ID;
  setTikTokLiveProbePolling({ intervalMs: 1, maxAttempts: 3 });
  clearTikTokLiveCache();
});
afterEach(() => {
  setTikTokLiveProbeUpstream(null);
  setTikTokLiveProbePolling(null);
  clearTikTokLiveCache();
  delete process.env.APIFY_API_KEY;
  delete process.env.APIFY_LIVE_ACTOR_ID;
});

describe("probeTikTokLiveStatus — the Apify state machine", () => {
  test("run → poll → dataset, mapped through the actor-row law", async () => {
    const calls: string[] = [];
    const inits: RequestInit[] = [];
    setTikTokLiveProbeUpstream(
      scriptedTransport(
        [
          { match: RUN_MATCH, respond: () => runJson("run-1", "ds-1") },
          { match: POLL_MATCH, respond: () => runJson("run-1", "ds-1") },
          {
            match: DATA_MATCH,
            respond: () =>
              new Response(JSON.stringify([{ unique_id: "someoneelse" }, LIVE_ROW]), { status: 200 }),
          },
        ],
        calls,
        inits
      )
    );
    const dto = (await probeTikTokLiveStatus("lofigirl"))!;
    expect(dto.live).toBe(true);
    expect(dto.room!.viewers).toBe(278);
    // the state machine's three rungs, in order
    expect(calls.length).toBe(3);
    expect(calls[0]).toContain("https://api.apify.com/v2/acts/unseenuser~tiktok-live-status-scraper/runs");
    expect(calls[0]).toContain("token=test-key");
    // the run POST carries the HANDLE INPUT (without it the actor runs its
    // own default handle and the dataset answers for the wrong creator —
    // the sandbox walk caught exactly that)
    expect(JSON.parse(String(inits[0].body ?? "{}"))).toEqual({ handles: ["lofigirl"] });
    expect(calls[1]).toContain("https://api.apify.com/v2/actor-runs/run-1");
    expect(calls[2]).toContain("https://api.apify.com/v2/datasets/ds-1/items");
  });

  test("the actor id is env-swappable (APIFY_LIVE_ACTOR_ID)", async () => {
    process.env.APIFY_LIVE_ACTOR_ID = "other-org~other-actor";
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: () => runJson("r", "d") },
        { match: POLL_MATCH, respond: () => runJson("r", "d") },
        { match: DATA_MATCH, respond: () => new Response(JSON.stringify([LIVE_ROW]), { status: 200 }) },
      ], calls)
    );
    await probeTikTokLiveStatus("lofigirl");
    expect(calls[0]).toContain("/v2/acts/other-org~other-actor/runs");
  });

  test("concurrent probes for one handle coalesce into ONE fetch sequence", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: () => runJson("r", "d") },
        { match: POLL_MATCH, respond: () => runJson("r", "d") },
        { match: DATA_MATCH, respond: () => new Response(JSON.stringify([LIVE_ROW]), { status: 200 }) },
      ], calls)
    );
    const [a, b] = await Promise.all([
      probeTikTokLiveStatus("lofigirl"),
      probeTikTokLiveStatus("lofigirl"),
    ]);
    expect(a!.live).toBe(true);
    expect(b!.live).toBe(true);
    expect(calls.length).toBe(3);
  });

  test("a run that never succeeds exhausts the poll cap into an honest 502", async () => {
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: () => runJson("r", "d", "RUNNING") },
        { match: POLL_MATCH, respond: () => runJson("r", "d", "RUNNING") },
      ])
    );
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toBeInstanceOf(
      TikTokLiveUnavailableError
    );
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
  });

  test("a FAILED run and a non-2xx run POST both answer 502", async () => {
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: () => runJson("r", "d", "FAILED") },
        { match: POLL_MATCH, respond: () => runJson("r", "d", "FAILED") },
      ])
    );
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });

    clearTikTokLiveCache();
    setTikTokLiveProbeUpstream(scriptedTransport([
      { match: RUN_MATCH, respond: () => new Response("no", { status: 500 }) },
    ]));
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
  });

  test("a dataset without the probe handle is an honest 502, not a fake offline", async () => {
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: () => runJson("r", "d") },
        { match: POLL_MATCH, respond: () => runJson("r", "d") },
        { match: DATA_MATCH, respond: () => new Response(JSON.stringify([{ unique_id: "x" }]), { status: 200 }) },
      ])
    );
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
  });

  test("invalid handles answer null without ever touching the transport", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(scriptedTransport([], calls));
    expect(await probeTikTokLiveStatus("bad handle!")).toBeNull();
    expect(await probeTikTokLiveStatus("")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("the disabled lane and the cache laws", () => {
  test("no APIFY_API_KEY → the lane is honestly unconfigured (503 with enable path)", async () => {
    delete process.env.APIFY_API_KEY;
    expect(isTikTokLiveProbeLaneConfigured()).toBe(false);
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(scriptedTransport([], calls));
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("APIFY_API_KEY"),
    });
    expect(calls).toHaveLength(0);
  });

  test("peek answers the cached DTO after a probe (and the cache is per-handle)", async () => {
    setTikTokLiveProbeUpstream(scriptedTransport([
      { match: RUN_MATCH, respond: () => runJson("r", "d") },
      { match: POLL_MATCH, respond: () => runJson("r", "d") },
      { match: DATA_MATCH, respond: () => new Response(JSON.stringify([LIVE_ROW]), { status: 200 }) },
    ]));
    expect(await peekTikTokLiveStatus("lofigirl")).toBeNull();
    const probed = await probeTikTokLiveStatus("lofigirl");
    expect(await peekTikTokLiveStatus("lofigirl")).toEqual(probed);
    expect(await peekTikTokLiveStatus("nowthispolitics")).toBeNull();
  });

  test("the TTL law: LIVE answers stay fresh 30s, offline answers 300s (cost law)", () => {
    expect(liveStatusTtlMs({ live: true } as never)).toBe(30_000);
    expect(liveStatusTtlMs({ live: false } as never)).toBe(300_000);
    expect(liveStatusTtlMs({ live: null } as never)).toBe(60_000);
  });

  test("in-flight is observable and clears when the probe settles", async () => {
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((res) => (release = res));
    setTikTokLiveProbeUpstream(
      scriptedTransport([
        { match: RUN_MATCH, respond: (): Promise<Response> => gate },
        { match: POLL_MATCH, respond: () => runJson("r", "d") },
        { match: DATA_MATCH, respond: () => new Response(JSON.stringify([LIVE_ROW]), { status: 200 }) },
      ])
    );
    const pending = probeTikTokLiveStatus("lofigirl");
    expect(isTikTokLiveProbeInFlight("lofigirl")).toBe(true);
    release(runJson("r", "d"));
    const dto = (await pending)!;
    expect(dto.live).toBe(true);
    expect(isTikTokLiveProbeInFlight("lofigirl")).toBe(false);
  });

  test("a failed probe puts the handle in failure backoff; peek surfaces the real error", async () => {
    setTikTokLiveProbeUpstream(scriptedTransport([
      { match: RUN_MATCH, respond: () => new Response("down", { status: 500 }) },
    ]));
    await expect(probeTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
    await expect(peekTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
    // clearing the cache (tests / operator freshness) lifts the backoff
    clearTikTokLiveCache();
    expect(await peekTikTokLiveStatus("lofigirl")).toBeNull();
  });
});
