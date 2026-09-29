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
const data = await yt("search", { query: "lofi", params: "EgIQAw==" });
// what item types are in sectionList?
const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
for (const section of sections) {
  const isr = section.itemSectionRenderer;
  if (isr) {
    for (const item of isr.contents ?? []) {
      const key = Object.keys(item)[0];
      console.log("item:", key, key === "lockupViewModel" ? (item.lockupViewModel?.contentId ?? "") + " | " + (item.lockupViewModel?.metadata?.lockupMetadataViewModel?.title?.content ?? "").slice(0, 50) : "");
    }
  }
}
