import { afterEach, expect, test } from "bun:test";
import { mainFetch } from "@/lib/main-api";
import { normalizeChannel } from "@/lib/mapping";
import { channelFixture, useMemoryKv } from "./helpers/fixtures";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("proxy parses fixture payload, caches in memory adapter (1 upstream call for 2 requests)", async () => {
  useMemoryKv();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ channel: channelFixture }), { status: 200 });
  }) as unknown as typeof fetch;

  const r1 = await mainFetch("/api/studio", { revalidateSec: 60, parse: (j) => normalizeChannel(j) });
  expect(r1.ok).toBe(true);
  const r2 = await mainFetch("/api/studio", { revalidateSec: 60, parse: (j) => normalizeChannel(j) });
  expect(r2.ok).toBe(true);
  expect(calls).toBe(1);
  if (r1.ok) expect(r1.data?.title).toBe("WebFlix Operator");
});

test("proxy degrades honestly on upstream 5xx", async () => {
  useMemoryKv();
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const r = await mainFetch("/api/channel/@x/videos", { revalidateSec: 60, parse: () => [] });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.degraded).toBe(true);
    expect(r.status).toBe(500);
    expect(r.reason).toContain("main-app 500");
  }
});

test("proxy degrades 502 when upstream unreachable; shape mismatch also degrades", async () => {
  useMemoryKv();
  globalThis.fetch = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  const r = await mainFetch("/api/studio", { revalidateSec: 60, parse: (j) => normalizeChannel(j) });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.status).toBe(502);

  globalThis.fetch = (async () => new Response(JSON.stringify({ garbage: true }), { status: 200 })) as unknown as typeof fetch;
  const r2 = await mainFetch("/api/studio", { revalidateSec: 60, parse: (j) => normalizeChannel(j) });
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.reason).toContain("shape mismatch");
});
