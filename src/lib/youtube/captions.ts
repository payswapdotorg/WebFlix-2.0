/**
 * WFX2-P4-QT — InnerTube caption tracks: the transcript language ladder.
 *
 * The caption-tracks list comes from the REAL watch page's embedded player
 * response (the SSR layer's page HTML — the same transport ssr.ts uses for
 * ytInitialData; the `player` InnerTube endpoint itself stays off-limits per
 * the standing laws). Per-language cues come from the track's own timedtext
 * endpoint (fmt=json3) — never fabricated: a language without a track is an
 * honest 404, an upstream failure is an honest 502.
 *
 * Pure extractors/mappers are exported for fixture-driven tests (the
 * extractYtInitialData idiom). Server-side only (routes import this; the
 * client consumes the routes' DTOs).
 */
import { fetchPageHtml } from "./ssr";
import { BROWSER_UA } from "./innertube";
import { upstreamFetch } from "./upstream";
import { cached, TTL } from "./cache";
import { ApiError } from "@/lib/watch/api";
import type { TranscriptCueDto } from "@/lib/watch/types";

/**
 * The player response's script tag: `ytInitialPlayerResponse = ({…});</script>`
 * — the same escape-safety argument as YT_INITIAL_DATA_RE (YouTube escapes
 * `</script>` inside the JSON, so the lazy match cannot over-run). Tolerant of
 * the `var `/`window.` prefixes (matches on the bare assignment).
 */
export const YT_INITIAL_PLAYER_RESPONSE_RE = /ytInitialPlayerResponse = ({[\s\S]*?});<\/script>/;

/** Pure extractor (exported for fixture-driven tests). */
export function extractYtInitialPlayerResponse(html: string): Record<string, any> {
  const m = html.match(YT_INITIAL_PLAYER_RESPONSE_RE);
  if (!m) throw new Error("ytInitialPlayerResponse not found in page HTML");
  return JSON.parse(m[1]) as Record<string, any>;
}

/** The wire DTO: one selectable transcript language (name + languageCode). */
export interface CaptionTrackDto {
  languageCode: string;
  name: string;
  /** "asr" → YouTube's auto-generated captions (the "(auto-generated)" label) */
  kind: "asr" | null;
}

/** A caption track with its timedtext endpoint (server-internal only). */
export interface RawCaptionTrack extends CaptionTrackDto {
  baseUrl: string | null;
}

function trackName(track: Record<string, any>): string {
  const name = track?.name;
  if (typeof name?.simpleText === "string" && name.simpleText) return name.simpleText;
  const runs = Array.isArray(name?.runs) ? name.runs : [];
  const joined = runs.map((r: Record<string, any>) => (typeof r?.text === "string" ? r.text : "")).join("");
  if (joined) return joined;
  return typeof track?.languageCode === "string" ? track.languageCode : "";
}

/**
 * Pure mapper: the player response's captionTracks → the track list.
 * Honest [] when the video carries no captions at all.
 */
export function extractCaptionTracks(playerResponse: unknown): RawCaptionTrack[] {
  const tracks =
    (playerResponse as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  const out: RawCaptionTrack[] = [];
  for (const track of tracks) {
    if (typeof track?.languageCode !== "string" || !track.languageCode) continue;
    out.push({
      languageCode: track.languageCode,
      name: trackName(track),
      kind: track?.kind === "asr" ? "asr" : null,
      baseUrl: typeof track?.baseUrl === "string" ? track.baseUrl : null,
    });
  }
  return out;
}

/**
 * Pick the track for a language: exact languageCode match; a manual track
 * beats an auto-generated one when both exist. null when no track exists.
 */
export function pickCaptionTrack(tracks: RawCaptionTrack[], languageCode: string): RawCaptionTrack | null {
  const matches = tracks.filter((t) => t.languageCode === languageCode);
  if (matches.length === 0) return null;
  return matches.find((t) => t.kind !== "asr") ?? matches[0];
}

/** The raw track list for a video (cached; carries the timedtext endpoints). */
async function rawCaptionTracks(videoId: string): Promise<RawCaptionTrack[]> {
  return cached(`yt:captions-raw:${videoId}`, TTL.WATCH_MS, async () => {
    // fetch failures map to an honest 502 (the routes surface it); a parsed
    // page without captions is the honest [] below.
    let html: string;
    try {
      html = await fetchPageHtml(`/watch/${videoId}`);
    } catch (e) {
      throw new ApiError(
        502,
        `caption tracks unavailable — the watch page fetch failed${e instanceof Error ? ` (${e.message})` : ""}`
      );
    }
    let playerResponse: Record<string, any>;
    try {
      playerResponse = extractYtInitialPlayerResponse(html);
    } catch {
      // the page carried no player response (consent wall / shape drift) —
      // honest 502, never a guessed track list
      throw new ApiError(502, "caption tracks unavailable — the watch page carried no player response");
    }
    return extractCaptionTracks(playerResponse);
  });
}

/**
 * The selectable languages for a video (name + languageCode per track) —
 * the caption-tracks list from the player response. 502 when YouTube does
 * not answer; [] when the video genuinely has no caption tracks.
 */
export async function getCaptionTracks(videoId: string): Promise<CaptionTrackDto[]> {
  const tracks = await rawCaptionTracks(videoId);
  return tracks.map(({ baseUrl: _baseUrl, ...dto }) => dto);
}

/**
 * Pure mapper: a timedtext json3 payload → cue rows (the TranscriptCueDto
 * shape the panel already consumes). Skips events without text (json3 emits
 * newline-only/blank events between lines); collapses in-cue newlines.
 */
export function mapJson3Cues(body: unknown, languageCode: string): TranscriptCueDto[] {
  const events = (body as any)?.events;
  if (!Array.isArray(events)) return [];
  const cues: TranscriptCueDto[] = [];
  for (const ev of events) {
    const startMs = Number(ev?.tStartMs);
    if (!Number.isFinite(startMs)) continue;
    const durMs = Number(ev?.dDurationMs);
    const segs = Array.isArray(ev?.segs) ? ev.segs : [];
    const text = segs
      .map((s: Record<string, any>) => (typeof s?.utf8 === "string" ? s.utf8 : ""))
      .join("")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    if (!text) continue;
    cues.push({
      id: `${languageCode}-${startMs}`,
      startSec: Math.floor(startMs / 1000),
      endSec: Math.floor((startMs + (Number.isFinite(durMs) ? durMs : 0)) / 1000),
      text,
    });
  }
  return cues;
}

/** GET the timedtext json3 for a track and map it to cues. */
async function fetchJson3Cues(baseUrl: string, languageCode: string): Promise<TranscriptCueDto[]> {
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
  const res = await upstreamFetch()(url, {
    method: "GET",
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      Referer: "https://www.youtube.com/",
    },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiError(502, `caption fetch failed: HTTP ${res.status}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(502, "caption fetch returned a non-JSON body");
  }
  return mapJson3Cues(body, languageCode);
}

/**
 * The per-language transcript fetch: resolve the track for `languageCode`
 * from the player response, then fetch that track's cues (cached). Honest
 * failures: no track for the language → 404; upstream failure → 502.
 */
export async function fetchCaptionCues(videoId: string, languageCode: string): Promise<TranscriptCueDto[]> {
  const tracks = await rawCaptionTracks(videoId);
  const track = pickCaptionTrack(tracks, languageCode);
  if (!track || !track.baseUrl) {
    throw new ApiError(404, `No transcript track for language "${languageCode}"`);
  }
  return cached(`yt:caption:${videoId}:${languageCode}`, TTL.WATCH_MS, () =>
    fetchJson3Cues(track.baseUrl!, languageCode)
  );
}
