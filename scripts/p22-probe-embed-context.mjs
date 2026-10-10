/**
 * P22-C dev-time LIVE probe (never in tests) — the EMBED context angle:
 * WEB_EMBEDDED_PLAYER with the thirdParty.embedUrl context real embeds send,
 * across several videos (some embeddable), plus the embed page's own
 * player_config JSON for wall evidence.
 *
 * Run: bun scripts/p22-probe-embed-context.mjs
 */
import { innertube } from "../src/lib/youtube/innertube.ts";
import { upstreamFetch } from "../src/lib/youtube/upstream.ts";

const VIDEOS = ["dQw4w9WgXcQ", "1X_yQ8m0Q2o", "8hRGBcr_gJc", "TyHvyGVs42U"];

for (const videoId of VIDEOS) {
  try {
    const r = await innertube("player", {
      context: {
        client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" },
        thirdParty: { embedUrl: "https://webflix-2-0-one.vercel.app" },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    });
    const status = r?.playabilityStatus?.status;
    const reason = r?.playabilityStatus?.reason ?? "";
    const plain = (r?.streamingData?.formats ?? []).filter((f) => typeof f?.url === "string" && f.url.length > 0);
    const sb = r?.storyboards?.playerStoryboardSpecRenderer?.spec ? "sb" : "-";
    console.log(`WEB_EMBEDDED_PLAYER+3p ${videoId}: status=${status} plain=${plain.length} ${sb} ${reason ? "reason=" + JSON.stringify(reason).slice(0, 50) : ""}`);
  } catch (e) {
    console.log(`WEB_EMBEDDED_PLAYER+3p ${videoId}: THREW ${String(e).slice(0, 70).replace(/\n/g, " ")}`);
  }
}

// the embed HTML page itself — what does its embedded config say?
console.log("\n== /embed/dQw4w9WgXcQ page (server-side read) ==");
try {
  const res = await upstreamFetch()("https://www.youtube.com/embed/dQw4w9WgXcQ?hl=en&gl=US", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
  });
  const html = await res.text();
  const m = html.match(/"embedded_player_response":"((?:[^"\\]|\\.)*)"/);
  if (m) {
    const json = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    const prs = json?.previewPlayabilityStatus ?? {};
    console.log("previewPlayabilityStatus:", JSON.stringify(prs).slice(0, 220));
  } else {
    const m2 = html.match(/ytInitialData\s*=\s*(\{.+?\});/);
    console.log("no embedded_player_response key; page len", html.length, "has ytInitialData:", !!m2);
    const wall = /Sign in to confirm|not a bot|playable_in_embed|UNPLAYABLE/i;
    console.log("wall-ish text in page:", wall.test(html));
    const pim = html.match(/"playableInEmbed":(true|false)/);
    console.log("playableInEmbed:", pim ? pim[1] : "n/a");
  }
} catch (e) {
  console.log("embed page THREW", String(e).slice(0, 100));
}
