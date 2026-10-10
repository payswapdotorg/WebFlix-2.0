/**
 * P22-C dev-time LIVE probe (never in tests) — try a wide matrix of
 * innertube player clients against one video to find which (if any) answer
 * usable plain-url formats from this egress, and what the others say.
 *
 * Run: bun scripts/p22-probe-player-clients.mjs [videoId]
 */
import { innertube } from "../src/lib/youtube/innertube.ts";

const videoId = process.argv[2] ?? "1X_yQ8m0Q2o";

const CLIENTS = [
  { clientName: "WEB", clientVersion: "2.20260925.08.00" },
  { clientName: "MWEB", clientVersion: "2.20260925.08.00" },
  { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "2.20260925.08.00" },
  { clientName: "WEB_REMIX", clientVersion: "0.1" },
  { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0" },
  {
    clientName: "IOS",
    clientVersion: "20.10.4",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.3.2.22D82",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    deviceMake: "Google",
    deviceModel: "Pixel 9",
    osName: "Android",
    osVersion: "15",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip",
    androidSdkVersion: 35,
  },
  { clientName: "TVHTML5", clientVersion: "7.20260925.10.00" },
];

for (const client of CLIENTS) {
  try {
    const r = await innertube("player", {
      context: { client: { ...client, hl: "en", gl: "US" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    });
    const status = r?.playabilityStatus?.status;
    const reason = r?.playabilityStatus?.reason ?? "";
    const fmts = r?.streamingData?.formats ?? [];
    const plain = fmts.filter((f) => typeof f?.url === "string" && f.url.length > 0);
    const adaptive = (r?.streamingData?.adaptiveFormats ?? []).filter(
      (f) => typeof f?.url === "string" && f.url.length > 0
    );
    const sb = r?.storyboards?.playerStoryboardSpecRenderer?.spec ? "sb" : "-";
    console.log(
      `${client.clientName.padEnd(30)} v${String(client.clientVersion).padEnd(14)} status=${String(status).padEnd(16)} plain=${plain.length} plainAdaptive=${adaptive.length} ${sb} ${reason ? "reason=" + JSON.stringify(reason).slice(0, 60) : ""}`
    );
    if (plain.length > 0) {
      console.log(`   -> itag=${plain[0].itag} ${plain[0].qualityLabel ?? ""} ${String(plain[0].mimeType).slice(0, 40)} url_len=${plain[0].url.length}`);
    }
  } catch (e) {
    console.log(`${client.clientName.padEnd(30)} v${String(client.clientVersion).padEnd(14)} THREW ${String(e).slice(0, 90).replace(/\n/g, " ")}`);
  }
}
