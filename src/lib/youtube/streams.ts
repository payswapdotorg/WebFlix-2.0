/**
 * Task 2-c — server-side playback fallback (the embed-wall chain).
 *
 * The watch page's iframe embed can be walled by YouTube ("Sign in to
 * confirm you're not a bot" — the third-party-cookie/datacenter embed wall).
 * When that happens the client needs a REAL stream to swap in, plus
 * storyboards for the hover preview (Task 2-c: the preview no longer uses
 * iframe embeds at all).
 *
 * This module owns the server-side player-response chain:
 *  1. the innertube `player` endpoint, tried over a CLIENT CHAIN: the
 *     configured `INNER_TUBE_PLAYER_CLIENT` (default WEB) first, then IOS
 *     (a native-app client whose wall behavior differs from the web ones).
 *     The sandbox IP gets LOGIN_REQUIRED/ERROR for every client probed;
 *     Vercel egress is untested at build time (the lead verifies post-deploy
 *     and sets the env accordingly) — the chain makes rung 1 resilient
 *     without multiplying requests when the first client answers usable.
 *  2. the watch page's embedded `ytInitialPlayerResponse` (SSR fetch) — a
 *     different path that reliably carries storyboards + duration even when
 *     the `player` endpoint is walled (live-verified from the sandbox:
 *     playabilityStatus OK, storyboards spec present; its progressive
 *     formats arrive signatureCipher'd only → honestly filtered out).
 *  3. WFX2-4A — the broker's page-context watch read: the logged-in
 *     operator tab fetches the watch page itself (credentials included, the
 *     shared tab never navigated) and the app extracts the SAME embedded
 *     player response — a logged-in session answers what the walled server
 *     egress cannot. Honest failure (broker unconfigured/offline, no
 *     player response in the HTML) → the empty degrade.
 *
 * Everything is parsed into the PlaybackDto contract and cached. Walled
 * responses resolve FAST (a LOGIN_REQUIRED answer is <1s), so the chain's
 * latency budget is small. No deciphering is attempted (out of scope): a
 * format is surfaced only when it carries a PLAIN `url`.
 *
 * Storyboard spec format (live-verified on dQw4w9WgXcQ, 2026-10-04 —
 * see tests/fixtures/yt/player_storyboard_dQw4.json):
 *   `base#…|w#h#frameCount#cols#rows#intervalMs#name#sigh|…`
 *   base = https://i.ytimg.com/sb/<id>/storyboard3_L$L/$N.jpg?sqp=…
 *   segment index i → level i ($L→i); name "default" (L0) → $N→"default"
 *   (single sheet, skipped); name "M$M" → sheet k = $N→"M<k>" with
 *   `&sigh=<sigh>` appended (all sheet URLs verified 200 on i.ytimg.com —
 *   the CDN does NOT IP-lock, so any client browser can fetch them).
 */
import { innertube } from "./innertube";
import { fetchPageHtml } from "./ssr";
import { cachedResilient, TTL } from "./cache";
import { brokerFetchPage } from "@/lib/broker";
import type { PlaybackDto, StoryboardLevelDto, StreamFormatDto } from "@/lib/watch/types";

/** The innertube client used for `player` (env-configurable, default WEB). */
export const PLAYER_CLIENT_ENV = "INNER_TUBE_PLAYER_CLIENT";

const DEFAULT_PLAYER_CLIENT = "WEB";

/**
 * A `player` client context. The web-family clients carry only the identity
 * pair; native-app clients (IOS) add the device fields YouTube's own apps
 * send (the userAgent here rides in the context payload — client identity —
 * while the HTTP transport keeps the browser UA; see innertube.ts).
 */
export interface PlayerClientContext {
  clientName: string;
  clientVersion: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  userAgent?: string;
}

/** Client contexts known to matter for `player` (unknown names pass through). */
const PLAYER_CLIENTS: Record<string, PlayerClientContext> = {
  WEB: { clientName: "WEB", clientVersion: "2.20260925.08.00" },
  MWEB: { clientName: "MWEB", clientVersion: "2.20260925.08.00" },
  WEB_EMBEDDED_PLAYER: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "2.20260925.08.00" },
  WEB_REMIX: { clientName: "WEB_REMIX", clientVersion: "0.1" },
  // native app context (realistic iPhone 15 Pro Max / iOS 17.5.2 shape) —
  // historically the last client family to keep plain-url progressive formats
  IOS: {
    clientName: "IOS",
    clientVersion: "19.29.1",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "17.5.2.21H",
    userAgent: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_2 like Mac OS X;)",
  },
};

/** The configured `player` client context (INNER_TUBE_PLAYER_CLIENT, default WEB). */
export function playerClientContext(): PlayerClientContext {
  const raw = (process.env[PLAYER_CLIENT_ENV] ?? "").trim().toUpperCase();
  const name = raw && PLAYER_CLIENTS[raw] ? raw : DEFAULT_PLAYER_CLIENT;
  return PLAYER_CLIENTS[name];
}

/**
 * The rung-1 client chain: the configured client first, then IOS (the
 * native-app lottery ticket against the egress wall). Deduped — configuring
 * INNER_TUBE_PLAYER_CLIENT=IOS yields a single-request rung.
 */
export function playerClientChain(): PlayerClientContext[] {
  const chain = [playerClientContext(), PLAYER_CLIENTS.IOS];
  const seen = new Set<string>();
  return chain.filter((c) => {
    if (seen.has(c.clientName)) return false;
    seen.add(c.clientName);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Parsing (pure — fixture-testable)                                   */
/* ------------------------------------------------------------------ */

/** Itag preference: 22 (720p mp4) then 18 (360p mp4), then anything else by height. */
function formatRank(f: StreamFormatDto): number {
  if (f.itag === 22) return 1_000_000;
  if (f.itag === 18) return 900_000;
  return (f.height ?? 0) * 1_000 + (f.bitrate ?? 0) / 1e9;
}

/**
 * Player response → PlaybackDto. Pure; tolerant of every walled shape
 * (no streamingData / no storyboards / status != OK → empty arrays, no throw).
 * Only formats with a PLAIN `url` are surfaced (signatureCipher-only formats
 * need JS deciphering — out of scope, honestly skipped).
 */
export function parsePlayback(
  source: PlaybackDto["source"],
  response: unknown
): PlaybackDto {
  const empty: PlaybackDto = { streamFormats: [], storyboards: [], durationSec: null, source };
  const pr = response as any;
  if (!pr || typeof pr !== "object") return empty;

  const status = pr?.playabilityStatus?.status;
  if (status !== "OK") return empty;

  const lengthSec = Number(pr?.videoDetails?.lengthSeconds);
  const durationSec = Number.isFinite(lengthSec) && lengthSec > 0 ? lengthSec : null;

  // ---- progressive formats with a plain URL ----
  const formats: StreamFormatDto[] = [];
  const rawFormats: any[] = pr?.streamingData?.formats ?? [];
  for (const f of rawFormats) {
    const url: unknown = f?.url;
    if (typeof url !== "string" || url.length === 0) continue; // signatureCipher — skip
    const mime: string = typeof f?.mimeType === "string" ? f.mimeType : "";
    if (!mime.startsWith("video/")) continue; // adaptive audio-only etc.
    const hasAudio =
      typeof f?.audioQuality === "string" || /mp4a|opus|ac-3|ec-3/.test(mime);
    if (!hasAudio) continue; // video-only (adaptive) — a <video> swap needs muxed
    formats.push({
      itag: Number(f?.itag) || 0,
      url,
      mimeType: mime,
      qualityLabel: typeof f?.qualityLabel === "string" ? f.qualityLabel : null,
      width: Number.isFinite(Number(f?.width)) ? Number(f.width) : null,
      height: Number.isFinite(Number(f?.height)) ? Number(f.height) : null,
      fps: Number.isFinite(Number(f?.fps)) ? Number(f.fps) : null,
      bitrate: Number.isFinite(Number(f?.bitrate)) ? Number(f.bitrate) : null,
      contentLength: typeof f?.contentLength === "string" ? f.contentLength : null,
      approxDurationMs: typeof f?.approxDurationMs === "string" ? f.approxDurationMs : null,
      hasAudio: true,
    });
  }
  formats.sort((a, b) => formatRank(b) - formatRank(a));

  return {
    streamFormats: formats,
    storyboards: parseStoryboardSpec(pr?.storyboards?.playerStoryboardSpecRenderer?.spec),
    durationSec,
    source,
  };
}

/**
 * The storyboard spec → animatable levels (M$M levels only; the "default"
 * single-sheet level has no sequence to animate). Pure + tolerant.
 */
export function parseStoryboardSpec(spec: unknown): StoryboardLevelDto[] {
  if (typeof spec !== "string" || spec.length === 0) return [];
  const parts = spec.split("|");
  const base = parts[0];
  if (!base.includes("$L") || !base.includes("$N")) return [];
  const levels: StoryboardLevelDto[] = [];
  for (let i = 1; i < parts.length; i++) {
    const fields = parts[i].split("#");
    // width#height#frameCount#cols#rows#intervalMs#name#sigh (sigh optional)
    if (fields.length < 7) continue;
    const [w, h, frameCount, cols, rows, interval, name, sigh] = fields;
    if (name !== "M$M") continue; // the "default" level is not a sequence
    const n = (v: string): number => {
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    };
    const perSheet = n(cols) * n(rows);
    if (perSheet <= 0) continue;
    // level URL: $L → level index; $N stays as the client-side sheet placeholder
    let templateUrl = base.split("$L").join(String(i - 1));
    if (typeof sigh === "string" && sigh.length > 0) {
      templateUrl += `${templateUrl.includes("?") ? "&" : "?"}sigh=${sigh}`;
    }
    levels.push({
      level: i - 1,
      templateUrl,
      frameWidth: n(w),
      frameHeight: n(h),
      cols: n(cols),
      rows: n(rows),
      intervalMs: n(interval),
      frameCount: n(frameCount),
      sheetCount: Math.ceil(n(frameCount) / perSheet),
    });
  }
  return levels;
}

/* ------------------------------------------------------------------ */
/* The chain                                                           */
/* ------------------------------------------------------------------ */

/**
 * Rung 1 — the innertube `player` CLIENT CHAIN: the configured client
 * (INNER_TUBE_PLAYER_CLIENT, default WEB) first, then IOS. The FIRST
 * response that parses into a USABLE payload (streamFormats or storyboards)
 * wins and the loop stops — a healthy primary client still costs exactly
 * one request. Null when every client is walled/empty.
 */
async function fetchInnertubePlayer(videoId: string): Promise<PlaybackDto | null> {
  for (const client of playerClientChain()) {
    let response: unknown;
    try {
      response = await innertube("player", {
        context: { client: { ...client, hl: "en", gl: "US" } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      });
    } catch {
      continue; // walled answers also arrive as HTTP 200 + UNPLAYABLE — and hard errors
    }
    const dto = parsePlayback("player", response);
    if (dto.streamFormats.length > 0 || dto.storyboards.length > 0) return dto;
  }
  return null;
}

const YT_INITIAL_PLAYER_RESPONSE_RE = /var ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var |<\/script>)/;

/** Extract the watch page's embedded player response (pure — fixture-testable). */
export function extractPlayerResponseFromHtml(html: string): Record<string, any> | null {
  const m = html.match(YT_INITIAL_PLAYER_RESPONSE_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, any>;
  } catch {
    return null;
  }
}

/** Rung 2 — the watch page's ytInitialPlayerResponse (SSR fetch). Null when absent. */
async function fetchWatchPagePlayerResponse(videoId: string): Promise<unknown | null> {
  try {
    const html = await fetchPageHtml(`/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
      timeoutMs: 12_000,
    });
    return extractPlayerResponseFromHtml(html);
  } catch {
    return null;
  }
}

/**
 * Rung 3 — the broker's page-context watch read (WFX2-4A): the logged-in
 * tab fetches the watch page itself (credentials included, never
 * navigating) and the app extracts the SAME embedded player response rung
 * 2 parses. Null when the broker is unconfigured/offline, the page carried
 * no player response, or the read broke — never a throw.
 */
async function fetchBrokerWatchPlayerResponse(videoId: string): Promise<unknown | null> {
  try {
    const result = await brokerFetchPage(`/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`);
    if (result instanceof Error) return null;
    return extractPlayerResponseFromHtml(result.body);
  } catch {
    return null;
  }
}

/**
 * The chain: `player` endpoint (client chain) → watch page → the broker's
 * page-context watch read. Cached (formats expire in hours; 10min mirrors
 * WATCH_MS) — the WINNING rung's payload is cached per video id. The result
 * is NEVER thrown — a walled egress yields the honest empty payload
 * (source: "").
 */
export async function getPlayback(videoId: string): Promise<PlaybackDto> {
  return cachedResilient(
    `yt:playback:${videoId}`,
    TTL.WATCH_MS,
    async () => {
      const fromPlayer = await fetchInnertubePlayer(videoId);
      if (fromPlayer) return fromPlayer;
      const fromPage = await fetchWatchPagePlayerResponse(videoId);
      if (fromPage) return parsePlayback("watch-page", fromPage);
      // WFX2-4A rung 3 — the broker's page-context watch read (the logged-in
      // session's own page); honest failure → the empty degrade below
      const fromBroker = await fetchBrokerWatchPlayerResponse(videoId);
      if (fromBroker) return parsePlayback("broker-watch", fromBroker);
      return { streamFormats: [], storyboards: [], durationSec: null, source: "" };
    },
    // WFX2-5 poisoning guard (the 4-c incident): the honest empty degrade is
    // NEVER cached — a wedge/wall window must not poison the key for the
    // 10min soft TTL (+2h last-good window). With a last-good payload that
    // keeps serving instead; a cold cache passes the empty through untouched
    // (the channel broker rung's convention). A healthy broker-watch read —
    // storyboards present, formats maybe empty because they are ciphered —
    // has source "broker-watch" and caches normally.
    { isEmpty: (v) => (v as PlaybackDto).source === "" }
  );
}
