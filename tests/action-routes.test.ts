/**
 * WFX2-A-W tests — action routes with the broker client + direct path
 * MOCKED (no network, no live CDP): the ok path, the direct-first path,
 * the broker fallback, and the honest 502 offline mapping.
 */
import { beforeEach, describe, expect, test, mock } from "bun:test";

/* ------------------------------------------------------------------ */
/* mock the broker client + direct module BEFORE the routes load       */
/* ------------------------------------------------------------------ */

class MockBrokerError extends Error {
  kind: string;
  status: number;
  detail?: unknown;
  constructor(kind: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const brokerCalls: { kind: string; target: unknown; payload: unknown }[] = [];
let brokerResponse: unknown = { ok: true, verified: true, path: "ui" };

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerAction: async (kind: string, target: unknown, payload?: unknown) => {
    brokerCalls.push({ kind, target, payload });
    return typeof brokerResponse === "function"
      ? brokerResponse({ kind, target, payload })
      : brokerResponse;
  },
  brokerOk: (r: unknown) => !(r instanceof MockBrokerError),
  brokerUrl: () => "http://127.0.0.1:3055",
  brokerSecret: () => "s3cret",
  brokerConfigured: () => true,
  brokerTimeoutMs: () => 15000,
}));

const directCalls: { channelId: string; on: boolean }[] = [];
let directResponse: unknown = { ok: true };
let directConfigured = true;
let subscribedState: boolean | null = null;

mock.module("@/lib/youtube-direct", () => ({
  parseCookies: (raw: string) => {
    const out: Record<string, string> = {};
    for (const part of raw.split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  },
  cookieValue: () => "fake",
  directAuthConfigured: () => directConfigured,
  sapisidhash: () => "0_hash",
  subscribeChannel: async (channelId: string, on: boolean) => {
    directCalls.push({ channelId, on });
    return directResponse;
  },
  getSubscribedState: async () => subscribedState,
}));

/* routes (imported after the mocks) */
import { POST as postLike } from "@/app/api/videos/[id]/like/route";
import { POST as postSubscribe } from "@/app/api/subscribe/route";
import { POST as postWatchLater } from "@/app/api/playlists/watch-later/route";

const OFFLINE_MSG = "action backend offline — the lead's broker must be running";

beforeEach(() => {
  brokerCalls.length = 0;
  directCalls.length = 0;
  brokerResponse = { ok: true, verified: true, path: "ui" };
  directResponse = { ok: true };
  directConfigured = true;
  subscribedState = null;
});

import type { NextRequest } from "next/server";

const req = (body: unknown, url = "http://localhost/api/x"): NextRequest =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe("POST /api/videos/[id]/like (broker proxy)", () => {
  const ctx = { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) };

  test("ok path: legacy value=like maps to broker kind like; honest counts from baseline", async () => {
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: null } }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      likes: number;
      dislikes: number;
      yourLike: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("liked");
    expect(body.yourLike).toBe("like");
    expect(body.likes).toBe(6);
    expect(body.dislikes).toBe(0);
    expect(brokerCalls).toEqual([{ kind: "like", target: { videoId: "dQw4w9WgXcQ" }, payload: undefined }]);
  });

  test("toggle-off: broker already:true → remove-rating second call; yourLike null", async () => {
    const calls: string[] = [];
    brokerResponse = ({ kind }: { kind: string }) => {
      calls.push(kind);
      return { ok: true, verified: true, already: kind === "like", path: "ui" };
    };
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: "like" } }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { yourLike: string | null; likes: number };
    expect(body.yourLike).toBeNull();
    expect(body.likes).toBe(4);
    expect(calls).toEqual(["like", "remove-rating"]);
  });

  test("canonical action=none maps to remove-rating", async () => {
    const res = await postLike(req({ action: "none" }), ctx);
    expect(res.status).toBe(200);
    expect(brokerCalls[0].kind).toBe("remove-rating");
    const body = (await res.json()) as { yourLike: string | null; effect: string };
    expect(body.yourLike).toBeNull();
    expect(body.effect).toBe("rating-removed");
  });

  test("swap path: action=dislike with baseline yourLike=like swaps honestly", async () => {
    const res = await postLike(
      req({ value: "dislike", baseline: { likes: 5, dislikes: 2, yourLike: "like" } }),
      ctx
    );
    const body = (await res.json()) as { likes: number; dislikes: number; yourLike: string };
    expect(brokerCalls[0].kind).toBe("dislike");
    expect(body.yourLike).toBe("dislike");
    expect(body.likes).toBe(4);
    expect(body.dislikes).toBe(3);
  });

  test("broker down → 502 with the honest offline message", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });

  test("broker action-failure → 502 with the broker's message", async () => {
    brokerResponse = new MockBrokerError("action-failed", "like-button-not-found", 502);
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("like-button-not-found");
  });

  test("DOM-observed count wins over baseline math (likesLabel parsed)", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { likesLabel: "2.4M" } };
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: null } }),
      ctx
    );
    const body = (await res.json()) as { likes: number };
    expect(body.likes).toBe(2400000);
  });

  test("missing action/value → 400", async () => {
    const res = await postLike(req({}), ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/subscribe (direct-first, broker fallback)", () => {
  test("direct path: SAPISIDHASH subscribe verified §16 → path direct, no broker call", async () => {
    const res = await postSubscribe(req({ channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", on: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; subscribed: boolean; path: string };
    expect(body.ok).toBe(true);
    expect(body.subscribed).toBe(true);
    expect(body.path).toBe("direct");
    expect(directCalls).toEqual([{ channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", on: true }]);
    expect(brokerCalls).toHaveLength(0);
  });

  test("direct unconfigured → broker fallback (kind unsubscribe for on:false)", async () => {
    directConfigured = false;
    const res = await postSubscribe(req({ channelId: "UC1", on: false }));
    const body = (await res.json()) as { ok: boolean; subscribed: boolean; path: string };
    expect(body.subscribed).toBe(false);
    expect(body.path).toBe("broker");
    expect(brokerCalls[0].kind).toBe("unsubscribe");
  });

  test("direct fails → broker fallback", async () => {
    directResponse = { ok: false, status: 403 };
    const res = await postSubscribe(req({ channelId: "UC1", on: true }));
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("broker");
    expect(brokerCalls[0].kind).toBe("subscribe");
  });

  test("on omitted → toggle: state read + direct inverse", async () => {
    subscribedState = true; // currently subscribed → direct unsubscribes
    const res = await postSubscribe(req({ channelId: "UC1" }));
    const body = (await res.json()) as { subscribed: boolean };
    expect(body.subscribed).toBe(false);
    expect(directCalls).toEqual([{ channelId: "UC1", on: false }]);
  });

  test("toggle with unknown state + broker down → 502 honest", async () => {
    subscribedState = null;
    directConfigured = false;
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postSubscribe(req({ channelId: "UC1" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });

  test("channelId missing → 400", async () => {
    const res = await postSubscribe(req({ on: true }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/playlists/watch-later (broker watch-later)", () => {
  test("toggle mode by default; response keeps the {added, playlistId} contract", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { added: true } };
    const res = await postWatchLater(req({ videoId: "dQw4w9WgXcQ" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; added: boolean; playlistId: string };
    expect(body.ok).toBe(true);
    expect(body.added).toBe(true);
    expect(body.playlistId).toBe("WL");
    expect(brokerCalls[0].kind).toBe("watch-later");
    expect(brokerCalls[0].payload).toEqual({ mode: "toggle" });
  });

  test("add:false maps to remove mode", async () => {
    const res = await postWatchLater(req({ videoId: "dQw4w9WgXcQ", add: false }));
    expect(brokerCalls[0].payload).toEqual({ mode: "remove" });
    expect(res.status).toBe(200);
  });

  test("broker down → 502 honest", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postWatchLater(req({ videoId: "dQw4w9WgXcQ" }));
    expect(res.status).toBe(502);
  });
});
