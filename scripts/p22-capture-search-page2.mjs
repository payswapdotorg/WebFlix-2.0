/**
 * P22-C dev-time LIVE probe (never in tests) — capture a REAL search
 * continuation page-2 response (the appendContinuationItemsAction shape) for
 * the fixtures, sanitized: tracking/framework params trimmed, the item
 * section's video renderers reduced to 3, tokens kept intact.
 *
 * Run: bun scripts/p22-capture-search-page2.mjs
 */
import { writeFileSync } from "node:fs";
import { innertubeSearch } from "../src/lib/youtube/innertube.ts";

const r1 = await innertubeSearch({ query: "lofi hip hop radio" });
const tok1 =
  r1?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.find(
    (c) => c?.continuationItemRenderer
  )?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
if (!tok1) {
  console.error("page 1 carried no continuation token — aborting");
  process.exit(1);
}
console.log("page1 token len", tok1.length);

const r2 = await innertubeSearch({ continuation: tok1 });
const append = r2?.onResponseReceivedCommands?.find((c) => c?.appendContinuationItemsAction)
  ?.appendContinuationItemsAction;
if (!append) {
  console.error("page 2 had no appendContinuationItemsAction — keys:", Object.keys(r2));
  process.exit(1);
}

// sanitize: keep the first 3 video renderers + the continuation item; strip
// tracking params (clickTrackingParams etc.) recursively
function strip(o) {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "clickTrackingParams" || k === "trackingParams" || k === "targetId") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return o;
}

const items = append.continuationItems ?? [];
const itemSection = items.find((i) => i?.itemSectionRenderer);
const continuationItem = items.find((i) => i?.continuationItemRenderer);
const trimmedSection = itemSection
  ? {
      itemSectionRenderer: {
        ...itemSection.itemSectionRenderer,
        contents: (itemSection.itemSectionRenderer.contents ?? []).slice(0, 3),
      },
    }
  : null;

const fixture = {
  responseContext: { visitorData: "SANITIZED", maxAgeSeconds: 3600 },
  estimatedResults: r2?.estimatedResults ?? "0",
  onResponseReceivedCommands: [
    {
      appendContinuationItemsAction: {
        continuationItems: [
          ...(trimmedSection ? [trimmedSection] : []),
          ...(continuationItem ? [continuationItem] : []),
        ],
        targetId: "search-feed_sanitize-target",
      },
    },
  ],
  header: { searchHeaderRenderer: { Sanitized: "header kept shape only" } },
  _sanitized: "P22-C capture 2026-10-10: real youtubei/v1/search continuation page-2 (appendContinuationItemsAction shape); video renderers trimmed to 3; tracking params stripped; tokens intact",
};

const TOKEN_2 = continuationItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ?? null;
console.log("page2 items:", items.length, "| kept section:", !!trimmedSection, "| continuation token:", !!TOKEN_2);

writeFileSync("tests/fixtures/yt/search_page2_append.json", JSON.stringify(fixture, null, 1));
console.log("wrote tests/fixtures/yt/search_page2_append.json");

// and walk one more page to prove the chain keeps going (token_2 → page 3)
if (TOKEN_2) {
  const r3 = await innertubeSearch({ continuation: TOKEN_2 });
  const append3 = r3?.onResponseReceivedCommands?.find((c) => c?.appendContinuationItemsAction)
    ?.appendContinuationItemsAction;
  const tok3 = append3?.continuationItems?.find((i) => i?.continuationItemRenderer)
    ?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  console.log("page3 items:", append3?.continuationItems?.length ?? "none", "| page3 token:", !!tok3);
}
