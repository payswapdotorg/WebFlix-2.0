const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CTX = { context: { client: { clientName: "WEB", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" } } };
async function yt(endpoint: string, body: object) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ ...CTX, ...body }),
  });
  return res.json();
}
const data = await yt("browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params: "EgZzZWFyY2jyBgQKAloA", query: "never" });
const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
console.log("tabs:", tabs.map((t: any) => t?.tabRenderer?.title ?? t?.expandableTabRenderer?.title ?? "?").join(", "));
const selected = tabs.find((t: any) => (t.tabRenderer ?? t.expandableTabRenderer)?.selected);
const tr = (selected?.tabRenderer ?? selected?.expandableTabRenderer) ?? tabs.find((t:any)=>t.expandableTabRenderer)?.expandableTabRenderer;
const content = tr?.content ?? {};
const s = JSON.stringify(content);
console.log("search tab content: videoRenderer:", (s.match(/"videoRenderer"/g)||[]).length, "| richItem:", (s.match(/"richItemRenderer"/g)||[]).length);
const titles: string[] = [];
function walk(n: any) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.videoRenderer?.videoId) titles.push(n.videoRenderer.title?.runs?.[0]?.text ?? "");
  for (const v of Object.values(n)) walk(v);
}
walk(content);
console.log("titles:", titles.length, "→", titles.slice(0, 5));
// also: continuation token for paging?
const tokens = (s.match(/"token":"[^"]{20,80}"/g) ?? []).slice(0,2);
console.log("continuation tokens found:", tokens.length);
