/**
 * WFX2-P23-A — the clip RESOLVE read family (youtube.com/clip/<postId>).
 *
 * Measured live 2026-10-17 (agent-browser + the walled-egress curl probe,
 * evidence saved to evidence/): a youtube.com/clip page is the source
 * video's FULL watch page (ytInitialData) with two clip additions —
 *   1. ytInitialPlayerResponse.clipConfig { postId, startTimeMs, endTimeMs }
 *      (the ranged player's contract — the embed cues [start, end) and
 *      loopCommand loops it), and
 *   2. the `engagement-panel-clip-view` engagement panel carrying a
 *      clipSectionRenderer → clipAttributionRenderer: the clip title, the
 *      clip author (+avatar), "N views · age" (createdText), and the footer
 *      "Share clip" / "Watch full video" buttons.
 * The source video id rides currentVideoEndpoint.watchEndpoint.videoId; the
 * video title/channel ride the watch page's own primary/secondary info
 * renderers. The player endpoint itself answers LOGIN_REQUIRED from this
 * sandbox's egress (the documented wall — reads still serve), which is why
 * this resolve reads the PAGE HTML (the house SSR pattern, ssr.ts) instead
 * of any player call. The `player` endpoint is never called (the lane law).
 *
 * Honest failure taxonomy (never a synthesized clip):
 *   - "clip-unavailable" — the page served but carries no clipConfig/panel
 *     (a dead/removed clip; youtube.com's own wording family, measured:
 *     "Clip not available - Try again later").
 *   - "not-found"        — YouTube answered a 404 page for the clip id.
 *   - "unavailable"      — the read itself failed (network/wall) — the
 *     P22-B honest-degradation family wording.
 */
import { fetchPageHtml } from "./ssr";
import { cached } from "./cache";
import { TTL } from "./cache";

export const CLIP_UNAVAILABLE_MESSAGE =
  "Clip not available - Try again later";

export const CLIP_READ_FAILED_MESSAGE =
  "the clip page could not be read — open it on youtube.com to check";

/** The resolve DTO — exactly the fields the clip page needs (all measured). */
export interface RemoteClipDto {
  source: "youtube";
  /** the clip postId (the /clip/<id> path segment) */
  clipId: string;
  /** the SOURCE video's id (currentVideoEndpoint.watchEndpoint.videoId) */
  videoId: string;
  /** [start, end) seconds — clipConfig.startTimeMs/endTimeMs / 1000 */
  startSec: number;
  endSec: number;
  /** the clip's title (clipAttributionRenderer.title) */
  title: string;
  /** the clip's creator (clipAttributionRenderer.clipAuthor) */
  clipAuthor: string;
  /** the clip creator's avatar (authorAvatar.thumbnails[0]) */
  clipAuthorAvatarUrl: string | null;
  /** "N views · age" (clipAttributionRenderer.createdText) — upstream text, honestly passed through */
  createdText: string | null;
  /** the source video's title (videoPrimaryInfoRenderer.title) */
  videoTitle: string;
  /** the source video's channel name (videoOwnerRenderer.title) */
  channelName: string;
  /** the source channel's handle (canonicalBaseUrl, "@…" form when present) */
  channelHandle: string | null;
  /** the source channel's avatar */
  channelAvatarUrl: string | null;
}

/** The honest failure shapes the resolve surfaces map to the page states. */
export type ClipResolveFailure =
  | { source: "youtube"; status: "not-found"; clipId: string }
  | { source: "youtube"; status: "clip-unavailable"; clipId: string }
  | { source: "youtube"; status: "read-failed"; clipId: string; message: string };

export type RemoteClipResolve = RemoteClipDto | ClipResolveFailure;

/* ------------------------------------------------------------------ */
/* pure extractors (fixture-testable)                                  */
/* ------------------------------------------------------------------ */

const YT_INITIAL_PLAYER_RESPONSE_RE = /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;/;

function runsText(node: unknown): string | null {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | null;
  if (!n || typeof n !== "object") return null;
  if (typeof n.simpleText === "string" && n.simpleText) return n.simpleText;
  if (Array.isArray(n.runs)) {
    const t = n.runs.map((r) => r?.text ?? "").join("");
    return t || null;
  }
  return null;
}

/** Depth-first key search over dicts + lists (the page shapes are deep). */
function findAll(obj: unknown, key: string, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 12) return out;
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (const item of obj) findAll(item, key, out, depth + 1);
    } else {
      const rec = obj as Record<string, unknown>;
      for (const k of Object.keys(rec)) {
        if (k === key) out.push(rec[k]);
        findAll(rec[k], key, out, depth + 1);
      }
    }
  }
  return out;
}

/** Extract ytInitialPlayerResponse (clipConfig lives there) from page HTML. */
export function extractClipConfig(html: string): {
  postId: string;
  startTimeMs: number;
  endTimeMs: number;
} | null {
  const m = html.match(YT_INITIAL_PLAYER_RESPONSE_RE);
  if (!m) return null;
  let pr: Record<string, unknown>;
  try {
    pr = JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const cfg = pr.clipConfig as Record<string, unknown> | undefined;
  if (!cfg || typeof cfg !== "object") return null;
  const postId = typeof cfg.postId === "string" ? cfg.postId : null;
  const startMs = Number(cfg.startTimeMs);
  const endMs = Number(cfg.endTimeMs);
  if (!postId || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { postId, startTimeMs: startMs, endTimeMs: endMs };
}

/**
 * Map the clip page's two JSON blobs onto the resolve DTO. Pure — the
 * fixture tests pin it against the REAL captured page.
 * Returns null when the page carries no clip panel (clip-unavailable).
 */
export function mapClipResolve(
  clipId: string,
  playerResponse: Record<string, any> | null,
  initialData: Record<string, any> | null
): RemoteClipDto | null {
  const cfg = playerResponse?.clipConfig as Record<string, unknown> | undefined;
  if (!cfg || typeof cfg !== "object") return null;
  const startMs = Number(cfg.startTimeMs);
  const endMs = Number(cfg.endTimeMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const data = initialData ?? {};
  // the source video id (currentVideoEndpoint.watchEndpoint.videoId)
  const videoId =
    data?.currentVideoEndpoint?.watchEndpoint?.videoId as string | undefined;

  // the clip attribution (engagement-panel-clip-view → clipSectionRenderer)
  const attribution = findAll(data, "clipAttributionRenderer")[0] as
    | Record<string, any>
    | undefined;

  const title = runsText(attribution?.title) ?? "";
  const clipAuthor = runsText(attribution?.clipAuthor) ?? "";
  const createdText = runsText(attribution?.createdText);
  const clipAuthorAvatarUrl =
    (attribution?.authorAvatar?.thumbnails as { url?: string }[] | undefined)?.[0]?.url ??
    null;

  // the source video's own watch metadata (primary + secondary renderers)
  const primary = findAll(data, "videoPrimaryInfoRenderer")[0] as
    | Record<string, any>
    | undefined;
  const videoTitle = runsText(primary?.title) ?? "";

  const owner = findAll(data, "videoOwnerRenderer")[0] as Record<string, any> | undefined;
  const channelName = runsText(owner?.title) ?? "";
  const browse = owner?.navigationEndpoint?.browseEndpoint ?? {};
  const channelHandle =
    typeof browse?.canonicalBaseUrl === "string" && browse.canonicalBaseUrl.startsWith("@")
      ? browse.canonicalBaseUrl
      : null;
  const channelAvatarUrl =
    (owner?.thumbnail?.thumbnails as { url?: string }[] | undefined)?.[0]?.url ?? null;

  // a clip panel with a videoId is the minimum honest resolve
  if (!videoId) return null;

  return {
    source: "youtube",
    clipId,
    videoId,
    startSec: Math.round(startMs / 1000),
    endSec: Math.round(endMs / 1000),
    title,
    clipAuthor,
    clipAuthorAvatarUrl,
    createdText,
    videoTitle,
    channelName,
    channelHandle,
    channelAvatarUrl,
  };
}

/* ------------------------------------------------------------------ */
/* the read (SSR page fetch — cached, the house pattern)               */
/* ------------------------------------------------------------------ */

/** True when the id plausibly names a YouTube clip postId (Ug… family). */
export function looksLikeYouTubeClipId(clipId: string): boolean {
  return /^U[A-Za-z0-9_-]{10,}$/.test(clipId);
}

/**
 * Resolve a youtube.com clip postId to the ranged-player payload.
 * Cached per clipId (WATCH_MS — the same budget as watch metadata).
 */
export async function resolveRemoteClip(clipId: string): Promise<RemoteClipResolve> {
  if (!looksLikeYouTubeClipId(clipId)) {
    return { source: "youtube", status: "not-found", clipId };
  }
  return cached(`clip:${clipId}`, TTL.WATCH_MS, async () => {
    let html: string;
    try {
      html = await fetchPageHtml(`/clip/${encodeURIComponent(clipId)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { source: "youtube", status: "read-failed", clipId, message } as ClipResolveFailure;
    }
    // a dead clip id answers youtube.com's 404 page (no clipConfig anywhere)
    const cfg = extractClipConfig(html);
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!cfg || !m) {
      return { source: "youtube", status: "clip-unavailable", clipId } as ClipResolveFailure;
    }
    let initialData: Record<string, any>;
    let playerResponse: Record<string, any> | null = null;
    try {
      initialData = JSON.parse(m[1]) as Record<string, any>;
    } catch {
      return { source: "youtube", status: "clip-unavailable", clipId } as ClipResolveFailure;
    }
    const pm = html.match(YT_INITIAL_PLAYER_RESPONSE_RE);
    if (pm) {
      try {
        playerResponse = JSON.parse(pm[1]) as Record<string, any>;
      } catch {
        playerResponse = null;
      }
    }
    const dto = mapClipResolve(clipId, playerResponse, initialData);
    if (!dto) {
      return { source: "youtube", status: "clip-unavailable", clipId } as ClipResolveFailure;
    }
    return dto;
  });
}
