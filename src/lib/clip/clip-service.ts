/**
 * WFX2-P23-A — the WebFlix clip service: the local CREATE + the unified
 * RESOLVE the /api/clip routes and the /clip/[id] page ride.
 *
 * Two id families (honest, never conflated):
 *  - WebFlix-local clips: rows in the Clip table (the Clip tab's create —
 *    a WebFlix-local share window; youtube.com's own web create seam is
 *    gone, measured 2026-10-17, so the create honestly stays local and
 *    SAYS so — see the routes' note copy).
 *  - YouTube clip postIds (Ug…): resolved through the read family
 *    (src/lib/youtube/clips.ts) — the /clip page then renders the SAME
 *    ranged-player surface on the REAL upstream clip.
 *
 * The resolve's unified view carries exactly the fields youtube.com's clip
 * page shows (measured): clip title, clip author (+avatar), "views · age"
 * text, source video title + channel attribution, and the [start, end)
 * window. Local clips never fabricate a view count (none is tracked —
 * the createdText carries the age only, honest absence).
 */
import { db } from "@/lib/db";
import { formatRelativeDate } from "@/lib/format";
import {
  resolveRemoteClip,
  looksLikeYouTubeClipId,
  CLIP_READ_FAILED_MESSAGE,
  type RemoteClipResolve,
} from "@/lib/youtube/clips";
import { getWatchMetadata } from "@/lib/youtube/watch";

/** youtube.com's clip window law (the dispatch spec; the current create
 * dialog could not be measured signed-out — the web create panel is
 * removed. The 15s floor / 60s ceiling are the documented contract). */
export const CLIP_MIN_SEC = 15;
export const CLIP_MAX_SEC = 60;
/** The clip title ceiling. youtube.com's field is server-configured
 * (data.maxCharacterLimit — unmeasurable this run); WebFlix maps it to
 * YouTube's title-family limit (100, measured/publicly documented). */
export const CLIP_TITLE_MAX = 100;

/** The unified clip view the /clip page renders (both id families). */
export interface ClipViewDto {
  source: "webflix" | "youtube";
  clipId: string;
  videoId: string;
  startSec: number;
  endSec: number;
  title: string;
  clipAuthor: string;
  clipAuthorAvatarUrl: string | null;
  /** youtube.com's "N views · 4 years ago" — upstream text (youtube rows) /
   *  the honest age-only line (webflix rows — no view count is tracked). */
  createdText: string | null;
  videoTitle: string | null;
  channelName: string | null;
  channelHandle: string | null;
  channelAvatarUrl: string | null;
}

/** The honest failure shapes for the resolve surface. */
export type ClipResolveError =
  | { status: "not-found" }
  | { status: "clip-unavailable" }
  | { status: "read-failed"; message: string };

export type ClipResolveResult = ClipViewDto | ClipResolveError;

export class ClipValidationError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "ClipValidationError";
    this.status = 400;
  }
}

/** Validate the create body — the 15–60s window + title law. Pure. */
export function validateClipInput(input: {
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
}): void {
  const { videoId, title, startSec, endSec } = input;
  if (!videoId || typeof videoId !== "string") {
    throw new ClipValidationError("videoId is required");
  }
  const t = title.trim();
  if (!t) throw new ClipValidationError("Give your clip a name");
  if (t.length > CLIP_TITLE_MAX) {
    throw new ClipValidationError(`Clip names are limited to ${CLIP_TITLE_MAX} characters`);
  }
  if (
    !Number.isFinite(startSec) ||
    !Number.isFinite(endSec) ||
    startSec < 0 ||
    endSec <= startSec
  ) {
    throw new ClipValidationError("The clip range is invalid");
  }
  const length = endSec - startSec;
  if (length < CLIP_MIN_SEC) {
    throw new ClipValidationError(`Clips must be at least ${CLIP_MIN_SEC} seconds long`);
  }
  if (length > CLIP_MAX_SEC) {
    throw new ClipValidationError(`Clips can be at most ${CLIP_MAX_SEC} seconds long`);
  }
}

/** The create's honest upstream note (shown by the dialog + the routes). */
export const CLIP_CREATE_NOTE =
  "This clip lives on WebFlix — the link shares the trimmed range of the video. " +
  "Creating clips on youtube.com itself is no longer offered by YouTube's web app " +
  "(measured 2026-10-17), so the clip is not created on your YouTube account.";

export interface CreateClipResult {
  ok: true;
  clipId: string;
  url: string;
  note: string;
}

/**
 * CREATE a WebFlix-local clip. The 15–60s law + title law are enforced
 * here (the client's trimmer also enforces them — the server is the
 * authority). The window's end is bounded by the source video's duration
 * via the (cached) watch metadata read — when that read cannot serve, the
 * create refuses honestly instead of storing an unbounded window.
 */
export async function createClip(input: {
  creatorId: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
}): Promise<CreateClipResult> {
  validateClipInput(input);
  const meta = await getWatchMetadata(input.videoId).catch(() => null);
  if (!meta) {
    throw new ClipValidationError(
      "The video's details could not be read right now — try again in a moment"
    );
  }
  const duration = meta.video.durationSec ?? 0;
  if (duration > 0 && input.endSec > duration + 1) {
    throw new ClipValidationError("The clip range is past the end of the video");
  }
  const row = await db.clip.create({
    data: {
      videoId: input.videoId,
      title: input.title.trim(),
      startSec: Math.round(input.startSec),
      endSec: Math.round(input.endSec),
      creatorId: input.creatorId,
    },
  });
  return {
    ok: true,
    clipId: row.id,
    url: `/clip/${row.id}`,
    note: CLIP_CREATE_NOTE,
  };
}

function localToView(
  row: {
    id: string;
    videoId: string;
    title: string;
    startSec: number;
    endSec: number;
    createdAt: Date;
    creator: { name: string; handle: string; avatarUrl: string };
  },
  enrich: {
    videoTitle: string | null;
    channelName: string | null;
    channelHandle: string | null;
    channelAvatarUrl: string | null;
  }
): ClipViewDto {
  return {
    source: "webflix",
    clipId: row.id,
    videoId: row.videoId,
    startSec: row.startSec,
    endSec: row.endSec,
    title: row.title,
    clipAuthor: row.creator.name,
    clipAuthorAvatarUrl: row.creator.avatarUrl ?? null,
    // honest: no view count is tracked for WebFlix clips — the age only
    createdText: formatRelativeDate(row.createdAt),
    ...enrich,
  };
}

function remoteToView(remote: RemoteClipResolve): ClipViewDto | ClipResolveError {
  if ("status" in remote) {
    if (remote.status === "read-failed") {
      return { status: "read-failed", message: CLIP_READ_FAILED_MESSAGE };
    }
    return { status: remote.status };
  }
  return {
    source: "youtube",
    clipId: remote.clipId,
    videoId: remote.videoId,
    startSec: remote.startSec,
    endSec: remote.endSec,
    title: remote.title,
    clipAuthor: remote.clipAuthor,
    clipAuthorAvatarUrl: remote.clipAuthorAvatarUrl,
    createdText: remote.createdText,
    videoTitle: remote.videoTitle || null,
    channelName: remote.channelName || null,
    channelHandle: remote.channelHandle,
    channelAvatarUrl: remote.channelAvatarUrl,
  };
}

/**
 * RESOLVE any clip id: WebFlix-local rows first (the DB is authoritative
 * for its own ids), then YouTube postIds through the read family. cuids
 * (the local id shape) never hit the network; YouTube ids never hit the
 * DB. Every failure is honest (not-found / clip-unavailable / read-failed).
 */
export async function resolveClip(clipId: string): Promise<ClipResolveResult> {
  // WebFlix-local ids are cuids (c-prefixed, 24-25 chars); YouTube clip
  // postIds are U-prefixed base64ish (the looksLikeYouTubeClipId law).
  if (!looksLikeYouTubeClipId(clipId)) {
    const row = await db.clip
      .findUnique({
        where: { id: clipId },
        include: { creator: { select: { name: true, handle: true, avatarUrl: true } } },
      })
      .catch(() => null);
    if (!row) return { status: "not-found" };
    // enrich with the source video's (cached) metadata — best-effort, honest
    const meta = await getWatchMetadata(row.videoId).catch(() => null);
    return localToView(row, {
      videoTitle: meta?.video.title ?? null,
      channelName: meta?.video.channel.name ?? null,
      channelHandle: meta?.video.channel.handle
        ? `@${meta.video.channel.handle.replace(/^@/, "")}`
        : null,
      channelAvatarUrl: meta?.video.channel.avatarUrl ?? null,
    });
  }
  return remoteToView(await resolveRemoteClip(clipId));
}
