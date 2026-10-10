/**
 * P22-C dev-time LIVE probe (never in tests) — run the streams.ts ladder
 * rung by rung against a real video to see exactly what each rung yields
 * from this egress, including the playabilityStatus of the watch page's
 * embedded ytInitialPlayerResponse.
 *
 * Run: bun scripts/p22-probe-playback-ladder.mjs <videoId>
 */
import { innertube } from "../src/lib/youtube/innertube.ts";
import { playerClientChain } from "../src/lib/youtube/streams.ts";
import { fetchPageHtml } from "../src/lib/youtube/ssr.ts";

const videoId = process.argv[2] ?? "1X_yQ8m0Q2o";
console.log(`== rung 1: innertube player client chain (${playerClientChain().map((c) => c.clientName).join(" → ")}) ==`);
for (const client of playerClientChain()) {
  try {
    const r = await innertube("player", {
      context: { client: { ...client, hl: "en", gl: "US" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    });
    const status = r?.playabilityStatus?.status;
    const reason = r?.playabilityStatus?.reason ?? "";
    const formats = (r?.streamingData?.formats ?? []).filter((f) => typeof f?.url === "string" && f.url.length > 0);
    const adaptive = (r?.streamingData?.adaptiveFormats ?? []).filter((f) => typeof f?.url === "string" && f.url.length > 0);
    console.log(`  ${client.clientName}: status=${status} reason=${JSON.stringify(reason).slice(0, 80)} plainFormats=${formats.length} plainAdaptive=${adaptive.length} storyboards=${r?.storyboards ? "present" : "absent"}`);
    if (formats.length > 0) console.log(`    first plain format itag=${formats[0].itag} ${formats[0].qualityLabel ?? ""} ${formats[0].mimeType}`);
  } catch (e) {
    console.log(`  ${client.clientName}: THREW ${String(e).slice(0, 100)}`);
  }
}

console.log("\n== rung 2: watch-page ytInitialPlayerResponse (SSR) ==");
try {
  const html = await fetchPageHtml(`/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, { timeoutMs: 12_000 });
  const m = html.match(/var ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var |<\/script>)/);
  if (!m) {
    console.log("  no ytInitialPlayerResponse in HTML (len " + html.length + ")");
  } else {
    const pr = JSON.parse(m[1]);
    const status = pr?.playabilityStatus?.status;
    const reason = pr?.playabilityStatus?.reason ?? "";
    const formats = (pr?.streamingData?.formats ?? []).filter((f) => typeof f?.url === "string" && f.url.length > 0);
    const ciphered = (pr?.streamingData?.formats ?? []).filter((f) => f?.signatureCipher || f?.cipher).length;
    const sb = pr?.storyboards?.playerStoryboardSpecRenderer?.spec;
    console.log(`  status=${status} reason=${JSON.stringify(reason).slice(0, 90)}`);
    console.log(`  plainFormats=${formats.length} cipheredFormats=${ciphered} storyboards=${sb ? "present" : "absent"} duration=${pr?.videoDetails?.lengthSeconds}`);
    if (formats.length > 0) console.log(`    first plain format itag=${formats[0].itag} ${formats[0].qualityLabel ?? ""}`);
  }
} catch (e) {
  console.log(`  THREW ${String(e).slice(0, 120)}`);
}

console.log("\n== rung 3: broker (expected offline) ==");
try {
  const { brokerFetchPage } = await import("../src/lib/broker.ts");
  const r = await brokerFetchPage(`/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`);
  console.log("  broker answered:", r instanceof Error ? `Error: ${r.message}` : `body len ${r.body?.length ?? 0}`);
} catch (e) {
  console.log(`  THREW ${String(e).slice(0, 120)}`);
}
