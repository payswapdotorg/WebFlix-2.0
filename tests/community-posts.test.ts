/// <reference types="bun-types" />
/**
 * WFX2-P2-SO tests — the Community/Posts social surface, end-to-end:
 *
 *  - the wall LADDER ordering: browse-healthy → walled → broker-read →
 *    last-good → honest-empty (the source flag per rung, never a lie);
 *  - the Tier-2 broker-read transport: the logged-in browser's own
 *    community-tab ytInitialData → the EXISTING mapCommunityPosts mapper →
 *    the DTO (one mapper, two transports — no duplicate parsing);
 *  - the mapper extensions: poll attachment, image grid, author avatar;
 *  - the post COMMENTS read (the post-detail browse → the same comment
 *    continuation walking, paged + sorted + honest walled degrade);
 *  - the new broker kinds' request shapes at the route layer (post-like,
 *    post-comment-create, post-comment-like, post-create) with the broker
 *    client MOCKED (no network, no live CDP — the comment-writes pattern);
 *  - the composer's gating state machine (canSubmitPost).
 *
 * Fixture bytes via setUpstream() + the Upstash fake via setUpstashRest()
 * (never the network).
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";

// ---- the broker client MOCK (installed before the route imports) ----
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
/** per-test broker behavior: an error factory or a success object */
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
  brokerCommunityRead: async (handle: string, channelId?: string) => {
    brokerCalls.push({
      kind: "community-read",
      target: { ...(channelId ? { channelId } : {}) },
      payload: { handle },
    });
    return typeof brokerResponse === "function"
      ? brokerResponse({ kind: "community-read", target: { channelId }, payload: { handle } })
      : brokerResponse;
  },
  brokerOk: (r: unknown) => !(r instanceof MockBrokerError),
  brokerUrl: () => "http://127.0.0.1:3055",
  brokerSecret: () => "s3cret",
  brokerConfigured: () => true,
  brokerTimeoutMs: () => 15000,
}));

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://example.com/a.png" };
mock.module("@/lib/watch/session", () => ({
  resolveViewer: async () => VIEWER,
  resolveViewerFromHeaders: async () => null,
  VIEWER_COOKIE: "wfx2_uid",
  VIEWER_HEADER: "x-wfx2-user",
}));

let operatorOwns = false;
mock.module("@/lib/youtube/operator", () => ({
  operatorChannelId: async () => (operatorOwns ? "UCuAXFkgsw1L7xaCfnd5JJOw" : null),
  operatorIsCreator: async (channelId: string | null) =>
    operatorOwns && channelId === "UCuAXFkgsw1L7xaCfnd5JJOw",
  extractChannelIdFromHtml: () => null,
}));

/* routes + libs (imported after the mocks) */
import { GET as tabRoute } from "@/app/api/channel/[handle]/tab/route";
import { GET as getPostCommentsRoute } from "@/app/api/posts/[postId]/comments/route";
import { POST as postComment } from "@/app/api/posts/[postId]/comments/route";
import { POST as postLikeRoute } from "@/app/api/posts/[postId]/like/route";
import { POST as postCommentLikeRoute } from "@/app/api/posts/[postId]/comments/[commentId]/like/route";
import { POST as createPostRoute } from "@/app/api/posts/route";
import { mapBackstagePost, mapCommunityPosts, mapBackstagePoll, mapBackstageImages } from "@/lib/youtube/channel-tabs";
import {
  communityBrowseHealthy,
  communityBrowserPayloadHealthy,
  communityCacheKey,
} from "@/lib/youtube/community";
import { canSubmitPost } from "@/components/community/post-composer";
import { parseCompactCount } from "@/lib/community/action-proxy";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setUpstashRest, type UpstashRest } from "@/lib/youtube/upstash-cache";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const channel = load("channel_rickastley");
const posts = load("channel_posts_rickastley");
const browserPayload = load("community_browser_synthetic");
const postDetail = load("post_detail_synthetic");
const postCommentsPage = load("post_comments_page_synthetic");
const searchLofi = load("search_lofi"); // zero channel renderers — the wall signature

const OFFLINE_MSG = "action backend offline — the lead's broker must be running";
const RICK_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";

// ---------------------------------------------------------------------------
// the fixture upstream (with per-test wall toggles)
// ---------------------------------------------------------------------------

interface Recorded {
  url: string;
  body: any;
}

function fixtureUpstream() {
  const recorded: Recorded[] = [];
  let communityBrowseWalled = false; // the 200-but-empty wall shape
  let ssrWalled = false; // the @handle resolution wall (404)
  const htmlFor = (data: unknown) =>
    `<!doctype html><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.includes("/youtubei/v1/search")) return json(searchLofi);
    if (url.includes("/youtubei/v1/browse")) {
      // the post detail + comments continuations (the post-comments read)
      if (body?.continuation) {
        return json(postCommentsPage);
      }
      if (typeof body?.browseId === "string" && body.browseId.startsWith("UgkxSYNTHETIC")) {
        return json(postDetail);
      }
      const params = String(body?.params ?? "");
      if (params.includes("EgVwb3N0c")) {
        // the community tab browse: healthy posts, or the walled 200-empty shape
        return json(communityBrowseWalled ? {} : posts);
      }
      return json(channel); // the channel home (resolution)
    }
    if (url.includes("youtube.com/@")) {
      if (ssrWalled) return new Response("not found", { status: 404 });
      return new Response(htmlFor(channel), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
  return {
    impl,
    recorded,
    wallCommunity: (v: boolean) => (communityBrowseWalled = v),
    wallSsr: (v: boolean) => (ssrWalled = v),
  };
}

/** An in-memory fake of the Upstash REST pipeline endpoint. */
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

/** Pre-seed the fake with a last-good envelope (stale soft, live hard). */
function seedLastGood(store: Map<string, string>, key: string, value: unknown): void {
  store.set(
    key,
    JSON.stringify({
      v: 1,
      value,
      softUntil: Date.now() - 60_000,
      hardUntil: Date.now() + 3_600_000,
    })
  );
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  brokerCalls.length = 0;
  brokerResponse = { ok: true, verified: true, path: "ui" };
  operatorOwns = false;
  upstream = fixtureUpstream();
  setUpstream(upstream.impl);
});

afterEach(() => {
  setUpstream(null);
  setUpstashRest(null);
});

afterAll(() => {
  setUpstream(null);
});

const tabCtx = (handle: string) => ({ params: Promise.resolve({ handle }) });
const postCtx = (postId: string) => ({ params: Promise.resolve({ postId }) });
const postCommentCtx = (postId: string, commentId: string) => ({
  params: Promise.resolve({ postId, commentId }),
});

// ---------------------------------------------------------------------------
// the mapper extensions (poll, image grid, author avatar)
// ---------------------------------------------------------------------------

describe("community post mapper extensions (WFX2-P2-SO)", () => {
  test("poll attachment maps: choices with vote counts + percentages, total votes", () => {
    const items = mapCommunityPosts(browserPayload);
    const pollPost = items.find((p: any) => p.id === "UgkxSYNTHETICbrowser01")!;
    expect(pollPost.poll).not.toBeNull();
    expect(pollPost.poll!.choices).toHaveLength(3);
    expect(pollPost.poll!.choices[0]).toMatchObject({
      text: "Together Forever",
      votes: 620,
      percentText: "62%",
    });
    expect(pollPost.poll!.totalVotesText).toBe("1K votes");
    expect(pollPost.poll!.totalVotes).toBe(1000);
  });

  test("image grid maps: all attachment images in order; imageUrl is the first", () => {
    const items = mapCommunityPosts(browserPayload);
    const gridPost = items.find((p: any) => p.id === "UgkxSYNTHETICbrowser02")!;
    expect(gridPost.images).toHaveLength(3);
    expect(gridPost.images![0]).toContain("synthetic-grid-1");
    expect(gridPost.imageUrl).toContain("synthetic-grid-1");
  });

  test("author avatar maps from authorThumbnail; single-image post keeps imageUrl", () => {
    const items = mapCommunityPosts(browserPayload);
    const plain = items.find((p: any) => p.id === "UgkxSYNTHETICbrowser03")!;
    expect(plain.authorAvatarUrl).toContain("synthetic-avatar");
    expect(plain.publishedText).toBe("2 weeks ago");
    expect(plain.likesText).toBe("4.4K likes");
  });

  test("mapBackstagePoll: null without choices (never a guessed poll)", () => {
    expect(mapBackstagePoll({ pollRenderer: {} })).toBeNull();
    expect(mapBackstagePoll({ pollRenderer: { choices: [{ text: { runs: [] } }] } })).toBeNull();
    expect(mapBackstagePoll(null)).toBeNull();
  });

  test("mapBackstageImages: empty for a text-only post", () => {
    expect(mapBackstageImages(null)).toEqual([]);
    expect(mapBackstageImages({})).toEqual([]);
  });

  test("the existing sanitized capture still maps (one mapper, both transports)", () => {
    const items = mapCommunityPosts(posts);
    expect(items).toHaveLength(5);
    expect(items[0].id).toBe("Ugkx6HzKUems4roLJrhsxgkRwC0sz_cHiVHX");
    // the new fields are additive on the old shape: single image, no poll
    expect(items[0].images).toHaveLength(1);
    expect(items[0].poll).toBeNull();
    expect(items[0].authorAvatarUrl).toBeNull();
  });

  test("communityBrowseHealthy: the tab strip is the health signal", () => {
    expect(communityBrowseHealthy(posts)).toBe(true); // real tab payload
    expect(communityBrowseHealthy({})).toBe(false); // the walled 200-empty shape
  });

  test("communityBrowserPayloadHealthy: posts OR the Posts tab strip prove the browser payload", () => {
    expect(communityBrowserPayloadHealthy(browserPayload)).toBe(true);
    expect(communityBrowserPayloadHealthy({})).toBe(false);
    expect(communityBrowserPayloadHealthy(null)).toBe(false);
    // a channel-not-found redirect: a payload with neither posts nor the tab strip
    expect(communityBrowserPayloadHealthy({ contents: { somethingElse: true } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the wall ladder (the tab route)
// ---------------------------------------------------------------------------

describe("GET /api/channel/[handle]/tab?tab=community — the wall ladder", () => {
  test("rung 1 browse-healthy: the mapped posts serve with source 'browse' (no broker call)", async () => {
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("community");
    expect(data.walled).toBeUndefined();
    expect(data.source).toBe("browse");
    expect(data.posts).toHaveLength(5);
    expect(data.posts[0].likesText).toBe("4.4K likes");
    // the ladder never touched the broker while browse answers healthy
    expect(brokerCalls).toHaveLength(0);
    // compose stays false in public mode (never a guessed own-channel)
    expect(data.compose).toBe(false);
  });

  test("rung 2 broker-read: the walled browse falls to the logged-in browser — the SAME mapper maps its payload (source 'broker')", async () => {
    upstream.wallCommunity(true); // the InnerTube wall: 200-but-empty
    brokerResponse = {
      ok: true,
      verified: true,
      path: "ui",
      detail: { data: browserPayload, url: "https://www.youtube.com/@RickAstleyYT/community", postsFound: 3 },
    };
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.tab).toBe("community");
    expect(data.walled).toBeUndefined();
    expect(data.source).toBe("broker");
    // the browser payload mapped through the EXISTING backstage mapper
    expect(data.posts).toHaveLength(3);
    expect(data.posts[0].poll.choices[0].text).toBe("Together Forever");
    expect(data.posts[1].images).toHaveLength(3);
    // the broker read carried the handle (the browser navigates by handle)
    const read = brokerCalls.find((c) => c.kind === "community-read");
    expect(read).toBeDefined();
    expect((read!.payload as any).handle).toBe("RickAstleyYT");
    expect((read!.target as any).channelId).toBe(RICK_ID);
  });

  test("rung 2 (production path): resolution walled too — the broker read still serves by handle", async () => {
    upstream.wallSsr(true); // the @handle SSR wall (404) + zero-renderer search
    upstream.wallCommunity(true);
    brokerResponse = {
      ok: true,
      verified: true,
      path: "ui",
      detail: { data: browserPayload, postsFound: 3 },
    };
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.source).toBe("broker");
    expect(data.posts).toHaveLength(3);
    const read = brokerCalls.find((c) => c.kind === "community-read");
    expect(read).toBeDefined();
    expect((read!.payload as any).handle).toBe("RickAstleyYT");
  });

  test("rung 2 honest failure: the browser payload is NOT the community tab → falls through (never fake emptiness)", async () => {
    upstream.wallCommunity(true);
    brokerResponse = {
      ok: true,
      verified: true,
      path: "ui",
      detail: { data: { contents: { somethingElse: true } }, postsFound: 0 },
    };
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.walled).toBe(true); // honest empty, never zero-post fakery
    expect(data.posts).toBeUndefined();
    expect(data.source).toBeUndefined();
  });

  test("rung 4 honest-empty: browse walled + broker offline → HTTP 200 {tab, walled: true}", async () => {
    upstream.wallCommunity(true);
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data).toMatchObject({ tab: "community", walled: true });
    expect(data.posts).toBeUndefined();
  });

  test("rung 3 last-good: the wall + broker down + an Upstash last-good → the last-good serves (source 'last-good'), never re-poisoned", async () => {
    const rest = fakeRest();
    setUpstashRest(rest.impl);
    // first, a healthy browse primes L2 under the channelId key
    await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    const set = rest.commands.find((c) => c[0] === "SET" && c[1] === communityCacheKey("@RickAstleyYT", RICK_ID));
    expect(set).toBeDefined();
    // soften the entry (stale-but-hard-valid = the last-good window)
    const env = JSON.parse(set![2]);
    env.softUntil = Date.now() - 60_000;
    env.hardUntil = Date.now() + 3_600_000;
    rest.store.set(communityCacheKey("@RickAstleyYT", RICK_ID), JSON.stringify(env));

    clearCache(); // cold L1 — the L2 last-good is the only survivor
    upstream.wallCommunity(true);
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.walled).toBeUndefined();
    expect(data.source).toBe("last-good");
    expect(data.posts).toHaveLength(5);
    // the walled answer never overwrote the stored last-good
    const stored = JSON.parse(rest.store.get(communityCacheKey("@RickAstleyYT", RICK_ID))!);
    expect(stored.value.posts).toHaveLength(5);
  });

  test("the ladder caches the broker read (rung 2 healthy → a second request makes NO new broker call)", async () => {
    upstream.wallCommunity(true);
    brokerResponse = {
      ok: true,
      verified: true,
      path: "ui",
      detail: { data: browserPayload, postsFound: 3 },
    };
    const first = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(((await first.json()) as any).source).toBe("broker");
    const readsAfterFirst = brokerCalls.filter((c) => c.kind === "community-read").length;
    expect(readsAfterFirst).toBe(1);

    const second = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    expect(((await second.json()) as any).source).toBe("broker");
    // the fresh cache entry served — no second broker read (rate + cache law)
    expect(brokerCalls.filter((c) => c.kind === "community-read")).toHaveLength(1);
  });

  test("compose: true when the operator session owns the channel (the composer affordance)", async () => {
    operatorOwns = true;
    const res = await tabRoute(
      new Request("http://localhost/api/channel/@RickAstleyYT/tab?tab=community"),
      tabCtx("@RickAstleyYT")
    );
    const data = (await res.json()) as any;
    expect(data.compose).toBe(true);
    expect(data.source).toBe("browse");
  });
});

// ---------------------------------------------------------------------------
// post comments (the read path)
// ---------------------------------------------------------------------------

describe("GET /api/posts/[postId]/comments — the post comments read", () => {
  test("the post-detail browse → the comment continuation walk maps (paged, sorted, total)", async () => {
    const res = await getPostCommentsRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments?sort=top"),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.walled).toBeUndefined();
    expect(data.total).toBe(2);
    expect(data.items).toHaveLength(2);
    expect(data.items[0].body).toBe("Never gonna give this poll up!");
    expect(data.items[0].author.name).toBe("@fanone");
    expect(data.items[0].likes).toBe(12);
    // the post detail was browsed by postId, then the token walked
    const browses = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"));
    expect(browses.some((r) => r.body?.browseId === "UgkxSYNTHETICbrowser01")).toBe(true);
    expect(browses.some((r) => r.body?.continuation === "SYNTHETIC-POST-COMMENTS-TOP-TOKEN")).toBe(true);
  });

  test("sort=new rides the sort menu's Newest token", async () => {
    const res = await getPostCommentsRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments?sort=new"),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).items).toHaveLength(2);
    expect(
      upstream.recorded.some((r) => r.body?.continuation === "SYNTHETIC-POST-COMMENTS-NEW-TOKEN")
    ).toBe(true);
  });

  test("a walled post read → the honest {items: [], walled: true} degrade (never fake zero-comment)", async () => {
    setUpstream(async () => new Response("not found", { status: 404 }));
    const res = await getPostCommentsRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments"),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.items).toEqual([]);
    expect(data.walled).toBe(true);
  });

  test("cursor pagination passes the continuation token straight through", async () => {
    const res = await getPostCommentsRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments?cursor=PAGE2TOKEN"),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).items).toHaveLength(2);
    expect(upstream.recorded.some((r) => r.body?.continuation === "PAGE2TOKEN")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the new broker kinds' request shapes (route layer)
// ---------------------------------------------------------------------------

describe("POST /api/posts/* — the Tier-2 write shapes", () => {
  test("post-like: {action: like} → brokerAction('post-like', {postId}, {action: 'like'})", async () => {
    const res = await postLikeRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/like", {
        method: "POST",
        body: JSON.stringify({ action: "like", baseline: { likes: 4400, yourLike: null } }),
      }),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.effect).toBe("post-liked");
    expect(data.yourLike).toBe("like");
    expect(data.likes).toBe(4401);
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].kind).toBe("post-like");
    expect(brokerCalls[0].target).toEqual({ postId: "UgkxSYNTHETICbrowser01" });
    expect(brokerCalls[0].payload).toEqual({ action: "like" });
  });

  test("post-like legacy toggle: same value again → action 'remove'", async () => {
    const res = await postLikeRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/like", {
        method: "POST",
        body: JSON.stringify({ value: "like", baseline: { likes: 4400, yourLike: "like" } }),
      }),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).effect).toBe("post-rating-removed");
    expect(brokerCalls[0].payload).toEqual({ action: "remove" });
  });

  test("post-like broker offline → the honest 502 the UI degrades on", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postLikeRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/like", {
        method: "POST",
        body: JSON.stringify({ action: "like" }),
      }),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(502);
    const data = (await res.json()) as any;
    expect(data.error).toBe(OFFLINE_MSG);
  });

  test("post-comment-create: {body} → brokerAction('post-comment-create', {postId}, {text}) + 201 synth DTO", async () => {
    const res = await postComment(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments", {
        method: "POST",
        body: JSON.stringify({ body: "great poll!" }),
      }),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.effect).toBe("post-comment-created");
    expect(data.body).toBe("great poll!");
    expect(data.author.name).toBe("Demo");
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].kind).toBe("post-comment-create");
    expect(brokerCalls[0].target).toEqual({ postId: "UgkxSYNTHETICbrowser01" });
    expect(brokerCalls[0].payload).toEqual({ text: "great poll!" });
  });

  test("post-comment-create rejects an empty body before the broker", async () => {
    const res = await postComment(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments", {
        method: "POST",
        body: JSON.stringify({ body: "   " }),
      }),
      postCtx("UgkxSYNTHETICbrowser01")
    );
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("post-comment-like: the commentText locator rides the payload (the DOM path)", async () => {
    const res = await postCommentLikeRoute(
      new NextRequest("http://localhost/api/posts/UgkxSYNTHETICbrowser01/comments/UgySYNTHETICpostComment1/like", {
        method: "POST",
        body: JSON.stringify({
          value: "like",
          baseline: { likes: 12, yourLike: null },
          commentText: "Never gonna give this poll up!",
        }),
      }),
      postCommentCtx("UgkxSYNTHETICbrowser01", "UgySYNTHETICpostComment1")
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.likes).toBe(13);
    expect(data.yourLike).toBe("like");
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].kind).toBe("post-comment-like");
    expect(brokerCalls[0].target).toEqual({
      postId: "UgkxSYNTHETICbrowser01",
      commentId: "UgySYNTHETICpostComment1",
    });
    expect(brokerCalls[0].payload).toEqual({
      mode: "toggle",
      commentText: "Never gonna give this poll up!",
    });
  });

  test("post-create: text + poll options → brokerAction('post-create') with the handle", async () => {
    const res = await createPostRoute(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          handle: "@RickAstleyYT",
          text: "Next cover vote:",
          pollOptions: ["Together Forever", "Keep Singing"],
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.effect).toBe("post-created");
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].kind).toBe("post-create");
    expect(brokerCalls[0].payload).toEqual({
      handle: "RickAstleyYT",
      text: "Next cover vote:",
      pollOptions: ["Together Forever", "Keep Singing"],
    });
  });

  test("post-create validation: a lone poll option never reaches the broker (400)", async () => {
    const res = await createPostRoute(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ handle: "@RickAstleyYT", text: "", pollOptions: ["only one"] }),
      })
    );
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("post-create validation: an empty post is refused (no text, no image, no poll)", async () => {
    const res = await createPostRoute(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ handle: "@RickAstleyYT", text: "" }),
      })
    );
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("parseCompactCount: the honest count parsing used by the like proxies", () => {
    expect(parseCompactCount("4.4K")).toBe(4400);
    expect(parseCompactCount("1,234")).toBe(1234);
    expect(parseCompactCount("")).toBeNull();
    expect(parseCompactCount("abc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the composer's gating state machine (pure)
// ---------------------------------------------------------------------------

describe("the creator composer's gating state machine", () => {
  test("empty composer → not submittable", () => {
    expect(canSubmitPost({ text: "", imageUrl: "", pollOn: false, pollOptions: [] })).toBe(false);
  });

  test("text alone → submittable", () => {
    expect(canSubmitPost({ text: "hello", imageUrl: "", pollOn: false, pollOptions: [] })).toBe(true);
  });

  test("an image URL alone → submittable (an image post)", () => {
    expect(canSubmitPost({ text: "", imageUrl: "https://x.dev/i.jpg", pollOn: false, pollOptions: [] })).toBe(true);
    expect(canSubmitPost({ text: "", imageUrl: "not-a-url", pollOn: false, pollOptions: [] })).toBe(false);
  });

  test("a poll needs 2-5 non-empty options (every row counts)", () => {
    expect(canSubmitPost({ text: "", imageUrl: "", pollOn: true, pollOptions: ["", ""] })).toBe(false);
    expect(canSubmitPost({ text: "vote", imageUrl: "", pollOn: true, pollOptions: ["a", ""] })).toBe(false);
    expect(canSubmitPost({ text: "", imageUrl: "", pollOn: true, pollOptions: ["a", "b"] })).toBe(true);
    expect(
      canSubmitPost({ text: "", imageUrl: "", pollOn: true, pollOptions: ["a", "b", "c", "d", "e"] })
    ).toBe(true);
  });
});
