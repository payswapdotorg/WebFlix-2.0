/// <reference types="bun-types" />
/**
 * WFX2-B-S tests → WFX2-P36 re-point — the comment WRITE routes:
 *
 *  - comment create/reply: the honest LOCAL lane (the official Data API only
 *    lets channels comment on their own videos) — every write lands in the
 *    WebFlix store with local:true + path "local", backed by the real test
 *    DB (setupTestDb). The pre-P36 direct-SAPISIDHASH → broker ladder is
 *    retired with the shared operator identity itself (these routes import
 *    neither seam anymore).
 *  - comment like/edit/delete/heart/pin/report: the honest UNSUPPORTED lane —
 *    the routes render the proxies' 501 {error, kind:"youtube-unsupported"}
 *    verbatim (the broker DOM drives are retired; the report public-mode 403
 *    is retired with them).
 *
 * Mocked modules (no network, no live CDP): the watch-session viewer + the
 * watch-metadata/operator seams the creator-mode guards consume. Same
 * capture/restore pattern as action-routes.test.ts (bun's mock.module is
 * process-wide).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { setupTestDb, mintSessionCookie } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSession = { ...require("@/lib/watch/session") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realWatch = { ...require("@/lib/youtube/watch") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOperator = { ...require("@/lib/youtube/operator") } as Record<string, unknown>;

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://example.com/a.png" };

mock.module("@/lib/watch/session", () => ({
  resolveViewer: async () => VIEWER,
  resolveViewerFromHeaders: async () => null,
  VIEWER_COOKIE: "wfx2_uid",
  VIEWER_HEADER: "x-wfx2-user",
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
import { db } from "@/lib/db";

let AUTH_COOKIE = "";
beforeAll(async () => {
  // these write routes sit behind the auth gate — sign in
  AUTH_COOKIE = await mintSessionCookie();
});

setupTestDb();

beforeEach(() => {
  operatorChannel = null;
});

afterAll(() => {
  mock.module("@/lib/watch/session", () => realSession);
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

describe("POST /api/comments — comment create (the honest LOCAL lane)", () => {
  test("a signed-in comment lands in the WebFlix store: 201, local:true, path local — the direct/broker rungs are retired", async () => {
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "hello from WebFlix" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      body: string;
      path: string;
      local?: boolean;
      effect: string;
    };
    expect(body.ok).toBe(true);
    expect(body.body).toBe("hello from WebFlix");
    expect(body.path).toBe("local");
    expect(body.local).toBe(true); // origin disclosed — never a YouTube write claimed
    expect(body.effect).toBe("comment-created");
    expect(await db.comment.count({ where: { videoId: "dQw4w9WgXcQ", body: "hello from WebFlix" } })).toBe(1);
  });

  test("the author bridge: the row renders as the session's own comment (isOwn + the wf_ shadow author)", async () => {
    const res = await postComment(req({ videoId: "dQw4w9WgXcQ", body: "via the author bridge" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      isOwn: boolean;
      author: { id: string; handle: string; name: string };
    };
    expect(body.ok).toBe(true);
    expect(body.isOwn).toBe(true); // own-comment rendering with the session identity
    expect(body.author.id).toBe("wf-u_wfx2_test");
    expect(body.author.handle).toMatch(/^wf_/);
    expect(body.author.name).toBe("Test Operator");
  });

  test("the video snapshot creates the shadow Video/Channel rows (the honest mirror of the real video)", async () => {
    const res = await postComment(
      req({
        videoId: "vidShadow1",
        body: "with a snapshot",
        video: { title: "The Real Title", channelId: "UCShadowChan1", channelName: "Shadow Channel" },
      })
    );
    expect(res.status).toBe(201);
    const video = await db.video.findUniqueOrThrow({ where: { id: "vidShadow1" } });
    expect(video.title).toBe("The Real Title");
    expect(video.channelId).toBe("UCShadowChan1");
    const channel = await db.channel.findUniqueOrThrow({ where: { id: "UCShadowChan1" } });
    expect(channel.name).toBe("Shadow Channel");
  });

  test("the local row keeps honest zero engagement (likes 0, moderation approved)", async () => {
    const res = await postComment(
      req({ videoId: "dQw4w9WgXcQ", body: "kept on WebFlix", video: { title: "t" } })
    );
    expect(res.status).toBe(201); // never a dead end — the honest local store
    const body = (await res.json()) as { local?: boolean; path?: string; effect?: string; likes?: number; moderation?: string };
    expect(body.local).toBe(true);
    expect(body.path).toBe("local");
    expect(body.effect).toBe("comment-created");
    expect(body.likes).toBe(0); // honest zero — never fabricated engagement
    expect(body.moderation).toBe("approved");
  });

  test("reply shape: parentId + parentText → the LOCAL reply with the shadow parent anchor", async () => {
    const res = await postComment(
      req({ videoId: "dQw4w9WgXcQ", body: "a reply", parentId: "Ugx123", parentText: "parent text" })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { effect: string; parentId: string; local?: boolean; path?: string };
    expect(body.effect).toBe("comment-replied");
    expect(body.parentId).toBe("Ugx123");
    expect(body.local).toBe(true);
    expect(body.path).toBe("local");
    // the shadow parent anchors the YouTube thread; the reply persists under it
    const anchor = await db.comment.findUniqueOrThrow({ where: { id: "Ugx123" } });
    expect(anchor.body).toBe("parent text");
    const reply = await db.comment.findFirstOrThrow({ where: { videoId: "dQw4w9WgXcQ", body: "a reply" } });
    expect(reply.parentId).toBe("Ugx123");
    expect(reply.moderation).toBe("approved");
  });

  test("replyParams is accepted (the composer's forwarding contract) but the write stays LOCAL — no YouTube claim", async () => {
    const res = await postComment(
      req({
        videoId: "dQw4w9WgXcQ",
        body: "reply with params",
        parentId: "Ugx456",
        parentText: "p",
        replyParams: "Eh1VZ3pnZTM0MGRCZy1yZXBseXBhcmFtcw==",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { path?: string; local?: boolean; effect?: string };
    expect(body.path).toBe("local"); // the local lane needs no locator — params are forwarded shape only
    expect(body.local).toBe(true);
    expect(body.effect).toBe("comment-replied");
    expect(
      await db.comment.count({ where: { videoId: "dQw4w9WgXcQ", body: "reply with params" } }),
    ).toBe(1);
  });

  test("no replyParams → still the honest local lane (the params are optional)", async () => {
    const res = await postComment(
      req({ videoId: "dQw4w9WgXcQ", body: "no params", parentId: "Ugx789", parentText: "p" })
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { path: string }).path).toBe("local");
    expect(await db.comment.count({ where: { videoId: "dQw4w9WgXcQ", body: "no params" } })).toBe(1);
  });

  test("guest (no WebFlix session) → 401 — the local lane is identity-bound, never anonymous", async () => {
    const res = await postComment(
      new Request("http://localhost/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: "dQw4w9WgXcQ", body: "guest write" }),
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(401);
    expect(await db.comment.count({ where: { videoId: "dQw4w9WgXcQ", body: "guest write" } })).toBe(0);
  });

  test("empty body / missing videoId / over-limit body → 400", async () => {
    expect((await postComment(req({ videoId: "dQw4w9WgXcQ", body: "   " }))).status).toBe(400);
    expect((await postComment(req({ body: "no video" }))).status).toBe(400);
    const long = "x".repeat(10_001);
    expect((await postComment(req({ videoId: "dQw4w9WgXcQ", body: long }))).status).toBe(400);
    expect(await db.comment.count({ where: { body: long } })).toBe(0);
  });
});

describe("PATCH /api/comments/[id] — the honest UNSUPPORTED lane (edit)", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("the edit answers the honest 501 {error, kind: youtube-unsupported} — the broker DOM drive is retired", async () => {
    const res = await patchComment(
      req({ body: "new text", videoId: "dQw4w9WgXcQ", commentText: "old text" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Editing YouTube comments isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
  });

  test("an edit carrying the full locator still answers the same honest 501 (never a broker drive)", async () => {
    const res = await patchComment(
      req({ body: "x", videoId: "dQw4w9WgXcQ", commentText: "locator text" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(501);
    expect(((await res.json()) as { kind?: string }).kind).toBe("youtube-unsupported");
  });

  test("missing videoId → 400 (validation precedes the verdict)", async () => {
    const res = await patchComment(req({ body: "x" }, "PATCH"), ctx(id));
    expect(res.status).toBe(400);
  });

  test("empty body → 400 (zod validation)", async () => {
    const res = await patchComment(
      req({ body: "", videoId: "dQw4w9WgXcQ" }, "PATCH"),
      ctx(id)
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/comments/[id] — the honest UNSUPPORTED lane (delete)", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("the delete answers the honest 501 {error, kind: youtube-unsupported}", async () => {
    const res = await deleteComment(
      req({ videoId: "dQw4w9WgXcQ", commentText: "to delete" }, "DELETE"),
      ctx(id)
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Deleting YouTube comments isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
  });

  test("a delete with the commentText locator → the same honest 501 (the DOM-path era is retired)", async () => {
    const res = await deleteComment(
      req({ videoId: "dQw4w9WgXcQ", commentText: "located" }, "DELETE"),
      ctx(id)
    );
    expect(res.status).toBe(501);
    expect(((await res.json()) as { kind?: string }).kind).toBe("youtube-unsupported");
  });

  test("missing videoId → 400", async () => {
    const res = await deleteComment(req({}, "DELETE"), ctx(id));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/comments/[id]/heart — creator guard + the honest UNSUPPORTED lane", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("public mode (not the video's channel) → 403 creator-only", async () => {
    const res = await postHeart(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/channel owner/i);
  });

  test("creator mode (the operator session IS the channel) → the honest 501 — creator hearts have no official end-user API", async () => {
    operatorChannel = "UCuAXFkgsw1L7xaCfnd5JJOw";
    const res = await postHeart(
      req({ videoId: "dQw4w9WgXcQ", commentText: "nice one" }),
      ctx(id)
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Creator hearts isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
  });

  test("session present but operator is NOT the channel → 403", async () => {
    operatorChannel = "UCsomeOtherChannel00000000";
    const res = await postHeart(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
  });

  test("missing videoId → 400", async () => {
    const res = await postHeart(req({}), ctx(id));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/comments/[id]/pin — creator guard + the honest UNSUPPORTED lane", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("creator mode → the honest 501 — pinning is channel moderation on YouTube's own surface", async () => {
    operatorChannel = "UCuAXFkgsw1L7xaCfnd5JJOw";
    const res = await postPin(req({ videoId: "dQw4w9WgXcQ", commentText: "pin me" }), ctx(id));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Pinning comments isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
  });

  test("public mode → 403 creator-only", async () => {
    const res = await postPin(req({ videoId: "dQw4w9WgXcQ" }), ctx(id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/channel owner/i);
  });
});

describe("POST /api/comments/[id]/report — the honest UNSUPPORTED lane (the public-mode 403 retired)", () => {
  const id = "Ugzge340dBgB75hWBm54AaABAg";

  test("a signed-in report answers the honest 501 {error, kind: youtube-unsupported} — the broker DOM drive is retired", async () => {
    const res = await postReport(
      req({ videoId: "dQw4w9WgXcQ", commentText: "spammy", reason: "spam or misleading" }),
      ctx(id)
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Reporting YouTube comments isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
  });

  test("an unknown reason label → the same honest 501 (the dialog's default row never reaches a broker)", async () => {
    const res = await postReport(
      req({ videoId: "dQw4w9WgXcQ", reason: "not-a-known-label" }),
      ctx(id)
    );
    expect(res.status).toBe(501);
    expect(((await res.json()) as { kind?: string }).kind).toBe("youtube-unsupported");
  });

  test("missing videoId → 400", async () => {
    const res = await postReport(req({}), ctx(id));
    expect(res.status).toBe(400);
  });
});
