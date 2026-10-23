/// <reference types="bun-types" />
/**
 * WFX2-P6-CR tests — the honest local comment rung, the read-path merge,
 * session resilience, and the UI disclosure:
 *
 *  - the three-rung chain on REAL modules + the real test DB: no
 *    YT_COOKIES/BROKER_URL → both YouTube tiers honestly offline → the
 *    LOCAL rung persists (local:true disclosed, shadow Video/Channel/User
 *    rows created, idempotent on second write);
 *  - the direct reply rung: the parent's replyParams + a configured session
 *    → create_comment with createCommentParams (mocked fetch, no network);
 *    direct failure falls through broker → local honestly;
 *  - the GET merge: local comments + replies appear with local:true, the
 *    header count adjusts, likes/read state stay honest, live threads never
 *    double-serve local rows (the setUpstream fixture seam — comments_dQw4);
 *  - session resilience: /api/watch/session NEVER 500s — missing fallback
 *    users and a dead User table both degrade to the anonymous viewer;
 *  - the UI disclosure (happy-dom): the WebFlix origin chip on local:true
 *    rows, the composer's "posted on WebFlix" toast, CommentsSection with a
 *    null viewer, and the watch page rendering the comments section while
 *    the session fetch fails (viewer stays null — the P6-CR regression).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* happy-dom as the global DOM (the comment-composer test pattern —     */
/* set before any component runs; the DB-backed route tests share it)   */
/* ------------------------------------------------------------------ */
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
  "React",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* toasts captured for the component tests (sonner stubbed — routes never toast) */
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

/* next/link → a plain <a> (no Next router in the bun test runtime).
 * The real module is captured via a top-level namespace import (bound before
 * mock.module swaps it) so afterAll can restore it. */
import * as RealNextLink from "next/link";
const realLink = RealNextLink as unknown as Record<string, unknown>;
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest } as Record<string, unknown>, children),
}));

/* the router stub for the watch-page component test (no Next router in bun) */
const navigations: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      navigations.push(url);
    },
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => "/watch/dQw4w9WgXcQ",
}));

import { setupTestDb, mintSessionCookie } from "./helpers";
import { db } from "../src/lib/db";
import type { CommentDto } from "@/lib/watch/types";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";

import { GET as sessionRoute } from "@/app/api/watch/session/route";
import { POST as postComment } from "@/app/api/comments/route";
import { GET as commentsRoute, POST as postVideoComment } from "@/app/api/videos/[id]/comments/route";
import { GET as repliesRoute } from "@/app/api/videos/[id]/comments/[commentId]/replies/route";
import { POST as likeCommentRoute } from "@/app/api/comments/[id]/like/route";
import { PATCH as patchCommentRoute, DELETE as deleteCommentRoute } from "@/app/api/comments/[id]/route";
import { POST as restoreCommentRoute } from "@/app/api/comments/[id]/restore/route";

setupTestDb();

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));
const nextDQw4 = load("next_dQw4");
const commentsDQw4 = load("comments_dQw4");

const VIDEO_ID = "dQw4w9WgXcQ";
const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";
/** the fixture's pinned first comment (live parent for the local reply) */
const LIVE_PARENT_ID = "Ugzge340dBgB75hWBm54AaABAg";
const LIVE_TOTAL = 2_457_856;

let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie();
});

const realFetch = globalThis.fetch;

beforeEach(() => {
  toasts.length = 0;
  delete process.env.YT_COOKIES;
  delete process.env.BROKER_URL;
  delete process.env.BROKER_SECRET;
});

afterEach(() => {
  setUpstream(null);
  clearCache();
  globalThis.fetch = realFetch;
});

/** the live-read upstream seam: the watch call (body.videoId) → the watch
 * fixture; continuation calls → the comments fixture (the cutover pattern). */
function serveLiveComments() {
  setUpstream(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/youtubei/v1/next")) {
      return json(body?.videoId ? nextDQw4 : commentsDQw4);
    }
    return new Response("not found", { status: 404 });
  });
}

const req = (
  body: unknown,
  method = "POST",
  url = "http://localhost/api/x",
  cookie = AUTH_COOKIE
): never =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

// ---------------------------------------------------------------------------

describe("WFX2-P6-CR — the local rung (both YouTube tiers offline, real modules)", () => {
  test("POST /api/comments: no session/broker → 201 local:true, path local, shadow rows created", async () => {
    const res = await postComment(
      req({
        videoId: VIDEO_ID,
        body: "stored on WebFlix, honestly",
        video: {
          title: "Rick Astley - Never Gonna Give You Up",
          channelId: CHANNEL_ID,
          channelHandle: "@RickAstleyYT",
          channelName: "Rick Astley",
          channelAvatarUrl: "https://yt3.ggpht.com/rick.jpg",
        },
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.local).toBe(true); // the origin disclosure — never claims YouTube
    expect(body.path).toBe("local");
    expect(body.effect).toBe("comment-created");
    expect(body.ok).toBe(true);
    expect(body.body).toBe("stored on WebFlix, honestly");
    expect(body.likes).toBe(0); // honest zero — never fabricated engagement
    expect(body.isOwn).toBe(true);
    expect(body.replyCount).toBe(0);
    expect(body.moderation).toBe("approved");
    // the author bridge: the session's shadow user (data-URI SVG avatar)
    expect(body.author.id).toBe("wf-u_wfx2_test");
    expect(body.author.handle).toMatch(/^wf_/);
    expect(body.author.name).toBe("Test Operator");
    expect(body.author.avatarUrl.startsWith("data:image/svg+xml")).toBe(true);

    // shadow rows: the honest mirror of the REAL video/channel
    const video = await db.video.findUniqueOrThrow({ where: { id: VIDEO_ID } });
    expect(video.channelId).toBe(CHANNEL_ID);
    expect(video.title).toBe("Rick Astley - Never Gonna Give You Up");
    expect(video.visibility).toBe("public");
    expect(video.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(video.videoUrl).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    const channel = await db.channel.findUniqueOrThrow({ where: { id: CHANNEL_ID } });
    expect(channel.name).toBe("Rick Astley");
    expect(channel.handle).toBe("RickAstleyYT");
    const user = await db.user.findUniqueOrThrow({ where: { id: "wf-u_wfx2_test" } });
    expect(user.handle).toMatch(/^wf_/);
    expect(user.name).toBe("Test Operator");
  });

  test("second write is idempotent on the shadow rows (no duplicates, real comment rows)", async () => {
    // fresh slate: earlier tests' rows on this video are not this test's subject
    await db.comment.deleteMany({ where: { videoId: VIDEO_ID } });
    const snapshot = { video: { title: "Rick Astley - Never Gonna Give You Up", channelId: CHANNEL_ID } };
    await postComment(req({ videoId: VIDEO_ID, body: "first", ...snapshot }));
    await postComment(req({ videoId: VIDEO_ID, body: "second", ...snapshot }));
    expect(await db.video.count({ where: { id: VIDEO_ID } })).toBe(1);
    expect(await db.channel.count({ where: { id: CHANNEL_ID } })).toBe(1);
    expect(await db.user.count({ where: { id: "wf-u_wfx2_test" } })).toBe(1);
    const rows = await db.comment.findMany({ where: { videoId: VIDEO_ID, parentId: null } });
    expect(rows.map((r) => r.body).sort()).toEqual(["first", "second"]);
  });

  test("reply to a LIVE YouTube comment: shadow parent anchor + the reply row (local:true)", async () => {
    const res = await postComment(
      req({
        videoId: VIDEO_ID,
        body: "a local reply to a live comment",
        parentId: LIVE_PARENT_ID,
        parentText: "can confirm: he never gave us up",
        video: { title: "Rick Astley - Never Gonna Give You Up", channelId: CHANNEL_ID },
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.local).toBe(true);
    expect(body.effect).toBe("comment-replied");
    expect(body.parentId).toBe(LIVE_PARENT_ID);
    // the shadow parent anchors the YouTube thread (never rendered itself)
    const anchor = await db.comment.findUniqueOrThrow({ where: { id: LIVE_PARENT_ID } });
    expect(anchor.videoId).toBe(VIDEO_ID);
    expect(anchor.body).toBe("can confirm: he never gave us up");
    expect(anchor.parentId).toBeNull();
    const reply = await db.comment.findFirstOrThrow({
      where: { videoId: VIDEO_ID, body: "a local reply to a live comment" },
    });
    expect(reply.parentId).toBe(LIVE_PARENT_ID);
  });

  test("reply with a parent on ANOTHER video is rejected honestly (400)", async () => {
    const { bbb, demo } = await (await import("./helpers")).fixtures();
    const otherVideoComment = await db.comment.create({
      data: { videoId: bbb.id, userId: demo.id, body: "a comment on another video" },
    });
    const res = await postComment(
      req({ videoId: VIDEO_ID, body: "bad parent", parentId: otherVideoComment.id, parentText: "x" })
    );
    expect(res.status).toBe(400); // no shadow rows, no silent cross-video write
  });

  test("the [id] route without a WebFlix session → the uniform 401 gate (no identity → no local write either)", async () => {
    const res = await postVideoComment(
      req({ body: "guest write" }, "POST", `http://localhost/api/videos/${VIDEO_ID}/comments`, ""),
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    expect(res.status).toBe(401); // no identity → never an anonymous local write
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
    expect(await db.comment.count({ where: { videoId: VIDEO_ID, body: "guest write" } })).toBe(0);
  });
});

describe("WFX2-P6-CR → P36 — the reply rung (replyParams + configured session → the LOCAL lane's own disclosure)", () => {
  test("replyParams + a configured session → the LOCAL lane discloses itself (the direct rung is retired by construction)", async () => {
    process.env.YT_COOKIES = "SAPISID=fake-sapisid; SID=x"; // even a configured operator session must NOT change the lane
    const fetchCalls: { url: string }[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      fetchCalls.push({ url: u });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await postComment(
      req({
        videoId: VIDEO_ID,
        body: "a reply through the local lane",
        parentId: LIVE_PARENT_ID,
        parentText: "can confirm: he never gave us up",
        replyParams: "Eh1VZ3pnZTM0MDBG-cmVwbHlwYXJhbXM",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.path).toBe("local"); // the local lane's own disclosure
    expect(body.local).toBe(true); // never claims a YouTube write
    expect(body.effect).toBe("comment-replied");
    expect(body.parentId).toBe(LIVE_PARENT_ID);
    // ZERO network on the write path — the direct create_comment rung is gone,
    // and no broker exists to fall to
    expect(fetchCalls).toHaveLength(0);
    // the reply persists locally, anchored under the shadow parent
    const reply = await db.comment.findFirstOrThrow({
      where: { videoId: VIDEO_ID, body: "a reply through the local lane" },
    });
    expect(reply.parentId).toBe(LIVE_PARENT_ID);
    expect(reply.moderation).toBe("approved");
  });

  test("a refusing network changes nothing: the LOCAL lane answers (the write is DB-only)", async () => {
    process.env.YT_COOKIES = "SAPISID=fake-sapisid; SID=x"; // even configured, the operator session is out of the write path
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const res = await postComment(
      req({
        videoId: VIDEO_ID,
        body: "fell all the way down",
        parentId: LIVE_PARENT_ID,
        parentText: "can confirm: he never gave us up",
        replyParams: "params-xyz",
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.local).toBe(true); // honest disclosure — the store is the lane, not a fallback
    expect(body.path).toBe("local");
  });

  test("replyParams absent → still the local lane, ZERO network (the params are optional)", async () => {
    process.env.YT_COOKIES = "SAPISID=fake-sapisid; SID=x";
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await postComment(
      req({ videoId: VIDEO_ID, body: "no params, no network call", parentId: LIVE_PARENT_ID, parentText: "x" })
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).path).toBe("local"); // the local lane needs no locator
    expect(fetches).toBe(0); // the write path never touches the network
  });
});

describe("WFX2-P6-CR — the GET merge (local rows join the live InnerTube read)", () => {
  test("local top-level PREPENDS (local:true), local replies nest under the live parent, counts adjust", async () => {
    // fresh slate: this test asserts exact positions + the exact adjusted total
    await db.comment.deleteMany({ where: { videoId: VIDEO_ID } });
    serveLiveComments();
    // one local top-level + one local reply under the fixture's pinned parent
    await postComment(
      req({
        videoId: VIDEO_ID,
        body: "a fresh WebFlix comment",
        video: { title: "Rick Astley - Never Gonna Give You Up", channelId: CHANNEL_ID },
      })
    );
    await postComment(
      req({
        videoId: VIDEO_ID,
        body: "a fresh WebFlix reply",
        parentId: LIVE_PARENT_ID,
        parentText: "can confirm: he never gave us up",
      })
    );

    const res = await commentsRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments`, {
        headers: { cookie: AUTH_COOKIE },
      }) as never,
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    // the local top-level is FIRST (the freshest), disclosed
    expect(page.items[0].local).toBe(true);
    expect(page.items[0].body).toBe("a fresh WebFlix comment");
    expect(page.items[0].author.id).toBe("wf-u_wfx2_test");
    expect(page.items[0].isOwn).toBe(true); // the read carries the session cookie
    // the live page follows, unchanged in order
    expect(page.items[1].local).toBeUndefined();
    expect(page.items[1].id).toBe(LIVE_PARENT_ID);
    // the header count adjusts by BOTH local rows
    expect(page.total).toBe(LIVE_TOTAL + 2);
    // the local reply nests under the live parent's thread, counts bumped
    const parent = page.items[1];
    expect(parent.replyCount).toBe(963 + 1);
    expect(parent.totalReplyCount).toBe(963 + 1);
    const nested = (parent.replies ?? []).find((r: any) => r.local);
    expect(nested).toBeDefined();
    expect(nested.body).toBe("a fresh WebFlix reply");
    expect(nested.parentId).toBe(LIVE_PARENT_ID);
    // likes stay honest: zero, yourLike null
    expect(page.items[0].likes).toBe(0);
    expect(page.items[0].yourLike).toBeNull();
  });

  test("anonymous read (no session cookie): local rows render, isOwn honestly false", async () => {
    serveLiveComments();
    await postComment(
      req({ videoId: VIDEO_ID, body: "anon-visible comment", video: { channelId: CHANNEL_ID } })
    );
    const res = await commentsRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments`) as never,
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    const page = (await res.json()) as any;
    expect(page.items[0].local).toBe(true);
    expect(page.items[0].isOwn).toBe(false); // anonymous viewer — not their row
  });

  test("the parentId path serves local replies when the live thread is empty (local parents)", async () => {
    serveLiveComments();
    const created = await postComment(
      req({ videoId: VIDEO_ID, body: "local thread head", video: { channelId: CHANNEL_ID } })
    );
    const head = (await created.json()) as any;
    await postComment(req({ videoId: VIDEO_ID, body: "nested local reply", parentId: head.id, parentText: "local thread head" }));

    // the local parent is not in the live payload → the local replies serve
    const res = await commentsRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments?parentId=${head.id}`) as never,
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    const page = (await res.json()) as any;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].body).toBe("nested local reply");
    expect(page.items[0].local).toBe(true);
    expect(page.items[0].parentId).toBe(head.id);
  });

  test("a live thread with replies never double-serves the local rows (no duplicates)", async () => {
    serveLiveComments();
    await postComment(
      req({ videoId: VIDEO_ID, body: "dup-guard reply", parentId: LIVE_PARENT_ID, parentText: "x" })
    );
    // the parent has a live thread → the parentId path serves the LIVE page
    const res = await commentsRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments?parentId=${LIVE_PARENT_ID}`) as never,
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    const page = (await res.json()) as any;
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((i: any) => i.local)).toBe(false); // inline nesting owns local replies
  });

  test("the dedicated replies route merges the same way (empty live thread → local replies)", async () => {
    serveLiveComments();
    const created = await postComment(
      req({ videoId: VIDEO_ID, body: "head for the nested route", video: { channelId: CHANNEL_ID } })
    );
    const head = (await created.json()) as any;
    await postComment(req({ videoId: VIDEO_ID, body: "reply for the nested route", parentId: head.id, parentText: "head for the nested route" }));
    const res = await repliesRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments/${head.id}/replies`) as never,
      { params: Promise.resolve({ id: VIDEO_ID, commentId: head.id }) } as never
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as any;
    expect(page.items.map((i: any) => i.body)).toEqual(["reply for the nested route"]);
    expect(page.items[0].local).toBe(true);
  });
});

describe("WFX2-P40 — the LOCAL-ROW ACTION TIER (like / edit / delete / restore on rows the store owns)", () => {
  const like = (id: string, body: unknown, cookie = AUTH_COOKIE) =>
    likeCommentRoute(
      req(body, "POST", `http://localhost/api/comments/${id}/like`, cookie),
      { params: Promise.resolve({ id }) } as never
    );
  const patch = (id: string, body: unknown, cookie = AUTH_COOKIE) =>
    patchCommentRoute(
      req(body, "PATCH", `http://localhost/api/comments/${id}`, cookie),
      { params: Promise.resolve({ id }) } as never
    );
  const del = (id: string, body: unknown, cookie = AUTH_COOKIE) =>
    deleteCommentRoute(
      req(body, "DELETE", `http://localhost/api/comments/${id}`, cookie),
      { params: Promise.resolve({ id }) } as never
    );
  const restore = (id: string, cookie = AUTH_COOKIE) =>
    restoreCommentRoute(
      req(undefined, "POST", `http://localhost/api/comments/${id}/restore`, cookie),
      { params: Promise.resolve({ id }) } as never
    );

  /** a fresh local top-level row + its id (the author = the session's shadow user). */
  async function createLocalRow(body: string): Promise<string> {
    const created = await postComment(req({ videoId: VIDEO_ID, body, video: { channelId: CHANNEL_ID } }));
    expect(created.status).toBe(201);
    return ((await created.json()) as any).id as string;
  }

  test("like on OWN local row → the store-backed tier: local:true, honest counts, toggle semantics", async () => {
    const id = await createLocalRow("likeable local row");
    const first = await like(id, { value: "like" });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(firstBody).toMatchObject({ ok: true, likes: 1, yourLike: "like", path: "local", local: true });
    // toggle: the same value removes the rating
    const second = await like(id, { value: "like" });
    const secondBody = (await second.json()) as any;
    expect(secondBody).toMatchObject({ ok: true, likes: 0, yourLike: null, local: true });
    // dislike never moves the visible like count
    const third = await like(id, { value: "dislike" });
    const thirdBody = (await third.json()) as any;
    expect(thirdBody).toMatchObject({ likes: 0, yourLike: "dislike" });
    // canonical SET semantics ride too
    const fourth = await like(id, { action: "none" });
    expect(((await fourth.json()) as any).yourLike).toBeNull();
  });

  test("like on a YOUTUBE comment (no local row) → the honest 501 youtube-unsupported", async () => {
    const res = await like(LIVE_PARENT_ID, { value: "like" });
    expect(res.status).toBe(501);
    const body = (await res.json()) as any;
    expect(body.kind).toBe("youtube-unsupported");
    expect(body.error).toContain("Liking YouTube comments");
  });

  test("the SHADOW-ANCHOR law: a live parent's anchor row NEVER takes the local tier (still the honest 501)", async () => {
    // replying to a live YouTube comment creates the FK anchor (moderation "shadow")
    const created = await postComment(
      req({ videoId: VIDEO_ID, body: "reply under a live parent", parentId: LIVE_PARENT_ID, parentText: "live parent text" })
    );
    expect(created.status).toBe(201);
    const anchor = await db.comment.findUnique({ where: { id: LIVE_PARENT_ID } });
    expect(anchor?.moderation).toBe("shadow");
    // the anchor stands for a YouTube comment — liking it stays unsupported
    const res = await like(LIVE_PARENT_ID, { value: "like" });
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).kind).toBe("youtube-unsupported");
  });

  test("edit own local row → body + edited:true, disclosed local:true; the read-back shows the new body", async () => {
    const id = await createLocalRow("the original text");
    const res = await patch(id, { body: "the edited text", videoId: VIDEO_ID, commentText: "the original text" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ ok: true, body: "the edited text", edited: true, path: "local", local: true });
    const row = await db.comment.findUnique({ where: { id } });
    expect(row?.body).toBe("the edited text");
    expect(row?.edited).toBe(true);
  });

  test("edit ANOTHER user's local row → 403 (the ownership law — never another identity's row)", async () => {
    const id = await createLocalRow("someone else will try to edit this");
    const otherCookie = await mintSessionCookie({
      sub: "u_wfx2_other",
      name: "Other Viewer",
      email: "other@webflix.test",
      avatarSeed: 44,
    });
    const res = await patch(id, { body: "hijacked", videoId: VIDEO_ID }, otherCookie);
    expect(res.status).toBe(403);
    expect((await db.comment.findUnique({ where: { id } }))?.body).toBe("someone else will try to edit this");
  });

  test("delete + restore own local row → soft delete, then the fresh DTO back (local:true, moderation approved)", async () => {
    const id = await createLocalRow("delete me then bring me back");
    const delRes = await del(id, { videoId: VIDEO_ID, commentText: "delete me then bring me back" });
    expect(delRes.status).toBe(200);
    expect(((await delRes.json()) as any)).toMatchObject({ ok: true, deleted: true, path: "local", local: true });
    expect((await db.comment.findUnique({ where: { id } }))?.moderation).toBe("deleted");
    const restoreRes = await restore(id);
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as any;
    expect(restored.local).toBe(true);
    expect(restored.moderation).toBe("approved");
    expect(restored.body).toBe("delete me then bring me back");
    expect((await db.comment.findUnique({ where: { id } }))?.moderation).toBe("approved");
  });

  test("restore a YOUTUBE id → the honest 501 (no restore path for YouTube comments)", async () => {
    const res = await restore(LIVE_PARENT_ID);
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).kind).toBe("youtube-unsupported");
  });

  test("the parentId CHILD merge: a local reply under a SERVED depth-1 row nests with its expander count (reload reachability)", async () => {
    serveLiveComments();
    // a local reply whose parent is one of the live rows the parentId page serves
    const SERVED_REPLY_ID = "UgxIOV-sXAchpKX94cB4AaABAg";
    const created = await postComment(
      req({ videoId: VIDEO_ID, body: "child of a served reply", parentId: SERVED_REPLY_ID, parentText: "served live reply" })
    );
    expect(created.status).toBe(201);
    // the parentId page for the live parent serves the fixture's rows — the
    // local child now nests under its served parent with the bumped count
    const res = await commentsRoute(
      new Request(`http://localhost/api/videos/${VIDEO_ID}/comments?parentId=${LIVE_PARENT_ID}`) as never,
      { params: Promise.resolve({ id: VIDEO_ID }) } as never
    );
    const page = (await res.json()) as any;
    const served = page.items.find((i: any) => i.id === SERVED_REPLY_ID);
    expect(served).toBeDefined();
    // the fixture's own toolbar count for this thread is 933 — the child
    // merge adds exactly +1 (934) and nests the local row under it
    expect(served.replyCount).toBe(934);
    expect(served.replies?.map((r: any) => r.body)).toContain("child of a served reply");
    expect(served.replies?.find((r: any) => r.local === true)?.body).toBe("child of a served reply");
    // the top-level served rows are NOT marked local themselves (only the child is)
    expect(served.local).toBeFalsy();
  });
});

describe("WFX2-P6-CR — session resilience (never 500)", () => {
  test("seeded fallback viewer serves 200 with the wfx2_uid cookie", async () => {
    const res = await sessionRoute(new Request("http://localhost/api/watch/session") as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.viewer.id).not.toBe(""); // the seeded demo/you fallback
    expect(data.operatorSession).toBe(false); // no YT_COOKIES in the test env
  });

  // the LAST tests of the file: they wipe the users (cascade) and finally
  // drop the User table — nothing DB-backed may run after them.
  test("fallback users missing → 200 with the honest anonymous viewer (no cookie)", async () => {
    await db.user.deleteMany({}); // cascade wipes comments/etc. — no fallback identity left
    const res = await sessionRoute(new Request("http://localhost/api/watch/session") as never);
    expect(res.status).toBe(200); // never a 500 — the P6-CR law
    const data = (await res.json()) as any;
    expect(data.viewer).toEqual({ id: "", handle: "@guest", name: "", avatarUrl: "" });
    expect(res.headers.get("set-cookie")).toBeNull(); // anonymous is never persisted
  });

  test("DB error (User table gone) → still 200 with the anonymous viewer", async () => {
    await db.$executeRawUnsafe('DROP TABLE "User"');
    const res = await sessionRoute(new Request("http://localhost/api/watch/session") as never);
    expect(res.status).toBe(200); // the query throws — the route degrades honestly
    const data = (await res.json()) as any;
    expect(data.viewer.handle).toBe("@guest");
    expect(data.viewer.id).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* UI disclosure — happy-dom component tests (the composer pattern)     */
/* ------------------------------------------------------------------ */

const COMMENT = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  parentId: null,
  body: "a local row",
  likes: 0,
  heartedByCreator: false,
  pinned: false,
  edited: false,
  moderation: "approved",
  createdAt: new Date().toISOString(),
  author: { id: "wf-u1", handle: "wf_u1", name: "Local Author", avatarUrl: "", isMember: false, isCreator: false },
  yourLike: null,
  isOwn: false,
  replyCount: 0,
  totalReplyCount: 0,
  ...over,
});

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://x/a.png" };

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const mount = async (el: React.ReactElement) => {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
};

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const text = (): string => (host ? host.textContent : "");

const unmount = () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
};

async function typeInto(ta: HTMLTextAreaElement, value: string) {
  await act(async () => {
    ta.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(ta);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(ta, value);
  await act(async () => {
    ta.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

describe("WFX2-P6-CR UI — the WebFlix origin chip (comment-row)", () => {
  const rowProps = (comment: CommentDto) => ({
    comment,
    videoId: VIDEO_ID,
    viewer: VIEWER,
    viewerIsCreator: false,
    creatorName: "Rick Astley",
    depth: 0,
    onDeleted: () => {},
    onReported: () => {},
    onChanged: () => {},
  });

  test("local:true rows render the chip with the honest disclosure title", async () => {
    const { CommentRow } = await import("@/components/watch/comment-row");
    await mount(<CommentRow {...rowProps(COMMENT({ local: true }))} />);
    const chip = all("span").find(
      (s) => (s.textContent ?? "").trim() === "WebFlix" && s.hasAttribute("title")
    );
    expect(chip).toBeDefined();
    expect(chip!.getAttribute("title")).toBe("Stored on WebFlix — not posted to YouTube");
    unmount();
  });

  test("live rows render NO chip (no false origin claims)", async () => {
    const { CommentRow } = await import("@/components/watch/comment-row");
    await mount(<CommentRow {...rowProps(COMMENT())} />);
    expect(all("span").some((s) => (s.textContent ?? "").trim() === "WebFlix")).toBe(false);
    unmount();
  });

  test("viewer:null rows still render (anonymous read parity)", async () => {
    const { CommentRow } = await import("@/components/watch/comment-row");
    await mount(<CommentRow {...rowProps(COMMENT({ local: true }))} viewer={null} />);
    expect(text()).toContain("a local row");
    expect(all("span").some((s) => (s.textContent ?? "").trim() === "WebFlix")).toBe(true);
    unmount();
  });
});

describe("WFX2-P40 UI — the reply-to-a-reply append (the depth-1 own-nesting law)", () => {
  const stubFetch201 = (response: unknown) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(response), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
  };

  /** mount a depth-1 reply row with NO onAppendReply (the pre-P40 wiring). */
  const mountDepth1Row = async (replyCount = 0) => {
    const { CommentRow } = await import("@/components/watch/comment-row");
    await mount(
      createElement(CommentRow, {
        comment: COMMENT({ id: "c1", parentId: "head1", body: "a live reply row", replyCount, local: false }),
        videoId: VIDEO_ID,
        viewer: VIEWER,
        viewerIsCreator: false,
        creatorName: "Rick Astley",
        depth: 1,
        onDeleted: () => {},
        onReported: () => {},
        onChanged: () => {},
      })
    );
    return CommentRow;
  };

  test("a reply submitted on a depth-1 row renders under it immediately (the silent-drop regression)", async () => {
    stubFetch201({
      ...COMMENT({
        id: "rr1",
        parentId: "c1",
        body: "the depth-two reply that must reflect",
        local: true,
        isOwn: true,
      }),
      ok: true,
      effect: "comment-replied",
      path: "local",
    });
    await mountDepth1Row(0);
    // open the inline reply composer (the row's Reply toggle renders at depth ≤ 1)
    const replyToggle = all("button").find((b) => (b.textContent ?? "").trim() === "Reply");
    expect(replyToggle).toBeDefined();
    await act(async () => {
      replyToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const ta = q("textarea") as unknown as HTMLTextAreaElement;
    expect(ta).toBeDefined();
    expect(ta.getAttribute("placeholder")).toBe("Add a reply...");
    await typeInto(ta, "the depth-two reply that must reflect");
    // submit via the COMPOSER's Reply button (the later one in DOM order)
    const replyButtons = all("button").filter((b) => (b.textContent ?? "").trim() === "Reply");
    const submit = replyButtons[replyButtons.length - 1] as HTMLButtonElement;
    expect(submit).toBeDefined();
    await act(async () => {
      submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // THE LAW: the fresh reply renders under the row at once (pre-P40 it was
    // silently dropped client-side — 201 server-side, nothing rendered)
    expect(text()).toContain("the depth-two reply that must reflect");
    // the expander count is honest before any reload: 0 live + 1 local = "1 reply"
    const expander = all("button").find((b) => /1\s*reply/.test((b.textContent ?? "").trim()));
    expect(expander).toBeDefined();
    unmount();
  });

  test("a depth-1 row with live children keeps its expander (replyCount > 0 still renders the nested block)", async () => {
    await mountDepth1Row(4);
    const expander = all("button").find((b) => /4\s*replies/.test((b.textContent ?? "").trim()));
    expect(expander).toBeDefined();
    unmount();
  });
});

describe("WFX2-P6-CR UI — the composer's local-write disclosure", () => {
  const stubFetch = (response: unknown) => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return new Response(
        JSON.stringify(
          typeof response === "function" ? response(body) : response
        ),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;
  };
  const submitButton = () =>
    all("button").find((b) => /^comment$/i.test((b.textContent ?? "").trim())) as
      | HTMLButtonElement
      | undefined;

  test("local:true response → 'Comment posted on WebFlix' toast", async () => {
    stubFetch((body: any) => ({ ...COMMENT({ body: body?.body, local: true }), id: "loc1" }));
    const { CommentComposer } = await import("@/components/watch/comment-composer");
    await mount(
      <CommentComposer videoId={VIDEO_ID} viewer={VIEWER} onSubmitted={() => {}} />
    );
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "hello local store");
    await act(async () => {
      submitButton()!.click();
    });
    expect(toasts).toContain("success:Comment posted on WebFlix");
    unmount();
  });

  test("reply local:true response → 'Reply posted on WebFlix'; YouTube-path writes stay silent", async () => {
    stubFetch((body: any) => ({ ...COMMENT({ body: body?.body, parentId: "p1", local: true }), id: "loc2" }));
    const { CommentComposer } = await import("@/components/watch/comment-composer");
    await mount(
      <CommentComposer videoId={VIDEO_ID} parentId="p1" parentText="parent" viewer={VIEWER} onSubmitted={() => {}} submitLabel="Reply" />
    );
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "a reply");
    await act(async () => {
      all("button").find((b) => /^reply$/i.test((b.textContent ?? "").trim()))!.click();
    });
    expect(toasts).toContain("success:Reply posted on WebFlix");
    unmount();

    // the YouTube path (no local flag) keeps the existing silent success
    toasts.length = 0;
    stubFetch((body: any) => ({ ...COMMENT({ body: body?.body }), id: "yt1" }));
    await mount(
      <CommentComposer videoId={VIDEO_ID} viewer={VIEWER} onSubmitted={() => {}} />
    );
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "a youtube comment");
    await act(async () => {
      submitButton()!.click();
    });
    expect(toasts).toEqual([]);
    unmount();
  });

  test("the submit forwards replyParams + the video snapshot additively", async () => {
    const sent: any[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return new Response(JSON.stringify({ ...COMMENT(), id: "x" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const { CommentComposer } = await import("@/components/watch/comment-composer");
    await mount(
      <CommentComposer
        videoId={VIDEO_ID}
        viewer={VIEWER}
        onSubmitted={() => {}}
        replyParams="the-live-reply-params"
        video={{ title: "Never Gonna Give You Up", channelId: CHANNEL_ID }}
      />
    );
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "with params");
    await act(async () => {
      submitButton()!.click();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].replyParams).toBe("the-live-reply-params");
    expect(sent[0].video).toEqual({ title: "Never Gonna Give You Up", channelId: CHANNEL_ID });
    unmount();
  });
});

describe("WFX2-P6-CR UI — CommentsSection with a null viewer (anonymous read)", () => {
  test("rows render read-only-ish and the composer keeps its gate states", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes(`/videos/${VIDEO_ID}/comments`)) {
        return new Response(
          JSON.stringify({
            items: [COMMENT({ id: "live1", body: "a live row for an anonymous viewer" })],
            nextCursor: null,
            total: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const { CommentsSection } = await import("@/components/watch/comments-section");
    await mount(
      <CommentsSection
        videoId={VIDEO_ID}
        viewer={null}
        viewerIsCreator={false}
        creatorName="Rick Astley"
        operatorSession={false}
        guest
      />
    );
    await act(async () => {}); // flush the load effect
    expect(q("section[aria-label='Comments']")).not.toBeNull();
    expect(text()).toContain("a live row for an anonymous viewer");
    expect(text()).toContain("Sign in to comment"); // the guest gate (P2-AU law kept)
    unmount();
  });
});

describe("WFX2-P6-CR UI — the watch page renders the comments section with a NULL viewer", () => {
  test("session fetch fails (viewer stays null) → comments still render (the P6-CR regression)", async () => {
    const DETAIL = {
      video: {
        id: VIDEO_ID,
        title: "Never Gonna Give You Up",
        description: "the description",
        videoUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
        durationSec: 213,
        views: 1_600_000_000,
        viewsText: "1.6B views",
        publishedText: "16 years ago",
        likeCountText: "19M",
        likes: 19_000_000,
        dislikes: 0,
        visibility: "public",
        category: "Music",
        createdAt: new Date().toISOString(),
        isMembersOnly: false,
        membersTier: null,
        isShort: false,
        isLive: false,
        premieredAt: null,
        channel: {
          id: CHANNEL_ID,
          handle: "RickAstleyYT",
          name: "Rick Astley",
          avatarUrl: "https://yt3.ggpht.com/rick.jpg",
          subscriberCount: 4_500_000,
          verified: true,
          subscriberCountText: "4.5M subscribers",
        },
      },
      state: {
        like: null,
        subscribed: false,
        bell: null,
        resumeSec: null,
        playlistIds: [],
        savedWatchLater: false,
        isCreator: false,
      },
    };
    const LOCAL_ROW = COMMENT({
      id: "loc-row",
      body: "a local row on the watch page",
      local: true,
    });
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      // the session bootstrap FAILS — viewer must stay null (the regression case)
      if (u.includes("/api/watch/session")) {
        return new Promise(() => {
          throw new TypeError("session fetch failed");
        });
      }
      if (u.includes("/api/auth/session")) {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.includes(`/videos/${VIDEO_ID}/comments`)) {
        return new Response(
          JSON.stringify({ items: [LOCAL_ROW], nextCursor: null, total: 1 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (u.includes(`/videos/${VIDEO_ID}/related`) || u.includes(`/videos/${VIDEO_ID}/transcript`)) {
        return new Response(JSON.stringify({ items: [], nextCursor: null, cues: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes(`/videos/${VIDEO_ID}`)) {
        return new Response(JSON.stringify(DETAIL), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const { WatchPage } = await import("@/components/watch/watch-page");
    await mount(<WatchPage videoId={VIDEO_ID} startAt={null} />);
    await act(async () => {});
    await act(async () => {}); // flush the bootstrap + comments load

    // THE regression: the section renders even though viewer is null
    expect(win.document.querySelector("section[aria-label='Comments']")).not.toBeNull();
    // the local row renders WITH its origin chip (title disclosure)
    const chip = Array.from(win.document.querySelectorAll("span")).find(
      (s) => (s.textContent ?? "").trim() === "WebFlix" && s.getAttribute("title")
    );
    expect(chip?.getAttribute("title")).toBe("Stored on WebFlix — not posted to YouTube");
    // the composer keeps its guest gate (P2-AU law untouched)
    expect(win.document.body.textContent).toContain("Sign in to comment");
    unmount();
  });
});

afterAll(() => {
  mock.module("sonner", () => ({ toast: () => {} }));
  mock.module("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => "/" }));
  mock.module("next/link", () => realLink);
});
