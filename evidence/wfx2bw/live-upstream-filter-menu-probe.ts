export {};
const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CTX = { context: { client: { clientName: "WEB", clientVersion: "2.20260925.08.00", hl: "en", gl: "US" } } };

async function yt(endpoint: string, body: object) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${KEY}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: "https://www.youtube.com", "X-Youtube-Client-Name": "1", "X-Youtube-Client-Version": "2.20260925.08.00" },
    body: JSON.stringify({ ...CTX, ...body }),
  });
  return { status: res.status, data: res.status === 200 ? await res.json() : await res.text() };
}

// count + first titles
function summarize(data: any, label: string) {
  const ids: string[] = [];
  const titles: string[] = [];
  function walk(n: any) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.videoRenderer?.videoId) { ids.push(n.videoRenderer.videoId); titles.push(n.videoRenderer.title?.runs?.[0]?.text ?? ""); }
    for (const v of Object.values(n)) walk(v);
  }
  walk(data);
  console.log(`${label}: ${ids.length} videoRenderers | first 3: ${titles.slice(0,3).map(t=>t.slice(0,45)).join(" || ")}`);
  return ids;
}

const query = process.argv[2] ?? "news";
const params = process.argv[3] ?? "";

const r = await yt("search", params ? { query, params } : { query });
console.log("search", JSON.stringify({ query, params }), "→ HTTP", r.status);
if (typeof r.data === "object") {
  summarize(r.data, "results");
  // dump the filter menu labels for ground truth
  const groups = r.data?.header?.searchHeaderRenderer?.searchFilterButton?.buttonRenderer?.command?.openPopupAction?.popup?.searchFilterOptionsDialogRenderer?.groups ?? [];
  for (const g of groups) {
    const gr = g.searchFilterGroupRenderer;
    const opts = (gr?.filters ?? []).map((f: any) => {
      const fr = f.searchFilterRenderer;
      return `${fr.label.simpleText}[${fr.navigationEndpoint?.searchEndpoint?.params ?? "-"}]`;
    });
    console.log("GROUP:", gr?.title?.simpleText, "→", opts.join(", ").slice(0, 300));
  }
} else console.log(String(r.data).slice(0, 200));
