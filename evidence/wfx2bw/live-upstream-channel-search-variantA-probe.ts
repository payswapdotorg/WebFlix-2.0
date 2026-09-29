const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CTX = { context: { client: { clientName: "WEB", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" } } };
async function yt(endpoint: string, body: object) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ ...CTX, ...body }),
  });
  return { status: res.status, data: res.json() };
}
// channel search params: protobuf {2: query (len-delim), 6: varint 8}
function channelSearchParams(query: string): string {
  const q = Buffer.from(query, "utf8");
  const bytes = [0x12, q.length, ...q, 0x30, 0x08];
  return Buffer.from(bytes).toString("base64");
}
const q = "never";
const params = channelSearchParams(q);
console.log("params for", q, "→", params);
const r = await yt("browse", { browseId: "UCuAXFkgsw1L7xaCfnd5JJOw", params, query: q });
console.log("HTTP", r.status);
const titles: string[] = [];
function walk(n: any) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walk); return; }
  if (n.videoRenderer?.videoId) titles.push(n.videoRenderer.title?.runs?.[0]?.text ?? "");
  if (n.gridVideoRenderer?.videoId) titles.push("[grid] " + n.gridVideoRenderer.title?.runs?.[0]?.text);
  for (const v of Object.values(n)) walk(v);
}
walk(r.data);
console.log("results:", titles.length, "→", titles.slice(0, 6));
