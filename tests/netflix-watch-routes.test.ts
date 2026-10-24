/// <reference types="bun-types" />
/**
 * P43 — the Netflix watch-session route battery.
 *
 * The routes proxy the netflix-desktop mini-service; the battery pins the
 * proxy seam with a stub upstream (the house injectable-transport law) so
 * no cloud session is ever touched from tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { NextRequest } from "next/server";
import {
  GET as watchSessionGet,
  POST as watchSessionPost,
} from "@/app/api/netflix/watch/session/route";
import { POST as cookiesPost } from "@/app/api/netflix/watch/cookies/route";
import { POST as releasePost } from "@/app/api/netflix/watch/release/route";
import { POST as retryAuthPost } from "@/app/api/netflix/watch/retry-auth/route";

type Handler = (req: Request, init?: { method: string; body: string }) => Promise<Response>;

const originalFetch = globalThis.fetch;
let brokerRequests: Array<{ url: string; method: string; body: string }> = [];
let brokerHandler: Handler | null = null;

function installBroker(handler: Handler | null) {
  brokerHandler = handler;
  brokerRequests = [];
  // @ts-expect-error — test seam: intercept fetches that target the broker
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("127.0.0.1:3030")) {
      return originalFetch(input as never, init);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    brokerRequests.push({ url, method, body });
    if (!brokerHandler) {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:3030");
    }
    return brokerHandler(new Request(url, { method, body, headers: init?.headers }));
  };
}

function req(url: string): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

function postReq(url: string, body: unknown): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  installBroker(null);
});

afterEach(() => {
  installBroker(null);
  globalThis.fetch = originalFetch;
});

describe("GET /api/netflix/watch/session — status proxy", () => {
  test("surfaces the broker status verbatim", async () => {
    installBroker(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          phase: "ready",
          sandboxId: "sbx1",
          streamUrl: "https://6080-sbx1.e2b.app/vnc.html",
          videoId: 81757047,
          audioRunning: true,
        }),
        { status: 200 },
      ),
    );
    const res = await watchSessionGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phase: string; streamUrl: string };
    expect(body.phase).toBe("ready");
    expect(body.streamUrl).toContain("vnc.html");
    expect(brokerRequests[0]?.url).toContain("/healthz");
  });

  test("degrades honestly when the mini-service is unreachable", async () => {
    installBroker(null);
    const res = await watchSessionGet();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { phase: string; message: string };
    expect(body.phase).toBe("unreachable");
    expect(body.message).toContain("unreachable");
  });
});

describe("POST /api/netflix/watch/session — the kick", () => {
  test("forwards the videoId and returns 202 with the immediate status", async () => {
    installBroker(async () =>
      new Response(JSON.stringify({ phase: "provisioning", videoId: 81757047 }), { status: 202 }),
    );
    const res = await watchSessionPost(postReq("http://localhost:3000/api/netflix/watch/session", { videoId: 81757047 }));
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.method).toBe("POST");
    expect(brokerRequests[0]?.body).toContain("81757047");
  });

  test("an empty body still provisions (no videoId forwarded)", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "idle" }), { status: 202 }));
    const res = await watchSessionPost(postReq("http://localhost:3000/api/netflix/watch/session", {}));
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.body).toContain("{}");
  });

  test("rejects garbage video ids", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "idle" }), { status: 202 }));
    const res = await watchSessionPost(
      postReq("http://localhost:3000/api/netflix/watch/session", { videoId: -5 }),
    );
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.body).toBe("{}");
  });
});

describe("POST /api/netflix/watch/cookies — operator connect", () => {
  test("requires the cookies field", async () => {
    const res = await cookiesPost(postReq("http://localhost:3000/api/netflix/watch/cookies", {}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test("forwards raw cookie strings to the broker", async () => {
    installBroker(async () =>
      new Response(JSON.stringify({ ok: true, message: "Netflix session connected." }), { status: 200 }),
    );
    const res = await cookiesPost(
      postReq("http://localhost:3000/api/netflix/watch/cookies", {
        cookies: "NetflixId=abc; SecureNetflixId=def",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toContain("connected");
    expect(brokerRequests[0]?.body).toContain("NetflixId=abc");
  });

  test("surfaces the broker's honest rejection (422)", async () => {
    installBroker(async () =>
      new Response(JSON.stringify({ ok: false, message: "No NetflixId cookie found in the payload." }), { status: 422 }),
    );
    const res = await cookiesPost(
      postReq("http://localhost:3000/api/netflix/watch/cookies", { cookies: "other=1" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("NetflixId");
  });
});

describe("POST /api/netflix/watch/release + retry-auth", () => {
  test("release is best-effort and always 200", async () => {
    installBroker(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await releasePost();
    expect(res.status).toBe(200);
    expect(brokerRequests[0]?.url).toContain("/session/release");
  });

  test("release survives a dead broker", async () => {
    installBroker(null);
    const res = await releasePost();
    expect(res.status).toBe(200);
  });

  test("retry-auth kicks the harvest lane", async () => {
    installBroker(async () => new Response(JSON.stringify({ ok: true, phase: "harvesting" }), { status: 202 }));
    const res = await retryAuthPost();
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.url).toContain("/auth/retry");
  });
});
