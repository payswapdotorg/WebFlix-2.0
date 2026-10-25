/// <reference types="bun-types" />
/**
 * P52 — the broker's serial-work primitive (mini-services/netflix-desktop/
 * mutex.ts), pinned directly from the app battery.
 *
 * WHY IT EXISTS: P51-AUDIT A3 (the broker-side half) — the restart route
 * fire-and-forgets `destroy()` while the UI immediately re-kicks `/session`.
 * The session manager now runs every bootstrap AND every teardown through
 * this queue, so a bootstrap can never adopt a dying sandbox and two
 * teardowns can never interleave. These pins hold the primitive to that law:
 * strict FIFO ordering, a failing job never blocks (or breaks) the queue,
 * and `drain()` settles only after everything queued before it.
 */
import { describe, expect, test } from "bun:test";

import { createSerialQueue } from "../mini-services/netflix-desktop/mutex";

describe("createSerialQueue — the broker's bootstrap/teardown law", () => {
  test("jobs run in strict enqueue order, even when submitted concurrently", async () => {
    const q = createSerialQueue();
    const events: string[] = [];
    // Out-of-order completion delays: job 0 is slowest, job 2 fastest — the
    // ONLY way the end order stays 0,1,2 is the queue's strict serial law.
    const runs = [0, 1, 2].map((i) =>
      q.run(async () => {
        events.push(`start-${i}`);
        await new Promise((r) => setTimeout(r, (2 - i) * 30));
        events.push(`end-${i}`);
        return i;
      }),
    );
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(events).toEqual([
      "start-0", "end-0",
      "start-1", "end-1",
      "start-2", "end-2",
    ]);
  });

  test("a failing job propagates to its own caller only — the queue stays usable", async () => {
    const q = createSerialQueue();
    const boom = q.run(async () => {
      throw new Error("teardown exploded");
    });
    await expect(boom).rejects.toThrow("teardown exploded");
    // the next job still runs (and a prior failure never poisons the tail)
    const after = await q.run(async () => "recovered");
    expect(after).toBe("recovered");
  });

  test("drain() settles only after every job queued before it", async () => {
    const q = createSerialQueue();
    let finished = 0;
    const slow = q.run(
      () => new Promise<string>((r) => setTimeout(() => { finished++; r("slow"); }, 30)),
    );
    const fast = q.run(async () => {
      finished++;
      return "fast";
    });
    await q.drain();
    expect(finished).toBe(2);
    expect(await slow).toBe("slow");
    expect(await fast).toBe("fast");
    // drain on an idle queue resolves immediately
    await q.drain();
  });

  test("the A3 shape: destroy → ensure ordering (teardown fully precedes the next bootstrap)", async () => {
    const q = createSerialQueue();
    const trace: string[] = [];
    const destroy = q.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      trace.push("teardown-done");
    });
    const ensure = q.run(async () => {
      // an ensure that starts while the teardown is mid-flight must observe
      // the POST-teardown world, never the dying one
      trace.push("bootstrap-starts");
      return "fresh";
    });
    await destroy;
    expect(await ensure).toBe("fresh");
    expect(trace).toEqual(["teardown-done", "bootstrap-starts"]);
  });
});
