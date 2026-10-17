/**
 * REA-1 G17 — the hashtag browse (read).
 *
 * The measured seam (live 2026-10-17, docs/research/
 * 2026-10-17-rea1-measurements.md): youtube.com's hashtag pages
 * (/hashtag/<tag>) are a browse surface — the watch page's own hashtag
 * links carry `{browseId: "FEhashtag", params: <protobuf>}` where the
 * params encode field 93 → { field 1: the tag bytes, field 3: 1 } (the
 * "All" chip state). The reconstructed params byte-match youtube.com's own
 * (verified live: `6gUICgRsb2ZpGAE=` for "lofi"), and the read serves from
 * this sandbox's egress: title "#lofi" + meta "7M videos • 1.4M channels"
 * + a richGrid of videoRenderer items + the continuation chain
 * (`onResponseReceivedActions[0].appendContinuationItemsAction`).
 *
 * Fixtures: tests/fixtures/yt/hashtag_browse_lofi.json (+ _page2) — REAL
 * captures of both pages (the browse POST and its continuation).
 */
import { innertubeBrowse } from "./innertube";
import { cached, TTL } from "./cache";
import { mapVideos, walkTree, findFirst } from "./mappers";
import type { HashtagPageDTO } from "@/lib/types";

/**
 * Build youtube.com's FEhashtag browse params for a tag (the measured
 * protobuf): `ea 05 <len> 0a <tagLen> <tag utf8> 18 01`.
 * Byte-level verified against youtube.com's own links (four tags, 2026-10-17).
 */
export function buildHashtagParams(tag: string): string {
  const tagBytes = Buffer.from(tag, "utf8");
  if (tagBytes.length === 0 || tagBytes.length > 100) return "";
  const inner = Buffer.concat([
    Buffer.from([0x0a, tagBytes.length]),
    tagBytes,
    Buffer.from([0x18, 0x01]),
  ]);
  const wrapped = Buffer.concat([Buffer.from([0xea, 0x05, inner.length]), inner]);
  return wrapped.toString("base64");
}

/** The #tag from a route segment ("lofi" → "#lofi"; honest no-op on empty). */
export function hashtagDisplay(tag: string): string {
  return tag ? `#${tag}` : "";
}

/** The response's own continuation token (any page's shape). */
function hashtagContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = item?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  for (const item of walkTree(response, "continuationItemViewModel")) {
    const token = item?.continuationCommand?.innertubeCommand?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

/**
 * Pure mapper: a FEhashtag browse response → the hashtag page DTO.
 * Header: pageHeaderRenderer → "#<tag>" + the metadata parts
 * ("7M videos • 1.4M channels"). Videos: the generic walker (the grid rides
 * videoRenderer inside richItemRenderer). Continuation: the trailing token.
 */
export function mapHashtagPage(tag: string, response: unknown): HashtagPageDTO {
  const phr = findFirst(response, "pageHeaderRenderer");
  const phv = phr?.content?.pageHeaderViewModel;
  const title = phv?.title?.dynamicTextViewModel?.text?.content ?? phr?.pageTitle ?? "";
  const rows = phv?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts: string[] = [];
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text?.content ?? "";
      if (text) parts.push(text);
    }
  }
  const metaText = parts.join(" • ") || null;
  const videos = mapVideos(response, { dedupe: true, limit: 40 });
  return {
    tag,
    title: title || hashtagDisplay(tag),
    metaText,
    videos,
    nextCursor: hashtagContinuationToken(response),
  };
}

/**
 * The hashtag browse page (cached). `cursor` pages the infinite scroll
 * (the continuation POST — the same token family the page itself carries).
 * Throws the honest upstream error when the read fails (the route's 502
 * family) — never a fabricated grid.
 */
export async function getHashtagPage(
  tag: string,
  cursor?: string
): Promise<HashtagPageDTO> {
  const params = buildHashtagParams(tag);
  if (!params) throw new Error("Invalid hashtag");
  const response = await cached(`yt:hashtag:${tag}:${cursor ?? ""}`, TTL.FEED_MS, () =>
    cursor
      ? innertubeBrowse({ browseId: "FEhashtag", params, continuation: cursor })
      : innertubeBrowse({ browseId: "FEhashtag", params })
  );
  return mapHashtagPage(tag, response);
}
