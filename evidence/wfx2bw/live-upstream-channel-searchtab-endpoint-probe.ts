export {};
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
// 1) plain channel browse: does it carry a search box with its params?
const data = await yt("browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw" });
const s = JSON.stringify(data);
console.log("has channelSearchBoxRenderer:", s.includes("channelSearchBoxRenderer"));
// dump any searchEndpoint in the channel response
const endpoints: any[] = [];
function walk(n: any) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.searchEndpoint) endpoints.push(n.searchEndpoint);
  if (n.continuationCommand && n.query) endpoints.push({query: n.query, continuation: "..."});
  for (const v of Object.values(n)) walk(v);
}
walk(data);
console.log("searchEndpoints in channel response:", JSON.stringify(endpoints).slice(0, 500));
// 2) The channel "Search" expandable tab — its endpoint:
const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
const searchTab = tabs.find((t: any) => t.expandableTabRenderer);
console.log("expandableTab title:", searchTab?.expandableTabRenderer?.title, "| endpoint:", JSON.stringify(searchTab?.expandableTabRenderer?.endpoint).slice(0, 400));
