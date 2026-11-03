/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — the ADR 0013 source-boundary contracts:
 * the URL-state law (source param parsing + canonical hrefs), the capability
 * map law (TikTok never claims a like/comment/follow write), and the
 * source-scan pins for the /shorts adapter switch + the /tiktok/v/[id]
 * compatibility redirect.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  parseShortsSource,
  shortsSourceHref,
  SHORTS_SOURCE_CAPABILITIES,
} from "@/lib/shorts/feed-contracts";

describe("parseShortsSource — the URL-state law", () => {
  test("youtube is the default for everything that is not exactly tiktok", () => {
    expect(parseShortsSource(null)).toBe("youtube");
    expect(parseShortsSource(undefined)).toBe("youtube");
    expect(parseShortsSource("")).toBe("youtube");
    expect(parseShortsSource("youtube")).toBe("youtube");
    expect(parseShortsSource("bogus")).toBe("youtube");
    // honest parse: no case-insensitive surprises
    expect(parseShortsSource("TikTok")).toBe("youtube");
    expect(parseShortsSource("TIKTOK")).toBe("youtube");
  });

  test("tiktok selects the TikTok adapter", () => {
    expect(parseShortsSource("tiktok")).toBe("tiktok");
  });
});

describe("shortsSourceHref — the canonical deep-link shapes", () => {
  test("youtube is the bare /shorts", () => {
    expect(shortsSourceHref("youtube")).toBe("/shorts");
    expect(shortsSourceHref("youtube", "6718335390845095173")).toBe("/shorts");
  });

  test("tiktok carries the source param; a valid post id rides as `post`", () => {
    expect(shortsSourceHref("tiktok")).toBe("/shorts?source=tiktok");
    expect(shortsSourceHref("tiktok", "6718335390845095173")).toBe(
      "/shorts?source=tiktok&post=6718335390845095173",
    );
  });

  test("a non-post-id never reaches the URL (the honest-ignore law)", () => {
    expect(shortsSourceHref("tiktok", "bogus")).toBe("/shorts?source=tiktok");
    expect(shortsSourceHref("tiktok", "<script>")).toBe("/shorts?source=tiktok");
    expect(shortsSourceHref("tiktok", null)).toBe("/shorts?source=tiktok");
  });
});

describe("SHORTS_SOURCE_CAPABILITIES — the never-claims-a-TikTok-write law", () => {
  test("tiktok ships NO like/dislike/comment/follow capability", () => {
    const caps = SHORTS_SOURCE_CAPABILITIES.tiktok;
    expect(caps.canLike).toBe(false);
    expect(caps.canDislike).toBe(false);
    expect(caps.canComment).toBe(false);
    expect(caps.canFollow).toBe(false);
    // the honest affordances stand
    expect(caps.canShare).toBe(true);
    expect(caps.canOpenOutbound).toBe(true);
    expect(caps.canReport).toBe(true);
    expect(caps.canHide).toBe(true);
  });

  test("youtube keeps the full official-lane capability set", () => {
    const caps = SHORTS_SOURCE_CAPABILITIES.youtube;
    expect(caps.canLike).toBe(true);
    expect(caps.canDislike).toBe(true);
    expect(caps.canComment).toBe(true);
    expect(caps.canFollow).toBe(true);
    expect(caps.canShare).toBe(true);
  });
});

describe("the /shorts adapter switch + the /tiktok/v/[id] redirect (source-scan)", () => {
  test("the shorts page reads searchParams server-side and renders BOTH adapters", () => {
    const source = readFileSync("src/app/shorts/page.tsx", "utf8");
    // the server-side URL-state law (back/reload/deep links render right on
    // first paint)
    expect(source).toContain("searchParams");
    expect(source).toContain("parseShortsSource");
    expect(source).toContain("<ShortsFeed />");
    expect(source).toContain("<TikTokShortsFeed");
    // the page is request-shaped now (the ADR 0013 consequence)
    expect(source).not.toContain("revalidate");
    // an invalid post id never reaches the feed prop
    expect(source).toContain("isTikTokPostId");
  });

  test("the old one-post page redirects INTO the shared experience", () => {
    const source = readFileSync("src/app/tiktok/v/[id]/page.tsx", "utf8");
    expect(source).toContain("redirect(");
    expect(source).toContain("/shorts?source=tiktok&post=");
    expect(source).toContain("isTikTokPostId");
    // no second playback UI: the old TikTokEmbedPlayer host is gone from the route
    expect(source).not.toContain("TikTokEmbedPlayer");
  });

  test("the TikTok feed adapter renders through the SHARED shell (one experience)", () => {
    const source = readFileSync("src/components/shorts/tiktok/tiktok-shorts-feed.tsx", "utf8");
    expect(source).toContain("ShortsFeedShell");
    expect(source).toContain("ShortsSourceSelector");
    // the boundary law: no YouTube DTO/player/rail crosses into the TikTok adapter
    expect(source).not.toContain("ShortDTO");
    expect(source).not.toContain("ShortsPlayerSlot");
    expect(source).not.toContain("ShortsEngagementRail");
    expect(source).not.toContain("/api/shorts");
  });

  test("the YouTube adapter stays YouTube-only (no TikTok imports)", () => {
    const source = readFileSync("src/components/shorts/shorts-feed.tsx", "utf8");
    expect(source).toContain("ShortsFeedShell");
    expect(source).not.toContain("TikTok");
    expect(source).not.toContain("tiktok");
  });
});
