/// <reference types="bun-types" />
/**
 * WFX2-C-B studio lane tests — the creator surfaces exercised against
 * fixture bytes via the test-only `setUpstream()` seam (the pattern from
 * A-B's yt-routes.test.ts). NEVER the network.
 *
 * Session handling mirrors personal-routes.test.ts: `YT_COOKIES` is set in
 * the live-session describes (hasSession() true), deleted in the public-mode
 * describes (honest degradation).
 *
 * Fixtures:
 *  - REAL: channel_rickastley.json (channel home browse — 59 non-short
 *    videos), next_dQw4.json (dQw4's real watch metadata: 19,427,647 likes,
 *    1,821,187,782 views), comments_dQw4.json (real comments page header:
 *    2,457,856 comments).
 *  - SYNTHETIC (provenance comments inside): ssr_home_ytcfg_synth.html (a
 *    signed-in home page's ytcfg CHANNEL_ID bootstrap),
 *    studio_analytics_synth.html (a Studio analytics page's embedded state).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import {
  extractChannelIdFromHtml,
  extractChannelLinks,
  extractStudioMetrics,
} from "@/lib/youtube/studio";

import { GET as studioRoute } from "@/app/api/studio/route";
import { GET as uploadGet, POST as uploadPost } from "@/app/api/upload/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));
const readHtml = (name: string): string => readFileSync(`${FIXTURE_DIR}/${name}.html`, "utf8");

/** NextRequest-compatible request factory (the routes type against NextRequest). */
const req = (url: string, init?: RequestInit): never => new Request(url, init) as never;

const HOME_YTCFG_HTML = readHtml("ssr_home_ytcfg_synth");
const HOME_NO_CHANNEL_HTML = HOME_YTCFG_HTML.replace(
  '"CHANNEL_ID":"UCuAXFkgsw1L7xaCfnd5JJOw",',
  ""
);
const STUDIO_ANALYTICS_HTML = readHtml("studio_analytics_synth");

const OPERATOR_CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";

interface Recorded {
  method: string;
  url: string;
  body: any;
}

const htmlFor = (data: unknown) =>
  `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(
    data
  )};</script></body></html>`;

type StudioResponder = () => Response;

interface UpstreamOptions {
  /** the youtube.com home page HTML (with or without the ytcfg CHANNEL_ID) */
  homeHtml: string;
  /** serve a channel page at /@me (the self-handle fallback) */
  atMe: boolean;
  /** the studio.youtube.com analytics page response */
  studio: StudioResponder;
}

/** Fixture-backed upstream for the whole studio lane. */
function studioUpstream(opts: UpstreamOptions) {
  const recorded: Recorded[] = [];
  const channel = load("channel_rickastley");
  const nextDQw4 = load("next_dQw4");
  const commentsDQw4 = load("comments_dQw4");

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const html = (text: string, status = 200) =>
      new Response(text, { status, headers: { "Content-Type": "text/html" } });

    if (url === "https://www.youtube.com/") return html(opts.homeHtml);
    if (url.includes("/@me")) {
      return opts.atMe ? html(htmlFor(channel)) : new Response("not found", { status: 404 });
    }
    if (url.startsWith("https://studio.youtube.com/")) return opts.studio();
    if (url.includes("/youtubei/v1/browse")) {
      // channel home + the videos tab (same browseId, tab params) — the real
      // channel fixture serves both (its own tab list drives the params)
      return json(channel);
    }
    if (url.includes("/youtubei/v1/next")) {
      if (body?.continuation) return json(commentsDQw4);
      if (body?.videoId === "dQw4w9WgXcQ") return json(nextDQw4);
      // videos with no watch fixture: {} → honest null enrichment (no fake 0)
      return json({});
    }
    return new Response("not found", { status: 404 });
  };

  return { impl, recorded };
}

const studioHtml = (): Response =>
  new Response(STUDIO_ANALYTICS_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
const studioAuthRedirect = (): Response =>
  new Response("", {
    status: 302,
    headers: { Location: "https://accounts.google.com/ServiceLogin?continue=studio" },
  });
const studioAppShell = (): Response =>
  new Response("<html><body>studio shell — state loads via XHR</body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
const studioError = (): Response => new Response("boom", { status: 500 });

let upstream: ReturnType<typeof studioUpstream>;

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  setUpstream(null);
  delete process.env.YT_COOKIES;
});

// ---------------------------------------------------------------------------
// pure mappers
// ---------------------------------------------------------------------------

describe("operator channel id extraction (pure)", () => {
  test("ytcfg CHANNEL_ID is honored", () => {
    expect(extractChannelIdFromHtml(HOME_YTCFG_HTML)).toBe(OPERATOR_CHANNEL_ID);
  });

  test("a grid item's lowercase channelId is NEVER mistaken for the operator", () => {
    // the synth home fixture embeds "channelId":"UCNOTtheOperator00000000"
    // inside ytInitialData — the extractor must ignore it
    const html = HOME_NO_CHANNEL_HTML;
    expect(extractChannelIdFromHtml(html)).toBeNull();
  });

  test("logged-out-style HTML (no ytcfg) → null", () => {
    expect(extractChannelIdFromHtml("<html><body>public page</body></html>")).toBeNull();
  });
});

describe("studio analytics metric extraction (pure)", () => {
  test("metrics parse from the embedded analytics state", () => {
    const metrics = extractStudioMetrics(STUDIO_ANALYTICS_HTML);
    expect(metrics).not.toBeNull();
    expect(metrics!.views).toBe(7123);
    expect(metrics!.impressions).toBe(984231);
    expect(metrics!.watchTimeMinutes).toBe(456789);
    expect(metrics!.subscribersGained).toBe(421);
    expect(metrics!.estimatedRevenue).toBe(123.45);
    expect(metrics!.likes).toBe(8712);
    expect(metrics!.comments).toBe(559);
    expect(metrics!.shares).toBe(37);
  });

  test("a page with no embedded analytics → null (honest unavailable)", () => {
    expect(extractStudioMetrics("<html><body>app shell</body></html>")).toBeNull();
  });

  test("non-numeric metric values never surface as numbers", () => {
    const html = `<script>state = {"unifiedAnalyticsData":{"views":"not-a-number"}}</script>`;
    expect(extractStudioMetrics(html)).toBeNull();
  });
});

describe("channel links extraction (pure)", () => {
  test("the REAL rickastley fixture carries no links → [] (honest)", () => {
    expect(extractChannelLinks(load("channel_rickastley"))).toEqual([]);
  });

  test("channelExternalLinkViewModel rows map + dedupe", () => {
    const response = {
      about: {
        links: [
          { channelExternalLinkViewModel: { title: { content: "Website" }, link: { content: "https://example.com" } } },
          { channelExternalLinkViewModel: { title: { content: "Website" }, link: { content: "https://example.com" } } },
          { channelExternalLinkViewModel: { title: { content: "Instagram" }, link: { content: "https://instagram.com/rick" } } },
        ],
      },
    };
    expect(extractChannelLinks(response)).toEqual([
      { title: "Website", url: "https://example.com" },
      { title: "Instagram", url: "https://instagram.com/rick" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/studio — live session (ytcfg resolution, REAL channel fixture)
// ---------------------------------------------------------------------------

describe("GET /api/studio — session mode (ytcfg operator resolution)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture; LOGIN_INFO=fixture";
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioHtml });
    setUpstream(upstream.impl);
  });

  test("the full honest surface: channel, real videos, real enrichment, parsed analytics, deep links", async () => {
    const res = await studioRoute(req("http://localhost/api/studio?enrich=25"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;

    expect(data.session).toBe(true);
    expect(data.loginRequired).toBe(false);

    // the operator's real channel (channel_rickastley.json)
    expect(data.channel.id).toBe(OPERATOR_CHANNEL_ID);
    expect(data.channel.handle).toBe("@RickAstleyYT");
    expect(data.channel.name).toBe("Rick Astley");
    expect(data.channel.subscriberCount).toBe(4_550_000);
    expect(data.channel.subscriberCountText).toBe("4.55M subscribers");
    expect(data.channel.videoCountText).toBe("437 videos");
    expect(data.channel.bannerUrl).toMatch(/^https:\/\//);
    expect(data.channel.links).toEqual([]);

    // the real public videos tab (59 non-shorts)
    expect(data.videos).toHaveLength(59);

    // dQw4 (index 19, inside the enrich window) carries REAL stats — the
    // enrichment upgrades the grid's compact "1.8B views" to the watch page's
    // exact count and adds the real likes + comment count
    const dqw4 = data.videos.find((v: any) => v.id === "dQw4w9WgXcQ");
    expect(dqw4).toBeDefined();
    expect(dqw4.views).toBe(1_821_187_782);
    expect(dqw4.viewsText).toBe("1,821,187,782 views");
    expect(dqw4.likes).toBe(19_427_647);
    expect(dqw4.commentCount).toBe(2_457_856);

    // videos without a watch fixture show honest nulls — never fake zeros
    const other = data.videos.find((v: any) => v.id === "PXC_PYeB6F8");
    expect(other.likes).toBeNull();
    expect(other.commentCount).toBeNull();

    // public-scope totals: real sums (the enriched dQw4 contributes its exact
    // 1,821,187,782 views in place of the grid's compact 1.8B)
    expect(data.totals.views).toBe(2_236_692_782);
    expect(data.totals.subscribers).toBe(4_550_000);
    expect(data.totals.videoCount).toBe(437);
    expect(data.totals.likes).toBe(19_427_647);
    expect(data.totals.comments).toBe(2_457_856);
    expect(data.totals.enrichedCount).toBe(1);

    // studio-scope analytics parsed from the Studio SSR page
    expect(data.analytics.mode).toBe("ok");
    expect(data.analytics.metrics.views).toBe(7123);
    expect(data.analytics.metrics.estimatedRevenue).toBe(123.45);
    expect(data.analytics.note).toContain("Studio");

    // deep links out to the real studio pages
    expect(data.deepLinks.studioRoot).toBe("https://studio.youtube.com");
    expect(data.deepLinks.analytics).toBe(
      `https://studio.youtube.com/channel/${OPERATOR_CHANNEL_ID}/analytics`
    );
    expect(data.deepLinks.content).toBe(
      `https://studio.youtube.com/channel/${OPERATOR_CHANNEL_ID}/videos`
    );
    expect(data.deepLinks.customization).toBe(
      `https://studio.youtube.com/channel/${OPERATOR_CHANNEL_ID}/customization`
    );
    expect(data.deepLinks.upload).toBe("https://www.youtube.com/upload");
  });

  test("exactly the expected upstream calls (cached, deduped) — and ZERO player calls", async () => {
    await studioRoute(req("http://localhost/api/studio?enrich=25"));

    // the LAW: the player endpoint is never touched
    expect(upstream.recorded.filter((r) => r.url.includes("/player"))).toHaveLength(0);

    // one home SSR (ytcfg), one channel-home browse + one videos-tab browse
    expect(upstream.recorded.filter((r) => r.url === "https://www.youtube.com/")).toHaveLength(1);
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/browse"))).toHaveLength(2);

    // 25 watch-metadata calls (the enrich window) + 2 comment-page calls for dQw4
    const nexts = upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/next"));
    expect(nexts.filter((r) => r.body?.videoId)).toHaveLength(25);
    expect(nexts.filter((r) => r.body?.continuation)).toHaveLength(2);

    // one Studio analytics SSR
    expect(
      upstream.recorded.filter((r) => r.url.startsWith("https://studio.youtube.com/"))
    ).toHaveLength(1);

    // the @me fallback was never needed (ytcfg resolved)
    expect(upstream.recorded.filter((r) => r.url.includes("/@me"))).toHaveLength(0);
  });

  test("?enrich=0 → no watch-metadata calls, all stats honestly null", async () => {
    const res = await studioRoute(req("http://localhost/api/studio?enrich=0"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.videos).toHaveLength(59);
    expect(data.videos.every((v: any) => v.likes === null && v.commentCount === null)).toBe(true);
    expect(data.totals.enrichedCount).toBe(0);
    expect(data.totals.likes).toBe(0);
    expect(upstream.recorded.filter((r) => r.url.includes("/youtubei/v1/next"))).toHaveLength(0);
  });

  test("a second GET is fully cache-served (zero new upstream calls)", async () => {
    await studioRoute(req("http://localhost/api/studio?enrich=25"));
    const callsAfterFirst = upstream.recorded.length;
    await studioRoute(req("http://localhost/api/studio?enrich=25"));
    expect(upstream.recorded.length).toBe(callsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// GET /api/studio — @me fallback resolution
// ---------------------------------------------------------------------------

describe("GET /api/studio — @me fallback (no CHANNEL_ID in the home page)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    upstream = studioUpstream({ homeHtml: HOME_NO_CHANNEL_HTML, atMe: true, studio: studioHtml });
    setUpstream(upstream.impl);
  });

  test("the /@me self-handle page resolves the operator channel", async () => {
    const res = await studioRoute(req("http://localhost/api/studio"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(true);
    expect(data.channel).not.toBeNull();
    expect(data.channel.id).toBe(OPERATOR_CHANNEL_ID);
    expect(data.channel.name).toBe("Rick Astley");
    expect(data.videos).toHaveLength(59);
    // the fallback was actually used
    expect(upstream.recorded.filter((r) => r.url.includes("/@me"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /api/studio — honest degradation modes
// ---------------------------------------------------------------------------

describe("GET /api/studio — operator channel unresolved (honest)", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    upstream = studioUpstream({ homeHtml: HOME_NO_CHANNEL_HTML, atMe: false, studio: studioHtml });
    setUpstream(upstream.impl);
  });

  test("no-channel state: channel null, honest analytics note, root deep links", async () => {
    const res = await studioRoute(req("http://localhost/api/studio"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(true);
    expect(data.channel).toBeNull();
    expect(data.videos).toEqual([]);
    expect(data.analytics.mode).toBe("no-channel");
    expect(data.analytics.metrics).toBeNull();
    expect(data.deepLinks.analytics).toBe("https://studio.youtube.com");
  });
});

describe("GET /api/studio — public mode (no YT_COOKIES)", () => {
  beforeEach(() => {
    delete process.env.YT_COOKIES;
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: true, studio: studioHtml });
    setUpstream(upstream.impl);
  });

  test("honest empty surface with ZERO upstream calls", async () => {
    const res = await studioRoute(req("http://localhost/api/studio"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(false);
    expect(data.loginRequired).toBe(true);
    expect(data.channel).toBeNull();
    expect(data.videos).toEqual([]);
    expect(data.analytics.mode).toBe("no-session");
    expect(data.analytics.metrics).toBeNull();
    expect(data.totals.views).toBe(0);
    expect(data.deepLinks.upload).toBe("https://www.youtube.com/upload");
    // public mode never touches youtube.com
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("GET /api/studio — Studio SSR honest analytics modes", () => {
  beforeEach(() => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
  });

  test("a 302 to accounts.google.com → auth-required, metrics null", async () => {
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioAuthRedirect });
    setUpstream(upstream.impl);
    const res = await studioRoute(req("http://localhost/api/studio"));
    const data = (await res.json()) as any;
    expect(data.analytics.mode).toBe("auth-required");
    expect(data.analytics.metrics).toBeNull();
    expect(data.analytics.note).toContain("re-authentication");
    // the channel data still loads — only analytics degrades
    expect(data.channel.name).toBe("Rick Astley");
  });

  test("a page with no parseable metrics → unavailable, metrics null", async () => {
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioAppShell });
    setUpstream(upstream.impl);
    const res = await studioRoute(req("http://localhost/api/studio"));
    const data = (await res.json()) as any;
    expect(data.analytics.mode).toBe("unavailable");
    expect(data.analytics.metrics).toBeNull();
    expect(data.analytics.note).toContain("no embedded analytics");
  });

  test("an upstream failure → error, metrics null", async () => {
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioError });
    setUpstream(upstream.impl);
    const res = await studioRoute(req("http://localhost/api/studio"));
    const data = (await res.json()) as any;
    expect(data.analytics.mode).toBe("error");
    expect(data.analytics.metrics).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// /api/upload — the metadata hand-off
// ---------------------------------------------------------------------------

describe("GET /api/upload — context", () => {
  test("session mode: the operator's real channel + the real upload URL", async () => {
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioHtml });
    setUpstream(upstream.impl);

    const res = await uploadGet(req("http://localhost/api/upload"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(true);
    expect(data.channel.name).toBe("Rick Astley");
    expect(data.channel.handle).toBe("@RickAstleyYT");
    expect(data.uploadUrl).toBe("https://www.youtube.com/upload");
    expect(data.studioRoot).toBe("https://studio.youtube.com");
  });

  test("public mode: channel null, ZERO upstream calls", async () => {
    delete process.env.YT_COOKIES;
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: true, studio: studioHtml });
    setUpstream(upstream.impl);

    const res = await uploadGet(req("http://localhost/api/upload"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.session).toBe(false);
    expect(data.channel).toBeNull();
    expect(upstream.recorded).toHaveLength(0);
  });
});

describe("POST /api/upload — hand-off bundle (NO upload simulation)", () => {
  beforeEach(() => {
    // cookies set on purpose: POST must stay pure — the hand-off never
    // touches the network regardless of session state
    process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture";
    upstream = studioUpstream({ homeHtml: HOME_YTCFG_HTML, atMe: false, studio: studioHtml });
    setUpstream(upstream.impl);
  });

  const post = (body: unknown) =>
    uploadPost(
      req("http://localhost/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  test("valid metadata → the bundle + the real YouTube upload deep link", async () => {
    const res = await post({
      title: "My Studio Handoff",
      description: "A real description",
      tags: ["one", "two", "one"],
      visibility: "unlisted",
      thumbnailUrl: "https://example.com/thumb.jpg",
      isShort: true,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.handoffUrl).toBe("https://www.youtube.com/upload");
    expect(data.prefillSupported).toBe(false);
    expect(data.bundle).toContain("TITLE: My Studio Handoff");
    expect(data.bundle).toContain("DESCRIPTION:\nA real description");
    expect(data.bundle).toContain("TAGS: one, two");
    expect(data.bundle).toContain("VISIBILITY: Unlisted");
    expect(data.bundle).toContain("THUMBNAIL URL: https://example.com/thumb.jpg");
    expect(data.bundle).toContain("FORMAT: vertical (Short)");
    expect(data.bundle).toContain("https://www.youtube.com/upload");
    // tags dedupe
    expect(data.fields.tags).toEqual(["one", "two"]);
    expect(data.fields.visibility).toBe("unlisted");
    // pure — zero upstream calls
    expect(upstream.recorded).toHaveLength(0);
  });

  test("minimal metadata (title only) → the bundle with defaults", async () => {
    const res = await post({ title: "Just a title" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.bundle).toContain("TITLE: Just a title");
    expect(data.bundle).toContain("DESCRIPTION:\n(none)");
    expect(data.fields.visibility).toBe("public");
    expect(data.fields.tags).toEqual([]);
    expect(upstream.recorded).toHaveLength(0);
  });

  test("missing title → 400", async () => {
    const res = await post({ description: "no title" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Title");
  });

  test("a 101-character title → 400 (YouTube's real 100-char limit)", async () => {
    const res = await post({ title: "x".repeat(101) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("100");
  });

  test("a non-https thumbnail → 400", async () => {
    const res = await post({ title: "T", thumbnailUrl: "http://example.com/t.jpg" });
    expect(res.status).toBe(400);
  });

  test("an invalid visibility → 400", async () => {
    const res = await post({ title: "T", visibility: "friends-only" });
    expect(res.status).toBe(400);
  });
});
