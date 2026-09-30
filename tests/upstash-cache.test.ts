/// <reference types="bun-types" />
/**
 * WFX2-C-W — the Upstash cache adapter under test: REST client wiring,
 * L1+L2 engine, TTL expiry, stale-while-revalidate, last-good fallback,
 * the walled-browse poisoning guard, and the no-live-network laws.
 *
 * The REST layer is a fake injected via `setUpstashRest()` (the lane law —
 * tests never touch the network; env vars are pointed at unroutable loopback
 * only to prove the client degrades, and are restored afterwards).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  cachedResilient,
  cacheJsonGet,
  cacheJsonSet,
  cachePeek,
  isTestUpstash,
  resetCacheEngine,
  setUpstashRest,
  upstashEnabled,
  type UpstashRest,
} from "@/lib/youtube/upstash-cache";
import { setUpstream } from "@/lib/youtube/innertube";

/** An in-memory fake of the Upstash REST pipeline endpoint. */
function fakeRest() {
  const store = new Map<string, string>();
  const commands: string[][] = [];
  const impl: UpstashRest = async (cmds) => {
    commands.push(...cmds.map((c) => [...c]));
    return cmds.map((cmd) => {
      switch (cmd[0]) {
        case "GET":
          return store.has(cmd[1]) ? store.get(cmd[1])! : null;
        case "SET":
          store.set(cmd[1], cmd[2]);
          return "OK";
        case "INCR": {
          const value = Number(store.get(cmd[1]) ?? "0") + 1;
          store.set(cmd[1], String(value));
          return value;
        }
        case "PEXPIRE":
          return 1;
        default:
          return null;
      }
    });
  };
  return { impl, store, commands };
}

const sleep = (ms: number) => Bun.sleep(ms);

/** Await a floating background revalidation (poll until `cond` or timeout). */
async function until(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await sleep(10);
  }
}

beforeEach(() => {
  resetCacheEngine();
});

afterEach(() => {
  setUpstashRest(null);
  setUpstream(null);
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("adapter activation", () => {
  test("no env, no seam → adapter offline; cached works L1-only exactly as before", async () => {
    expect(upstashEnabled()).toBe(false);
    expect(isTestUpstash()).toBe(false);
    let calls = 0;
    const v = await cachedResilient("k", 60_000, async () => {
      calls += 1;
      return { a: 1 };
    });
    expect(v).toEqual({ a: 1 });
    const v2 = await cachedResilient("k", 60_000, async () => {
      calls += 1;
      return { a: 2 };
    });
    expect(v2).toEqual({ a: 1 }); // L1 hit
    expect(calls).toBe(1);
  });

  test("fixture upstream stands L2 down even when the env IS configured (no-live-network law)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://unreachable.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network must not be touched");
    }) as unknown as typeof fetch;
    try {
      setUpstream(async () => new Response("{}", { status: 200 }));
      const v = await cachedResilient("k", 60_000, async () => "value");
      expect(v).toBe("value");
      expect(fetchCalls).toBe(0); // the law: fixtures + env → zero REST calls
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("env-configured client is used when no fixture upstream serves (and REST failure degrades to a miss)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://unreachable.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    expect(upstashEnabled()).toBe(true);
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("simulated outage");
    }) as unknown as typeof fetch;
    try {
      const v = await cachedResilient("k", 60_000, async () => "value");
      expect(v).toBe("value"); // the cache must never break the request
      expect(fetchCalls).toBeGreaterThanOrEqual(1); // L2 genuinely attempted
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("L1 + L2 engine", () => {
  test("cold miss computes once, writes the L2 envelope (SET … EX from the hard TTL)", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    let calls = 0;
    const v = await cachedResilient("yt:home:feed", 60_000, async () => {
      calls += 1;
      return { rails: 24 };
    });
    expect(v).toEqual({ rails: 24 });
    expect(calls).toBe(1);

    const set = rest.commands.find((c) => c[0] === "SET");
    expect(set).toBeDefined();
    expect(set![1]).toBe("yt:home:feed");
    const envelope = JSON.parse(set![2]) as {
      v: number;
      value: { rails: number };
      softUntil: number;
      hardUntil: number;
    };
    expect(envelope.v).toBe(1);
    expect(envelope.value).toEqual({ rails: 24 });
    expect(envelope.softUntil).toBeGreaterThan(Date.now());
    expect(envelope.hardUntil).toBeGreaterThan(envelope.softUntil);
    // EX seconds ≈ the hard window (default ttl×12 clamped to [5m, 2h])
    const exSec = Number(set![4]);
    expect(exSec).toBeGreaterThanOrEqual(299);
    expect(exSec).toBeLessThanOrEqual(7_201);
  });

  test("a fresh L1 hit performs zero REST round-trips", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    await cachedResilient("k", 60_000, async () => 1);
    const commandsAfterFirst = rest.commands.length;
    await cachedResilient("k", 60_000, async () => 2);
    expect(rest.commands.length).toBe(commandsAfterFirst); // no GET, no SET
  });

  test("a new instance (L1 wiped) is served from L2 without recomputing", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    let calls = 0;
    await cachedResilient("k", 60_000, async () => {
      calls += 1;
      return "v1";
    });
    resetCacheEngine(); // simulate a cold lambda instance
    const v = await cachedResilient("k", 60_000, async () => {
      calls += 1;
      return "v2";
    });
    expect(v).toBe("v1"); // L2 hit — cross-instance sharing works
    expect(calls).toBe(1);
    expect(rest.commands.some((c) => c[0] === "GET" && c[1] === "k")).toBe(true);
  });

  test("in-flight dedupe: concurrent cold calls compute exactly once", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await sleep(30);
      return "shared";
    };
    const [a, b, c] = await Promise.all([
      cachedResilient("k", 60_000, fn),
      cachedResilient("k", 60_000, fn),
      cachedResilient("k", 60_000, fn),
    ]);
    expect(a).toBe("shared");
    expect(b).toBe("shared");
    expect(c).toBe("shared");
    expect(calls).toBe(1);
  });

  test("nested same-key calls do not deadlock (the related-route pattern)", async () => {
    // /api/videos/[id]/related wraps watchResponse() in cached("yt:watch:…")
    // while watchResponse() itself caches with the same key — the engine's
    // re-entrancy guard must let the inner call compute (exactly one fetch).
    let fetches = 0;
    const rawFetch = async () => {
      fetches += 1;
      await sleep(20);
      return { payload: "next" };
    };
    const helperThatCachesInternally = () => cachedResilient("nested:k", 60_000, rawFetch);
    const value = await cachedResilient("nested:k", 60_000, helperThatCachesInternally);
    expect(value).toEqual({ payload: "next" });
    expect(fetches).toBe(1);
    // and a follow-up call is a fresh L1 hit
    const again = await cachedResilient("nested:k", 60_000, helperThatCachesInternally);
    expect(again).toEqual({ payload: "next" });
    expect(fetches).toBe(1);
  });
});

describe("TTL + stale-while-revalidate", () => {
  test("soft TTL expiry serves the stale value immediately, then refreshes in the background", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return `v${calls}`;
    };
    expect(await cachedResilient("k", 40, fn, { hardTtlMs: 5_000 })).toBe("v1");
    await sleep(70); // soft expired, hard window open
    const served = await cachedResilient("k", 40, fn, { hardTtlMs: 5_000 });
    expect(served).toBe("v1"); // stale served instantly (SWR)
    await until(() => calls === 2); // the background revalidation ran
    expect(await cachedResilient("k", 40, fn, { hardTtlMs: 5_000 })).toBe("v2");
  });

  test("beyond the hard TTL the entry is gone — honest recompute", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return `v${calls}`;
    };
    await cachedResilient("k", 30, fn, { hardTtlMs: 60 });
    await sleep(120); // past the hard window
    expect(await cachedResilient("k", 30, fn, { hardTtlMs: 60 })).toBe("v2");
    expect(calls).toBe(2);
  });
});

describe("last-good fallback", () => {
  test("upstream failure inside the hard window serves the last-good payload", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) return "good";
      throw new Error("upstream 503");
    };
    await cachedResilient("k", 30, fn, { hardTtlMs: 5_000 });
    await sleep(60); // soft expired
    const served = await cachedResilient("k", 30, fn, { hardTtlMs: 5_000 });
    expect(served).toBe("good"); // no throw — last-good keeps the surface alive
  });

  test("upstream failure with NO last-good rethrows honestly (no fake data)", async () => {
    await expect(
      cachedResilient("k", 60_000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("past the hard window a failure rethrows — unbounded staleness is refused", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) return "good";
      throw new Error("upstream down");
    };
    await cachedResilient("k", 20, fn, { hardTtlMs: 50 });
    await sleep(120);
    await expect(cachedResilient("k", 20, fn, { hardTtlMs: 50 })).rejects.toThrow("upstream down");
  });
});

describe("the walled-browse poisoning guard (isEmpty)", () => {
  const isEmpty = (v: unknown) => v === "WALLED-EMPTY";

  test("an unhealthy 200 is never cached and the last-good keeps serving", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls === 1 ? "good" : "WALLED-EMPTY";
    };
    await cachedResilient("k", 30, fn, { isEmpty, hardTtlMs: 5_000 });
    await sleep(60); // soft expired → revalidate → walled answer arrives
    expect(await cachedResilient("k", 30, fn, { isEmpty, hardTtlMs: 5_000 })).toBe("good");
    // the poisoned answer never reached L2
    const set = rest.commands.find((c) => c[0] === "SET");
    expect(JSON.parse(set![2]).value).toBe("good");
  });

  test("an unhealthy 200 with NO last-good is returned honestly and never stored", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    const v = await cachedResilient("k", 60_000, async () => "WALLED-EMPTY", { isEmpty });
    expect(v).toBe("WALLED-EMPTY"); // honest — never fake data
    expect(rest.commands.some((c) => c[0] === "SET")).toBe(false);
  });
});

describe("raw JSON ops + peek", () => {
  test("cacheJsonSet/Get round-trip through both layers", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    await cacheJsonSet("ops:key", { n: 7 }, 60_000);
    expect(await cacheJsonGet<{ n: number }>("ops:key")).toEqual({ n: 7 });
    resetCacheEngine();
    expect(await cacheJsonGet<{ n: number }>("ops:key")).toEqual({ n: 7 }); // L2
  });

  test("cachePeek reports freshness without side effects", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    await cachedResilient("peek:k", 40, async () => "v", { hardTtlMs: 5_000 });
    const fresh = await cachePeek("peek:k");
    expect(fresh?.value).toBe("v");
    expect(fresh?.fresh).toBe(true);
    await sleep(70);
    const stale = await cachePeek("peek:k");
    expect(stale?.value).toBe("v");
    expect(stale?.fresh).toBe(false);
    expect(rest.commands.length).toBe(2); // 1 GET (miss) + 1 SET — peek added nothing
  });
});
