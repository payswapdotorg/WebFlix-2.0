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
  PLAYER_CLIENT_ENV,
} from "@/lib/youtube/streams";
import { setUpstream } from "@/lib/youtube/innertube";
import { cachePeek, clearCache } from "@/lib/youtube/cache";
import { pickPreviewStreamFormat } from "@/lib/watch/playback-client";
import { pickStreamFormat } from "@/components/player/player-fallback";
import { GET as playbackRoute } from "@/app/api/videos/[id]/playback/route";
import { GET as streamRoute } from "@/app/api/stream/route";
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

  test("every walled rung costs one FAST request: the full chain fires exactly six player calls, NO STS anywhere", async () => {
    const { impl, recorded } = chainUpstream(WALLED_PLAYER, null);
    setUpstream(impl);
    const dto = await getPlayback("WALLED77777");
    expect(dto).toEqual({ streamFormats: [], storyboards: [], durationSec: null, source: "" });
    const playerCalls = recorded.filter((r) => r.url.includes("/youtubei/v1/player"));
    expect(playerCalls.map((r) => r.body.context.client.clientName)).toEqual([
      "WEB",
      "IOS",
      "ANDROID",
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
