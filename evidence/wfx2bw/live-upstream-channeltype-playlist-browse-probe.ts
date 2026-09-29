const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CTX = { context: { client: { clientName: "WEB", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" } } };
async function yt(endpoint: string, body: object) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ ...CTX, ...body }),
  });
  return res.json();
}
// 1. type=channel search
let data = await yt("search", { query: "lofi", params: "EgIQAg==" });
const s = JSON.stringify(data);
console.log("type=channel: channelRenderer:", (s.match(/"channelRenderer"/g)||[]).length, "| lockupViewModel:", (s.match(/"lockupViewModel"/g)||[]).length);
// 2. playlist browse VL…
data = await yt("browse", { browseId: "VLPLKF4F4n54F99H4YEa9bBmNC-xCXmNaW5B" });
const s2 = JSON.stringify(data);
console.log("VL browse: playlistVideoRenderer:", (s2.match(/"playlistVideoRenderer"/g)||[]).length, "| lockupViewModel:", (s2.match(/"lockupViewModel"/g)||[]).length, "| videoRenderer:", (s2.match(/"videoRenderer"/g)||[]).length);
// dump the playlist header (title/byline)
const ph = data?.header?.playlistHeaderRenderer ?? null;
console.log("playlistHeaderRenderer:", ph ? JSON.stringify({title: ph.title?.runs?.[0]?.text, owner: ph.ownerText?.runs?.[0]?.text, count: ph.stats?.map((x:any)=>x?.runs?.[0]?.text)}) : "none");
// what's in the sidebar?
console.log("browseId keys of contents:", Object.keys(data?.contents ?? {}));
