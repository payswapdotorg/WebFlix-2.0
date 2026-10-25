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
import { setUpstream } from "@/lib/youtube/innertube";
import { setupTestDb, fixtures } from "./helpers";
import {
  GET as watchSessionGet,
  POST as watchSessionPost,
} from "@/app/api/netflix/watch/session/route";
import { GET as autoauthGet, POST as autoauthPost } from "@/app/api/netflix/watch/autoauth/route";
import { POST as cookiesPost } from "@/app/api/netflix/watch/cookies/route";
import { POST as releasePost } from "@/app/api/netflix/watch/release/route";
import { POST as retryAuthPost } from "@/app/api/netflix/watch/retry-auth/route";
import { POST as sessionRestartPost } from "@/app/api/netflix/watch/session/restart/route";

setupTestDb();

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

function req(url: string, headers: Record<string, string> = {}): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"), { headers });
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
  // P51: the watch routes are rate-limited like every other netflix route —
  // the battery stands the limiter down via the test-upstream idiom
  setUpstream(async () => new Response("{}", { status: 200 }));
});

afterEach(() => {
  installBroker(null);
  setUpstream(null);
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
    const res = await watchSessionGet(req("http://localhost:3000/api/netflix/watch/session"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { phase: string; streamUrl: string };
    expect(body.phase).toBe("ready");
    expect(body.streamUrl).toContain("vnc.html");
    expect(brokerRequests[0]?.url).toContain("/healthz");
  });

  test("degrades honestly when the mini-service is unreachable", async () => {
    installBroker(null);
    const res = await watchSessionGet(req("http://localhost:3000/api/netflix/watch/session"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { phase: string; message: string };
    expect(body.phase).toBe("unreachable");
    expect(body.message).toContain("unreachable");
  });

  test("never discloses the sandbox id (P51-AUDIT B1)", async () => {
    // the id is the ADDRESS of the sandbox's public CDP relay — an older
    // broker build that still sends it must not leak through the proxy
    installBroker(async () =>
      new Response(
        JSON.stringify({ ok: true, phase: "ready", sandboxId: "sbx-leak", streamUrl: "https://x/vnc.html" }),
        { status: 200 },
      ),
    );
    const res = await watchSessionGet(req("http://localhost:3000/api/netflix/watch/session"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sandboxId).toBeUndefined();
  });

  test("rejects a cross-site Origin on the kick (P51-AUDIT B3)", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "provisioning" }), { status: 202 }));
    const evil = new NextRequest(new URL("http://localhost:3000/api/netflix/watch/session"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ videoId: 81757047 }),
    });
    const res = await watchSessionPost(evil);
    expect(res.status).toBe(403);
    expect(brokerRequests).toHaveLength(0); // nothing reached the broker
  });

  test("a same-site Origin rides through (the app's own pages)", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "provisioning" }), { status: 202 }));
    const own = new NextRequest(new URL("http://localhost:3000/api/netflix/watch/session"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ videoId: 81757047 }),
    });
    const res = await watchSessionPost(own);
    expect(res.status).toBe(202);
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

  test("forwards the Netflix Live browse path (P44)", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "provisioning" }), { status: 202 }));
    const res = await watchSessionPost(
      postReq("http://localhost:3000/api/netflix/watch/session", { path: "/browse" }),
    );
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.body).toContain("/browse");
  });

  test("a non-whitelisted path never reaches the broker (no open redirect)", async () => {
    installBroker(async () => new Response(JSON.stringify({ phase: "idle" }), { status: 202 }));
    const res = await watchSessionPost(
      postReq("http://localhost:3000/api/netflix/watch/session", { path: "https://evil.example/x" }),
    );
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.body).toBe("{}");
  });
});

describe("POST /api/netflix/watch/session/restart — the P44 restart lane", () => {
  test("forwards the teardown to the broker", async () => {
    installBroker(async () =>
      new Response(JSON.stringify({ ok: true, phase: "restarting" }), { status: 202 }),
    );
    const res = await sessionRestartPost(req("http://localhost:3000/api/netflix/watch/session/restart"));
    expect(res.status).toBe(200);
    expect(brokerRequests[0]?.url).toContain("/session/restart");
  });

  test("survives a dead broker (best effort — the view re-kicks)", async () => {
    installBroker(null);
    const res = await sessionRestartPost(req("http://localhost:3000/api/netflix/watch/session/restart"));
    expect(res.status).toBe(200);
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
    const res = await releasePost(req("http://localhost:3000/api/netflix/watch/release"));
    expect(res.status).toBe(200);
    expect(brokerRequests[0]?.url).toContain("/session/release");
  });

  test("release survives a dead broker", async () => {
    installBroker(null);
    const res = await releasePost(req("http://localhost:3000/api/netflix/watch/release"));
    expect(res.status).toBe(200);
  });

  test("retry-auth kicks the harvest lane", async () => {
    installBroker(async () => new Response(JSON.stringify({ ok: true, phase: "harvesting" }), { status: 202 }));
    const res = await retryAuthPost(req("http://localhost:3000/api/netflix/watch/retry-auth"));
    expect(res.status).toBe(202);
    expect(brokerRequests[0]?.url).toContain("/auth/retry");
  });
});

describe("P52 — the pairing lockdown rung (NETFLIX_PAIRING_LOCKDOWN)", () => {
  const TOKEN_STUB = async () =>
    new Response(JSON.stringify({ token: "pair-token-1", bridge: null }), { status: 200 });
  let savedLockdown: string | undefined;

  beforeEach(() => {
    savedLockdown = process.env.NETFLIX_PAIRING_LOCKDOWN;
  });

  afterEach(() => {
    if (savedLockdown === undefined) delete process.env.NETFLIX_PAIRING_LOCKDOWN;
    else process.env.NETFLIX_PAIRING_LOCKDOWN = savedLockdown;
  });

  test("lockdown ON + anonymous → the pairing token answers the house 401", async () => {
    process.env.NETFLIX_PAIRING_LOCKDOWN = "1";
    installBroker(TOKEN_STUB); // would have answered 200 — the gate must stop the request first
    const res = await autoauthGet(req("http://localhost:3000/api/netflix/watch/autoauth"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(brokerRequests).toHaveLength(0); // the broker was never asked
  });

  test("lockdown ON + a signed-out cookie paste → 401, broker untouched", async () => {
    process.env.NETFLIX_PAIRING_LOCKDOWN = "1";
    installBroker(TOKEN_STUB);
    const res = await cookiesPost(
      postReq("http://localhost:3000/api/netflix/watch/cookies", { cookies: "NetflixId=abc" }),
    );
    expect(res.status).toBe(401);
    expect(brokerRequests).toHaveLength(0);
  });

  test("lockdown ON + the signed-in identity (the x-wfx2-user header lane) → the gate opens", async () => {
    process.env.NETFLIX_PAIRING_LOCKDOWN = "1";
    const { demo } = await fixtures();
    installBroker(TOKEN_STUB);
    const res = await autoauthGet(
      req("http://localhost:3000/api/netflix/watch/autoauth", { "x-wfx2-user": demo.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string | null };
    expect(body.token).toBe("pair-token-1");
  });

  test("lockdown OFF (the default) → anonymous keeps the open operator tool", async () => {
    delete process.env.NETFLIX_PAIRING_LOCKDOWN;
    installBroker(TOKEN_STUB);
    const res = await autoauthGet(req("http://localhost:3000/api/netflix/watch/autoauth"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token: string | null }).token).toBe("pair-token-1");
  });

  test("lockdown truthiness: only 1/true/yes lock the door", async () => {
    process.env.NETFLIX_PAIRING_LOCKDOWN = "0";
    installBroker(TOKEN_STUB);
    const res = await autoauthGet(req("http://localhost:3000/api/netflix/watch/autoauth"));
    expect(res.status).toBe(200);
  });

  test("lockdown ON + rotate without identity → 401 (rotation is privileged too)", async () => {
    process.env.NETFLIX_PAIRING_LOCKDOWN = "1";
    installBroker(TOKEN_STUB);
    const res = await autoauthPost(
      postReq("http://localhost:3000/api/netflix/watch/autoauth", { action: "rotate" }),
    );
    expect(res.status).toBe(401);
    expect(brokerRequests).toHaveLength(0);
  });
});
