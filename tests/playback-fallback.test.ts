/// <reference types="bun-types" />
/**
 * Task 2-c tests — the playback fallback chain (server side).
 *
 * Covered:
 *  - parseStoryboardSpec: the REAL dQw4 storyboard spec (fixture captured
 *    from the live watch page 2026-10-04) → animatable M$M levels with the
 *    verified template math ($L → level, $N kept as the sheet placeholder,
 *    &sigh appended; L2 = 160x90 frames, 5x5 grid, 108 frames, 5 sheets);
 *  - parsePlayback: the honest filter (signatureCipher-only formats yield
 *    EMPTY streamFormats), the plain-url progressive picker (itag 22 > 18),
 *    walled/UNPLAYABLE shapes → empty;
 *  - extractPlayerResponseFromHtml round-trip;
 *  - getPlayback's chain via the setUpstream seam: rung 1 `player` over the
 *    CLIENT CHAIN (INNER_TUBE_PLAYER_CLIENT primary, default WEB, then IOS —
 *    first usable answer wins, no request multiplication) → rung 2 the watch
 *    page's embedded player response → rung 3 the BROKER's page-context
 *    watch read (WFX2-4A — the logged-in session's own page, source
 *    "broker-watch") → honest-empty when all are walled;
 *  - GET /api/videos/[id]/playback (DTO + validation);
 *  - GET /api/stream (the googlevideo proxy): allowlist, Range passthrough,
 *    status/header pass-through, upstream failure mapping.
 *
 * NEVER the network (lane law: tests run against tests/fixtures/yt only).
 * The broker client is MOCKED with an injectable brokerFetchPage (the
 * comment-writes/action-routes mock.module pattern — the real module is
 * re-installed in afterAll; bun's mock.module is process-wide).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";

/* capture the REAL broker module before the mock replaces it (restore) —
 * copied into a fresh object: bun mutates the captured namespace in place
 * when mock.module swaps the registry */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realBroker = { ...require("@/lib/broker") } as Record<string, unknown>;

class MockBrokerError extends Error {
  kind: string;
  status: number;
  constructor(kind: string, message: string, status: number) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
  }
}

const brokerCalls: string[] = [];
/** injectable broker fetch: a path→response fn, or a value for every path */
let brokerResponse: unknown = new MockBrokerError(
  "offline",
  "action backend offline — the lead's broker must be running",
  502
);

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerFetchPage: async (path: string) => {
    brokerCalls.push(path);
    return typeof brokerResponse === "function" ? brokerResponse(path) : brokerResponse;
  },
}));

/* the app modules (imported after the mock) */
import {
  extractPlayerResponseFromHtml,
  getPlayback,
  parsePlayback,
  parseSignatureCipher,
  parseStoryboardSpec,
  playerClientChain,
  playerClientContext,
  pickProxyStreamFormat,
  PLAYER_CLIENT_ENV,
} from "@/lib/youtube/streams";
import { setUpstream } from "@/lib/youtube/innertube";
import { cachePeek, clearCache } from "@/lib/youtube/cache";
import { pickPreviewStreamFormat } from "@/lib/watch/playback-client";
import { pickStreamFormat } from "@/components/player/player-fallback";
import { GET as playbackRoute } from "@/app/api/videos/[id]/playback/route";
import { GET as streamRoute, resetProxyRegenCache } from "@/app/api/stream/route";
import { attemptChainStream, fetchUpstream } from "@/lib/youtube/stream-proxy";
import type { StreamFormatDto } from "@/lib/watch/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const playerFixture = load("player_storyboard_dQw4");
/** P26-HPV2 — the 2026-10-18 real watch-page capture (the walled-class shape). */
const watchpage2026Fixture = load("player_watchpage_dQw4_20261018");

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe("parseStoryboardSpec — the real dQw4 spec (live-captured)", () => {
  const spec: string = playerFixture.storyboards.playerStoryboardSpecRenderer.spec;

  test("the M$M levels parse with the verified template math; the default level is skipped", () => {
    const levels = parseStoryboardSpec(spec);
    expect(levels.map((l) => l.level)).toEqual([1, 2, 3]); // L0 "default" skipped
    const l2 = levels.find((l) => l.level === 2)!;
    expect(l2.frameWidth).toBe(160);
    expect(l2.frameHeight).toBe(90);
    expect(l2.cols).toBe(5);
    expect(l2.rows).toBe(5);
    expect(l2.frameCount).toBe(108);
    expect(l2.sheetCount).toBe(5); // ceil(108 / 25)
    expect(l2.intervalMs).toBe(2000);
    // template: level substituted, $N preserved for the client, sigh appended
    expect(l2.templateUrl).toContain("storyboard3_L2/$N.jpg");
    expect(l2.templateUrl).toContain("&sigh=rs$AOn4CLClA1jTU48sHENDTij_c2ZcE493TQ");
    // the base URL's sqp survived
    expect(l2.templateUrl).toContain("sqp=");
  });

  test("tolerant shapes: no spec / garbage → empty, never a throw", () => {
    expect(parseStoryboardSpec(undefined)).toEqual([]);
    expect(parseStoryboardSpec("")).toEqual([]);
    expect(parseStoryboardSpec("https://example.com/no-placeholders.jpg")).toEqual([]);
    expect(parseStoryboardSpec("https://i.ytimg.com/x$L/$N.jpg|not#enough#fields")).toEqual([]);
  });
});

describe("parsePlayback — formats + storyboards + duration", () => {
  test("the real watch-page fixture: storyboards parse, signatureCipher-only formats are HONESTLY dropped", () => {
    const dto = parsePlayback("watch-page", playerFixture);
    expect(dto.source).toBe("watch-page");
    expect(dto.streamFormats).toEqual([]); // cipher-only — no deciphering in scope
    expect(dto.storyboards).toHaveLength(3);
    expect(dto.durationSec).toBe(213);
  });

  test("plain-url progressive formats: itag 22 outranks 18; video-only and ciphered are dropped", () => {
    const response = {
      playabilityStatus: { status: "OK" },
      videoDetails: { lengthSeconds: "213" },
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            url: "https://rr3.googlevideo.com/videoplayback?itag=18",
            qualityLabel: "360p",
            width: 640,
            height: 360,
            fps: 25,
            bitrate: 444226,
            approxDurationMs: "213089",
            audioQuality: "AUDIO_QUALITY_LOW",
          },
          {
            itag: 22,
            mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
            url: "https://rr3.googlevideo.com/videoplayback?itag=22",
            qualityLabel: "720p",
            width: 1280,
            height: 720,
            audioQuality: "AUDIO_QUALITY_MEDIUM",
          },
          {
            // adaptive video-only — no muxed audio → dropped
            itag: 137,
            mimeType: 'video/mp4; codecs="avc1.640028"',
            url: "https://rr3.googlevideo.com/videoplayback?itag=137",
            width: 1920,
            height: 1080,
          },
          {
            // ciphered → dropped (no plain url)
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            signatureCipher: "s=abc&sp=sig&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback",
            audioQuality: "AUDIO_QUALITY_LOW",
          },
        ],
      },
    };
    const dto = parsePlayback("player", response);
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([22, 18]);
    expect(dto.streamFormats[0]).toMatchObject({
      qualityLabel: "720p",
      hasAudio: true,
      mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
    });
    expect(dto.durationSec).toBe(213);
    expect(dto.source).toBe("player");
  });

  test("walled / broken shapes → the honest empty payload", () => {
    expect(parsePlayback("player", { playabilityStatus: { status: "LOGIN_REQUIRED" } })).toEqual({
      streamFormats: [],
      storyboards: [],
      durationSec: null,
      source: "player",
    });
    expect(parsePlayback("player", { playabilityStatus: { status: "UNPLAYABLE", reason: "Video unavailable" } }).streamFormats).toEqual([]);
    expect(parsePlayback("player", null).storyboards).toEqual([]);
  });

  test("extractPlayerResponseFromHtml round-trips the fixture", () => {
    const html = `<!doctype html><html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(
      playerFixture
    )};</script></body></html>`;
    const extracted = extractPlayerResponseFromHtml(html);
    expect(extracted?.playabilityStatus?.status).toBe("OK");
    expect(extracted?.storyboards?.playerStoryboardSpecRenderer?.spec).toContain("storyboard3_L$L/$N.jpg");
    expect(extractPlayerResponseFromHtml("<html>no player response here</html>")).toBeNull();
    // malformed JSON inside the marker → null, never a throw
    expect(extractPlayerResponseFromHtml("var ytInitialPlayerResponse = {broken;;};</script>")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P26-HPV — adaptiveFormats (the hover preview's native-lane fuel) + pickers
// ---------------------------------------------------------------------------

/** A StreamFormatDto builder (defaults = a 360p video-only adaptive entry). */
const fmt = (
  over: Partial<StreamFormatDto> & Pick<StreamFormatDto, "itag" | "url">
): StreamFormatDto => ({
  mimeType: 'video/mp4; codecs="avc1.4d401e"',
  qualityLabel: null,
  width: 640,
  height: 360,
  fps: 30,
  bitrate: 600_000,
  contentLength: null,
  approxDurationMs: null,
  hasAudio: false,
  ...over,
});

describe("P26-HPV — parsePlayback: adaptiveFormats widen the stream surface (preview-only fuel)", () => {
  const adaptiveResponse = (adaptiveFormats: unknown[], formats: unknown[] = []) => ({
    playabilityStatus: { status: "OK" },
    videoDetails: { lengthSeconds: "213" },
    streamingData: { formats, adaptiveFormats },
  });

  test("a video-only adaptive entry with a plain URL is surfaced (hasAudio:false, real dimensions) after the muxed rung", () => {
    const dto = parsePlayback("player", adaptiveResponse(
      [
        // video-only 360p adaptive — the hover preview's native-lane fuel
        {
          itag: 134,
          mimeType: 'video/mp4; codecs="avc1.4d401e"',
          url: "https://rr5.googlevideo.com/videoplayback?itag=134",
          qualityLabel: "360p",
          width: 640,
          height: 360,
          fps: 30,
          bitrate: 600000,
          approxDurationMs: "213089",
        },
        // video-only 1080p adaptive — taller, still preview fuel
        {
          itag: 137,
          mimeType: 'video/mp4; codecs="avc1.640028"',
          url: "https://rr5.googlevideo.com/videoplayback?itag=137",
          qualityLabel: "1080p",
          width: 1920,
          height: 1080,
          fps: 30,
          bitrate: 2500000,
        },
      ],
      [
        {
          itag: 18,
          mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          url: "https://rr5.googlevideo.com/videoplayback?itag=18",
          qualityLabel: "360p",
          width: 640,
          height: 360,
          audioQuality: "AUDIO_QUALITY_LOW",
        },
      ]
    ));
    // deterministic order: muxed first (formatRank), then video-only by height DESC
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18, 137, 134]);
    const f134 = dto.streamFormats.find((f) => f.itag === 134)!;
    expect(f134.hasAudio).toBe(false); // the honest preview-only marker
    expect(f134.height).toBe(360);
    expect(f134.width).toBe(640);
    expect(f134.url).toBe("https://rr5.googlevideo.com/videoplayback?itag=134");
    expect(f134.mimeType).toBe('video/mp4; codecs="avc1.4d401e"');
    // the raw approxDurationMs passthrough (the field rides the DTO as-is)
    expect(String(f134.approxDurationMs)).toBe("213089");
  });

  test("audio-only adaptive entries are skipped (a hover preview needs pictures)", () => {
    const dto = parsePlayback("player", adaptiveResponse([
      {
        itag: 140,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        url: "https://rr5.googlevideo.com/videoplayback?itag=140",
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        bitrate: 130000,
      },
    ]));
    expect(dto.streamFormats).toEqual([]);
  });

  test("signatureCipher-only adaptive entries are skipped (the standing no-deciphering law)", () => {
    const dto = parsePlayback("player", adaptiveResponse([
      {
        itag: 137,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        signatureCipher: "s=abc&sp=sig&url=https%3A%2F%2Frr5.googlevideo.com%2Fvideoplayback",
        width: 1920,
        height: 1080,
      },
    ]));
    expect(dto.streamFormats).toEqual([]);
  });

  test("a muxed-looking adaptive entry (an audio codec present) keeps hasAudio:true", () => {
    const dto = parsePlayback("player", adaptiveResponse([
      {
        itag: 18,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        url: "https://rr5.googlevideo.com/videoplayback?itag=18",
        qualityLabel: "360p",
        width: 640,
        height: 360,
        audioQuality: "AUDIO_QUALITY_LOW",
      },
    ]));
    expect(dto.streamFormats).toHaveLength(1);
    expect(dto.streamFormats[0].hasAudio).toBe(true);
  });
});

describe("P26-HPV — the pickers (the watch guard + the preview's nearest-360p)", () => {
  test("pickStreamFormat (the WATCH picker) NEVER returns a hasAudio:false entry, even when it is the tallest", () => {
    const formats = [
      fmt({ itag: 18, url: "https://rr5.googlevideo.com/videoplayback?itag=18", hasAudio: true, qualityLabel: "360p" }),
      fmt({ itag: 137, url: "https://rr5.googlevideo.com/videoplayback?itag=137", hasAudio: false, height: 1080, qualityLabel: "1080p" }),
    ];
    expect(pickStreamFormat(formats)?.itag).toBe(18); // muxed 360p beats video-only 1080p
    // a video-only-only surface yields null — the blocked card's contract
    expect(pickStreamFormat([formats[1]])).toBeNull();
  });

  test("pickPreviewStreamFormat: nearest-360p wins over 720p/1080p", () => {
    const picked = pickPreviewStreamFormat([
      fmt({ itag: 137, url: "u137", height: 1080, hasAudio: false, bitrate: 2_500_000 }),
      fmt({ itag: 136, url: "u136", height: 720, hasAudio: true, bitrate: 1_200_000 }),
      fmt({ itag: 134, url: "u134", height: 360, hasAudio: false, bitrate: 600_000 }),
    ]);
    expect(picked?.itag).toBe(134);
  });

  test("pickPreviewStreamFormat: muxed wins an exact height tie (+500)", () => {
    const picked = pickPreviewStreamFormat([
      fmt({ itag: 134, url: "u134", height: 360, hasAudio: false, bitrate: 600_000 }),
      fmt({ itag: 18, url: "u18", height: 360, hasAudio: true, bitrate: 600_000 }),
    ]);
    expect(picked?.itag).toBe(18);
  });

  test("pickPreviewStreamFormat: empty input → null (the storyboard floor)", () => {
    expect(pickPreviewStreamFormat([])).toBeNull();
  });

  test("pickPreviewStreamFormat: no-height entries rank last", () => {
    const picked = pickPreviewStreamFormat([
      fmt({ itag: 999, url: "u999", height: null, hasAudio: false, bitrate: null }),
      fmt({ itag: 242, url: "u242", height: 240, hasAudio: false, bitrate: 300_000 }),
      fmt({ itag: 135, url: "u135", height: 480, hasAudio: false, bitrate: 800_000 }),
    ]);
    // 240p and 480p tie at distance 120 — the cheaper stream wins the tie;
    // the no-height entry (distance 360) ranks behind both
    expect(picked?.itag).toBe(242);
  });
});

// ---------------------------------------------------------------------------
// P26-HPV2 — the widened client chain + the cipher surface (Task 33)
// ---------------------------------------------------------------------------

describe("P26-HPV2 — parsePlayback: the 2026-10-18 real watch-page capture (the walled-class shape)", () => {
  test("storyboards parse; the ciphered itag18 + the ABR-track adaptiveFormats are honestly dropped", () => {
    const dto = parsePlayback("watch-page", watchpage2026Fixture);
    expect(dto.source).toBe("watch-page");
    // the honest filter: signatureCipher'd itag18 (s/sp/url, no plain url) AND
    // the 3 ABR-track descriptors (NEITHER url NOR signatureCipher — useless
    // entries the parser must tolerate, never surface) → empty streamFormats
    expect(dto.streamFormats).toEqual([]);
    expect(dto.storyboards.map((l) => l.level)).toEqual([1, 2, 3]); // the "default" L0 skipped
    expect(dto.durationSec).toBe(213);
    expect(dto.storyboards[1].frameWidth).toBe(160); // L2 160x90 — the spec family is stable
  });

  test("the 2026-10-18 capture's cipher is PARSEABLE (parseSignatureCipher) but never deciphered — no surface", () => {
    // the cipher parsing exists for inspection (the lane's bounded research
    // surface); the decipher itself is not implementable in the current
    // player world (the honest Part 2 stop), so the parsed triple NEVER
    // rides streamFormats — the honest degrade above is the whole story
    const cipher = watchpage2026Fixture.streamingData.formats[0].signatureCipher;
    const parts = parseSignatureCipher(cipher)!;
    expect(parts).not.toBeNull();
    expect(parts.s.length).toBe(108); // the real scramble length (2026-10-18 capture)
    expect(parts.sp).toBe("sig");
    expect(parts.url).toContain("googlevideo.com/videoplayback"); // IP-bound, egress-bound
    // and the pairing: the SAME response parsed through parsePlayback keeps
    // the format out of the surface — parsing ≠ deciphering ≠ surfacing
    expect(parsePlayback("watch-page", watchpage2026Fixture).streamFormats).toEqual([]);
  });
});

describe("P26-HPV2 — parseSignatureCipher (the s/sp/url triple, pure + tolerant)", () => {
  test("parses the REAL captured cipher (order-insensitive params, URL-decoded values)", () => {
    const parts = parseSignatureCipher(
      "s=y%3D%3DWEZZ814ULVVggRJJMf&sp=sig&url=https%3A%2F%2Frr4.googlevideo.com%2Fvideoplayback%3Fexpire%3D1792"
    )!;
    expect(parts.s).toBe("y==WEZZ814ULVVggRJJMf"); // %3D decoded
    expect(parts.sp).toBe("sig");
    expect(parts.url).toBe("https://rr4.googlevideo.com/videoplayback?expire=1792");
  });

  test("sp defaults to sig when absent; param order does not matter", () => {
    const parts = parseSignatureCipher(
      "url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback&s=abc"
    )!;
    expect(parts.sp).toBe("sig");
    expect(parts.s).toBe("abc");
  });

  test("tolerant shapes: null / empty / missing s / missing url / garbage → null, never a throw", () => {
    expect(parseSignatureCipher(null)).toBeNull();
    expect(parseSignatureCipher(undefined)).toBeNull();
    expect(parseSignatureCipher("")).toBeNull();
    expect(parseSignatureCipher(12345)).toBeNull();
    expect(parseSignatureCipher("sp=sig&url=https%3A%2F%2Fx.example.com%2Fv")).toBeNull(); // no s
    expect(parseSignatureCipher("s=abc&sp=sig")).toBeNull(); // no url
    expect(parseSignatureCipher("not-a-query-string")).toBeNull();
  });
});

describe("P26-HPV2 — the widened rung-1 client chain (six lottery tickets)", () => {
  test("the chain order: configured client first, then the native family, then the web/embedded family", () => {
    expect(playerClientChain().map((c) => c.clientName)).toEqual([
      "WEB", // INNER_TUBE_PLAYER_CLIENT default
      "IOS",
      "ANDROID",
      "ANDROID_VR", // P26B-HPV3 — the seventh ticket (the measured native-family winner)
      "MWEB",
      "WEB_EMBEDDED_PLAYER",
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    ]);
  });

  test("the ANDROID rung's context carries the real device shape (androidSdkVersion + the app UA)", () => {
    const android = playerClientChain().find((c) => c.clientName === "ANDROID")!;
    expect(android).toMatchObject({
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 30,
      osName: "Android",
      osVersion: "11",
    });
    expect(android.userAgent).toContain("com.google.android.youtube/20.10.38");
  });

  test("the embed-player family's thirdParty context (embedUrl rides OUTSIDE the client object)", () => {
    const embedded = playerClientChain().filter((c) => c.thirdPartyEmbedUrl);
    expect(embedded.map((c) => c.clientName)).toEqual(["WEB_EMBEDDED_PLAYER", "TVHTML5_SIMPLY_EMBEDDED_PLAYER"]);
    for (const c of embedded) expect(c.thirdPartyEmbedUrl).toBe("https://www.youtube.com");
    expect(embedded[1].clientVersion).toBe("2.0"); // TVHTML5_SIMPLY_EMBEDDED_PLAYER v2.0
  });

  test("every walled rung costs one FAST request: the full chain fires exactly seven player calls, NO STS anywhere", async () => {
    const { impl, recorded } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const dto = await getPlayback("WALLED77777");
    expect(dto).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS",
      "ANDROID",
      "ANDROID_VR",
      "MWEB",
      "WEB_EMBEDDED_PLAYER",
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    ]);
    // the measured STS verdict is pinned: NO player call carries
    // playbackContext.contentPlaybackContext.signatureTimestamp — wiring it
    // would let a storyboards-only WEB answer capture the loop before the
    // IOS/ANDROID plain-format rungs (the measured regression; see the lane ledger)
    for (const call of playerCalls) {
      expect(call.body.playbackContext).toBeUndefined();
    }
    // the two embedded rungs sent their thirdParty context at the CONTEXT level
    const tvSimply = playerCalls.find((r) => r.body.context.client.clientName === "TVHTML5_SIMPLY_EMBEDDED_PLAYER")!;
    expect(tvSimply.body.context.thirdParty).toEqual({ embedUrl: "https://www.youtube.com" });
    expect(tvSimply.body.context.client.thirdPartyEmbedUrl).toBeUndefined();
    const webEmbedded = playerCalls.find((r) => r.body.context.client.clientName === "WEB_EMBEDDED_PLAYER")!;
    expect(webEmbedded.body.context.thirdParty).toEqual({ embedUrl: "https://www.youtube.com" });
    // the ANDROID rung sent its device shape
    const android = playerCalls.find((r) => r.body.context.client.clientName === "ANDROID")!;
    expect(android.body.context.client).toMatchObject({ androidSdkVersion: 30, osName: "Android" });
    expect(android.body.context.thirdParty).toBeUndefined();
    // P26B-HPV3 — the ANDROID_VR rung sent the VR device shape (no thirdParty)
    const vr = playerCalls.find((r) => r.body.context.client.clientName === "ANDROID_VR")!;
    expect(vr.body.context.client).toMatchObject({
      clientName: "ANDROID_VR",
      clientVersion: "1.61.48",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
    });
    expect(vr.body.context.client.userAgent).toContain("com.google.android.apps.youtube.vr.oculus/1.61.48");
    expect(vr.body.context.thirdParty).toBeUndefined();
  });

  test("the widened chain's new winning cell: WEB + IOS walled → ANDROID answers plain formats (no watch fetch)", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: WALLED_PLAYER, IOS: WALLED_PLAYER, ANDROID: OK_PLAYER_WITH_FORMATS },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    expect(dto.storyboards).toHaveLength(3);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual(["WEB", "IOS", "ANDROID"]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });
});

describe("P26B-HPV3 — the formats-first hunt (the operator's 2026-10-19 re-file)", () => {
  test("the ANDROID_VR ticket's context (the 2026-10-18 measurement's unwired winner, re-measured 2026-10-19: OK + 23 plain formats for dQw4)", () => {
    const vr = playerClientChain().find((c) => c.clientName === "ANDROID_VR")!;
    expect(vr).toMatchObject({
      clientName: "ANDROID_VR",
      clientVersion: "1.61.48",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
    });
    expect(vr.userAgent).toContain("com.google.android.apps.youtube.vr.oculus/1.61.48");
    expect(vr.thirdPartyEmbedUrl).toBeUndefined(); // a native-family rung, never an embed shape
    // the chain position: inside the native family, after ANDROID
    expect(playerClientChain().map((c) => c.clientName).indexOf("ANDROID_VR")).toBe(3);
  });

  test("a STORYBOARDS-ONLY answer must NOT capture the loop — the formats-bearing rung behind it wins (no watch fetch)", async () => {
    // the starvation mode the STS note feared, now structurally impossible:
    // WEB answers OK-with-storyboards-but-ciphered-formats; the hunt runs on
    // to ANDROID's plain formats instead of stopping at the slideshow fuel
    const { impl, recorded } = perClientUpstream(
      { WEB: STORYBOARDS_ONLY_PLAYER, IOS: WALLED_PLAYER, ANDROID: OK_PLAYER_WITH_FORMATS },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]); // ANDROID's formats, not WEB's storyboards
    expect(dto.storyboards).toHaveLength(3);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS",
      "ANDROID",
    ]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });

  test("every rung storyboards-only → the remembered fallback returns (source player, formats honestly empty) after the rung-2 formats hunt", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: STORYBOARDS_ONLY_PLAYER },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    // no rung carried formats — the rung-1 storyboards-only answer survives
    // as the fallback (the rung-2 storyboards answer does not displace it)
    expect(dto.source).toBe("player");
    expect(dto.streamFormats).toEqual([]);
    expect(dto.storyboards.map((l) => l.level)).toEqual([1, 2, 3]);
    // the hunt ran the full chain AND probed rung 2 for formats before settling
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS",
      "ANDROID",
      "ANDROID_VR",
      "MWEB",
      "WEB_EMBEDDED_PLAYER",
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    ]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
  });

  test("rung 1 storyboards-only + rung 2 FORMATS-bearing → rung 2 wins (the watch page's plain itag18 cells, measured 2026-10-19 on production)", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: STORYBOARDS_ONLY_PLAYER },
      watchHtmlFor(OK_PLAYER_WITH_FORMATS),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("watch-page");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    expect(dto.storyboards).toHaveLength(3);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls).toHaveLength(7); // the full rung-1 hunt ran first
    expect(recorded.some((r) => r.url.includes("youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
  });
});

describe("WFX2-P40 — the MUXED-FIRST hunt (the operator's 2026-10-23 \"embedding is broken again\" re-file)", () => {
  /**
   * The measured production shape that broke the watch fallback: IOS answers
   * OK with plain-URL VIDEO-ONLY adaptive formats (no muxed entry, no
   * audio) — every format hasAudio:false. The old first-usable-wins loop
   * STOPPED there; the client's muxed-only picker (player-fallback
   * pickStreamFormat) then found nothing usable and the native fallback
   * never armed — while ANDROID, one rung later, answers the muxed itag-18
   * (measured 2026-10-23 from the station egress: WEB UNPLAYABLE, IOS
   * audioless-22, ANDROID muxed+23, ANDROID_VR muxed+22).
   */
  const AUDIOLESS_PLAYER = {
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213" },
    storyboards: playerFixture.storyboards,
    streamingData: {
      formats: [],
      adaptiveFormats: [
        {
          itag: 313,
          mimeType: 'video/webm; codecs="vp09.00.50.08"',
          url: "https://rr4.googlevideo.com/videoplayback?itag=313&source=youtube",
          qualityLabel: "2160p",
          width: 3840,
          height: 2160,
        },
        {
          itag: 243,
          mimeType: 'video/webm; codecs="vp09.00.50.08"',
          url: "https://rr4.googlevideo.com/videoplayback?itag=243&source=youtube",
          qualityLabel: "360p",
          width: 640,
          height: 360,
        },
      ],
    },
  };

  test("an AUDIOLESS formats answer must NOT capture the loop — the MUXED rung behind it wins (the 2026-10-23 measurement)", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: WALLED_PLAYER, IOS: AUDIOLESS_PLAYER, ANDROID: OK_PLAYER_WITH_FORMATS },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]); // ANDROID's MUXED itag-18 — never IOS's silent 313/243
    expect(dto.storyboards).toHaveLength(3);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS", // audioless — remembered, hunt continues
      "ANDROID", // muxed — the immediate win
    ]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });

  test("a MUXED-bearing rung wins IMMEDIATELY — IOS-muxed means ANDROID never fires (no hunt past a healthy win)", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: WALLED_PLAYER, IOS: OK_PLAYER_WITH_FORMATS, ANDROID: AUDIOLESS_PLAYER },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual(["WEB", "IOS"]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });

  test("every rung audioless → the AUDIOLESS fallback serves after the full hunt (formats present, hasAudio all false — preview fuel, never a watch-fallback claim)", async () => {
    const { impl, recorded } = perClientUpstream(
      {
        WEB: WALLED_PLAYER,
        IOS: AUDIOLESS_PLAYER,
        ANDROID: AUDIOLESS_PLAYER,
        ANDROID_VR: AUDIOLESS_PLAYER,
        MWEB: WALLED_PLAYER,
        WEB_EMBEDDED_PLAYER: WALLED_PLAYER,
        TVHTML5_SIMPLY_EMBEDDED_PLAYER: WALLED_PLAYER,
      },
      watchHtmlFor(playerFixture), // rung 2: storyboards-only (ciphered formats) — outranked by the audioless FORMATS answer
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([313, 243]);
    expect(dto.streamFormats.every((f) => f.hasAudio === false)).toBe(true);
    expect(dto.storyboards.map((l) => l.level)).toEqual([1, 2, 3]);
    // the hunt ran the whole rung-1 chain AND probed rung 2 before settling
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls).toHaveLength(7);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
  });

  test("rung 1 audioless + rung 2 MUXED (the watch page's plain itag-18) → rung 2 wins — the outer chain hunts too", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: WALLED_PLAYER, IOS: AUDIOLESS_PLAYER },
      watchHtmlFor(OK_PLAYER_WITH_FORMATS),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("watch-page");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS",
      "ANDROID",
      "ANDROID_VR",
      "MWEB",
      "WEB_EMBEDDED_PLAYER",
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    ]);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The chain (setUpstream seam) + routes
// ---------------------------------------------------------------------------

interface Recorded {
  url: string;
  body: any;
}

function chainUpstream(playerResponse: unknown, watchHtml: string | null) {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    if (url.includes("/youtubei/v1/player")) {
      return new Response(JSON.stringify(playerResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("youtube.com/watch")) {
      if (watchHtml === null) return new Response("walled", { status: 403 });
      return new Response(watchHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded };
}

const watchHtmlFor = (playerResponse: unknown) =>
  `<!doctype html><html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(
    playerResponse
  )};</script><script>var ytInitialData = {};</script></body></html>`;

/** Upstream serving a DIFFERENT player response per context.client.clientName. */
function perClientUpstream(byClient: Record<string, unknown>, watchHtml: string | null) {
  const recorded: Recorded[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ url, body });
    if (url.includes("/youtubei/v1/player")) {
      const name = String(body?.context?.client?.clientName ?? "");
      return new Response(JSON.stringify(byClient[name] ?? WALLED_PLAYER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("youtube.com/watch")) {
      if (watchHtml === null) return new Response("walled", { status: 403 });
      return new Response(watchHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, recorded };
}

const OK_PLAYER_WITH_FORMATS = {
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213" },
  storyboards: playerFixture.storyboards,
  streamingData: {
    formats: [
      {
        itag: 18,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        url: "https://rr4.googlevideo.com/videoplayback?itag=18&source=youtube",
        qualityLabel: "360p",
        width: 640,
        height: 360,
        audioQuality: "AUDIO_QUALITY_LOW",
      },
    ],
  },
};

const WALLED_PLAYER = { playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" } };

/**
 * P26B-HPV3 — the storyboards-only player answer (the STS-flip's measured
 * shape, and the watch page's own family): playabilityStatus OK, storyboards
 * present, formats CIPHERED-ONLY (signatureCipher, no plain url) — honestly
 * filtered to an empty streamFormats. The old first-usable-wins loop STOPPED
 * here and starved the native lane; the formats-first hunt runs on.
 */
const STORYBOARDS_ONLY_PLAYER = {
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213" },
  storyboards: playerFixture.storyboards,
  streamingData: {
    formats: [
      {
        itag: 18,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        signatureCipher:
          "s=abc&sp=sig&url=https%3A%2F%2Frr4.googlevideo.com%2Fvideoplayback%3Fitag%3D18",
        qualityLabel: "360p",
        width: 640,
        height: 360,
      },
    ],
  },
};

let envBefore: string | undefined;

beforeEach(() => {
  clearCache();
  envBefore = process.env[PLAYER_CLIENT_ENV];
  brokerCalls.length = 0;
  brokerResponse = new MockBrokerError(
    "offline",
    "action backend offline — the lead's broker must be running",
    502
  );
});

afterEach(() => {
  setUpstream(null);
  if (envBefore === undefined) delete process.env[PLAYER_CLIENT_ENV];
  else process.env[PLAYER_CLIENT_ENV] = envBefore;
});

/* bun's mock.module is process-wide — restore the real broker module so
 * later-loaded files exercise the real implementation again */
afterAll(() => {
  mock.module("@/lib/broker", () => realBroker);
});

describe("getPlayback — the chain (player endpoint → watch page → honest empty)", () => {
  test("rung 1 wins when the player endpoint serves a playable response (no watch page fetch)", async () => {
    const { impl, recorded } = chainUpstream(OK_PLAYER_WITH_FORMATS, watchHtmlFor(WALLED_PLAYER));
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    expect(dto.storyboards).toHaveLength(3);
    // the rung-1 request carried the configured client (default WEB)
    const playerCall = recorded.find((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCall?.body.context.client.clientName).toBe("WEB");
    // the chain stops at the first usable answer — the IOS tail never fires
    expect(recorded.filter((r) => r.url.includes("/youtubei/v1/player"))).toHaveLength(1);
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });

  test("rung 1 walled → rung 2 (the watch page's embedded player response) serves storyboards", async () => {
    const { impl, recorded } = chainUpstream(WALLED_PLAYER, watchHtmlFor(playerFixture));
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("watch-page");
    expect(dto.storyboards.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(dto.streamFormats).toEqual([]); // the watch page's formats are cipher-only
    expect(recorded.some((r) => r.url.includes("youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
  });

  test("both rungs walled → the honest empty payload (cached, never thrown)", async () => {
    const { impl } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const dto = await getPlayback("WALLED12345");
    expect(dto).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
  });

  test("INNER_TUBE_PLAYER_CLIENT overrides the rung-1 client context", async () => {
    process.env[PLAYER_CLIENT_ENV] = "MWEB";
    expect(playerClientContext().clientName).toBe("MWEB");
    const { impl, recorded } = chainUpstream(OK_PLAYER_WITH_FORMATS, null);
    setUpstream(impl);
    await getPlayback("dQw4w9WgXcQ");
    const playerCall = recorded.find((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCall?.body.context.client.clientName).toBe("MWEB");
  });

  test("an unknown client name falls back to WEB", () => {
    process.env[PLAYER_CLIENT_ENV] = "NOT_A_CLIENT";
    expect(playerClientContext().clientName).toBe("WEB");
  });

  test("rung 1 client chain: the primary client walled → IOS answers OK → its formats win (no watch fetch)", async () => {
    const { impl, recorded } = perClientUpstream(
      { WEB: WALLED_PLAYER, IOS: OK_PLAYER_WITH_FORMATS },
      watchHtmlFor(playerFixture),
    );
    setUpstream(impl);
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("player");
    expect(dto.streamFormats.map((f) => f.itag)).toEqual([18]);
    expect(dto.storyboards).toHaveLength(3);
    // exactly the [WEB, IOS] sequence — the first usable answer stops the chain
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual(["WEB", "IOS"]);
    // the IOS request carried the realistic native-app context
    // (P22-C: 20.10.4 — 19.29.1 answers HTTP 400 "Precondition check failed"
    // upstream, killing rung 1's second client; live-probed 2026-10-10)
    expect(playerCalls[1].body.context.client).toMatchObject({
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "en",
      gl: "US",
    });
    expect(playerCalls[1].body.context.client.userAgent).toContain(
      "com.google.ios.youtube/20.10.4"
    );
    expect(recorded.some((r) => r.url.includes("youtube.com/watch"))).toBe(false);
  });

  test("INNER_TUBE_PLAYER_CLIENT=IOS dedupes the chain (the IOS rung never repeats; the widened tail still runs)", async () => {
    process.env[PLAYER_CLIENT_ENV] = "IOS";
    const { impl, recorded } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const dto = await getPlayback("WALLED99999");
    expect(dto).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
    // the deduped widened chain: IOS first (configured), then the rest
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "IOS",
      "ANDROID",
      "ANDROID_VR",
      "MWEB",
      "WEB_EMBEDDED_PLAYER",
      "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    ]);
  });

  test("WFX2-4A rung 3 — rungs 1-2 walled, the broker's page-context watch read serves (source: broker-watch)", async () => {
    const { impl } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    // the logged-in session's own watch page — the SAME embedded player
    // response rung 2 parses, read through the broker fetch transport
    brokerResponse = () => ({ ok: true, status: 200, body: watchHtmlFor(playerFixture) });
    const dto = await getPlayback("dQw4w9WgXcQ");
    expect(dto.source).toBe("broker-watch");
    expect(dto.storyboards.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(dto.durationSec).toBe(213);
    expect(dto.streamFormats).toEqual([]); // the watch page's formats are cipher-only
    // exactly one broker read — the watch page with the hl/gl params
    expect(brokerCalls).toEqual(["/watch?v=dQw4w9WgXcQ&hl=en&gl=US"]);
  });

  test("WFX2-4A — all three rungs walled (broker offline too) → the honest empty payload, re-checked", async () => {
    const { impl } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const dto = await getPlayback("WALLED12345");
    expect(dto).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
    // the broker rung WAS attempted before the honest degrade stood
    expect(brokerCalls).toEqual(["/watch?v=WALLED12345&hl=en&gl=US"]);
  });

  test("WFX2-5 — the all-walled empty degrade is NEVER cached (isEmpty guard); a healthy broker-watch read still is", async () => {
    const { impl } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    // every rung walled (broker offline too) → the honest empty payload …
    const empty = await getPlayback("WALLED12345");
    expect(empty).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
    // … which must NOT be persisted: the 4-c tab-wedge incident cached
    // source:"" for the full 10min soft TTL and poisoned later reads —
    // the cache layer holds nothing for the key
    expect(await cachePeek("yt:playback:WALLED12345")).toBeNull();
    // the broker revives: the SAME id recomputes immediately (a cached
    // empty would have served for 10 minutes with zero upstream requests)
    brokerResponse = () => ({ ok: true, status: 200, body: watchHtmlFor(playerFixture) });
    const recovered = await getPlayback("WALLED12345");
    expect(recovered.source).toBe("broker-watch");
    expect(recovered.storyboards).toHaveLength(3);
    expect(recovered.streamFormats).toEqual([]); // cipher-only formats are NOT "empty"
    // the healthy payload (storyboards present) IS cached normally — the
    // guard matches only the source:"" degrade
    const stored = await cachePeek("yt:playback:WALLED12345");
    expect(stored).not.toBeNull();
    expect(stored?.fresh).toBe(true);
    expect((stored?.value as { source: string }).source).toBe("broker-watch");
  });
});

describe("GET /api/videos/[id]/playback", () => {
  test("serves the chain's DTO", async () => {
    const { impl } = chainUpstream(WALLED_PLAYER, watchHtmlFor(playerFixture));
    setUpstream(impl);
    const res = await playbackRoute(new Request("http://localhost/api/videos/dQw4w9WgXcQ/playback"), {
      params: Promise.resolve({ id: "dQw4w9WgXcQ" }),
    } as any);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as any;
    expect(dto.source).toBe("watch-page");
    expect(dto.storyboards).toHaveLength(3);
  });

  test("invalid ids are rejected (400), never proxied upstream", async () => {
    const { impl, recorded } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const res = await playbackRoute(new Request("http://localhost/api/videos/<script>/playback"), {
      params: Promise.resolve({ id: "<script>" }),
    } as any);
    expect(res.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });
});

describe("GET /api/stream — the googlevideo proxy", () => {
  const realFetch = globalThis.fetch;
  const seen: { url: string; headers: Record<string, string> }[] = [];

  function stubUpstream(status: number, headers: Record<string, string>, body: string) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      seen.push({
        url: u,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(body, { status, headers });
    }) as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
    seen.length = 0;
  });

  const streamUrl = (target: string) =>
    `http://localhost/api/stream?url=${encodeURIComponent(target)}`;

  test("missing url → 400", async () => {
    const res = await streamRoute(new Request("http://localhost/api/stream"));
    expect(res.status).toBe(400);
  });

  test("non-googlevideo hosts are refused (never a generic proxy)", async () => {
    for (const evil of [
      "https://example.com/videoplayback?itag=18",
      "https://evil.googlevideo.com.example.com/x",
      "http://rr3.googlevideo.com/videoplayback", // not https
      "https://googlevideo.com.evil.io/x",
    ]) {
      const res = await streamRoute(new Request(streamUrl(evil)));
      expect(res.status).toBe(400);
    }
  });

  test("googlevideo URLs proxy with Range passthrough + 206 + header pass-through", async () => {
    stubUpstream(206, {
      "Content-Type": "video/mp4",
      "Content-Length": "1024",
      "Content-Range": "bytes 0-1023/444226",
      "Accept-Ranges": "bytes",
    }, "MP4BYTES");
    const target = "https://rr4---sn-i3b7knsl.googlevideo.com/videoplayback?itag=18&source=youtube&ip=1.2.3.4";
    const res = await streamRoute(
      new Request(streamUrl(target), { headers: { Range: "bytes=0-1023" } })
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/444226");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("MP4BYTES");
    // the upstream fetch carried the Range header verbatim
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(target);
    expect(seen[0].headers["Range"]).toBe("bytes=0-1023");
  });

  test("plain 200 (no Range) passes through too", async () => {
    stubUpstream(200, { "Content-Type": "video/mp4", "Content-Length": "444226" }, "FULL");
    const res = await streamRoute(
      new Request(streamUrl("https://rr1.googlevideo.com/videoplayback?itag=22"))
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("444226");
  });

  test("upstream failure → 502 (never an upstream body/status leak)", async () => {
    stubUpstream(403, { "Content-Type": "text/html" }, "forbidden");
    const res = await streamRoute(
      new Request(streamUrl("https://rr2.googlevideo.com/videoplayback?itag=18"))
    );
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// P29-STREAM-REGEN — the self-healing proxy (the production 502 cure)
// ---------------------------------------------------------------------------

/** Two plain formats: the itag-preference law + the nearest-360p fallback. */
const OK_PLAYER_TWO_FORMATS = {
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213" },
  storyboards: playerFixture.storyboards,
  streamingData: {
    formats: [
      {
        itag: 18,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        url: "https://rr4.googlevideo.com/videoplayback?itag=18&source=youtube",
        qualityLabel: "360p",
        width: 640,
        height: 360,
        audioQuality: "AUDIO_QUALITY_LOW",
      },
      {
        itag: 22,
        mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
        url: "https://rr5.googlevideo.com/videoplayback?itag=22&source=youtube",
        qualityLabel: "720p",
        width: 1280,
        height: 720,
        audioQuality: "AUDIO_QUALITY_MEDIUM",
      },
    ],
  },
};

describe("GET /api/stream — P29-STREAM-REGEN: the self-healing pass (the production 502 cure)", () => {
  const realFetch = globalThis.fetch;
  /** googlevideo fetches made by the ROUTE (the innertube chain rides the setUpstream seam instead) */
  const gvFetches: { url: string; range: string | undefined }[] = [];
  /** innertube calls made by the regen's getPlayback (recorded by the injected upstream) */
  let innertubeCalls = 0;

  /**
   * The route's googlevideo upstream: a URL→status map (each URL answers
   * the same status every time it is fetched). The DEFAULT production
   * shape: the client-held URL is dead (403 — generated by a DIFFERENT
   * function's egress), the fresh chain URLs are alive (206).
   */
  function stubRouteUpstream(byUrl: Record<string, number>) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      gvFetches.push({ url: u, range: headers["Range"] });
      const status = byUrl[u] ?? 403;
      if (status === 206) {
        return new Response("MP4BYTES", {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": "1024",
            "Content-Range": "bytes 0-1023/444226",
            "Accept-Ranges": "bytes",
          },
        });
      }
      return new Response("forbidden", { status, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
  }

  /** Serve `player` (rung 1 OK, formats-bearing) for the regen's chain. */
  function primeChain(player: unknown) {
    const { impl } = chainUpstream(player, null);
    const countingImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes("/youtubei/v1/player")) innertubeCalls += 1;
      return impl(url, init);
    };
    setUpstream(countingImpl);
  }

  const DEAD_CLIENT_URL = "https://rr1.googlevideo.com/videoplayback?itag=18&ip=54.164.133.198";
  const FRESH_18_URL = "https://rr4.googlevideo.com/videoplayback?itag=18&source=youtube";
  const FRESH_22_URL = "https://rr5.googlevideo.com/videoplayback?itag=22&source=youtube";

  const healUrl = (dead: string, video: string | null, itag: number | null) =>
    `http://localhost/api/stream?url=${encodeURIComponent(dead)}${
      video !== null ? `&video=${video}` : ""
    }${itag !== null ? `&itag=${itag}` : ""}`;

  beforeEach(() => {
    resetProxyRegenCache();
    gvFetches.length = 0;
    innertubeCalls = 0;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    setUpstream(null); // belt and braces — the file-level afterEach re-asserts it
  });

  test("the production shape heals: client-held dead URL (403) + video → the chain's fresh URL streams (206, Range forwarded on BOTH attempts)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [FRESH_18_URL]: 206 });
    const res = await streamRoute(
      new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18), {
        headers: { Range: "bytes=0-1023" },
      })
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/444226");
    expect(await res.text()).toBe("MP4BYTES");
    // the fetch sequence: the dead client URL (403), then the fresh chain URL
    expect(gvFetches.map((f) => f.url)).toEqual([DEAD_CLIENT_URL, FRESH_18_URL]);
    expect(gvFetches.every((f) => f.range === "bytes=0-1023")).toBe(true); // Range survives the heal
    expect(innertubeCalls).toBeGreaterThanOrEqual(1); // the regen ran the chain
  });

  test("the itag-preference law: itag=22 is requested and the fresh answer carries it → the 22 URL serves (a Range resume rides the same stream)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [FRESH_22_URL]: 206 });
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 22)));
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([DEAD_CLIENT_URL, FRESH_22_URL]);
  });

  test("the nearest-360p fallback: itag=999 not in the fresh answer → the 360p (itag 18) URL serves", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [FRESH_18_URL]: 206 });
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 999)));
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([DEAD_CLIENT_URL, FRESH_18_URL]);
  });

  test("the regen cache: a second request heals WITHOUT re-running the chain (seek/Range storms are cheap)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [FRESH_18_URL]: 206 });
    const first = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(first.status).toBe(206);
    const chainRunsAfterFirst = innertubeCalls;
    expect(chainRunsAfterFirst).toBeGreaterThanOrEqual(1);
    clearCache(); // even with the PLAYBACK cache cold, the regen cache answers
    const second = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(second.status).toBe(206);
    expect(await second.text()).toBe("MP4BYTES");
    expect(innertubeCalls).toBe(chainRunsAfterFirst); // ZERO extra chain runs
    expect(gvFetches.map((f) => f.url)).toEqual([
      DEAD_CLIENT_URL,
      FRESH_18_URL,
      DEAD_CLIENT_URL,
      FRESH_18_URL, // the cached fresh URL — served again
    ]);
  });

  test("a dead cached fresh URL re-heals: the cache entry 403s → invalidated → the chain mints a NEW URL that serves", async () => {
    /** the B-variant chain answer — the re-run mints a different URL (real chains do: each run signs fresh) */
    const OK_PLAYER_B_VARIANT = {
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId: "dQw4w9WgXcQ", lengthSeconds: "213" },
      storyboards: playerFixture.storyboards,
      streamingData: {
        formats: [
          {
            itag: 18,
            mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            url: "https://rr6.googlevideo.com/videoplayback?itag=18&source=youtube&rn=2",
            qualityLabel: "360p",
            width: 640,
            height: 360,
            audioQuality: "AUDIO_QUALITY_LOW",
          },
        ],
      },
    };
    const FRESH_18B_URL = "https://rr6.googlevideo.com/videoplayback?itag=18&source=youtube&rn=2";
    primeChain(OK_PLAYER_TWO_FORMATS);
    // the first-minted URL dies after its first serve (egress churn); the B-variant lives
    let firstUrlServes = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      gvFetches.push({ url: u, range: ((init?.headers ?? {}) as Record<string, string>)["Range"] });
      if (u === FRESH_18_URL) {
        firstUrlServes += 1;
        if (firstUrlServes <= 1) {
          return new Response("MP4BYTES", {
            status: 206,
            headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" },
          });
        }
        return new Response("forbidden", { status: 403 });
      }
      if (u === FRESH_18B_URL) {
        return new Response("MP4BYTES2", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" },
        });
      }
      return new Response("forbidden", { status: 403 });
    }) as typeof fetch;
    const first = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(first.status).toBe(206);
    const runsAfterFirst = innertubeCalls;
    expect(runsAfterFirst).toBeGreaterThanOrEqual(1);
    clearCache(); // the playback cache is cold — the re-heal MUST run the chain
    primeChain(OK_PLAYER_B_VARIANT); // the re-run mints the new URL
    const second = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(second.status).toBe(206);
    expect(await second.text()).toBe("MP4BYTES2");
    expect(innertubeCalls).toBeGreaterThan(runsAfterFirst); // the chain re-ran for the re-heal
    // the fetch story: dead client URL → first mint (206) → dead client URL → cached mint (403, invalidated) → NEW mint (206)
    expect(gvFetches.map((f) => f.url)).toEqual([
      DEAD_CLIENT_URL,
      FRESH_18_URL,
      DEAD_CLIENT_URL,
      FRESH_18_URL,
      FRESH_18B_URL,
    ]);
  });

  test("the walled class heals honestly: the chain answers no formats → 502 with the regen note (never a loop)", async () => {
    primeChain(WALLED_PLAYER); // rung 1 walled; rung 2 walled (null html); broker offline
    stubRouteUpstream({});
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("regen unavailable");
    // the dead URL was fetched exactly once — the heal did not loop on it
    expect(gvFetches.filter((f) => f.url === DEAD_CLIENT_URL)).toHaveLength(1);
  });

  test("no video param → the OLD law (an honest 502, no regen attempt)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({});
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, null, 18)));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Upstream stream responded 403");
    expect(innertubeCalls).toBe(0); // the chain never ran
  });

  test("an INVALID video id is ignored → the old law (never a proxy for arbitrary regen keys)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({});
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "<script>", 18)));
    expect(res.status).toBe(502);
    expect(innertubeCalls).toBe(0);
  });

  test("non-403 upstream failures do NOT regen (the heal is the IP-bind signature's, not a generic retry)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({}); // default 403 — override to 500 below via a fresh stub
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      gvFetches.push({ url: u, range: undefined });
      return new Response("boom", { status: 500, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
    const res = await streamRoute(new Request(healUrl(DEAD_CLIENT_URL, "dQw4w9WgXcQ", 18)));
    expect(res.status).toBe(502);
    expect(gvFetches).toHaveLength(1); // one upstream attempt, no heal
    expect(innertubeCalls).toBe(0);
  });

  test("an invalid itag param is ignored (the nearest-360p law still heals)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [FRESH_18_URL]: 206 });
    const res = await streamRoute(
      new Request("http://localhost/api/stream?" + [
        `url=${encodeURIComponent(DEAD_CLIENT_URL)}`,
        "video=dQw4w9WgXcQ",
        "itag=abc",
      ].join("&"))
    );
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([DEAD_CLIENT_URL, FRESH_18_URL]);
  });
});

// ---------------------------------------------------------------------------
// P31-HPV5 — the playback route's BOX-PLAYER STREAM MODE
// (/api/videos/[id]/playback?itag=<n>&stream=1)
// ---------------------------------------------------------------------------

describe("GET /api/videos/[id]/playback?stream=1 — P31-HPV5: the box-player stream mode (generate + fetch on ONE invocation)", () => {
  const realFetch = globalThis.fetch;
  /** googlevideo fetches made by the ROUTE (the chain rides the setUpstream seam) */
  const gvFetches: { url: string; range: string | undefined }[] = [];
  /** innertube calls made by the route's getPlayback runs (cached + forced-fresh) */
  let innertubeCalls = 0;

  function stubRouteUpstream(byUrl: Record<string, number>) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      gvFetches.push({ url: u, range: headers["Range"] });
      const status = byUrl[u] ?? 403;
      if (status === 206) {
        return new Response("MP4BYTES", {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": "1024",
            "Content-Range": "bytes 0-1023/444226",
            "Accept-Ranges": "bytes",
          },
        });
      }
      return new Response("forbidden", { status, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
  }

  /** Serve `player` (rung 1 OK, formats-bearing) for the route's chain runs. */
  function primeChain(player: unknown) {
    const { impl } = chainUpstream(player, null);
    const countingImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes("/youtubei/v1/player")) innertubeCalls += 1;
      return impl(url, init);
    };
    setUpstream(countingImpl);
  }

  const URL_18 = "https://rr4.googlevideo.com/videoplayback?itag=18&source=youtube";
  const URL_22 = "https://rr5.googlevideo.com/videoplayback?itag=22&source=youtube";
  /** a SECOND-generation chain answer (a different googlevideo URL — the
   *  egress-rotated fresh URL after the cached one went dead) */
  const URL_18_ROTATED = "https://rr6.googlevideo.com/videoplayback?itag=18&source=youtube";

  const playerWithUrls = (u18: string, u22: string) => ({
    ...OK_PLAYER_TWO_FORMATS,
    streamingData: {
      formats: [
        {
          itag: 18,
          mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
          url: u18,
          qualityLabel: "360p",
          width: 640,
          height: 360,
          audioQuality: "AUDIO_QUALITY_LOW",
        },
        {
          itag: 22,
          mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
          url: u22,
          qualityLabel: "720p",
          width: 1280,
          height: 720,
          audioQuality: "AUDIO_QUALITY_MEDIUM",
        },
      ],
    },
  });

  const streamUrl = (video: string, itag: number | null) =>
    `http://localhost/api/videos/${video}/playback?${itag !== null ? `itag=${itag}&` : ""}stream=1`;

  const call = (url: string, range?: string) =>
    playbackRoute(
      new Request(url, range ? { headers: { Range: range } } : undefined),
      { params: Promise.resolve({ id: url.split("/api/videos/")[1]?.split("/")[0] ?? "" }) } as any
    );

  beforeEach(() => {
    gvFetches.length = 0;
    innertubeCalls = 0;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    setUpstream(null);
  });

  test("the DTO law is byte-identical without stream=1 (the mode switch is stream-only — even with an itag param)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({});
    const res = await call("http://localhost/api/videos/dQw4w9WgXcQ/playback?itag=18");
    expect(res.status).toBe(200);
    const dto = (await res.json()) as any;
    expect(Array.isArray(dto.streamFormats)).toBe(true);
    expect(dto.streamFormats).toHaveLength(2);
    expect(gvFetches).toHaveLength(0); // never a googlevideo fetch in DTO mode
  });

  test("the happy path: the chain's URL fetched from THIS invocation (Range forwarded, headers + CSP law passed through)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [URL_18]: 206, [URL_22]: 206 });
    const res = await call(streamUrl("dQw4w9WgXcQ", 18), "bytes=0-1023");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1023/444226");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    // the same-origin proxy must never let the browser sniff something else
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; media-src 'self'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...res.headers.keys()]).not.toContain("cookie");
    expect(await res.text()).toBe("MP4BYTES");
    // the client's itag rode the pick (a Range resume must ride the same stream)
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18]);
    expect(gvFetches[0].range).toBe("bytes=0-1023");
  });

  test("no itag param → the server's nearest-360p muxed-preferred law picks", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({ [URL_18]: 206, [URL_22]: 206 });
    const res = await call(streamUrl("dQw4w9WgXcQ", null));
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18]); // 360p muxed beats 720p
  });

  test("THE DEAD-CACHED-URL CURE: a cached URL answering 403 forces ONE fresh chain run in the SAME invocation — and the write-through makes the NEXT request ride the fresh URL with ZERO chain runs", async () => {
    // 1) fill the cache with generation-1 URLs (the DTO mode — the way the
    //    card-mount prefetch does it in the app)
    primeChain(playerWithUrls(URL_18, URL_22));
    stubRouteUpstream({});
    await call("http://localhost/api/videos/dQw4w9WgXcQ/playback");
    const chainRunsAfterDto = innertubeCalls;
    expect(chainRunsAfterDto).toBeGreaterThanOrEqual(1);

    // 2) egress rotated: generation-1 URLs are dead (403); the chain now
    //    answers generation-2 URLs (a fresh watch-page/player read)
    primeChain(playerWithUrls(URL_18_ROTATED, URL_22));
    stubRouteUpstream({ [URL_18_ROTATED]: 206 });

    // 3) the stream mode: the cached URL dies → the forced-fresh chain run
    //    (generation 2) → the fresh URL streams — generate + fetch on ONE
    //    invocation, the one axis that always matches
    const res = await call(streamUrl("dQw4w9WgXcQ", 18), "bytes=0-1023");
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18, URL_18_ROTATED]);
    expect(innertubeCalls).toBeGreaterThan(chainRunsAfterDto); // the fresh run happened

    // 4) the write-through: the next Range request rides the FRESH cached
    //    URL with ZERO new chain runs (the seek-storm law)
    gvFetches.length = 0;
    const runsBeforeSecond = innertubeCalls;
    const res2 = await call(streamUrl("dQw4w9WgXcQ", 18), "bytes=1024-2047");
    expect(res2.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18_ROTATED]);
    expect(innertubeCalls).toBe(runsBeforeSecond); // no chain re-run
  });

  test("the walled class (no formats anywhere, both attempts) → the honest 502 — never a fake stream", async () => {
    primeChain(WALLED_PLAYER);
    stubRouteUpstream({});
    const res = await call(streamUrl("dQw4w9WgXcQ", 18));
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error).toContain("unavailable");
    expect(gvFetches).toHaveLength(0); // no format ever fetched
  });

  test("the upstream throwing on the cached URL (not 403) also rides the fresh retry", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    // the cached URL is unreachable (throws); the fresh URL after the retry streams
    let throwOnce = true;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      gvFetches.push({ url: u, range: headers["Range"] });
      if (u === URL_18 && throwOnce) {
        throwOnce = false;
        throw new Error("upstream unreachable");
      }
      return new Response("MP4BYTES", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": "1024",
          "Content-Range": "bytes 0-1023/444226",
          "Accept-Ranges": "bytes",
        },
      });
    }) as typeof fetch;
    const res = await call(streamUrl("dQw4w9WgXcQ", 18));
    expect(res.status).toBe(206);
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18, URL_18]);
  });

  test("invalid ids are rejected in stream mode too (400, never proxied)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({});
    const res = await playbackRoute(
      new Request("http://localhost/api/videos/<script>/playback?stream=1"),
      { params: Promise.resolve({ id: "<script>" }) } as any
    );
    expect(res.status).toBe(400);
    expect(gvFetches).toHaveLength(0);
  });

  test("the fresh retry prefers the SAME itag when the fresh answer carries it (the Range-resume law)", async () => {
    primeChain(OK_PLAYER_TWO_FORMATS);
    stubRouteUpstream({});
    await call("http://localhost/api/videos/dQw4w9WgXcQ/playback"); // cache gen-1
    primeChain(playerWithUrls(URL_18_ROTATED, URL_22));
    stubRouteUpstream({ [URL_18_ROTATED]: 206, [URL_22]: 206 });
    const res = await call(streamUrl("dQw4w9WgXcQ", 18), "bytes=0-1023");
    expect(res.status).toBe(206);
    // the retry picked itag 18's fresh URL — NOT itag 22 — because the
    // client asked for 18 (a resume must ride the same stream)
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18, URL_18_ROTATED]);
  });

  test("P32-HPV6 — THE MULTI-FORMAT TICKET LOOP: the fresh chain's preferred itag dying tries the NEXT distinct-itag candidate before any 502 (the per-format wall lottery)", async () => {
    // gen-1 cached URLs (dead together — the egress rotated)
    primeChain(playerWithUrls(URL_18, URL_22));
    stubRouteUpstream({});
    await call("http://localhost/api/videos/dQw4w9WgXcQ/playback"); // fill the cache
    // the fresh generation: the moving wall killed itag 18's URL but itag
    // 22's URL (a different googlevideo host) still serves
    primeChain(playerWithUrls(URL_18_ROTATED, URL_22));
    stubRouteUpstream({ [URL_22]: 206 }); // URL_18_ROTATED falls through to 403
    const res = await call(streamUrl("dQw4w9WgXcQ", 18), "bytes=0-1023");
    expect(res.status).toBe(206);
    // the ticket trail: the CACHED single pick (dead generation, one try —
    // cached URLs die TOGETHER) → the fresh itag-18 ticket (the Range-resume
    // law, dead) → the SECOND fresh ticket: the picker's next-best candidate
    // (itag 22 — nearest-360p applied to the remaining pool) SAVES the stream
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18, URL_18_ROTATED, URL_22]);
    expect(gvFetches[2].range).toBe("bytes=0-1023"); // the ticket rides the client's Range
  });

  test("P32-HPV6 — the ticket loop is BOUNDED: every candidate dead → the honest 502 after exactly the ticket count (never an unbounded scan)", async () => {
    primeChain(playerWithUrls(URL_18, URL_22));
    stubRouteUpstream({});
    await call("http://localhost/api/videos/dQw4w9WgXcQ/playback"); // cache gen-1
    primeChain(playerWithUrls(URL_18_ROTATED, URL_22)); // fresh gen-2, ALL dead
    stubRouteUpstream({}); // every URL 403
    const res = await call(streamUrl("dQw4w9WgXcQ", 18));
    expect(res.status).toBe(502);
    // the cached pick + BOTH fresh tickets (the two-format pool is exhausted
    // before MAX_STREAM_TICKETS) — then the honest floor, no third fetch
    expect(gvFetches.map((f) => f.url)).toEqual([URL_18, URL_18_ROTATED, URL_22]);
  });
});

// ---------------------------------------------------------------------------
// WFX2-P37 — the timeout laws (the production 504 cure), pinned at the unit
// seams: the HEADER-DEADLINE (an upstream that never answers headers is a
// FAST dead ticket — the abort clock dies once headers land, so a healthy
// body streams past the deadline), the TICKET-LOOP deadline (a hanging first
// candidate costs its deadline, then the next ticket serves), and the CHAIN
// BUDGET race (a walled/tarpitting chain answers the honest empty degrade —
// source:"" — ON the deadline, never cached, so the next healthy run still
// serves). The route-level wiring (DTO 40s / stream 22s budgets + 8s/6s
// header deadlines) keeps every answer inside maxDuration — the platform's
// 504 can never again speak for this route.
// ---------------------------------------------------------------------------

describe("WFX2-P37 — the header-deadline law (stream-proxy)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("an upstream that never answers HEADERS is a FAST dead ticket (the abort fires at the deadline, never at 60s)", async () => {
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      // the tarpit class: the connection opens, headers NEVER arrive — and
      // like a real fetch, the abort signal is the only thing that ends it
      const signal = init?.signal;
      if (signal) {
        await new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      await new Promise(() => {});
      return new Response("unreachable");
    }) as typeof fetch;
    const started = Date.now();
    await expect(
      fetchUpstream(new URL("https://rr1.googlevideo.com/videoplayback?itag=18"), null, 60)
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000); // ~60ms + overhead, never 60s
    expect(observedSignal?.aborted).toBe(true); // the abort is what killed it
  });

  test("headers arrived → the deadline is CLEARED: a slow body streams past it (never a mid-transfer kill)", async () => {
    globalThis.fetch = (async (_url: string | URL | Request) => {
      // headers land immediately; the body takes LONGER than the deadline
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await new Promise((r) => setTimeout(r, 150));
          controller.enqueue(new TextEncoder().encode("SLOWBYTES"));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }) as typeof fetch;
    const res = await fetchUpstream(
      new URL("https://rr1.googlevideo.com/videoplayback?itag=18"),
      null,
      60
    );
    expect(res.status).toBe(200);
    // the body resolves at 150ms — PAST the 60ms header deadline — because
    // the pre-P37 whole-fetch timeout (which killed bodies mid-transfer at
    // 60s) is gone
    expect(await res.text()).toBe("SLOWBYTES");
  });

  test("the ticket loop: a hanging first candidate costs only its deadline — the SECOND ticket serves", async () => {
    const hangUrl = "https://rr1.googlevideo.com/videoplayback?itag=18&hang=1";
    const goodUrl = "https://rr2.googlevideo.com/videoplayback?itag=22";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u === hangUrl) {
        // the tarpit: never answers — only the abort signal ends it
        const signal = init?.signal;
        if (signal) {
          await new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        await new Promise(() => {});
      }
      return new Response("MP4BYTES", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-7/8" },
      });
    }) as typeof fetch;
    const formats: StreamFormatDto[] = [
      {
        itag: 18, url: hangUrl, mimeType: "video/mp4", qualityLabel: "360p",
        width: 640, height: 360, fps: 30, bitrate: 500_000, contentLength: "8",
        approxDurationMs: 8000, hasAudio: true,
      },
      {
        itag: 22, url: goodUrl, mimeType: "video/mp4", qualityLabel: "720p",
        width: 1280, height: 720, fps: 30, bitrate: 1_000_000, contentLength: "8",
        approxDurationMs: 8000, hasAudio: true,
      },
    ];
    const started = Date.now();
    const res = await attemptChainStream(
      formats, 18, null, pickProxyStreamFormat, 60
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(206);
    expect(Date.now() - started).toBeLessThan(1_000); // one 60ms hang, then served
  });
});

describe("WFX2-P37 — the chain-budget race (getPlayback)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    setUpstream(null);
    globalThis.fetch = realFetch;
    clearCache();
  });

  test("a tarpitting chain answers the honest EMPTY degrade ON the deadline — and the empty is NEVER cached", async () => {
    // the wall: the player rung tarpits (answers AFTER the budget), the
    // watch page and the broker fail fast — the pre-P37 shape burned past
    // maxDuration into the platform's 504; the P37 race answers at the budget
    setUpstream(async (url: string) => {
      if (url.includes("/youtubei/v1/player")) {
        await new Promise((r) => setTimeout(r, 400)); // longer than the budget
        return new Response(JSON.stringify(OK_PLAYER_TWO_FORMATS), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const started = Date.now();
    const dto = await getPlayback("p37budget1", { fresh: true, budgetMs: 60 });
    expect(Date.now() - started).toBeLessThan(350); // answered ON the budget (the chain needed 400ms+)
    expect(dto.source).toBe(""); // the honest empty degrade
    expect(dto.streamFormats).toEqual([]);
    // the poisoning guard: the deadline's empty is NEVER cached
    expect(await cachePeek("yt:playback:p37budget1")).toBeNull();

    // and the NEXT healthy run (no budget, the tarpit gone) serves + caches
    setUpstream(async (url: string) => {
      if (url.includes("/youtubei/v1/player")) {
        return new Response(JSON.stringify(OK_PLAYER_TWO_FORMATS), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const healthy = await getPlayback("p37budget1", { fresh: true });
    expect(healthy.streamFormats.length).toBeGreaterThan(0);
    expect(await cachePeek("yt:playback:p37budget1")).toBeDefined(); // the healthy answer caches
  });

  test("an unbudgeted call keeps the pre-P37 per-rung defaults exactly (the built-in retry survives — no single-attempt tightening)", async () => {
    let playerCalls = 0;
    setUpstream(async (url: string) => {
      if (url.includes("/youtubei/v1/player")) {
        playerCalls += 1;
        if (playerCalls === 1) {
          return new Response("boom", { status: 500 }); // retryable — the pre-P37 retry fires
        }
        return new Response(JSON.stringify(OK_PLAYER_TWO_FORMATS), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const dto = await getPlayback("p37nobudget1", { fresh: true });
    expect(dto.streamFormats.length).toBeGreaterThan(0);
    // initial + the single built-in retry — the unbudgeted path is EXACTLY
    // the pre-P37 shape (the budget's single-attempt tightening never leaks)
    expect(playerCalls).toBe(2);
  });
});
