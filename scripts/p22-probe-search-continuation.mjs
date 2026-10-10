/**
 * P22-C dev-time LIVE probe (never in tests) — inspect the RAW shapes of
 * consecutive search continuation responses to find where the continuation
 * token actually lives on page 2+.
 *
 * Run: bun scripts/p22-probe-search-continuation.mjs
 */
import { innertubeSearch, innerTubeContext } from "../src/lib/youtube/innertube.ts";

const has = (o, path) => {
  let n = o;
  for (const k of path.split(".")) {
    if (n == null || typeof n !== "object") return false;
    n = n[k];
  }
  return n != null;
};

const findTokenPaths = (obj, prefix = "", out = []) => {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (k === "token" && typeof v === "string" && v.length > 20) out.push(p);
      if (v && typeof v === "object") findTokenPaths(v, p, out);
    }
  }
  return out;
};

// ---- page 1: the initial search
const body1 = { ...innerTubeContext(), query: "music" };
const r1 = await innertubeSearch({ query: "music" });
console.log("PAGE 1 top-level keys:", Object.keys(r1));
console.log("PAGE 1 has sectionListRenderer:", has(r1, "contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer"));
const paths1 = findTokenPaths(r1).filter((p) => p.includes("continuation"));
console.log("PAGE 1 continuation token paths:", JSON.stringify(paths1, null, 1));
const tok1 =
  r1?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.find(
    (c) => c?.continuationItemRenderer
  )?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
console.log("PAGE 1 token (classic path):", tok1 ? `${tok1.slice(0, 40)}… (len ${tok1.length})` : "NONE");

// ---- page 2: the continuation POST
const r2 = await innertubeSearch({ continuation: tok1 });
console.log("\nPAGE 2 top-level keys:", Object.keys(r2));
console.log("PAGE 2 has onResponseReceivedCommands:", has(r2, "onResponseReceivedCommands"));
console.log("PAGE 2 has sectionListRenderer anywhere:", JSON.stringify(findTokenPaths(r2)).length > 0 ? "tokens exist — see paths" : "no tokens");
let sectionList2 = false;
const walk = (o) => {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) return o.forEach(walk);
  for (const [k, v] of Object.entries(o)) {
    if (k === "sectionListRenderer") sectionList2 = true;
    walk(v);
  }
};
walk(r2);
console.log("PAGE 2 contains a sectionListRenderer node:", sectionList2);
const paths2 = findTokenPaths(r2).filter((p) => p.includes("continuation"));
console.log("PAGE 2 continuation token paths:", JSON.stringify(paths2, null, 1));
const append = r2?.onResponseReceivedCommands?.find((c) => c?.appendContinuationItemsAction)?.appendContinuationItemsAction;
if (append) {
  console.log("PAGE 2 appendContinuationItemsAction item count:", append.continuationItems?.length);
  const tok2 = append.continuationItems?.find((c) => c?.continuationItemRenderer)?.continuationItemRenderer
    ?.continuationEndpoint?.continuationCommand?.token;
  console.log("PAGE 2 token (append path):", tok2 ? `${tok2.slice(0, 40)}… (len ${tok2.length})` : "NONE");
  const kinds = append.continuationItems?.map((c) => Object.keys(c)[0]);
  console.log("PAGE 2 item kinds:", JSON.stringify(kinds));
}

// ---- page 3: continue the chain one more step to prove depth
const tok2b =
  append?.continuationItems?.find((c) => c?.continuationItemRenderer)?.continuationItemRenderer
    ?.continuationEndpoint?.continuationCommand?.token;
if (tok2b) {
  const r3 = await innertubeSearch({ continuation: tok2b });
  const append3 = r3?.onResponseReceivedCommands?.find((c) => c?.appendContinuationItemsAction)?.appendContinuationItemsAction;
  const tok3 = append3?.continuationItems?.find((c) => c?.continuationItemRenderer)?.continuationItemRenderer
    ?.continuationEndpoint?.continuationCommand?.token;
  console.log("\nPAGE 3 items:", append3?.continuationItems?.length ?? "—", "next token:", tok3 ? "PRESENT" : "NONE");
}
