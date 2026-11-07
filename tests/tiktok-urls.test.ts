/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the URL law battery (ADR 0004 §1): urls.ts is the ONLY
 * place allowed to construct a tiktok.com URL, so its shapes are pinned here.
 * No network anywhere (lane law).
 */
import { describe, expect, test } from "bun:test";

import {
  isTikTokPostId,
  parseTikTokVideoUrl,
  tiktokAuthorUrl,
  tiktokOEmbedApiUrl,
  tiktokPlayerEmbedUrl,
  tiktokVideoUrl,
} from "@/lib/tiktok/urls";

const DOCS_ID = "6718335390845095173"; // TikTok's own docs example post

describe("parseTikTokVideoUrl — every reference shape", () => {
  test("www @user/video URL with query params", () => {
    const p = parseTikTokVideoUrl(
      `https://www.tiktok.com/@scout2015/video/${DOCS_ID}?is_from_webapp=1&sender_device=pc`
    );
    expect(p).toEqual({ postId: DOCS_ID, author: "scout2015" });
  });

  test("bare post id", () => {
    expect(parseTikTokVideoUrl(DOCS_ID)).toEqual({ postId: DOCS_ID, author: null });
  });

  test("the Embed Player's own URL shape", () => {
    expect(parseTikTokVideoUrl(`https://www.tiktok.com/player/v1/${DOCS_ID}`)).toEqual({
      postId: DOCS_ID,
      author: null,
    });
  });

  test("m.tiktok.com /v/<id>.html", () => {
    expect(parseTikTokVideoUrl(`https://m.tiktok.com/v/${DOCS_ID}.html`)).toEqual({
      postId: DOCS_ID,
      author: null,
    });
  });

  test("short links (vm/vt) honestly null — unresolvable without a network hop", () => {
    expect(parseTikTokVideoUrl("https://vm.tiktok.com/ZMhqkVxLp/")).toBeNull();
    expect(parseTikTokVideoUrl("https://vt.tiktok.com/ZSabc123/")).toBeNull();
  });

  test("non-tiktok hosts and garbage honestly null", () => {
    expect(parseTikTokVideoUrl("https://youtube.com/watch?v=abc")).toBeNull();
    expect(parseTikTokVideoUrl("https://www.tiktok.com/@user")).toBeNull();
    expect(parseTikTokVideoUrl("not a url at all")).toBeNull();
    expect(parseTikTokVideoUrl("")).toBeNull();
    expect(parseTikTokVideoUrl("12345")).toBeNull(); // too short
  });
});

describe("isTikTokPostId", () => {
  test("numeric strings 6..32 digits", () => {
    expect(isTikTokPostId(DOCS_ID)).toBeTrue();
    expect(isTikTokPostId("123456789")).toBeTrue();
    expect(isTikTokPostId("12345")).toBeFalse();
    expect(isTikTokPostId("abc123")).toBeFalse();
    expect(isTikTokPostId("")).toBeFalse();
  });
});

describe("tiktokPlayerEmbedUrl — the official Embed Player params", () => {
  test("WebFlix defaults: attribution on, discovery stays in the hub, no autoplay", () => {
    const url = tiktokPlayerEmbedUrl(DOCS_ID);
    expect(url.startsWith(`https://www.tiktok.com/player/v1/${DOCS_ID}?`)).toBeTrue();
    const u = new URL(url);
    expect(u.searchParams.get("music_info")).toBe("1");
    expect(u.searchParams.get("description")).toBe("1");
    expect(u.searchParams.get("rel")).toBe("0");
    expect(u.searchParams.get("autoplay")).toBeNull();
  });

  test("documented params are settable (music_info/description/rel/loop/force_muted)", () => {
    // WFX2-TIKTOK-SHORTS-EXPERIENCE-1 param audit: the 2026-10-28 embed-player
    // docs renamed the start-muted param to `force_muted` — the pinned law
    // follows the current contract 1:1.
    const url = tiktokPlayerEmbedUrl(DOCS_ID, { musicInfo: false, description: false, rel: true, loop: true, forceMuted: true });
    const u = new URL(url);
    expect(u.searchParams.get("music_info")).toBe("0");
    expect(u.searchParams.get("description")).toBe("0");
    expect(u.searchParams.get("rel")).toBe("1");
    expect(u.searchParams.get("loop")).toBe("1");
    expect(u.searchParams.get("force_muted")).toBe("1");
    // the retired pre-2026-10-28 name must never surface in a built URL
    expect(u.searchParams.get("muted")).toBeNull();
  });

  test("invalid ids throw (the URL law refuses to build a broken embed)", () => {
    expect(() => tiktokPlayerEmbedUrl("not-an-id")).toThrow();
  });
});

describe("the other two constructors", () => {
  test("oEmbed API URL encodes the video url", () => {
    const u = tiktokOEmbedApiUrl(`https://www.tiktok.com/@scout2015/video/${DOCS_ID}`);
    expect(u.startsWith("https://www.tiktok.com/oembed?url=")).toBeTrue();
    expect(u).toContain(encodeURIComponent(`https://www.tiktok.com/@scout2015/video/${DOCS_ID}`));
  });

  test("video URL: author shape when known, player page otherwise", () => {
    expect(tiktokVideoUrl("scout2015", DOCS_ID)).toBe(`https://www.tiktok.com/@scout2015/video/${DOCS_ID}`);
    expect(tiktokVideoUrl(null, DOCS_ID)).toBe(`https://www.tiktok.com/player/v1/${DOCS_ID}`);
    expect(() => tiktokVideoUrl(null, "bogus")).toThrow();
  });

  test("author profile URL (P59-R1): @-stripped, encoded, handle-validated", () => {
    expect(tiktokAuthorUrl("scout2015")).toBe("https://www.tiktok.com/@scout2015");
    expect(tiktokAuthorUrl("@scout2015")).toBe("https://www.tiktok.com/@scout2015");
    expect(() => tiktokAuthorUrl("bad handle!")).toThrow();
    expect(() => tiktokAuthorUrl("")).toThrow();
  });
});

describe("normalizeTikTokHandle / isTikTokHandle — the P97 multi-sigil law (G20)", () => {
  test("all leading sigils collapse to the core handle", async () => {
    const { isTikTokHandle, normalizeTikTokHandle } = await import("@/lib/tiktok/urls");
    expect(normalizeTikTokHandle("scout2015")).toBe("scout2015");
    expect(normalizeTikTokHandle("@scout2015")).toBe("scout2015");
    expect(normalizeTikTokHandle("@@scout2015")).toBe("scout2015");
    expect(normalizeTikTokHandle("@@@scout2015")).toBe("scout2015");
    expect(normalizeTikTokHandle("  @scout2015 ")).toBe("scout2015");
    // sigil-messy spellings are LENIENT-valid (they mean the core handle)
    expect(isTikTokHandle("@@bad")).toBeTrue();
    expect(isTikTokHandle("@@@bad")).toBeTrue();
    // genuinely-invalid strings stay invalid at every rung
    expect(isTikTokHandle("bad handle!")).toBeFalse();
    expect(isTikTokHandle("b@d")).toBeFalse();
    expect(isTikTokHandle("")).toBeFalse();
  });

  test("idempotence: normalizing twice equals normalizing once", async () => {
    const { normalizeTikTokHandle } = await import("@/lib/tiktok/urls");
    for (const raw of ["scout2015", "@scout2015", "@@scout2015", "@@@scout2015", "  @scout2015 "]) {
      expect(normalizeTikTokHandle(normalizeTikTokHandle(raw))).toBe(normalizeTikTokHandle(raw));
    }
  });
});
