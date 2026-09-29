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
function dumpShape(data: any, label: string) {
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  console.log(label, "| tabs:", tabs.map((t: any) => t?.tabRenderer?.title ?? "?").join(", "));
  const alerts = [];
  function walk(n: any) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.alertRenderer) alerts.push(n.alertRenderer.text?.simpleText ?? JSON.stringify(n.alertRenderer.text));
    if (n.channelSearchBoxRenderer) console.log("channelSearchBox found:", JSON.stringify(n.channelSearchBoxRenderer).slice(0, 400));
    for (const v of Object.values(n)) walk(v);
  }
  walk(data);
  if (alerts.length) console.log("alerts:", alerts);
}
// variant A: browse with params {2: query, 6: 8} (what I tried)
const q = "never";
const bytes = [0x12, q.length, ...Buffer.from(q), 0x30, 0x08];
const params = Buffer.from(bytes).toString("base64");
let data = await yt("browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params, query: q });
dumpShape(data, "A: browse{params:{2:q,6:8}, query}");
// variant B: search with browseId + params + query
data = await yt("search", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params, query: q });
const titles: string[] = [];
function walk2(n: any) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk2); return; }
  if (n.videoRenderer?.videoId) titles.push(n.videoRenderer.title?.runs?.[0]?.text ?? "");
  for (const v of Object.values(n)) walk2(v);
}
walk2(data);
console.log("B: search{browseId, params, query} → videos:", titles.length, titles.slice(0, 5));
