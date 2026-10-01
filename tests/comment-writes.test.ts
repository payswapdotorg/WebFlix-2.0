/// <reference types="bun-types" />
/**
 * WFX2-B-S tests — the comment WRITE routes with the broker client, the
 * direct path, the creator-mode guards and the session module MOCKED (no
 * network, no live CDP, no DB): the ok paths, direct-first vs broker
 * fallback, honest 502 offline mapping, the needs-session degrade, and the
 * creator-only heart/pin guard.
 *
 * Same mock pattern as action-routes.test.ts (real modules captured and
 * re-installed in afterAll — bun's mock.module is process-wide).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";
import type { NextRequest } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realBroker = { ...require("@/lib/broker") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realDirect = { ...require("@/lib/youtube-direct") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSession = { ...require("@/lib/watch/session") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realYtSession = { ...require("@/lib/youtube/session") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realWatch = { ...require("@/lib/youtube/watch") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOperator = { ...require("@/lib/youtube/operator") } as Record<string, unknown>;

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

const directCalls: { videoId: string; text: string }[] = [];
let directResponse: unknown = { ok: true };
let directConfigured = false;

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
  subscribeChannel: async () => ({ ok: true }),
  getSubscribedState: async () => null,
  createComment: async (videoId: string, text: string) => {
    directCalls.push({ videoId, text });
    return directResponse;
  },
}));

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://example.com/a.png" };

mock.module("@/lib/watch/session", () => ({
  resolveViewer: async () => VIEWER,
  resolveViewerFromHeaders: async () => null,
  VIEWER_COOKIE: "wfx2_uid",
  VIEWER_HEADER: "x-wfx2-user",
}));

let sessionConfigured = false;
mock.module("@/lib/youtube/session", () => ({
  getCookieHeader: () => (sessionConfigured ? "SAPISID=fake; VISITOR_INFO=1" : null),
  hasSession: () => sessionConfigured,
}));

const WATCH_META = {
  video: { id: "dQw4w9WgXcQ", title: "t", channel: { id: "UCuAXFkgsw1L7xaCfnd5JJOw" } },
  state: {},
};
let operatorChannel: string | null = null;

mock.module("@/lib/youtube/watch", () => ({
  getWatchMetadata: async () => WATCH_META,
  watchResponse: async () => ({}),
  getVideoDetail: async () => null,
  mapWatchMetadata: () => WATCH_META,
}));

mock.module("@/lib/youtube/operator", () => ({
  operatorChannelId: async () => operatorChannel,
  operatorIsCreator: async (channelId: string | null) =>
    operatorChannel !== null && operatorChannel === channelId,
  extractChannelIdFromHtml: () => null,
}));

/* routes (imported after the mocks) */
import { POST as postComment } from "@/app/api/comments/route";
import { PATCH as patchComment, DELETE as deleteComment } from "@/app/api/comments/[id]/route";
import { POST as postHeart } from "@/app/api/comments/[id]/heart/route";
import { POST as postPin } from "@/app/api/comments/[id]/pin/route";
import { POST as postReport } from "@/app/api/comments/[id]/report/route";
import { mintSessionCookie } from "./helpers";

const OFFLINE_MSG = "action backend offline — the lead's broker must be running";

let AUTH_COOKIE = "";
beforeAll(async () => {
  // WFX2-P2-AU: these write routes sit behind the auth gate — sign in
  AUTH_COOKIE = await mintSessionCookie();
});

beforeEach(() => {
  brokerCalls.length = 0;
  directCalls.length = 0;
  brokerResponse = { ok: true, verified: true, path: "ui" };
  directResponse = { ok: true };
  directConfigured = false;
  sessionConfigured = false;
  operatorChannel = null;
});

afterAll(() => {
  mock.module("@/lib/broker", () => realBroker);
  mock.module("@/lib/youtube-direct", () => realDirect);
  mock.module("@/lib/watch/session", () => realSession);
  mock.module("@/lib/youtube/session", () => realYtSession);
  mock.module("@/lib/youtube/watch", () => realWatch);
  mock.module("@/lib/youtube/operator", () => realOperator);
});

const req = (body: unknown, method = "POST", url = "http://localhost/api/x"): NextRequest =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/comments — comment create (direct-first, broker fallback)", () => {
  test("direct path: SAPISIDHASH create_comment ok → path direct, no broker call", async () => {
    directConfigured = true;
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "hello from WebFlix" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; body: string; path: string; effect: string };
    expect(body.ok).toBe(true);
    expect(body.body).toBe("hello from WebFlix");
    expect(body.path).toBe("direct");
    expect(body.effect).toBe("comment-created");
    expect(directCalls).toEqual([{ videoId: "dQw4w9WgXcQ", text: "hello from WebFlix" }]);
    expect(brokerCalls).toHaveLength(0);
  });

  test("direct unconfigured → broker comment-create (kind + target + text)", async () => {
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "via broker" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; path: string; isOwn: boolean };
    expect(body.ok).toBe(true);
    expect(body.path).toBe("ui");
    expect(body.isOwn).toBe(true); // own-comment rendering with the viewer identity
    expect(brokerCalls).toEqual([
      { kind: "comment-create", target: { videoId: "dQw4w9WgXcQ" }, payload: { text: "via broker" } },
    ]);
  });

  test("direct fails → broker fallback (honest path switch)", async () => {
    directConfigured = true;
    directResponse = { ok: false, status: 403 };
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "retry via broker" }));
    expect(res.status).toBe(201);
    expect(brokerCalls[0].kind).toBe("comment-create");
  });

  test("reply shape: parentId + parentText → broker comment-reply with commentText locator", async () => {
    const res = await postComment(
      req({ videoId: "dQw4w9WgXcQ", body: "a reply", parentId: "Ugx123", parentText: "parent text" })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { effect: string; parentId: string };
    expect(body.effect).toBe("comment-replied");
    expect(body.parentId).toBe("Ugx123");
    expect(brokerCalls).toEqual([
      {
        kind: "comment-reply",
        target: { commentId: "Ugx123", videoId: "dQw4w9WgXcQ" },
        payload: { text: "a reply", commentText: "parent text" },
      },
    ]);
  });

  test("broker offline → 502 with the honest offline message", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "x" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });

  test("empty body / missing videoId / over-limit body → 400", async () => {
    expect((await postComment(req({ videoId: "dQw4w9WgXcQ", body: "   " }))).status).toBe(400);
    expect((await postComment(req({ body: "no video" }))).status).toBe(400);
    const long = "x".repeat(10_001);
    expect((await postComment(req({ videoId: "dQw4w9WgXcQ", body: long }))).status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });
});

describe("PATCH /api/comments/[id] — comment edit (broker ⋮ → Edit DOM path)", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("ok path: broker comment-edit with the locator payload; edited DTO back", async () => {
    const res = await patchComment(
      req({ body: "new text", videoId: "dQw4w9WgXcQ", commentText: "old text" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; effect: string; body: string; edited: boolean };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("comment-edited");
    expect(body.body).toBe("new text");
    expect(body.edited).toBe(true);
    expect(brokerCalls).toEqual([
      {
        kind: "comment-edit",
        target: { commentId: id, videoId: "dQw4w9WgXcQ" },
        payload: { text: "new text", commentText: "old text" },
      },
    ]);
  });

  test("missing videoId → 400 (the DOM path needs the watch page)", async () => {
    const res = await patchComment(req({ body: "x" }, "PATCH"), ctx(id));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("empty body → 400 (zod validation)", async () => {
    const res = await patchComment(
      req({ body: "", videoId: "dQw4w9WgXcQ" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(400);
  });

  test("broker offline → 502 honest", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await patchComment(
      req({ body: "x", videoId: "dQw4w9WgXcQ" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });
});

describe("DELETE /api/comments/[id] — comment delete (⋮ → Delete → confirm)", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("ok path: broker comment-delete with videoId + commentText locator", async () => {
    const res = await deleteComment(
      req({ videoId: "dQw4w9WgXcQ", commentText: "to delete" }, "DELETE"),
      ctx(id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: boolean; effect: string };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);
    expect(body.effect).toBe("comment-deleted");
    expect(brokerCalls).toEqual([
      {
        kind: "comment-delete",
        target: { commentId: id, videoId: "dQw4w9WgXcQ" },
        payload: { commentText: "to delete" },
      },
    ]);
  });

  test("missing videoId → 400", async () => {
    const res = await deleteComment(req({}, "DELETE"), ctx(id));
    expect(res.status).toBe(400);
  });

  test("broker offline → 502 honest", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await deleteComment(
      req({ videoId: "dQw4w9WgXcQ" }, "DELETE"),
      ctx(id)
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /api/comments/[id]/heart — creator-mode guard + broker heart", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("public mode (no operator session) → 403 creator-only, no broker call", async () => {
    const res = await postHeart(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/channel owner/i);
    expect(brokerCalls).toHaveLength(0);
  });

  test("creator mode (operator session IS the channel) → broker comment-heart", async () => {
    sessionConfigured = true;
    operatorChannel = "UCuAXFkgsw1L7xaCfnd5JJOw";
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { hearted: true } };
    const res = await postHeart(
      req({ videoId: "dQw4w9WgXcQ", commentText: "nice one" }),
      ctx(id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; heartedByCreator: boolean; effect: string };
    expect(body.heartedByCreator).toBe(true);
    expect(body.effect).toBe("comment-hearted");
    expect(brokerCalls).toEqual([
      {
        kind: "comment-heart",
        target: { commentId: id, videoId: "dQw4w9WgXcQ" },
        payload: { commentText: "nice one" },
      },
    ]);
  });

  test("session present but operator is NOT the channel → 403", async () => {
    sessionConfigured = true;
    operatorChannel = "UCsomeOtherChannel00000000";
    const res = await postHeart(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    expect(brokerCalls).toHaveLength(0);
  });

  test("missing videoId → 400", async () => {
    const res = await postHeart(req({}), ctx(id));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/comments/[id]/pin — creator-mode guard + broker pin", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("creator mode → broker comment-pin; pinned flows from the broker detail", async () => {
    sessionConfigured = true;
    operatorChannel = "UCuAXFkgsw1L7xaCfnd5JJOw";
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { pinned: true } };
    const res = await postPin(req({ videoId: "dQw4w9WgXcQ", commentText: "pin me" }), ctx(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pinned: boolean; effect: string };
    expect(body.pinned).toBe(true);
    expect(body.effect).toBe("comment-pinned");
    expect(brokerCalls).toEqual([
      {
        kind: "comment-pin",
        target: { commentId: id, videoId: "dQw4w9WgXcQ" },
        payload: { commentText: "pin me" },
      },
    ]);
  });

  test("public mode → 403 creator-only", async () => {
    const res = await postPin(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    expect(brokerCalls).toHaveLength(0);
  });
});

describe("POST /api/comments/[id]/report — needs-session degrade + broker report", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("public mode → 403 needsSession (honest, no fake reported state)", async () => {
    const res = await postReport(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; needsSession: boolean };
    expect(body.needsSession).toBe(true);
    expect(body.error).toMatch(/operator's YouTube session/i);
    expect(brokerCalls).toHaveLength(0);
  });

  test("session present → broker comment-report with the canonical reason label", async () => {
    sessionConfigured = true;
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { reason: "Spam or misleading" } };
    const res = await postReport(
      req({ videoId: "dQw4w9WgXcQ", commentText: "spammy", reason: "spam or misleading" }),
      ctx(id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reported: boolean; reason: string };
    expect(body.ok).toBe(true);
    expect(body.reported).toBe(true);
    expect(body.reason).toBe("Spam or misleading");
    expect(brokerCalls).toEqual([
      {
        kind: "comment-report",
        target: { commentId: id, videoId: "dQw4w9WgXcQ" },
        payload: { commentText: "spammy", reason: "Spam or misleading" },
      },
    ]);
  });

  test("unknown reason label → broker still called with no reason (dialog default row)", async () => {
    sessionConfigured = true;
    const res = await postReport(
      req({ videoId: "dQw4w9WgXcQ", reason: "not-a-known-label" }),
      ctx(id)
    );
    expect(res.status).toBe(200);
    expect(brokerCalls[0].payload).toEqual({});
  });

  test("missing videoId → 400", async () => {
    sessionConfigured = true;
    const res = await postReport(req({}), ctx(id));
    expect(res.status).toBe(400);
  });
});
