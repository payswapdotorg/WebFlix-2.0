/**
 * P58-TIKTOK-SOURCE — the curated universe + the keyless oEmbed lane
 * (ADR 0004 §2/§3).
 *
 * TikTok publishes no feed API, so the hub's universe is a small curated
 * list: the in-repo seed, overridable by `TIKTOK_CURATED_IDS` (comma-
 * separated post URLs or bare ids — parsed by the URL law, deduped, capped
 * at 40). Each post resolves through the official keyless oEmbed endpoint,
 * server-side only, through the injectable upstream seam, cached via the
 * shared Upstash adapter (soft TTL 6h / hard 24h, own `tt:*` keyspace) —
 * the same ladder the Netflix pools run. A walled egress degrades to honest
 * unavailable cards; the embed lane itself keeps working (viewer-side).
 *
 * The remote oEmbed `html` field is NEVER rendered — the DTO's embedUrl is
 * built locally from the documented params (no remote HTML injection).
 */
import { cachedResilient } from "@/lib/youtube/upstash-cache";
import { curatedAuthorMap, TIKTOK_CURATED_UNIVERSE } from "./curated";
import { tiktokUpstreamFetch } from "./upstream";
import {
  isTikTokPostId,
  parseTikTokVideoUrl,
  tiktokAuthorUrl,
  tiktokOEmbedApiUrl,
  tiktokPlayerEmbedUrl,
  tiktokVideoUrl,
} from "./urls";
import type { TikTokRailDTO, TikTokSearchResultsDTO, TikTokSource, TikTokVideoDTO } from "./types";

/** The curated universe's hard cap (per-domain rate limits stay benign). */
export const TIKTOK_CURATED_CAP = 40;

/**
 * Continuity alias for the P58 name: the curated universe's ids (the P59
 * cited-universe default — TikTok's docs example FIRST, then the HN-cited
 * posts; see curated.ts for the provenance law).
 */
export const TIKTOK_SEED: readonly string[] = TIKTOK_CURATED_UNIVERSE.map((p) => p.postId);

/** The curated universe: env override → the cited default, deduped in order, capped. */
export function curatedPostIds(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.TIKTOK_CURATED_IDS ?? "").trim();
  const seen = new Set<string>();
  if (raw) {
    for (const part of raw.split(",")) {
      const parsed = parseTikTokVideoUrl(part);
      if (parsed && !seen.has(parsed.postId)) seen.add(parsed.postId);
      if (seen.size >= TIKTOK_CURATED_CAP) break;
    }
  }
  if (seen.size === 0) {
    for (const id of TIKTOK_SEED) {
      if (isTikTokPostId(id) && !seen.has(id)) seen.add(id);
      if (seen.size >= TIKTOK_CURATED_CAP) break;
    }
  }
  return [...seen];
}

/** The canonical video URL an oEmbed call expects (author best-effort). */
function oEmbedTargetUrl(postId: string, author: string | null): string {
  return tiktokVideoUrl(author, postId);
}

/** The documented oEmbed response shape — everything beyond
 * `embed_product_id` is optional (the parser never trusts `html`). */
interface OEmbedResponse {
  version?: string;
  type?: string;
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  width?: number | string;
  height?: number | string;
  html?: string;
  provider_name?: string;
  embed_product_id?: string;
  embed_type?: string;
}

function toNum(v: number | string | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * P59-R2 — the curated fallback card: when the oEmbed lane is walled, a
 * cited post STILL renders an honest card — the factual `@handle` from the
 * citation, a URL-law author link, no fabricated title/thumbnail, and
 * `unavailable: false` because the embed player (viewer-side) may play
 * regardless. Provenance stays `tiktok-curated` so no surface can mistake
 * it for an oEmbed answer.
 */
function curatedFallbackDTO(postId: string, author: string): TikTokVideoDTO {
  return {
    postId,
    author,
    authorUrl: tiktokAuthorUrl(author),
    title: null,
    thumbnailUrl: null,
    width: null,
    height: null,
    embedUrl: tiktokPlayerEmbedUrl(postId),
    deepLinkUrl: tiktokVideoUrl(author, postId),
    source: "tiktok-curated",
    unavailable: false,
    unavailableReason: null,
  };
}

/** The honest unavailable card (walled egress / private / deleted post).
 * An INVALID id gets an empty embedUrl — the URL law refuses to build a
 * broken player URL, and no surface renders an invalid id anyway (routes
 * answer 400, the view validates). */
function unavailableDTO(postId: string, reason: string): TikTokVideoDTO {
  return {
    postId,
    author: null,
    authorUrl: null,
    title: null,
    thumbnailUrl: null,
    width: null,
    height: null,
    embedUrl: isTikTokPostId(postId) ? tiktokPlayerEmbedUrl(postId) : "",
    deepLinkUrl: isTikTokPostId(postId) ? tiktokVideoUrl(null, postId) : "",
    source: "tiktok-oembed",
    unavailable: true,
    unavailableReason: reason,
  };
}

async function fetchOEmbed(postId: string): Promise<OEmbedResponse | null> {
  const url = tiktokOEmbedApiUrl(oEmbedTargetUrl(postId, null));
  const doFetch = async (): Promise<Response | null> => {
    try {
      const res = await tiktokUpstreamFetch()(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      return res;
    } catch {
      return null;
    }
  };
  const res = await doFetch();
  if (!res) return null;
  try {
    const body = (await res.json()) as OEmbedResponse;
    // The one field TikTok guarantees for a valid post: the product id. A
    // mismatched id means the endpoint answered something else — treat as
    // honest absence rather than rendering a foreign row.
    if (!body || body.embed_product_id !== postId) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * One video: cached oEmbed → DTO. The cached value IS the DTO (success or
 * honest-unavailable) — a walled window serves the honest card until the
 * soft TTL re-opens the fetch, mirroring the pools' last-good ladder.
 */
export async function getTikTokVideo(postId: string): Promise<TikTokVideoDTO> {
  if (!isTikTokPostId(postId)) {
    return unavailableDTO(postId, "Not a valid TikTok post id.");
  }
  return cachedResilient<TikTokVideoDTO>(
    `tt:oembed:${postId}`,
    6 * 60 * 60 * 1000,
    async () => {
      const body = await fetchOEmbed(postId);
      if (!body) {
        // P59-R2: a cited post keeps its factual handle even when the
        // metadata lane walls — the card stays renderable, the player rides.
        const cited = curatedAuthorMap().get(postId);
        if (cited) return curatedFallbackDTO(postId, cited.author);
        return unavailableDTO(
          postId,
          "TikTok's oEmbed endpoint is unreachable from this egress right now (or the post is private/removed) — the embed player still rides the official lane."
        );
      }
      const author = typeof body.author_name === "string" && body.author_name ? body.author_name : null;
      return {
        postId,
        author,
        authorUrl: typeof body.author_url === "string" && body.author_url ? body.author_url : null,
        title: typeof body.title === "string" && body.title ? body.title : null,
        thumbnailUrl:
          typeof body.thumbnail_url === "string" && body.thumbnail_url ? body.thumbnail_url : null,
        width: toNum(body.width),
        height: toNum(body.height),
        embedUrl: tiktokPlayerEmbedUrl(postId),
        deepLinkUrl: tiktokVideoUrl(author, postId),
        source: "tiktok-oembed",
        unavailable: false,
        unavailableReason: null,
      };
    }
  );
}

/**
 * The hub composition: every curated post resolved (concurrently), each
 * honestly successful or honestly unavailable. `unavailable` on the RAIL
 * means every video failed — the hub renders the notice, never fake rows.
 */
export async function getTikTokRail(): Promise<TikTokRailDTO> {
  const ids = curatedPostIds();
  const videos = await Promise.all(ids.map((id) => getTikTokVideo(id)));
  const ok = videos.filter((v) => !v.unavailable);
  // P59-R2: provenance reflects what actually served the cards — oEmbed when
  // any row rode it, the cited fallback when only curated handles served.
  const anyOEmbed = videos.some((v) => v.source === "tiktok-oembed" && !v.unavailable);
  const source: TikTokSource =
    ok.length > 0 ? (anyOEmbed ? "tiktok-oembed" : "tiktok-curated") : ids.length > 0 ? "tiktok-curated" : "";
  return {
    videos,
    universeSize: ids.length,
    source,
    unavailable: ids.length > 0 && ok.length === 0,
    unavailableReason:
      ids.length === 0
        ? null
        : ok.length === 0
          ? "TikTok's metadata endpoint is unreachable from this egress right now — the curated posts stay listed with their embed players intact."
          : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * The global-search lane over the curated library (render-when-answers law):
 * matches against whatever metadata the cache holds — no metadata (walled
 * egress) → no matches → the shelf renders nothing, never a placeholder.
 */
export async function searchTikTokLibrary(q: string): Promise<TikTokSearchResultsDTO> {
  const query = q.trim();
  const ids = curatedPostIds();
  if (!query || ids.length === 0) {
    return { q, videos: [], universeSize: ids.length, source: "", note: null };
  }
  const needle = query.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean).slice(0, 6);
  const rail = await getTikTokRail();
  const videos = rail.videos.filter((v) => {
    if (v.unavailable) return false;
    const hay = `${v.title ?? ""} ${v.author ?? ""}`.toLowerCase();
    const text = hay.includes(needle) || tokens.some((t) => t.length > 0 && hay.includes(t));
    return text;
  });
  const anyOEmbed = videos.some((v) => v.source === "tiktok-oembed");
  const source: TikTokSource = videos.length > 0 ? (anyOEmbed ? "tiktok-oembed" : "tiktok-curated") : "";
  return {
    q,
    videos,
    universeSize: ids.length,
    source,
    note: videos.length > 0 ? "From WebFlix's curated TikTok shelf." : null,
  };
}
