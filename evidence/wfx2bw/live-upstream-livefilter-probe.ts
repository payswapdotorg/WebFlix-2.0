export {};
const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CTX = { context: { client: { clientName: "WEB", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" } } };
async function yt(endpoint: string, body: object) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: "https://www.youtube.com" },
    body: JSON.stringify({ ...CTX, ...body }),
  });
  return { status: res.status, data: res.status === 200 ? await res.json() : await res.text() };
}
function analyze(data: any, label: string) {
  let live = 0, videos = 0, watching: string[] = [];
  function walk(n: any) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const vr = n.videoRenderer;
    if (vr?.videoId) {
      videos++;
      const style = vr.thumbnailOverlays?.some((o: any) => o?.thumbnailOverlayTimeStatusRenderer?.style === "LIVE");
      const wt = vr.shortViewCountText?.simpleText ?? vr.viewCountText?.simpleText ?? "";
      if (style || /watching now/i.test(wt)) { live++; watching.push(`${vr.title?.runs?.[0]?.text?.slice(0,40)} [${wt}]`); }
    }
    for (const v of Object.values(n)) walk(v);
  }
  walk(data);
  console.log(`${label}: ${videos} videos, ${live} LIVE → ${watching.slice(0,3).join(" | ")}`);
}
// 1. live feature filter with query "live"
let r = await yt("search", { query: "live", params: "EgJAAQ==" });
console.log("HTTP", r.status); if (typeof r.data === "object") analyze(r.data, "search q=live params=EgJAAQ (Features:Live)");
// 2. empty-ish query with live param
r = await yt("search", { query: "", params: "EgJAAQ==" });
console.log("HTTP", r.status); if (typeof r.data === "object") analyze(r.data, "search q='' params=EgJAAQ");
// 3. combined: live feature + type video
r = await yt("search", { query: "news", params: "EgJAAQ%3D%3D" });
console.log("HTTP", r.status); if (typeof r.data === "object") analyze(r.data, "search q=news params=EgJAAQ (live)");
