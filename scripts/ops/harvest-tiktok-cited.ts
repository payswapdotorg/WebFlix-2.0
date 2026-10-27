/**
 * P59-R1 harvest — real TikTok post URLs cited on Hacker News (Algolia open
 * API, no key). Zero guessed ids: every entry comes from a cited URL whose
 * @handle and numeric id appear verbatim in the citation.
 */
export {};
const VIDEO_RE =
  /https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([\w.\-]+)\/video\/(\d{6,32})/g;

interface Hit {
  url?: string | null;
  story_url?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  title?: string | null;
}

const seen = new Map<string, { postId: string; author: string; cite: string }>();

function scan(text: string | null | undefined, cite: string): void {
  if (!text) return;
  for (const m of text.matchAll(VIDEO_RE)) {
    const author = m[1];
    const postId = m[2];
    if (!seen.has(postId)) seen.set(postId, { postId, author, cite });
  }
}

async function search(query: string, pages: number): Promise<void> {
  for (let page = 0; page < pages; page++) {
    const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=100&page=${page}`;
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const body = (await res.json()) as { hits?: Hit[] };
      const hits = body.hits ?? [];
      for (const h of hits) {
        scan(h.url, h.url ?? "hit-url");
        scan(h.story_url, h.story_url ?? "story-url");
        scan(h.story_text, "story-text");
        scan(h.comment_text, "comment-text");
      }
      if (hits.length < 100) return;
    } catch {
      return;
    }
  }
}

const queries = ["tiktok.com/@/video", "tiktok.com", "tiktok video", "www.tiktok.com"];
for (const q of queries) await search(q, 3);

const entries = [...seen.values()];
console.log(JSON.stringify({ total: entries.length, entries: entries.slice(0, 60) }, null, 1));
