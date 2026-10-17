/// <reference types="bun-types" />
/**
 * WFX2-P23-A tests — the clip read family's pure extractors/mappers pinned
 * against the REAL captured /clip page (tests/fixtures/yt/clip_page_public.json
 * — https://www.youtube.com/clip/Ugkx9hS31W7ocpw8tLKo_m-Ht7j36o5StJof,
 * captured 2026-10-17 with the house SSR headers) + the trimmer's 15–60s
 * clamp law. Fixtures only — NEVER the network (the lane law).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  extractClipConfig,
  mapClipResolve,
  looksLikeYouTubeClipId,
  resolveRemoteClip,
  CLIP_UNAVAILABLE_MESSAGE,
} from "../src/lib/youtube/clips";
import { clearCache } from "../src/lib/youtube/cache";
import { setUpstream } from "../src/lib/youtube/innertube";
import {
  clampClipHandle,
  defaultClipWindow,
  parseTimeInput,
  formatTimeInput,
  CLIP_MIN_SEC,
  CLIP_MAX_SEC,
} from "../src/lib/clip/trimmer";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const fixture = load("clip_page_public");
const CLIP_ID = "Ugkx9hS31W7ocpw8tLKo_m-Ht7j36o5StJof";

/** Build the /clip page HTML shape the SSR read parses (both blobs). */
const clipHtml = (playerResponse: unknown, initialData: unknown): string =>
  `<!doctype html><html><head><script>var ytInitialPlayerResponse = ${JSON.stringify(
    playerResponse
  )};</script></head><body><script>var ytInitialData = ${JSON.stringify(
    initialData
  )};</script></body></html>`;

describe("clip resolve mappers (the REAL captured page)", () => {
  test("extractClipConfig pulls the measured clipConfig", () => {
    const html = clipHtml(fixture.ytInitialPlayerResponse, { x: 1 });
    expect(extractClipConfig(html)).toEqual({
      postId: CLIP_ID,
      startTimeMs: 464131,
      endTimeMs: 471087,
    });
  });

  test("mapClipResolve maps the full measured attribution + source video", () => {
    const dto = mapClipResolve(
      CLIP_ID,
      fixture.ytInitialPlayerResponse,
      fixture.ytInitialData
    );
    expect(dto).not.toBeNull();
    // the ranged player contract (clipConfig / 1000)
    expect(dto!.videoId).toBe("Jljy8KtoXOU");
    expect(dto!.startSec).toBe(464);
    expect(dto!.endSec).toBe(471);
    // the clip attribution (clipAttributionRenderer)
    expect(dto!.title).toBe("payment");
    expect(dto!.clipAuthor).toBe("ggtylerr");
    expect(dto!.createdText).toBe("93 views · 4 years ago");
    expect(dto!.clipAuthorAvatarUrl).toContain("yt3.ggpht.com");
    // the source video attribution (primary/secondary renderers)
    expect(dto!.videoTitle).toBe("Game Collecting - Scott The Woz");
    expect(dto!.channelName).toBe("Scott The Woz");
    expect(dto!.channelHandle).toBe("@ScottTheWoz");
    expect(dto!.channelAvatarUrl).toContain("yt3.ggpht.com");
    expect(dto!.source).toBe("youtube");
  });

  test("a page without clipConfig maps to null (the dead-clip family)", () => {
    expect(mapClipResolve(CLIP_ID, {}, fixture.ytInitialData)).toBeNull();
    expect(mapClipResolve(CLIP_ID, null, fixture.ytInitialData)).toBeNull();
  });

  test("clipConfig without the source video id maps to null (honest refuse)", () => {
    const noEndpoint = JSON.parse(
      JSON.stringify({ ...fixture.ytInitialData, currentVideoEndpoint: undefined })
    );
    expect(mapClipResolve(CLIP_ID, fixture.ytInitialPlayerResponse, noEndpoint)).toBeNull();
  });

  test("inverted / empty clip windows map to null", () => {
    const inverted = { clipConfig: { postId: CLIP_ID, startTimeMs: "500", endTimeMs: "100" } };
    expect(mapClipResolve(CLIP_ID, inverted as any, fixture.ytInitialData)).toBeNull();
    const zero = { clipConfig: { postId: CLIP_ID, startTimeMs: "500", endTimeMs: "500" } };
    expect(mapClipResolve(CLIP_ID, zero as any, fixture.ytInitialData)).toBeNull();
  });
});

describe("looksLikeYouTubeClipId (the two id families, never conflated)", () => {
  test("YouTube postIds (U… base64ish) → true", () => {
    expect(looksLikeYouTubeClipId(CLIP_ID)).toBe(true);
    expect(looksLikeYouTubeClipId("Ugxgx0v68upxitbi24J4AaABCQ")).toBe(true);
  });
  test("WebFlix cuids + junk → false (the DB owns them)", () => {
    expect(looksLikeYouTubeClipId("clxxxxx0w3ynq8m1s2p3")).toBe(false);
    expect(looksLikeYouTubeClipId("short")).toBe(false);
    expect(looksLikeYouTubeClipId("")).toBe(false);
  });
});

describe("resolveRemoteClip (fixture upstream — no network)", () => {
  const realPage = clipHtml(fixture.ytInitialPlayerResponse, fixture.ytInitialData);
  const deadPage = clipHtml({ playabilityStatus: { status: "OK" } }, { nope: true });

  test("the captured page resolves to the ranged-player DTO", async () => {
    setUpstream(async (url) => {
      if (String(url).includes(`/clip/${CLIP_ID}`)) {
        return new Response(realPage, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    });
    clearCache();
    const result = await resolveRemoteClip(CLIP_ID);
    expect("videoId" in result).toBe(true);
    if ("videoId" in result) {
      expect(result.videoId).toBe("Jljy8KtoXOU");
      expect(result.startSec).toBe(464);
      expect(result.endSec).toBe(471);
      expect(result.title).toBe("payment");
      expect(result.channelHandle).toBe("@ScottTheWoz");
    }
    setUpstream(null);
  });

  test("a served page without clipConfig → clip-unavailable (the measured wording family)", async () => {
    setUpstream(async () => new Response(deadPage, { status: 200, headers: { "Content-Type": "text/html" } }));
    clearCache();
    const result = await resolveRemoteClip("Ugkxdeadclip0000000000000");
    expect("status" in result && result.status).toBe("clip-unavailable");
    expect(CLIP_UNAVAILABLE_MESSAGE).toBe("Clip not available - Try again later");
    setUpstream(null);
  });

  test("the read failing → read-failed (the honest degradation family)", async () => {
    setUpstream(async () => {
      throw new Error("SSR fetch /clip/x failed: HTTP 502");
    });
    clearCache();
    const result = await resolveRemoteClip("Ugkxwalledclip00000000000");
    expect("status" in result && result.status).toBe("read-failed");
    expect("message" in result && /failed/i.test(String(result.message))).toBe(true);
    setUpstream(null);
  });

  test("a non-YouTube-shaped id never fetches → not-found", async () => {
    let fetched = 0;
    setUpstream(async () => {
      fetched += 1;
      return new Response("", { status: 200 });
    });
    clearCache();
    const result = await resolveRemoteClip("notayoutubeclipid");
    expect("status" in result && result.status).toBe("not-found");
    expect(fetched).toBe(0);
    setUpstream(null);
  });
});

describe("the trimmer law (15s min / 60s max, youtube.com's contract)", () => {
  const DURATION = 600;

  test("dragging the start handle cannot cross the 15s floor / 60s ceiling", () => {
    // anchored at end=300: start ∈ [240, 285]
    expect(clampClipHandle("start", 299, 300, DURATION)).toBe(285); // 60s ceiling
    expect(clampClipHandle("start", 0, 300, DURATION)).toBe(240); // 60s ceiling from below
    expect(clampClipHandle("start", 290, 300, DURATION)).toBe(285);
    // anchored at end=100: start ∈ [40, 85]
    expect(clampClipHandle("start", 90, 100, DURATION)).toBe(85); // 15s floor
    expect(clampClipHandle("start", 60, 100, DURATION)).toBe(60); // inside the law — untouched
    expect(clampClipHandle("start", 50, 100, DURATION)).toBe(50);
    // never below 0 (an early window: anchored at end=30)
    expect(clampClipHandle("start", -50, 30, DURATION)).toBe(0);
  });

  test("dragging the end handle cannot cross the 15s floor / 60s ceiling", () => {
    // anchored at start=100: end ∈ [115, 160]
    expect(clampClipHandle("end", 105, 100, DURATION)).toBe(115); // 15s floor
    expect(clampClipHandle("end", 200, 100, DURATION)).toBe(160); // 60s ceiling
    expect(clampClipHandle("end", 140, 100, DURATION)).toBe(140); // inside the law
    // never past the duration
    expect(clampClipHandle("end", 999, 590, DURATION)).toBe(600);
  });

  test("the default window is 15s at the playhead, clamped to the timeline", () => {
    expect(defaultClipWindow(120, 600)).toEqual({ startSec: 120, endSec: 135 });
    expect(defaultClipWindow(0, 600)).toEqual({ startSec: 0, endSec: 15 });
    expect(defaultClipWindow(595, 600)).toEqual({ startSec: 585, endSec: 600 });
    expect(defaultClipWindow(120, 0)).toEqual({ startSec: 120, endSec: 135 });
  });

  test("the timestamp inputs parse m:ss / h:mm:ss / raw seconds (the [\d\.\:] pattern)", () => {
    expect(parseTimeInput("2:15")).toBe(135);
    expect(parseTimeInput("1:02:03")).toBe(3723);
    expect(parseTimeInput("135")).toBe(135);
    expect(parseTimeInput("2.5")).toBe(2.5);
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("1x2")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });

  test("formatTimeInput renders m:ss / h:mm:ss", () => {
    expect(formatTimeInput(135)).toBe("2:15");
    expect(formatTimeInput(3723)).toBe("1:02:03");
    expect(formatTimeInput(0)).toBe("0:00");
  });

  test("the law's constants are youtube.com's (15 / 60)", () => {
    expect(CLIP_MIN_SEC).toBe(15);
    expect(CLIP_MAX_SEC).toBe(60);
  });
});
