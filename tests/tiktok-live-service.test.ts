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
  isTikTokLiveProbeBackedOff,
  isTikTokLiveProbeInFlight,
  isTikTokLiveProbeLaneConfigured,
  liveStatusTtlMs,
  peekTikTokLiveStatus,
  probeTikTokLiveStatus,
  setTikTokLiveProbePolling,
  TikTokLiveUnavailableError,
  tiktokLiveStatusTtlOverrideMs,
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

  test("P103-mini the quota-survival knob: TIKTOK_LIVE_STATUS_TTL_MS stretches the LIVE freshness (clamped, garbage → the 30s law)", () => {
    const prev = process.env.TIKTOK_LIVE_STATUS_TTL_MS;
    try {
      // absent → the 30s law (the P102 freshness default, unchanged)
      delete process.env.TIKTOK_LIVE_STATUS_TTL_MS;
      expect(tiktokLiveStatusTtlOverrideMs()).toBeNull();
      expect(liveStatusTtlMs({ live: true } as never)).toBe(30_000);
      // 300s → the FREE-plan survival cadence (the measured economics:
      // the status actor charges per answered handle; 30s buys ~10
      // viewing-hours a month on the $5 credit, 300s buys ~100)
      process.env.TIKTOK_LIVE_STATUS_TTL_MS = "300000";
      expect(tiktokLiveStatusTtlOverrideMs()).toBe(300_000);
      expect(liveStatusTtlMs({ live: true } as never)).toBe(300_000);
      // the OFFLINE cost law and the probing window never move
      expect(liveStatusTtlMs({ live: false } as never)).toBe(300_000);
      expect(liveStatusTtlMs({ live: null } as never)).toBe(60_000);
      // floor: the 30s law is the cheapest a LIVE answer may be served
      process.env.TIKTOK_LIVE_STATUS_TTL_MS = "1000";
      expect(tiktokLiveStatusTtlOverrideMs()).toBe(30_000);
      // cap: nonsense stretches clamp to one hour
      process.env.TIKTOK_LIVE_STATUS_TTL_MS = "999999999";
      expect(tiktokLiveStatusTtlOverrideMs()).toBe(3_600_000);
      // garbage → the 30s law
      process.env.TIKTOK_LIVE_STATUS_TTL_MS = "thirty seconds";
      expect(tiktokLiveStatusTtlOverrideMs()).toBeNull();
      expect(liveStatusTtlMs({ live: true } as never)).toBe(30_000);
    } finally {
      if (prev === undefined) delete process.env.TIKTOK_LIVE_STATUS_TTL_MS;
      else process.env.TIKTOK_LIVE_STATUS_TTL_MS = prev;
    }
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

// ---------------------------------------------------------------------------
// P103-mini-4 — the quota-death mapping: when the probe provider answers
// 403 platform-feature-disabled (the MEASURED 2026-11-08 outage — the
// operator's Apify free credit exhausted mid-cycle), the error the UI
// renders must be a HUMAN sentence, not dev-speak. Any other non-ok run
// start keeps the generic could-not-start law (no fabrication).
// ---------------------------------------------------------------------------
describe("P103-mini-4 — the quota-death mapping", () => {
  test("a 403 platform-feature-disabled run start answers the human quota sentence with status 503", async () => {
    setTikTokLiveProbeUpstream(
      ((url: string) => {
        if (url.includes("/acts/") && url.includes("/runs")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  type: "platform-feature-disabled",
                  message:
                    "You've used the $5.00 of monthly usage included in the Free plan, so Actor runs and other Apify services are blocked until your monthly usage cycle resets.",
                },
              }),
              { status: 403 }
            )
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as TikTokProbeFetch
    );
    let thrown: TikTokLiveUnavailableError | null = null;
    try {
      await probeTikTokLiveStatus("lofigirl");
    } catch (err) {
      thrown = err as TikTokLiveUnavailableError;
    }
    expect(thrown).toBeInstanceOf(TikTokLiveUnavailableError);
    expect(thrown?.status).toBe(503);
    expect(thrown?.message).toContain("monthly free quota");
    expect(thrown?.message).not.toContain("actor"); // no dev-speak identifier leak
    // the backoff still records the failure (the lane laws hold)
    await expect(peekTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 503 });
  });

  test("any other non-ok run start keeps the generic could-not-start law", async () => {
    setTikTokLiveProbeUpstream(
      ((url: string) => {
        if (url.includes("/acts/") && url.includes("/runs")) {
          return Promise.resolve(new Response("boom", { status: 500 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as TikTokProbeFetch
    );
    let thrown: TikTokLiveUnavailableError | null = null;
    try {
      await probeTikTokLiveStatus("lofigirl");
    } catch (err) {
      thrown = err as TikTokLiveUnavailableError;
    }
    expect(thrown?.status).toBe(502);
    expect(thrown?.message).toContain("could not start");
  });

  // -------------------------------------------------------------------------
  // M2.6 (work order fixture class "401/403/quota-exhausted mapping") — the
  // 401 auth-failure class: the operator key is invalid/revoked. The law: a
  // TYPED unavailable error (never a fake offline row), the generic
  // could-not-start sentence (the human quota sentence is for the MEASURED
  // 403 platform-feature-disabled class ONLY — no fabrication for 401), and
  // the failure-backoff marker so the route's circuit stays open (no actor
  // launches during the window).
  // -------------------------------------------------------------------------
  test("a 401 run start maps to the typed 502 could-not-start law and earns the backoff (no quota-sentence fabrication)", async () => {
    const calls: string[] = [];
    setTikTokLiveProbeUpstream(
      ((url: string) => {
        calls.push(String(url));
        if (url.includes("/acts/") && url.includes("/runs")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { type: "invalid-token" } }), { status: 401 })
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as TikTokProbeFetch
    );
    let thrown: TikTokLiveUnavailableError | null = null;
    try {
      await probeTikTokLiveStatus("lofigirl");
    } catch (err) {
      thrown = err as TikTokLiveUnavailableError;
    }
    expect(thrown).toBeInstanceOf(TikTokLiveUnavailableError);
    expect(thrown?.status).toBe(502);
    expect(thrown?.message).toContain("could not start");
    // the human quota sentence stays exclusive to the measured 403 class
    expect(thrown?.message).not.toContain("monthly free quota");
    // the circuit marker: the route gates re-probes on this (zero launches)
    expect(isTikTokLiveProbeBackedOff("lofigirl")).toBe(true);
    await expect(peekTikTokLiveStatus("lofigirl")).rejects.toMatchObject({ status: 502 });
    // exactly ONE actor attempt was made — no internal retry, no second run
    expect(calls.filter((u) => u.includes("/runs"))).toHaveLength(1);
  });
});
