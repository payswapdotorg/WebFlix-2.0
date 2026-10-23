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
 *  1. the innertube `player` endpoint, tried over a CLIENT CHAIN (P26-HPV2:
 *     widened to six rungs — see playerClientChain). The wall is a
 *     PER-(video, client, egress) lottery, not a flat wall: measured
 *     2026-10-18 from the sandbox egress, dQw4w9WgXcQ answers OK with 27–30
 *     PLAIN-URL formats to IOS / ANDROID (and ANDROID_VR) while
 *     jNQXAC9IVRw + kJQP7kiw5Fk answer LOGIN_REQUIRED to every client
 *     probed (the walled class this lane hunts). Walled answers cost one
 *     FAST request each (<300ms measured), so extra rungs are cheap lottery
 *     tickets; the first usable answer still wins and stops the loop.
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
 * latency budget is small.
 *
 * P26-HPV2 (rung 2, Task 33) — the decipher verdict, honestly ledgered (the
 * two-incarnation run: the 2nd incarnation re-measured every cell 2026-10-18
 * 16:30–17:20Z from this egress; all numbers below are ITS fresh probes):
 * the classic signature decipher (split→[reverse|splice|swap]→join) is GONE
 * from the CURRENT player world — measured across the served 0229cd64 build
 * family (player_es6 + player_ias en_US base.js: every split("")/reverse()/
 * splice() site is a generic utility — 8/13 split("") sites, 2/3 reverse()
 * sites, 35 splice() sites, ZERO "decipher" mentions, ZERO "&sig=" append
 * sites, the String.prototype patches are Closure polyfills; the ONLY
 * functional signatureCipher read BLANKS the field in an offline path), no
 * separate decipher script exists on the page (the watch page references
 * exactly ONE player script). The LEGACY builds are still served (b12cc44b +
 * 20dfca59 → HTTP 200; 0f963df1 + 4fe6b5d4 → 404) and DO carry the classic
 * decipher — extracted verbatim and live-tested against TODAY's cipher: the
 * b12-decoded and 20d-decoded s both answer the range probe with HTTP 403
 * (the live-verification law applied; the current scramble algorithm matches
 * NEITHER legacy op sequence). The modern web player plays through SABR
 * (streamingData.serverAbrStreamingUrl rides every OK answer) gated by
 * attestation (playabilityStatus.contextParams — the BotGuard/PO-token
 * challenge; the player JS carries playerAttestationRenderer botguardData/
 * challenge + the po_token machinery — the cipher's real client path now).
 * parseSignatureCipher surfaces the s/sp/url TRIPLE for inspection, but a
 * parsed cipher is NEVER deciphered here and NEVER surfaces in
 * streamFormats — only PLAIN-URL formats do.
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
import { innertube, InnertubeError } from "./innertube";
import { fetchPageHtml } from "./ssr";
import { cachedResilient, TTL } from "./cache";
import { brokerFetchPage } from "@/lib/broker";
import type { PlaybackDto, StoryboardLevelDto, StreamFormatDto } from "@/lib/watch/types";

/** The innertube client used for `player` (env-configurable, default WEB). */
export const PLAYER_CLIENT_ENV = "INNER_TUBE_PLAYER_CLIENT";

const DEFAULT_PLAYER_CLIENT = "WEB";

/**
 * A `player` client context. The web-family clients carry only the identity
 * pair; native-app clients (IOS, ANDROID) add the device fields YouTube's
 * own apps send (the userAgent here rides in the context payload — client
 * identity — while the HTTP transport keeps the browser UA; see innertube.ts).
 * P26-HPV2 additions: `androidSdkVersion` (ANDROID's device field) and
 * `thirdPartyEmbedUrl` (the embed-player family's thirdParty context — sent
 * as context.thirdParty.embedUrl, NOT inside the client object).
 */
export interface PlayerClientContext {
  clientName: string;
  clientVersion: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  userAgent?: string;
  androidSdkVersion?: number;
  thirdPartyEmbedUrl?: string;
}

/** Client contexts known to matter for `player` (unknown names pass through). */
const PLAYER_CLIENTS: Record<string, PlayerClientContext> = {
  WEB: { clientName: "WEB", clientVersion: "2.20260925.08.00" },
  MWEB: { clientName: "MWEB", clientVersion: "2.20260925.08.00" },
  WEB_EMBEDDED_PLAYER: {
    clientName: "WEB_EMBEDDED_PLAYER",
    clientVersion: "1.20260925.01.00",
    thirdPartyEmbedUrl: "https://www.youtube.com",
  },
  WEB_REMIX: { clientName: "WEB_REMIX", clientVersion: "0.1" },
  // P26-HPV2 — the historical embed-player shape (v2.0 + the thirdParty
  // embedUrl context). Measured 2026-10-18 from the sandbox egress it
  // answers ERROR "YouTube is no longer supported in this application or
  // device" for every probe video — the weakest ticket, ordered last.
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    thirdPartyEmbedUrl: "https://www.youtube.com",
  },
  // native app context (realistic iPhone 16 Pro Max / iOS 18.3.2 shape).
  // P22-C: 19.29.1 is DEAD upstream — the player endpoint answers HTTP 400
  // "Precondition check failed" for it (live-probed 2026-10-10), silently
  // killing rung 1's second client. 20.10.4 answers normally (LOGIN_REQUIRED
  // from walled egresses, OK with 27 plain-url formats from the sandbox
  // egress for dQw4w9WgXcQ on 2026-10-18 — the chain's strongest ticket).
  IOS: {
    clientName: "IOS",
    clientVersion: "20.10.4",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.3.2.22D82",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  // P26-HPV2 — the ANDROID native-app ticket (the order's context shape:
  // 20.10.38, androidSdkVersion 30, Android 11). Measured 2026-10-18 from
  // the sandbox egress: OK with 30 PLAIN-URL formats + storyboards for
  // dQw4w9WgXcQ (a second winning native cell alongside IOS) — and it stays
  // a cheap ticket for the per-video lottery on other egresses.
  ANDROID: {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    androidSdkVersion: 30,
    osName: "Android",
    osVersion: "11",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
  },
  // P26B-HPV3 — the ANDROID_VR ticket (the rung the 2026-10-18 measurements
  // named but never wired: "IOS / ANDROID (and ANDROID_VR)" answered OK with
  // plain-url formats for dQw4w9WgXcQ). Re-measured 2026-10-19 from the
  // sandbox egress: OK with 23 plain video formats for dQw4w9WgXcQ — a real
  // third native-family cell. For the walled class (kJQP7kiw5Fk /
  // 8hRGBcr_gJc) it answers LOGIN_REQUIRED like every other client probed
  // (the 13-client matrix of 2026-10-19: WEB/IOS/ANDROID/MWEB/
  // WEB_EMBEDDED_PLAYER/TVHTML5_SIMPLY_EMBEDDED_PLAYER/ANDROID_VR/TVHTML5/
  // ANDROID_MUSIC/IOS_MUSIC/ANDROID_CREATOR → LOGIN_REQUIRED or ERROR,
  // WEB_REMIX → 404, MEDIA_CONNECT_FRONTEND → 403) — a cheap ticket, never
  // a cure for the label-content wall.
  ANDROID_VR: {
    clientName: "ANDROID_VR",
    clientVersion: "1.61.48",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    osName: "Android",
    osVersion: "12L",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
};

/** The configured `player` client context (INNER_TUBE_PLAYER_CLIENT, default WEB). */
export function playerClientContext(): PlayerClientContext {
  const raw = (process.env[PLAYER_CLIENT_ENV] ?? "").trim().toUpperCase();
  const name = raw && PLAYER_CLIENTS[raw] ? raw : DEFAULT_PLAYER_CLIENT;
  return PLAYER_CLIENTS[name];
}

/**
 * The rung-1 client chain (P26-HPV2 — widened from [configured, IOS] to six
 * rungs; P26B-HPV3 — ANDROID_VR joins as the seventh): the configured client
 * first, then the NATIVE-APP family (the plain-URL lottery winners — IOS,
 * ANDROID and ANDROID_VR all answered OK with plain formats for dQw4w9WgXcQ
 * from the sandbox egress), then the web/embedded family (MWEB,
 * WEB_EMBEDDED_PLAYER, TVHTML5_SIMPLY_EMBEDDED_PLAYER — cheap tickets:
 * walled answers cost one FAST request each).
 * Deduped — configuring INNER_TUBE_PLAYER_CLIENT to any chained client
 * removes that rung's duplicate.
 *
 * STS is deliberately NOT passed (playbackContext.contentPlaybackContext.
 * signatureTimestamp; the served build's own value is 20739 — measured in
 * the base.js, no longer embedded in the page HTML). Measured 2026-10-18
 * (twice, both incarnations): WEB/MWEB + the page's visitorData + STS=20739
 * FLIP their cells from UNPLAYABLE to OK — but the flipped answers carry
 * ZERO plain formats (exactly 1 signatureCipher'd itag18 + 26 ABR-track
 * descriptors with NEITHER url NOR signatureCipher + storyboards + SABR +
 * the attestation challenge in playabilityStatus.contextParams). Wiring STS
 * would let the storyboards-only WEB answer CAPTURE the first-usable-wins
 * loop before the IOS/ANDROID rungs — a measured REGRESSION for the native
 * lane (the healthy class would degrade from native video to storyboard).
 * The walled classes don't flip at all (LOGIN_REQUIRED with or without STS
 * — measured on jNQXAC9IVRw + kJQP7kiw5Fk). The page's own re-call does NOT
 * exchange the cipher for plain urls either (the same probe: zero plain
 * formats in every STS-flipped answer). Honest verdict: STS stays out; the
 * measurements are the lane's ledger.
 */
export function playerClientChain(): PlayerClientContext[] {
  const chain = [
    playerClientContext(),
    PLAYER_CLIENTS.IOS,
    PLAYER_CLIENTS.ANDROID,
    PLAYER_CLIENTS.ANDROID_VR,
    PLAYER_CLIENTS.MWEB,
    PLAYER_CLIENTS.WEB_EMBEDDED_PLAYER,
    PLAYER_CLIENTS.TVHTML5_SIMPLY_EMBEDDED_PLAYER,
  ];
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
 *
 * P26-HPV — the stream surface is WIDENED: `streamingData.adaptiveFormats` is
 * read too, and its video-only entries are surfaced with `hasAudio: false` as
 * PREVIEW-ONLY fuel (the hover preview's native lane plays a muted <video>
 * through /api/stream — it needs no audio track; the operator's report: some
 * previews played the video, others showed "slideshows of pictures" — those
 * were embed-disabled videos degrading to the storyboard). The watch page's
 * pickStreamFormat (player-fallback.tsx) still requires muxed, so a
 * video-only stream can never drive the watch swap.
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

  // ---- formats with a plain URL ----
  // Two rungs share one reader:
  //  - `streamingData.formats` (progressive): MUXED required — the watch
  //    page's <video> swap needs audio, so video-only entries are skipped
  //    (unchanged law);
  //  - `streamingData.adaptiveFormats` (P26-HPV): hasAudio is COMPUTED the
  //    exact same way and surfaced honestly — video-only entries become
  //    hasAudio:false preview fuel, rare-but-real muxed-looking adaptive
  //    entries (an audio codec / audioQuality present) stay hasAudio:true.
  const muxed: StreamFormatDto[] = [];
  const videoOnly: StreamFormatDto[] = [];
  const readFormat = (f: any, allowVideoOnly: boolean): void => {
    const url: unknown = f?.url;
    if (typeof url !== "string" || url.length === 0) return; // signatureCipher — skip
    const mime: string = typeof f?.mimeType === "string" ? f.mimeType : "";
    if (!mime.startsWith("video/")) return; // audio-only entries skipped
    const hasAudio =
      typeof f?.audioQuality === "string" || /mp4a|opus|ac-3|ec-3/.test(mime);
    if (!hasAudio && !allowVideoOnly) return; // video-only in the progressive rung — a watch swap needs muxed
    (hasAudio ? muxed : videoOnly).push({
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
      hasAudio,
    });
  };
  for (const f of (pr?.streamingData?.formats ?? []) as any[]) readFormat(f, false);
  for (const f of (pr?.streamingData?.adaptiveFormats ?? []) as any[]) readFormat(f, true);
  // Deterministic order: muxed first (the existing formatRank), then the
  // video-only entries by height DESC — the pickers decide usage anyway
  // (watch: muxed only; preview: nearest-360p).
  muxed.sort((a, b) => formatRank(b) - formatRank(a));
  videoOnly.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const formats: StreamFormatDto[] = [...muxed, ...videoOnly];

  return {
    streamFormats: formats,
    storyboards: parseStoryboardSpec(pr?.storyboards?.playerStoryboardSpecRenderer?.spec),
    durationSec,
    source,
  };
}

/**
 * P26-HPV2 — a parsed signatureCipher entry: the s/sp/url triple. Pure and
 * tolerant (null on any malformed shape, never a throw).
 *
 * Parsing is NOT deciphering. The decipher itself does not exist in
 * implementable form in the current player world (the honest Part 2 stop —
 * see the module header): the classic split→ops→join family is absent from
 * every served player build, and the modern web player plays through SABR
 * gated by attestation. A parsed cipher is therefore surfaced for
 * INSPECTION ONLY (fixture-tested shape) — a deciphered URL would still
 * have to pass the live-verification law (a server-side range probe
 * returning 200/206) before it could EVER ride streamFormats, and no
 * deciphered URL is ever surfaced by this module.
 */
export interface SignatureCipherParts {
  /** The scrambled signature (URL-decoded). */
  s: string;
  /** The signature parameter name the deciphered value appends as (default "sig"). */
  sp: string;
  /** The IP-bound googlevideo stream URL (URL-decoded). */
  url: string;
}

/** Parse a format's `signatureCipher` string (s / sp / url, order-insensitive). */
export function parseSignatureCipher(signatureCipher: unknown): SignatureCipherParts | null {
  if (typeof signatureCipher !== "string" || signatureCipher.length === 0) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(signatureCipher);
  } catch {
    return null;
  }
  const s = params.get("s");
  const sp = params.get("sp");
  const url = params.get("url");
  if (s === null || s.length === 0 || url === null || url.length === 0) return null;
  return { s, sp: sp && sp.length > 0 ? sp : "sig", url };
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
 * Rung 1 — the innertube `player` CLIENT CHAIN (P26-HPV2: six rungs;
 * P26B-HPV3: ANDROID_VR joins, and the loop is FORMATS-FIRST). The FIRST
 * response that parses into a formats-bearing payload wins and stops the
 * loop immediately (a healthy primary client still costs exactly one
 * request). A STORYBOARDS-ONLY answer is the remembered FALLBACK — it must
 * NOT stop the hunt: the operator's 2026-10-19 re-file ("showing a
 * slideshow for some videos") is exactly the starvation mode the STS note
 * feared — on any egress where a web-family rung answers OK-with-
 * storyboards-but-ciphered-formats, the old first-usable-wins loop STOPPED
 * there and the IOS/ANDROID/ANDROID_VR plain-format rungs never fired, so
 * the native preview lane starved and the hover preview fell to the
 * storyboard. Now the loop runs on (each walled/empty rung costs one FAST
 * request), and the storyboards-only answer is returned only when NO rung
 * yields formats. Null when every client is walled/empty.
 *
 * WFX2-P40 — MUXED-FIRST (the operator's "embedding is broken again"
 * re-file, 2026-10-23): the first-usable-wins stop was ONE RUNG TOO
 * SHALLOW for the watch page's fallback player. Measured from the station
 * egress that day (dQw4w9WgXcQ): WEB → UNPLAYABLE; IOS → OK with 22
 * video-only + 5 audio-only PLAIN formats (NO muxed); ANDROID → OK with
 * itag-18 MUXED + 23 video + 6 audio; ANDROID_VR → OK with itag-18 MUXED.
 * Production's cached playback DTO carried the IOS answer (`c=IOS`, every
 * format hasAudio:false) — so when the operator's browser got embed-walled
 * (the bot-check lottery), the client's muxed-only picker
 * (player-fallback pickStreamFormat) found NOTHING usable, the native
 * fallback never armed, and the honest exhaustion card answered — while
 * the muxed itag-18 sat UNREACHED one rung later. The loop is now
 * MUXED-FIRST: an answer carrying a hasAudio format wins immediately; a
 * formats-bearing-but-audioless answer is the remembered WEAK fallback
 * (still fine for the hover preview / box-player video lanes) and the hunt
 * continues — the ANDROID/ANDROID_VR rungs are exactly the muxed lottery
 * tickets behind IOS. Walled/empty rungs still cost one FAST request each,
 * so the deeper hunt is cheap; the P37 chain budget bounds the worst case.
 *
 * The embed-player family's thirdParty context rides as
 * context.thirdParty.embedUrl (sibling of context.client — the historical
 * embed-player shape), never inside the client object itself.
 */
async function fetchInnertubePlayer(
  videoId: string,
  io: ChainIO = {}
): Promise<PlaybackDto | null> {
  let storyboardFallback: PlaybackDto | null = null;
  let audiolessFallback: PlaybackDto | null = null;
  for (const client of playerClientChain()) {
    const { thirdPartyEmbedUrl, ...clientFields } = client;
    const context: Record<string, unknown> = { client: { ...clientFields, hl: "en", gl: "US" } };
    if (thirdPartyEmbedUrl) context.thirdParty = { embedUrl: thirdPartyEmbedUrl };
    let response: unknown;
    try {
      response = await innertube("player", {
        context,
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }, {
        ...(io.signal ? { signal: io.signal } : {}),
        ...(io.innertubeTimeoutMs !== undefined ? { timeoutMs: io.innertubeTimeoutMs } : {}),
        ...(io.innertubeExtraRetries !== undefined ? { extraRetries: io.innertubeExtraRetries } : {}),
      });
    } catch {
      continue; // walled answers also arrive as HTTP 200 + UNPLAYABLE — and hard errors
    }
    const dto = parsePlayback("player", response);
    if (dto.streamFormats.some((f) => f.hasAudio)) return dto; // MUXED wins IMMEDIATELY (the watch fallback needs audio)
    if (dto.streamFormats.length > 0) audiolessFallback ??= dto; // formats-but-silent: remembered, hunt continues
    if (dto.storyboards.length > 0) storyboardFallback ??= dto; // remembered, never a chain-stopper
  }
  return audiolessFallback ?? storyboardFallback;
}

/**
 * WFX2-P41 — THE PER-USER OAUTH PLAYER RUNG's client ladder. Measured
 * 2026-10-23 from the station egress on dQw4w9WgXcQ (the loose protection
 * class): ANDROID and ANDROID_VR both answer OK with n-free muxed itag-18;
 * IOS answers OK with 27 n-free audioless formats (preview fuel). The
 * protected/trending class walls EVERY client anonymously from datacenter
 * egresses (measured same day: 10/10 home-feed videos LOGIN_REQUIRED on
 * WEB/IOS/ANDROID/ANDROID_VR/MWEB/TVHTML5 from BOTH the station and
 * production's Vercel egress — only the watch-page rung answered, with
 * n-scrambled dead URLs; see the filter below). The authed rung rides the
 * SAME client ladder with the acting user's OAuth Bearer token: the wall's
 * own "Sign in to confirm you're not a bot" demand answered through the
 * sanctioned P36 connection spine (the endpoint parses the Authorization
 * header — a fake bearer answers Google's auth-layer 401, measured live
 * 2026-10-23, distinct from the anonymous LOGIN_REQUIRED wall).
 */
const AUTHED_PLAYER_CLIENTS: PlayerClientContext[] = [
  PLAYER_CLIENTS.ANDROID,
  PLAYER_CLIENTS.ANDROID_VR,
  PLAYER_CLIENTS.IOS,
];

/**
 * WFX2-P41 — the auth-rung refusal sticky (per lambda instance, per user):
 * when EVERY authed client answers 401 (the token refused — scope/consent
 * class), the rung is skipped for AUTH_RUNG_REFUSED_MS so a refused token
 * does not cost 3 doomed requests per playback DTO. The expiry (or a live
 * answer once the rung runs again) is the recovery path — a re-consented
 * token revives within the window. Test-resettable (the
 * resetYoutubeConnectionStore precedent).
 */
const AUTH_RUNG_REFUSED_MS = 5 * 60_000;
/**
 * WFX2-P41 — the authed rung's budget reserve: 3 single-attempt 4s client
 * requests, carved out of the caller's chain budget so the per-user path's
 * worst case stays inside the same wall the shared path respects.
 */
const AUTH_RUNG_RESERVE_MS = 10_000;
const authRungRefusedUntil = new Map<string, number>();

/** Test-only: clear the per-user auth-rung refusal sticky. */
export function resetAuthRungRefusalForTests(): void {
  authRungRefusedUntil.clear();
}

function authRungRefused(userId: string): boolean {
  const until = authRungRefusedUntil.get(userId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    authRungRefusedUntil.delete(userId);
    return false;
  }
  return true;
}

/**
 * WFX2-P41 — the per-user OAuth `player` rung. Identical law to the
 * anonymous loop (MUXED-FIRST: a hasAudio answer wins immediately; an
 * audioless formats answer is the remembered WEAK fallback; storyboards
 * remembered) over the ANDROID/ANDROID_VR/IOS ladder, each request carrying
 * `Authorization: Bearer <accessToken>` (innertube.ts threads it — the
 * explicit credential always wins over the env session's SAPISIDHASH).
 *
 * A 401 on every attempted client marks the refusal sticky (the honest
 * degrade for a refused token — the anonymous base answer serves). A
 * walled-but-authenticated answer (LOGIN_REQUIRED even with the token) is
 * NOT a refusal — the rung just returns what it found, like the anonymous
 * chain. Never throws; null when nothing usable answered.
 */
async function fetchInnertubePlayerAuthed(
  videoId: string,
  accessToken: string,
  userId: string,
  io: ChainIO = {}
): Promise<PlaybackDto | null> {
  const authorization = `Bearer ${accessToken}`;
  let storyboardFallback: PlaybackDto | null = null;
  let audiolessFallback: PlaybackDto | null = null;
  let refusedCount = 0;
  let answeredCount = 0;
  for (const client of AUTHED_PLAYER_CLIENTS) {
    const { thirdPartyEmbedUrl, ...clientFields } = client;
    const context: Record<string, unknown> = { client: { ...clientFields, hl: "en", gl: "US" } };
    let response: unknown;
    try {
      response = await innertube("player", {
        context,
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }, {
        ...(io.signal ? { signal: io.signal } : {}),
        ...(io.innertubeTimeoutMs !== undefined ? { timeoutMs: io.innertubeTimeoutMs } : {}),
        // the authed rung is always SINGLE-ATTEMPT: each client is a lottery
        // ticket (a refused 401 or a walled 200 answers FAST), and the
        // built-in retry would double every doomed request's cost.
        extraRetries: io.innertubeExtraRetries ?? -1,
        authorization,
      });
    } catch (err) {
      if (err instanceof InnertubeError && err.status === 401) refusedCount++;
      continue; // refused/walled/hard-error rung — the ladder continues
    }
    answeredCount++;
    authRungRefusedUntil.delete(userId); // a live answer clears any stale refusal
    const dto = parsePlayback("player-authed", response);
    if (dto.streamFormats.some((f) => f.hasAudio)) return dto; // MUXED wins IMMEDIATELY
    if (dto.streamFormats.length > 0) audiolessFallback ??= dto; // formats-but-silent: preview fuel, remembered
    if (dto.storyboards.length > 0) storyboardFallback ??= dto; // remembered, never a chain-stopper
  }
  if (answeredCount === 0 && refusedCount === AUTHED_PLAYER_CLIENTS.length) {
    // every client refused the credential — the token itself is dead for
    // this endpoint (scope/consent class). Skip the rung for a while.
    authRungRefusedUntil.set(userId, Date.now() + AUTH_RUNG_REFUSED_MS);
  }
  return audiolessFallback ?? storyboardFallback;
}

/**
 * WFX2-P41 — THE N-SCRAMBLED URL FILTER (the honest watch-page hygiene).
 *
 * Measured 2026-10-23 in production: the watch-page rung's plain itag-18
 * URLs carry the WEB client's scrambled `n` query param (`c=WEB`, e.g.
 * n=t_vpcG7Jhd28K6hmIfT), and googlevideo now answers 403 to the
 * UNTRANSFORMED n even from the SAME invocation that minted the URL (the
 * stream route's fresh re-chain 502'd 10/10 home-feed videos while dQw4's
 * n-free ANDROID URLs 206'd through the same route — the enforcement
 * hardened from throttle to hard 403 during 2026-10-20..23; P31's era
 * streamed these same URLs 4/4). The real web player transforms n via the
 * player JS (the ntsc lane — descoped by P26-HPV2's honest verdict); a
 * server-side transform is a decipher-class lane this repo does not ship.
 *
 * The honest law instead: a format whose URL carries a standalone `n` param
 * from the watch-page/broker rungs is PRESUMPTIVELY DEAD fuel — surfacing
 * it arms a doomed native boot (the preview wastes its health-gate window,
 * the watch fallback errors to the same card it would have shown
 * honestly). Drop it at parse time; keep the storyboards + duration (the
 * preview's storyboard lane + the honest floors are untouched). Scoped to
 * the watch-page/broker rungs ONLY — the native-client player answers
 * measure n-free today (ANDROID/ANDROID_VR/IOS, 2026-10-23) and stay
 * untouched. If YouTube re-softens n (P31's 2026-10-20 behavior), re-measure
 * and revert this filter — the comment is the ledger.
 */
function urlCarriesScrambledN(url: string): boolean {
  try {
    return new URL(url).searchParams.has("n");
  } catch {
    return false; // malformed URL — not this filter's law
  }
}

/** Drop the n-scrambled (presumptively dead) formats from a watch-page/broker DTO. */
export function dropScrambledNFormats(dto: PlaybackDto): PlaybackDto {
  const kept = dto.streamFormats.filter((f) => !urlCarriesScrambledN(f.url));
  if (kept.length === dto.streamFormats.length) return dto;
  return { ...dto, streamFormats: kept };
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
async function fetchWatchPagePlayerResponse(
  videoId: string,
  timeoutMs: number = 12_000
): Promise<unknown | null> {
  try {
    const html = await fetchPageHtml(`/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`, {
      timeoutMs,
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
 *
 * P26B-HPV3 — the chain is FORMATS-FIRST end to end: a storyboards-only
 * rung-1 answer no longer returns early — the hunt continues into rung 2
 * (whose watch-page reads measured plain itag18 urls on walled-player
 * cells: 2026-10-19 production census, 31/51 home-feed videos) and rung 3,
 * and the storyboards-only answer survives only as the remembered fallback
 * when NO rung yields formats. Semantics otherwise preserved: a rung-2
 * answer carrying storyboards still short-circuits the broker (the WFX2-4A
 * trigger law — the broker is the last resort for a rung-2 HTML fetch that
 * produced nothing parseable at all).
 */
/** Options for {@link getPlayback} — P31-HPV5. */
export interface GetPlaybackOptions {
  /**
   * P31-HPV5 — force a fresh chain run: skip the cache READ paths and
   * re-run the whole chain in THIS invocation, writing the answer through
   * (the cache engine's `force`). The playback route's stream mode rides it
   * after a 403: a cached stream URL is egress-bound (generated by a past
   * invocation — serverless containers rotate egress IPs), so the retry
   * must generate and fetch from the SAME invocation — the one axis that
   * always matches.
   */
  fresh?: boolean;
  /**
   * WFX2-P37 — THE CHAIN BUDGET (the production 504 cure, part 2): a hard
   * wall-clock deadline for the whole chain. The pre-P37 chain could burn
   * MINUTES on a walled egress (7 innertube rungs × 10s timeout × 2
   * attempts + jitter + a 12s watch-page fetch + the broker rung — measured
   * 2026-10-22 in production: cold-cache DTO answers 504'd at the platform's
   * 60s limit before the route's own honest degrade could run), so every
   * route that answers within a serverless maxDuration now races the chain
   * against a budget and answers the honest empty degrade (source: "" —
   * never cached, the poisoning guard) when the wall eats the clock. The
   * budget also TIGHTENS the rungs themselves (single-attempt 4s innertube
   * calls + a 6s watch-page fetch) so the deadline aborts active requests,
   * not just their results.
   */
  budgetMs?: number;
  /**
   * WFX2-P41 — THE PER-USER OAUTH PLAYER RUNG: the acting user's YouTube
   * connection (the P36 spine's OAuth access token + their WebFlix user
   * id). When present, the chain runs the anonymous base as always, then
   * the authed ANDROID/ANDROID_VR/IOS `player` ladder with
   * `Authorization: Bearer <token>` — the bot-wall's own "Sign in to
   * confirm" demand answered with the user's own credential — and merges
   * the user's formats ON TOP of the base under a PER-USER cache key
   * (`yt:playback:auth:<userId>:<videoId>`): the shared anonymous row is
   * never touched (the P36 isolation law). Absent (every anonymous
   * caller) → the shared path, byte-identical to pre-P41.
   *
   * Measured context (2026-10-23, the operator's "embedding and preview
   * broken" re-file): the wall hardened across 2026-10-20..23 — the
   * protected/trending class now LOGIN_REQUIREDs every anonymous innertube
   * client from datacenter egresses (station AND production Vercel), and
   * the watch-page rung's plain URLs carry the scrambled `n` param that
   * googlevideo 403s untransformed — the anonymous native lane died for
   * the whole feed class. The authed rung is the revival lane for
   * connected users; anonymous users keep the honest floors (the embed
   * lottery + storyboards).
   */
  auth?: { userId: string; accessToken: string };
}

/** The per-rung I/O shape a budgeted chain run uses (P37). */
interface ChainIO {
  /** shared deadline — aborts every innertube rung through the composed signal */
  signal?: AbortSignal;
  /** per-rung innertube timeout (default: the innertube module's own 10s) */
  innertubeTimeoutMs?: number;
  /** extra retries per rung (budgeted runs pass -1: ONE attempt each) */
  innertubeExtraRetries?: number;
  /** the watch-page rung's fetch timeout (default 12s) */
  pageTimeoutMs?: number;
}

export async function getPlayback(
  videoId: string,
  opts: GetPlaybackOptions = {}
): Promise<PlaybackDto> {
  // WFX2-P41 — THE PER-USER DISPATCH: without `auth` the shared path runs
  // byte-identically to pre-P41 (the anonymous law, untouched). With `auth`
  // the per-user merge rides its OWN cache key — the authed answer can
  // NEVER touch the shared `yt:playback:<id>` row (the P36 isolation law:
  // one user's authenticated playback fuel is never served to another).
  // The key carries the userId, so every cache layer (L1 per instance, L2
  // Upstash) isolates per user by construction.
  if (!opts.auth) return getPlaybackShared(videoId, opts);
  const { userId, accessToken } = opts.auth;
  return cachedResilient(
    `yt:playback:auth:${userId}:${videoId}`,
    TTL.WATCH_MS,
    async () => {
      // WFX2-P41 — the budget law: ONE outer deadline covers the base chain
      // AND the authed rung (the per-user answer must respect the caller's
      // maxDuration exactly like the shared one). The base gets the budget
      // minus the authed rung's reserve (3 single-attempt clients), so the
      // worst case stays inside the caller's wall — the DTO route's 40s and
      // the stream route's 22s ride unchanged.
      const outerSignal = opts.budgetMs ? AbortSignal.timeout(opts.budgetMs) : undefined;
      const base = await getPlaybackShared(videoId, {
        fresh: opts.fresh,
        ...(opts.budgetMs
          ? { budgetMs: Math.max(opts.budgetMs - AUTH_RUNG_RESERVE_MS, 5_000) }
          : {}),
      });
      if (authRungRefused(userId)) {
        // the sticky refusal — the honest degrade: the anonymous truth
        return base;
      }
      const io: ChainIO = outerSignal
        ? { signal: outerSignal, innertubeTimeoutMs: 4_000, innertubeExtraRetries: -1 }
        : {};
      const authed = await fetchInnertubePlayerAuthed(videoId, accessToken, userId, io);
      if (!authed || authed.streamFormats.length === 0) {
        // the authed rung honestly failed (walled even authenticated /
        // network) — the anonymous base answers unchanged
        return base;
      }
      // THE MERGE LAW: the user's own authenticated formats lead the union
      // (fresh, user-context URLs — the wall's own sign-in demand answered);
      // the base's anonymous formats follow deduped by itag (both classes
      // fetch same-invocation — the pickers choose, more fuel never hurts).
      // Storyboards/duration: the richer of the two (the preview's
      // storyboard lane + the honest floors keep their fuel).
      const authedItags = new Set(authed.streamFormats.map((f) => f.itag));
      const mergedFormats = [
        ...authed.streamFormats,
        ...base.streamFormats.filter((f) => !authedItags.has(f.itag)),
      ];
      return {
        streamFormats: mergedFormats,
        storyboards:
          authed.storyboards.length > 0 ? authed.storyboards : base.storyboards,
        durationSec: authed.durationSec ?? base.durationSec,
        source: "player-authed",
      };
    },
    // The same poisoning guard as the shared key: the honest empty degrade
    // (source "" — authed failed AND the anonymous chain found nothing) is
    // NEVER cached; a later healthy run still gets its chance.
    { isEmpty: (v) => (v as PlaybackDto).source === "", force: opts.fresh === true }
  );
}

async function getPlaybackShared(
  videoId: string,
  opts: GetPlaybackOptions = {}
): Promise<PlaybackDto> {
  return cachedResilient(
    `yt:playback:${videoId}`,
    TTL.WATCH_MS,
    async () => {
      // WFX2-P37 — the budgeted shape: rungs tightened (single-attempt 4s
      // innertube calls, 6s watch page) and the WHOLE chain raced against the
      // caller's wall-clock budget. On deadline the honest empty degrade
      // answers (source: "" — the poisoning guard below keeps it out of the
      // cache, so a later unwalled run still gets its chance). Unbudgeted
      // callers keep the pre-P37 per-rung defaults exactly.
      const io: ChainIO = opts.budgetMs
        ? { signal: AbortSignal.timeout(opts.budgetMs), innertubeTimeoutMs: 4_000, innertubeExtraRetries: -1, pageTimeoutMs: 6_000 }
        : {};
      const runChain = async (): Promise<PlaybackDto> => {
        let storyboardFallback: PlaybackDto | null = null;
        let audiolessFallback: PlaybackDto | null = null;
        const fromPlayer = await fetchInnertubePlayer(videoId, io);
        if (fromPlayer) {
          // WFX2-P40 — MUXED-FIRST continues through the outer chain too: an
          // audioless rung-1 formats answer is the remembered WEAK win; the
          // watch-page rung 2 (progressive itag-18/22 plain URLs on walled-
          // player cells) and the broker rung 3 are exactly the muxed
          // sources that can still outrank it.
          if (fromPlayer.streamFormats.some((f) => f.hasAudio)) return fromPlayer;
          if (fromPlayer.streamFormats.length > 0) {
            audiolessFallback = fromPlayer; // formats-but-silent — remembered, hunt continues
          } else {
            storyboardFallback = fromPlayer; // storyboards-only — remembered, hunt continues
          }
        }
        const fromPage = await fetchWatchPagePlayerResponse(videoId, io.pageTimeoutMs ?? 12_000);
        if (fromPage) {
          // WFX2-P41 — the n-scrambled URL filter rides the watch-page rung's
          // parse (the measured dead class; see dropScrambledNFormats).
          const pageDto = dropScrambledNFormats(parsePlayback("watch-page", fromPage));
          if (pageDto.streamFormats.length > 0) return pageDto; // the formats hunt's rung-2 win (progressive → muxed)
          if (pageDto.storyboards.length > 0) {
            storyboardFallback ??= pageDto;
            // storyboards in hand — the broker is not the last resort for
            // these; an audioless FORMATS answer still outranks a
            // storyboards-only one (the preview lane can play video).
            return audiolessFallback ?? storyboardFallback;
          }
        }
        // WFX2-4A rung 3 — the broker's page-context watch read (the logged-in
        // session's own page); honest failure → the degrade below
        const fromBroker = await fetchBrokerWatchPlayerResponse(videoId);
        if (fromBroker) {
          // WFX2-P41 — the broker rung's page-context URLs ride the same WEB
          // client shape (n-scrambled) — the same filter law applies.
          const brokerDto = dropScrambledNFormats(parsePlayback("broker-watch", fromBroker));
          if (brokerDto.streamFormats.length > 0 || brokerDto.storyboards.length > 0) {
            return brokerDto;
          }
        }
        return audiolessFallback
          ?? storyboardFallback
          ?? { streamFormats: [], storyboards: [], durationSec: null, source: "" };
      };
      if (!opts.budgetMs) return runChain();
      // P37 — the deadline race. The empty degrade resolves the race on
      // deadline; the chain's own answer wins whenever it lands first. A
      // losing chain keeps running until its rungs' composed signal aborts
      // them (or the invocation ends) — the RESPONSE is bounded either way.
      const emptyOnDeadline = new Promise<PlaybackDto>((resolve) => {
        io.signal?.addEventListener("abort", () => {
          resolve({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
        }, { once: true });
      });
      return Promise.race([runChain(), emptyOnDeadline]);
    },
    // WFX2-5 poisoning guard (the 4-c incident): the honest empty degrade is
    // NEVER cached — a wedge/wall window must not poison the key for the
    // 10min soft TTL (+2h last-good window). With a last-good payload that
    // keeps serving instead; a cold cache passes the empty through untouched
    // (the channel broker rung's convention). A healthy broker-watch read —
    // storyboards present, formats maybe empty because they are ciphered —
    // has source "broker-watch" and caches normally.
    { isEmpty: (v) => (v as PlaybackDto).source === "", force: opts.fresh === true }
  );
}

/**
 * P31-HPV5 — the server-side stream picker (the canonical home; the legacy
 * /api/stream route imports the same law). The server twin of the client's
 * pickPreviewStreamFormat (src/lib/watch/playback-client.ts): prefer the
 * EXACT itag the client picked (a Range resume must ride the same stream),
 * else the nearest-360p law — muxed (hasAudio) entries preferred so a
 * watch-page fallback never lands on a silent stream, any entry as the
 * last resort.
 */
export function pickProxyStreamFormat(
  formats: StreamFormatDto[],
  preferItag: number | null
): StreamFormatDto | null {
  if (formats.length === 0) return null;
  if (preferItag !== null) {
    const exact = formats.find((f) => f.itag === preferItag);
    if (exact) return exact;
  }
  const score = (f: StreamFormatDto): number =>
    -Math.abs((f.height ?? 0) - 360) * 1000 + (f.hasAudio ? 500 : 0) - (f.bitrate ?? 0) / 1e9;
  const withAudio = formats.filter((f) => f.hasAudio);
  const pool = withAudio.length > 0 ? withAudio : formats;
  return pool.reduce((best, f) => (score(f) > score(best) ? f : best));
}
