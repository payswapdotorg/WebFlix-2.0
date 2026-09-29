/**
 * WFX2-A-B autoplay — the watch `next` response's autoplay set.
 *
 * Path (verified in tests/fixtures/yt/next_dQw4.json):
 * contents.twoColumnWatchNextResults.autoplay.autoplay.sets[].autoplayVideo
 *   .watchEndpoint.videoId — plus mode/countDownSecs.
 */
import type { RelatedVideoDto } from "@/lib/watch/types";
import { walkTree } from "./mappers";
import { relatedDtosFor } from "./related";

/** Pure mapper: autoplay set → next-up DTO (null when autoplay is off/absent). */
export function mapAutoplay(response: unknown): {
  video: RelatedVideoDto | null;
  countDownSecs: number | null;
} {
  // several unrelated `autoplay: true` booleans (lottie settings) ride along —
  // only objects count; the real node nests once or twice:
  // twoColumnWatchNextResults.autoplay = { autoplay?: { sets, countDownSecs } }
  let autoplay: any = null;
  for (const found of walkTree(response, "autoplay")) {
    if (!found || typeof found !== "object") continue;
    const inner = found?.sets ? found : found?.autoplay;
    if (inner?.sets && Array.isArray(inner.sets)) {
      autoplay = inner;
      break;
    }
  }
  const sets = autoplay?.sets ?? [];
  const first = Array.isArray(sets) ? sets[0] : null;
  const videoId =
    first?.autoplayVideo?.watchEndpoint?.videoId ??
    first?.autoplayAutoplayVideoRenderer?.videoId ??
    null;
  const countDownSecs =
    typeof autoplay?.countDownSecs === "number" ? autoplay.countDownSecs : null;
  if (typeof videoId !== "string" || !videoId) return { video: null, countDownSecs };
  const dto = relatedDtosFor(response).find((v) => v.id === videoId) ?? null;
  if (dto) return { video: dto, countDownSecs };
  // fall back to a minimal honest DTO from the autoplay set itself
  return {
    video: {
      id: videoId,
      title: "",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSec: null,
      views: 0,
      viewsText: null,
      publishedText: null,
      createdAt: null,
      channel: { id: "", handle: "", name: "", avatarUrl: "", verified: false },
    },
    countDownSecs,
  };
}
