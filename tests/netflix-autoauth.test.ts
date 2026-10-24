/// <reference types="bun-types" />
/**
 * P46 — the automatic sign-in battery.
 *
 * Three hermetic seams, zero Netflix/E2B touches:
 *  1. the broker's ingest module (token pairing, candidate store, push
 *     decisions — poison-proof: nothing reaches a trusted cache here),
 *  2. the WebFlix Bridge extension (manifest sanity + the pure push logic
 *     the service worker actually imports),
 *  3. the app's ingest/autoauth proxy routes (stub upstream, house law).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// hermetic paths MUST be set before the broker module is imported
process.env.NETFLIX_INGEST_TOKEN_PATH = "/tmp/nf-test-ingest-token.json";
process.env.NETFLIX_BRIDGE_CANDIDATE_PATH = "/tmp/nf-test-bridge-candidate.json";
for (const p of [process.env.NETFLIX_INGEST_TOKEN_PATH, process.env.NETFLIX_BRIDGE_CANDIDATE_PATH]) {
  rmSync(p, { force: true });
}

const {
  getIngestToken,
  rotateIngestToken,
  verifyIngestToken,
  normalizeBridgeCookies,
  hasUsableAuthCookies,
  cookieSignature,
  decidePush,
  ingestBridgeCookies,
  readBridgeCandidate,
  clearBridgeCandidate,
  getBridgeStatus,
} = await import("../mini-services/netflix-desktop/ingest");
import { POST as appIngestPost } from "@/app/api/netflix/watch/ingest/route";
import { GET as autoauthGet, POST as autoauthPost } from "@/app/api/netflix/watch/autoauth/route";

const CANDIDATE = process.env.NETFLIX_BRIDGE_CANDIDATE_PATH!;

function bridgePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    token: getIngestToken(),
    cookies: [
      { name: "NetflixId", value: "v=3%26mm%26test", domain: ".netflix.com", path: "/" },
      { name: "SecureNetflixId", value: "v=3%26sig", domain: ".netflix.com", path: "/" },
      { name: "nfvdid", value: "some-device-id", domain: ".netflix.com", path: "/" },
    ],
    device: "test-browser",
    ...overrides,
  };
}

beforeEach(() => {
  clearBridgeCandidate();
});

afterEach(() => {
  clearBridgeCandidate();
});

describe("ingest token pairing", () => {
  test("token is minted, persisted, and stable across calls", () => {
    const t1 = getIngestToken();
    expect(t1.length).toBeGreaterThanOrEqual(32);
    expect(getIngestToken()).toBe(t1); // persisted — not re-minted
    expect(verifyIngestToken(t1)).toBe(true);
    expect(verifyIngestToken(`${t1}x`)).toBe(false);
    expect(verifyIngestToken("")).toBe(false);
    expect(verifyIngestToken(null)).toBe(false);
  });

  test("rotate mints a fresh token and invalidates the old one", () => {
    const t1 = getIngestToken();
    const t2 = rotateIngestToken();
    expect(t2).not.toBe(t1);
    expect(verifyIngestToken(t1)).toBe(false);
    expect(verifyIngestToken(t2)).toBe(true);
  });
});

describe("bridge payload normalization", () => {
  test("accepts a cookie array and tolerates missing domain/path", () => {
    const cookies = normalizeBridgeCookies([{ name: "NetflixId", value: "abc" }]);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].domain).toBe(".netflix.com");
    expect(cookies[0].httpOnly).toBe(true);
  });

  test("accepts a raw Cookie header string (the tolerant parse path)", () => {
    const cookies = normalizeBridgeCookies("NetflixId=abc; SecureNetflixId=def");
    expect(hasUsableAuthCookies(cookies)).toBe(true);
  });

  test("a payload without a STANDALONE NetflixId is unusable", () => {
    expect(hasUsableAuthCookies(normalizeBridgeCookies([{ name: "SecureNetflixId", value: "v" }]))).toBe(false);
    expect(hasUsableAuthCookies(normalizeBridgeCookies("garbage"))).toBe(false);
    expect(hasUsableAuthCookies(normalizeBridgeCookies(42))).toBe(false);
  });

  test("signature covers both auth cookies and flips on rotation", () => {
    const a = cookieSignature(normalizeBridgeCookies("NetflixId=aaa; SecureNetflixId=bbb"));
    expect(a).toBe(cookieSignature(normalizeBridgeCookies("SecureNetflixId=bbb; NetflixId=aaa"))); // order-independent
    expect(a).not.toBe(cookieSignature(normalizeBridgeCookies("NetflixId=zzz; SecureNetflixId=bbb")));
    expect(cookieSignature(normalizeBridgeCookies("SecureNetflixId=bbb"))).toBeNull();
  });
});

describe("the bridge-side push decision", () => {
  const now = 1_000_000_000;
  test("never pushes without auth cookies", () => {
    expect(decidePush({ signature: null, lastSignature: null, lastPushAt: null, now })).toEqual({
      push: false,
      reason: "no-auth",
    });
  });
  test("first sight pushes; rotation pushes; unchanged idles", () => {
    expect(decidePush({ signature: "a", lastSignature: null, lastPushAt: null, now }).reason).toBe("first");
    expect(decidePush({ signature: "b", lastSignature: "a", lastPushAt: now, now }).reason).toBe("rotated");
    expect(decidePush({ signature: "a", lastSignature: "a", lastPushAt: now - 60_000, now }).reason).toBe("unchanged");
  });
  test("debounce suppresses; keepalive re-asserts after 6h", () => {
    expect(decidePush({ signature: "a", lastSignature: "a", lastPushAt: now - 5_000, now }).reason).toBe("debounced");
    expect(decidePush({ signature: "a", lastSignature: "a", lastPushAt: now - 7 * 3600_000, now }).reason).toBe("keepalive");
  });
});

describe("ingestBridgeCookies (poison-proof ladder)", () => {
  test("401 on a bad pairing token — nothing is stored", () => {
    const r = ingestBridgeCookies(bridgePayload({ token: "wrong" }), {
      isSessionLive: () => false,
      applyLive: async () => ({ ok: true, message: "x" }),
    });
    return r.then((res) => {
      expect(res.code).toBe(401);
      expect(readBridgeCandidate()).toBeNull();
    });
  });

  test("422 when the payload carries no NetflixId", async () => {
    const res = await ingestBridgeCookies(bridgePayload({ cookies: [{ name: "nfvdid", value: "x" }] }), {
      isSessionLive: () => false,
      applyLive: async () => ({ ok: true, message: "x" }),
    });
    expect(res.code).toBe(422);
    expect(readBridgeCandidate()).toBeNull();
  });

  test("sandbox idle → queued as a candidate (never the trusted cache), status surfaces it", async () => {
    const res = await ingestBridgeCookies(bridgePayload(), {
      isSessionLive: () => false,
      applyLive: async () => ({ ok: true, message: "should not be called" }),
    });
    expect(res.code).toBe(200);
    expect(res.applied).toBe(false);
    expect(res.message).toContain("queued");
    const cand = readBridgeCandidate();
    expect(cand).not.toBeNull();
    expect(cand!.device).toBe("test-browser");
    expect(cand!.cookies.some((c) => c.name === "NetflixId")).toBe(true);
    expect(getBridgeStatus().candidatePending).toBe(true);
    expect(getBridgeStatus().lastBridgePushAt).not.toBeNull();
  });

  test("sandbox live → applied through the strict path; success clears the candidate", async () => {
    const applied: string[][] = [];
    const res = await ingestBridgeCookies(bridgePayload(), {
      isSessionLive: () => true,
      applyLive: async (cookies) => {
        applied.push(cookies.map((c) => c.name));
        return { ok: true, message: "Netflix session connected." };
      },
    });
    expect(res.applied).toBe(true);
    expect(res.message).toBe("Netflix session connected.");
    expect(applied[0]).toContain("NetflixId");
    expect(readBridgeCandidate()).toBeNull();
  });

  test("sandbox live → a live REJECTION is never queued as a candidate", async () => {
    const res = await ingestBridgeCookies(bridgePayload(), {
      isSessionLive: () => true,
      applyLive: async () => ({ ok: false, message: "Netflix rejected these cookies (redirected to sign-in)." }),
    });
    expect(res.code).toBe(422);
    expect(readBridgeCandidate()).toBeNull();
    expect(getBridgeStatus().lastRejection?.reason).toContain("rejected");
  });

  test("unchanged re-push is an idempotent no-op (no candidate churn)", async () => {
    const payload = bridgePayload();
    await ingestBridgeCookies(payload, { isSessionLive: () => false, applyLive: async () => ({ ok: true, message: "x" }) });
    clearBridgeCandidate(); // simulate promotion elsewhere
    const res = await ingestBridgeCookies(payload, { isSessionLive: () => false, applyLive: async () => ({ ok: true, message: "x" }) });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("already current");
    expect(readBridgeCandidate()).toBeNull();
  });

  test("a rotated session re-queues (the whole point of the bridge)", async () => {
    await ingestBridgeCookies(bridgePayload(), { isSessionLive: () => false, applyLive: async () => ({ ok: true, message: "x" }) });
    clearBridgeCandidate();
    const res = await ingestBridgeCookies(
      bridgePayload({ cookies: [{ name: "NetflixId", value: "v=3%26ROTATED" }, { name: "SecureNetflixId", value: "v=3%26sig2" }] }),
      { isSessionLive: () => false, applyLive: async () => ({ ok: true, message: "x" }) },
    );
    expect(res.ok).toBe(true);
    expect(readBridgeCandidate()?.cookies[0].value).toContain("ROTATED");
  });
});

describe("the WebFlix Bridge extension", () => {
  const extDir = new URL("../extension/webflix-bridge/", import.meta.url).pathname;

  test("manifest is MV3 with the cookie-watching permissions", () => {
    const m = JSON.parse(readFileSync(`${extDir}manifest.json`, "utf8"));
    expect(m.manifest_version).toBe(3);
    for (const p of ["cookies", "storage", "alarms"]) expect(m.permissions).toContain(p);
    expect(m.host_permissions.some((h: string) => h.includes("netflix.com"))).toBe(true);
    // the bridge must be able to reach its WebFlix without baking every origin in
    expect((m.optional_host_permissions ?? []).some((h: string) => h.startsWith("https"))).toBe(true);
    expect(m.background?.service_worker).toBe("background.js");
  });

  test("the shipped zip exists in public/ (the download the app serves)", () => {
    expect(existsSync(new URL("../public/netflix-bridge.zip", import.meta.url).pathname)).toBe(true);
  });

  test("logic.js — toBridgeCookies maps chrome's jar to the broker shape", async () => {
    const { toBridgeCookies, cookieSignature: sig } = await import("../extension/webflix-bridge/logic.js");
    const mapped = toBridgeCookies([
      { name: "NetflixId", value: "v1", domain: ".netflix.com", path: "/", expirationDate: 1893456000, httpOnly: true, secure: true },
      { name: "junk", value: "x" },
    ]);
    expect(mapped).toHaveLength(2);
    expect(mapped[0].expires).toBe(1893456000);
    expect(sig(mapped)).not.toBeNull();
  });
});

// ---- the app proxy routes (stub upstream, house injectable-transport law) ----
const originalFetch = globalThis.fetch;
let brokerHandler: ((req: Request) => Promise<Response>) | null = null;
let brokerCalls: Array<{ url: string; method: string; body: string }> = [];

function installBroker(handler: ((req: Request) => Promise<Response>) | null) {
  brokerHandler = handler;
  brokerCalls = [];
  // @ts-expect-error — test seam
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("127.0.0.1:3030")) return originalFetch(input as never, init);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    brokerCalls.push({ url, method, body });
    if (!brokerHandler) throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:3030");
    return brokerHandler(new Request(url, { method, body, headers: init?.headers }));
  };
}

function postReq(url: string, body: unknown): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the app ingest/autoauth proxies", () => {
  afterEach(() => installBroker(null));

  test("ingest forwards token+cookies to the broker and passes the verdict through", async () => {
    installBroker(async (req) =>
      Response.json({ ok: true, applied: false, message: "Session queued — it connects automatically on the next play." }, { status: 200 }),
    );
    const res = await appIngestPost(postReq("/api/netflix/watch/ingest", { token: "tok", cookies: [{ name: "NetflixId", value: "v" }], device: "b" }));
    expect(res.status).toBe(200);
    expect(brokerCalls[0].url.endsWith("/ingest")).toBe(true);
    expect(JSON.parse(brokerCalls[0].body).token).toBe("tok");
    expect((await res.json()).message).toContain("queued");
  });

  test("ingest rejects a body without a token before touching the broker", async () => {
    installBroker(null);
    const res = await appIngestPost(postReq("/api/netflix/watch/ingest", { cookies: [] }));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("ingest degrades honestly (502) when the playback service is unreachable", async () => {
    installBroker(null);
    const res = await appIngestPost(postReq("/api/netflix/watch/ingest", { token: "t", cookies: [{ name: "NetflixId", value: "v" }] }));
    expect(res.status).toBe(502);
  });

  test("autoauth GET surfaces the pairing token + bridge status", async () => {
    installBroker(async (req) => Response.json({ token: "the-token", bridge: { candidatePending: false, lastBridgePushAt: null, lastBridgeDevice: null, lastRejection: null } }));
    const res = await autoauthGet();
    expect(res.status).toBe(200);
    expect(brokerCalls[0].url.endsWith("/ingest/token")).toBe(true);
    expect((await res.json()).token).toBe("the-token");
  });

  test("autoauth GET degrades honestly (503) with a null token when unreachable", async () => {
    installBroker(null);
    const res = await autoauthGet();
    expect(res.status).toBe(503);
    expect((await res.json()).token).toBeNull();
  });

  test("autoauth POST rotate forwards and returns the fresh token", async () => {
    installBroker(async () => Response.json({ ok: true, token: "fresh-token" }));
    const res = await autoauthPost(postReq("/api/netflix/watch/autoauth", { action: "rotate" }));
    expect(res.status).toBe(200);
    expect(brokerCalls[0].url.endsWith("/ingest/token/rotate")).toBe(true);
    expect((await res.json()).token).toBe("fresh-token");
  });

  test("autoauth POST rejects unknown actions", async () => {
    installBroker(null);
    const res = await autoauthPost(postReq("/api/netflix/watch/autoauth", { action: "explode" }));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });
});
