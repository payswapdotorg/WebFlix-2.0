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
const q = "never";
const bytes = [0x12, q.length, ...Buffer.from(q), 0x30, 0x08];
const params = Buffer.from(bytes).toString("base64");
const data = await yt("browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params, query: q });
const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
const last = tabs[tabs.length - 1];
console.log("last tab keys:", Object.keys(last));
const tr = last.tabRenderer ?? last.expandableTabRenderer;
console.log("renderer type:", tr ? Object.keys(last)[0] : "?");
console.log("title:", tr?.title, "| selected:", tr?.selected, "| endpoint browseId:", tr?.endpoint?.browseEndpoint?.browseId);
const content = tr?.content ?? {};
console.log("content keys:", Object.keys(content));
const s = JSON.stringify(content);
console.log("videoRenderer:", (s.match(/"videoRenderer"/g)||[]).length, "| gridVideoRenderer:", (s.match(/"gridVideoRenderer"/g)||[]).length, "| lockupViewModel:", (s.match(/"lockupViewModel"/g)||[]).length, "| richItemRenderer:", (s.match(/"richItemRenderer"/g)||[]).length);
// find titles in that tab
const titles: string[] = [];
function walk(n: any) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.videoRenderer?.videoId) titles.push(n.videoRenderer.title?.runs?.[0]?.text ?? "");
  for (const v of Object.values(n)) walk(v);
}
walk(content);
console.log("videoRenderer titles in last tab:", titles.length, titles.slice(0,6));
