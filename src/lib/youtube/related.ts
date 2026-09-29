/**
 * WFX2-A-B related rail — secondaryResults from the watch `next` response.
 *
 * Current responses wrap related items in `lockupViewModel`s inside
 * secondaryResults.secondaryResults.results[].itemSectionRenderer.contents[];
 * a trailing `continuationItemRenderer` carries the next-page token (cursor).
 */
import type { RelatedVideoDto } from "@/lib/watch/types";
import type { VideoDTO } from "@/lib/types";
import { walkTree, mapLockupViewModel, mapVideoRenderer, mapCompactVideoRenderer } from "./mappers";

export interface RelatedPage {
  items: RelatedVideoDto[];
  nextCursor: string | null;
}

/** Related DTOs from any response carrying secondaryResults (autoplay reuse). */
export function relatedDtosFor(response: unknown): RelatedVideoDto[] {
  return mapRelatedPage(response).items;
}

/** Pure mapper: secondaryResults → related page. */
export function mapRelatedPage(response: unknown): RelatedPage {
  const items: RelatedVideoDto[] = [];
  const seen = new Set<string>();
  const toRelated = (dto: VideoDTO | null): RelatedVideoDto | null => {
    if (!dto || !dto.id || !dto.title) return null;
    return {
      id: dto.id,
      title: dto.title,
      thumbnailUrl: dto.thumbnailUrl,
      durationSec: dto.durationSec,
      views: dto.views,
      viewsText: dto.viewsText ?? null,
      publishedText: dto.publishedText ?? null,
      createdAt: dto.createdAt,
      channel: {
        id: dto.channel.id,
        handle: dto.channel.handle || dto.channel.id,
        name: dto.channel.name,
        avatarUrl: dto.channel.avatarUrl,
        verified: dto.channel.verified,
      },
    };
  };
  for (const r of walkTree(response, "lockupViewModel")) {
    const rel = toRelated(mapLockupViewModel(r));
    if (rel && !seen.has(rel.id)) {
      seen.add(rel.id);
      items.push(rel);
    }
  }
  for (const r of walkTree(response, "compactVideoRenderer")) {
    const rel = toRelated(mapCompactVideoRenderer(r));
    if (rel && !seen.has(rel.id)) {
      seen.add(rel.id);
      items.push(rel);
    }
  }
  for (const r of walkTree(response, "videoRenderer")) {
    const rel = toRelated(mapVideoRenderer(r));
    if (rel && !seen.has(rel.id)) {
      seen.add(rel.id);
      items.push(rel);
    }
  }

  // next-page cursor: the trailing continuation inside secondaryResults
  let nextCursor: string | null = null;
  const secondary = walkTree(response, "secondaryResults");
  for (const sec of secondary) {
    for (const item of sec?.results ?? []) {
      const token =
        item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
        item?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint
          ?.continuationCommand?.token;
      if (typeof token === "string" && token) nextCursor = token;
    }
  }
  return { items, nextCursor };
}
