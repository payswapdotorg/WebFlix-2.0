#!/usr/bin/env node
/**
 * WFX2-C-W — end-to-end acceptance harness (the merge gate).
 *
 * Usage:
 *   bun scripts/acceptance.mjs                # against ACCEPT_URL (default: production)
 *   ACCEPT_URL=http://localhost:3000 bun scripts/acceptance.mjs
 *   bun scripts/acceptance.mjs --selftest     # hermetic dry-run against an in-process mock server
 *
 * Suites:
 *   A. 14 page routes — HTTP 200 + the exact document title;
 *   B. 19 live-data API checks — home rails non-empty, videos?q= (the cutover
 *      fix), trending (Now + Music), search (videos + channels), watch meta,
 *      comments, related, shorts, live surface, autocomplete/suggest, channel
 *      tabs (+ in-channel search), live-status shape;
 *   C. 5 honest-degradation checks — personal surfaces WITHOUT a session must
 *      answer loginRequired=true with zero rows (never fake rows). When the
 *      deployment DOES carry the operator session (YT_COOKIES set), the check
 *      passes only if real rows are present — an empty payload with
 *      loginRequired=false is the fake-data failure signature and fails.
 *
 * Exit code: 0 iff every check passes. This is the ONLY live-network tool in
 * the repo (bun test never runs it; --selftest binds 127.0.0.1 only).
 */

import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);

const PRODUCTION_URL = "https://webflix-2-0-3l2mqi5ti.vercel.app";
const PAGE_TIMEOUT_MS = 20_000;
const API_TIMEOUT_MS = 15_000;
const selftest = process.argv.includes("--selftest");
const base = (selftest ? "" : (process.env.ACCEPT_URL || PRODUCTION_URL)).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Check definitions
// ---------------------------------------------------------------------------

const n = (v) => (Array.isArray(v) ? v.length : 0);

/** A page route and the exact <title> the deployed document must carry. */
const PAGE_CHECKS = [
  { path: "/", title: "WebFlix — Watch & Share Videos" },
  { path: "/trending", title: "Trending · WebFlix" },
  { path: "/explore", title: "Explore · WebFlix" },
  { path: "/explore/live", title: "Live · WebFlix" },
  { path: "/search?q=lofi", title: "Search · WebFlix" },
  { path: "/watch/dQw4w9WgXcQ", title: "WebFlix — Watch & Share Videos" },
  { path: "/shorts", title: "Shorts · WebFlix" },
  { path: "/history", title: "History · WebFlix" },
  { path: "/subscriptions", title: "Subscriptions · WebFlix" },
  { path: "/playlists", title: "Playlists · WebFlix" },
  { path: "/liked", title: "Liked videos · WebFlix" },
  { path: "/channel/@RickAstley", title: "WebFlix — Watch & Share Videos" },
  { path: "/studio", title: "Studio · WebFlix" },
  { path: "/upload", title: "Upload · WebFlix" },
];

/** Live-data API checks — `expect` returns a detail string, throws to fail. */
const API_CHECKS = [
  {
    name: "home rails non-empty",
    path: "/api/home",
    expect: (j) => {
      if (
        j.hero === null &&
        n(j.recommended) === 0 &&
        n(j.shorts) === 0 &&
        j.becauseYouWatched === null
      )
        throw new Error("every rail empty (hero/recommended/shorts/byw)");
      return `hero=${j.hero ? "y" : "n"} rec=${n(j.recommended)} shorts=${n(j.shorts)}`;
    },
  },
  {
    name: "home category rail",
    path: "/api/home?category=Music",
    expect: (j) => {
      if (n(j.recommended) === 0) throw new Error("recommended empty for category=Music");
      return `recommended=${n(j.recommended)}`;
    },
  },
  {
    name: "videos?q= results (cutover fix)",
    path: "/api/videos?q=music",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("videos empty for q=music");
      return `videos=${n(j.videos)} nextCursor=${j.nextCursor ? "y" : "n"}`;
    },
  },
  {
    name: "videos default feed",
    path: "/api/videos",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("default videos page empty");
      return `videos=${n(j.videos)}`;
    },
  },
  {
    name: "videos limit honored",
    path: "/api/videos?limit=24",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("no videos with limit=24");
      if (n(j.videos) > 24) throw new Error(`limit=24 returned ${n(j.videos)}`);
      return `videos=${n(j.videos)} ≤ 24`;
    },
  },
  {
    name: "trending (Now)",
    path: "/api/trending",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("trending empty");
      return `videos=${n(j.videos)} source=${j.source ?? "?"}`;
    },
  },
  {
    name: "trending (Music)",
    path: "/api/trending?category=Music",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("trending Music empty");
      return `videos=${n(j.videos)}`;
    },
  },
  {
    name: "search videos",
    path: "/api/search?q=lofi",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("no video results for q=lofi");
      return `videos=${n(j.videos)} channels=${n(j.channels)}`;
    },
  },
  {
    name: "search channel results",
    path: "/api/search?q=Rick%20Astley",
    expect: (j) => {
      if (n(j.channels) === 0) throw new Error("no channel results for Rick Astley");
      return `channels=${n(j.channels)}`;
    },
  },
  {
    name: "watch meta real (dQw4w9WgXcQ)",
    path: "/api/videos/dQw4w9WgXcQ",
    expect: (j) => {
      // 2026-09-30 integration fix (lead): the route wraps in {video: …} —
      // the original expectation read the top level (never true in prod).
      const v = j.video ?? j;
      if (!v.title || !v.channel?.name) throw new Error("title/channel missing");
      return `title="${String(v.title).slice(0, 40)}" ch="${v.channel.name}"`;
    },
  },
  {
    name: "watch bootstrap aggregate",
    path: "/api/watch/dQw4w9WgXcQ",
    expect: (j) => {
      if (j.video?.id !== "dQw4w9WgXcQ") throw new Error(`video.id=${j.video?.id}`);
      return `related=${n(j.related)} comments=${n(j.comments)}`;
    },
  },
  {
    name: "comments first page",
    path: "/api/videos/dQw4w9WgXcQ/comments",
    expect: (j) => {
      if (n(j.items) === 0) throw new Error("comments empty");
      return `items=${n(j.items)} total=${j.total ?? "?"}`;
    },
  },
  {
    name: "related rail",
    path: "/api/videos/dQw4w9WgXcQ/related",
    expect: (j) => {
      if (n(j.items) === 0) throw new Error("related empty");
      return `items=${n(j.items)}`;
    },
  },
  {
    name: "shorts feed",
    path: "/api/shorts",
    expect: (j) => {
      if (n(j.items) === 0) throw new Error("shorts seed empty");
      return `items=${n(j.items)} nextCursor=${j.nextCursor ? "y" : "n"}`;
    },
  },
  {
    name: "live surface",
    path: "/api/live",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("live surface empty");
      return `videos=${n(j.videos)}`;
    },
  },
  {
    name: "autocomplete (suggest)",
    path: "/api/search/suggest?q=mus",
    expect: (j) => {
      if (n(j.suggestions) === 0) throw new Error("no suggestions for q=mus");
      return `suggestions=${n(j.suggestions)}`;
    },
  },
  {
    name: "channel page + tabs",
    path: "/api/channel/@RickAstley",
    expect: (j) => {
      if (!j.channel?.name) throw new Error("channel header missing");
      if (n(j.videos) === 0 && n(j.shorts) === 0) throw new Error("channel tabs empty");
      return `ch="${j.channel.name}" videos=${n(j.videos)} shorts=${n(j.shorts)}`;
    },
  },
  {
    name: "channel tab search",
    path: "/api/channel/@RickAstley/search?q=never",
    expect: (j) => {
      if (n(j.videos) === 0) throw new Error("in-channel search empty");
      return `videos=${n(j.videos)}`;
    },
  },
  {
    name: "live-status shape",
    path: "/api/videos/dQw4w9WgXcQ/live-status",
    expect: (j) => {
      if (typeof j.isLive !== "boolean") throw new Error(`isLive=${j.isLive}`);
      return `isLive=${j.isLive}`;
    },
  },
];

/**
 * Honest-degradation checks. PASS: loginRequired=true + zero rows (the
 * no-session contract). PASS (noted): loginRequired falsy + non-empty rows
 * (the deployment carries the operator session — real rows, not fake).
 * FAIL: loginRequired falsy + empty rows (the fake-empty signature).
 */
const DEGRADE_CHECKS = [
  { name: "history honest w/o session", path: "/api/history", rows: (j) => n(j.groups), label: "groups" },
  { name: "subscriptions honest w/o session", path: "/api/subscriptions", rows: (j) => n(j.channels) + n(j.videos), label: "ch+vid" },
  { name: "playlists honest w/o session", path: "/api/playlists", rows: (j) => n(j.playlists), label: "playlists" },
  { name: "notifications honest w/o session", path: "/api/notifications", rows: (j) => n(j.items), label: "items" },
  { name: "liked honest w/o session", path: "/api/liked", rows: (j) => n(j.videos), label: "videos" },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function runPageCheck(target, check) {
  const res = await fetchWithTimeout(target + check.path, PAGE_TIMEOUT_MS);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  // 2026-09-30 integration fix (lead): the raw <title> carries HTML entities
  // (&amp; &lt; …) — decode before comparing or every "&" in a title fails.
  const decode = (s) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const title = m ? decode(m[1].trim()) : "(no <title>)";
  if (title !== check.title) throw new Error(`title="${title}" want="${check.title}"`);
  return `title="${title}"`;
}

async function runApiCheck(target, check) {
  const res = await fetchWithTimeout(target + check.path, API_TIMEOUT_MS);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return check.expect(json);
}

async function runDegradeCheck(target, check) {
  const res = await fetchWithTimeout(target + check.path, API_TIMEOUT_MS);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = check.rows(json);
  if (json.loginRequired === true && rows === 0) {
    return `loginRequired=true ${check.label}=0 (honest)`;
  }
  if (json.loginRequired !== true && rows > 0) {
    return `session present — ${check.label}=${rows} real rows`;
  }
  throw new Error(
    `loginRequired=${json.loginRequired} ${check.label}=${rows} (fake-empty signature)`,
  );
}

function printRow(ok, name, detail) {
  const mark = ok ? "✓" : "✗";
  const paddedName = name.padEnd(38);
  const clipped = detail.length > 60 ? detail.slice(0, 57) + "..." : detail;
  console.log(`  ${mark}  ${paddedName} ${clipped}`);
}

async function runSuite(target) {
  const results = { pass: 0, fail: 0, failures: [] };

  console.log("\nPAGES — shell + title");
  for (const check of PAGE_CHECKS) {
    try {
      const detail = await runPageCheck(target, check);
      results.pass++;
      printRow(true, `GET ${check.path}`, detail);
    } catch (err) {
      results.fail++;
      results.failures.push(`page ${check.path}: ${err.message}`);
      printRow(false, `GET ${check.path}`, err.message);
    }
  }

  console.log("\nAPI — live data");
  for (const check of API_CHECKS) {
    try {
      const detail = await runApiCheck(target, check);
      results.pass++;
      printRow(true, check.name, detail);
    } catch (err) {
      results.fail++;
      results.failures.push(`api ${check.name} (${check.path}): ${err.message}`);
      printRow(false, check.name, err.message);
    }
  }

  console.log("\nHONEST DEGRADATION — personal surfaces without session");
  for (const check of DEGRADE_CHECKS) {
    try {
      const detail = await runDegradeCheck(target, check);
      results.pass++;
      printRow(true, check.name, detail);
    } catch (err) {
      results.fail++;
      results.failures.push(`degrade ${check.name} (${check.path}): ${err.message}`);
      printRow(false, check.name, err.message);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// --selftest: a hermetic mock deployment (loopback only, ephemeral port)
// ---------------------------------------------------------------------------

function video(id, title) {
  return {
    id,
    title,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    durationSec: 213,
    views: 1_000_000,
    viewsText: "1M views",
    publishedText: "13 years ago",
    category: "Music",
    isLive: false,
    isShort: false,
    isMembersOnly: false,
    channel: {
      id: "UCuAXFkgcl1yQ0yQ0yQ0yQ0y",
      name: "Rick Astley",
      handle: "RickAstleyYT",
      avatarUrl: "https://example.invalid/a.jpg",
      verified: true,
    },
  };
}

function startMockServer() {
  const titles = new Map(PAGE_CHECKS.map((c) => [c.path.replace(/\?.*$/, ""), c.title]));
  const channels = [
    {
      id: "UCuAXFkgcl1yQ0yQ0yQ0yQ0y",
      name: "Rick Astley",
      handle: "RickAstleyYT",
      avatarUrl: "https://example.invalid/a.jpg",
      verified: true,
    },
  ];

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    const q = url.searchParams;
    const send = (status, body, type) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    const json = (obj) => send(200, JSON.stringify(obj), "application/json");

    if (req.method === "GET" && titles.has(path)) {
      return send(
        200,
        `<!doctype html><html><head><title>${titles.get(path)}</title></head><body>shell</body></html>`,
        "text/html",
      );
    }
    if (path === "/api/home") {
      return json({
        hero: video("dQw4w9WgXcQ", "Never Gonna Give You Up"),
        trending: [],
        continueWatching: [],
        becauseYouWatched: null,
        shorts: [video("short1", "S1")],
        recommended: Array.from({ length: 24 }, (_, i) => video(`rec${i}`, `Rec ${i}`)),
        recommendedCursor: "cur",
        chips: ["All", "Music"],
      });
    }
    if (path === "/api/videos") {
      const limit = Math.min(12, Number(q.get("limit") ?? 12) || 12);
      return json({
        videos: Array.from({ length: limit }, (_, i) => video(`v${i}`, `V ${i}`)),
        nextCursor: "cur",
      });
    }
    if (path === "/api/trending") {
      return json({
        category: q.get("category") ?? "Now",
        videos: Array.from({ length: 10 }, (_, i) => video(`t${i}`, `T ${i}`)),
        source: "trending",
      });
    }
    if (path === "/api/search") {
      return json({ query: q.get("q") ?? "", videos: [video("s1", "Search hit")], channels, playlists: [] });
    }
    if (path === "/api/search/suggest") {
      return json({ query: q.get("q") ?? "", suggestions: ["music video", "music playlist"] });
    }
    if (path === "/api/videos/dQw4w9WgXcQ") {
      return json({ ...video("dQw4w9WgXcQ", "Never Gonna Give You Up (Official Video)"), description: "d", likeCount: 1 });
    }
    if (path === "/api/watch/dQw4w9WgXcQ") {
      return json({
        video: video("dQw4w9WgXcQ", "NGGYU"),
        isSubscribed: false,
        isOwner: false,
        memberTierName: null,
        related: [video("r1", "R1")],
        comments: [],
      });
    }
    if (path === "/api/videos/dQw4w9WgXcQ/comments") {
      return json({
        items: [
          {
            id: "c1",
            body: "b",
            likes: 1,
            heartedByCreator: false,
            pinned: false,
            createdAt: null,
            author: { handle: "@a", name: "A", avatarUrl: "u" },
            replyCount: 0,
          },
        ],
        nextCursor: null,
        total: 1,
      });
    }
    if (path === "/api/videos/dQw4w9WgXcQ/related") {
      return json({ items: [video("r1", "Related 1")], nextCursor: null });
    }
    if (path === "/api/videos/dQw4w9WgXcQ/live-status") {
      return json({ isLive: false, concurrentViewers: null, viewersText: null, likesText: "768K", dateText: null, pollMs: 5000 });
    }
    if (path === "/api/shorts") {
      return json({ items: [{ id: "sh1", title: "Short 1", viewsText: "1M views" }], nextCursor: "cur" });
    }
    if (path === "/api/live") {
      return json({ videos: [video("lv1", "Live now")] });
    }
    if (path === "/api/channel/@RickAstley" || path === "/api/channel/RickAstleyYT") {
      return json({
        channel: {
          id: "UCuAXFkgcl1yQ0yQ0yQ0yQ0y",
          handle: "RickAstleyYT",
          name: "Rick Astley",
          avatarUrl: "u",
          verified: true,
          subscriberCount: 4_500_000,
          subscriberCountText: "4.5M subscribers",
          bannerUrl: "b",
          description: "d",
          createdAt: null,
          isSubscribed: false,
          isOwner: false,
          videoCount: 500,
        },
        videos: [video("cv1", "Channel video")],
        shorts: [],
      });
    }
    if (path === "/api/channel/@RickAstley/search") {
      return json({
        query: q.get("q") ?? "",
        channelId: "UCuAXFkgcl1yQ0yQ0yQ0yQ0y",
        channelName: "Rick Astley",
        videos: [video("cs1", "Never Gonna Give You Up")],
        nextCursor: null,
      });
    }
    if (path === "/api/history") {
      return json({ groups: [], nextCursor: null, loginRequired: true, watchHistoryPaused: false, searchHistoryPaused: false, total: 0, session: false });
    }
    if (path === "/api/subscriptions") {
      return json({ channels: [], videos: [], nextCursor: null, loginRequired: true, session: false });
    }
    if (path === "/api/playlists") {
      return json({ playlists: [], loginRequired: true, session: false });
    }
    if (path === "/api/notifications") {
      return json({ unread: 0, items: [], pollIntervalMs: 300000, loginRequired: true, session: false });
    }
    if (path === "/api/liked") {
      return json({ videos: [], playlist: null, nextCursor: null, loginRequired: true, session: false });
    }
    return json({ error: "mock miss", path });
  });

  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (selftest) {
    const server = await startMockServer();
    const { port } = server.address();
    const target = `http://127.0.0.1:${port}`;
    console.log("══════════════════════════════════════════════════════════════");
    console.log(" WFX2-C-W ACCEPTANCE — SELFTEST (hermetic mock server, loopback)");
    console.log(` target: ${target}`);
    console.log("══════════════════════════════════════════════════════════════");
    const results = await runSuite(target);
    server.close();
    finish(results);
    return;
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log(" WFX2-C-W ACCEPTANCE — LIVE DEPLOYMENT");
  console.log(` target: ${base} (ACCEPT_URL)`);
  console.log("══════════════════════════════════════════════════════════════");
  const results = await runSuite(base);
  finish(results);
}

function finish(results) {
  const total = results.pass + results.fail;
  console.log("──────────────────────────────────────────────────────────────");
  console.log(` ${results.pass}/${total} checks passed · ${results.fail} failed`);
  if (results.fail > 0) {
    console.log("\n FAILURES:");
    for (const f of results.failures) console.log(`   ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("acceptance harness crashed:", err);
  process.exit(1);
});
