/// <reference types="bun-types" />
/**
 * WFX2-C-W — rate limiting behind the adapter:
 *  - the offline (in-memory) fixed window keeps the pre-cutover semantics;
 *  - the Upstash path counts via INCR/PEXPIRE on per-window keys;
 *  - REST failure fails open; fixture upstreams stand the limiter down;
 *  - the livechat lane's (capacity, refillPerSec) signature maps to the same
 *    fixed-window core with its exact 60-second ceiling.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { clearRateLimits, rateLimit } from "@/lib/youtube/cache";
import { rateLimit as livechatRateLimit } from "@/lib/youtube/livechat";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";
import { setUpstream } from "@/lib/youtube/innertube";

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

const sleep = (ms: number) => Bun.sleep(ms);

beforeEach(() => {
  clearRateLimits();
});

afterEach(() => {
  setUpstashRest(null);
  setUpstream(null);
});

describe("offline fallback (no Upstash) — pre-cutover semantics", () => {
  test("fixed window: allows up to the limit, blocks past it", async () => {
    expect(await rateLimit("route:ip", { limit: 2 })).toBe(true);
    expect(await rateLimit("route:ip", { limit: 2 })).toBe(true);
    expect(await rateLimit("route:ip", { limit: 2 })).toBe(false);
  });

  test("the window resets after windowMs", async () => {
    expect(await rateLimit("route:ip", { limit: 1, windowMs: 40 })).toBe(true);
    expect(await rateLimit("route:ip", { limit: 1, windowMs: 40 })).toBe(false);
    await sleep(60);
    expect(await rateLimit("route:ip", { limit: 1, windowMs: 40 })).toBe(true);
  });

  test("default budget is 120/60s per key; keys are independent", async () => {
    for (let i = 0; i < 120; i++) expect(await rateLimit("a:ip")).toBe(true);
    expect(await rateLimit("a:ip")).toBe(false);
    expect(await rateLimit("b:ip")).toBe(true); // per-route budgets are separate keys
  });

  test("clearRateLimits wipes the local windows", async () => {
    expect(await rateLimit("route:ip", { limit: 1 })).toBe(true);
    expect(await rateLimit("route:ip", { limit: 1 })).toBe(false);
    clearRateLimits();
    expect(await rateLimit("route:ip", { limit: 1 })).toBe(true);
  });
});

describe("adapter-backed (Upstash path)", () => {
  test("INCR/PEXPIRE on a per-window key; the budget is enforced", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    expect(await rateLimit("home:1.2.3.4", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(await rateLimit("home:1.2.3.4", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(await rateLimit("home:1.2.3.4", { limit: 2, windowMs: 60_000 })).toBe(false);

    const incr = rest.commands.filter((c) => c[0] === "INCR");
    expect(incr).toHaveLength(3);
    expect(incr[0][1]).toMatch(/^wfx2:rl:home:1\.2\.3\.4:\d+$/); // route+IP+window index
    const pexpire = rest.commands.filter((c) => c[0] === "PEXPIRE");
    expect(pexpire).toHaveLength(3); // cleanup TTL rides every increment
    expect(pexpire[0][1]).toBe(incr[0][1]);
  });

  test("REST failure fails open (availability over strictness)", async () => {
    setUpstashRest(async () => {
      throw new Error("upstash outage");
    });
    for (let i = 0; i < 10; i++) {
      expect(await rateLimit("home:ip", { limit: 1 })).toBe(true);
    }
  });

  test("fixture upstream stands the limiter down (no REST, always allow)", async () => {
    const rest = fakeRest();
    setUpstream(async () => new Response("{}", { status: 200 })); // fixtures serving
    // NOTE: no setUpstashRest — the law: fixtures without an injected fake
    // must never touch the network, so the limiter stands down entirely.
    for (let i = 0; i < 50; i++) {
      expect(await rateLimit("home:ip", { limit: 1 })).toBe(true);
    }
  });
});

describe("the livechat limiter behind the same adapter", () => {
  test("(60, 1) token-bucket budget maps to a 120/60s fixed-window ceiling", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    for (let i = 0; i < 120; i++) {
      expect(await livechatRateLimit("live-status:ip", 60, 1)).toBe(true);
    }
    expect(await livechatRateLimit("live-status:ip", 60, 1)).toBe(false); // 121st
  });

  test("default (60, 0.5) maps to 90/60s", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    for (let i = 0; i < 90; i++) {
      expect(await livechatRateLimit("shorts:ip")).toBe(true);
    }
    expect(await livechatRateLimit("shorts:ip")).toBe(false);
  });

  test("local fallback also enforces the mapped ceiling offline", async () => {
    for (let i = 0; i < 90; i++) {
      expect(await livechatRateLimit("offline:ip")).toBe(true);
    }
    expect(await livechatRateLimit("offline:ip")).toBe(false);
  });
});
