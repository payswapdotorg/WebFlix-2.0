/// <reference types="bun-types" />
/**
 * P100 — the LIVE URL law battery (ADR 0004 §1 extension): urls.ts stays the
 * ONLY place allowed to construct a tiktok.com (or webcast.tiktok.com) URL,
 * so the live shapes are pinned here. Every live rung rides the G20 handle
 * law (trim-then-strip, multi-sigil collapse). No network anywhere (lane law).
 */
import { describe, expect, test } from "bun:test";

import {
  parseTikTokLiveUrl,
  tiktokLiveHref,
  tiktokLiveRoomUrl,
  tiktokWebcastRoomInfoUrl,
} from "@/lib/tiktok/urls";

describe("parseTikTokLiveUrl — every live reference shape", () => {
  test("canonical www /@handle/live", () => {
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@lofigirl/live")).toEqual({
      handle: "lofigirl",
    });
  });

  test("query params and trailing slashes ride along", () => {
    expect(
      parseTikTokLiveUrl("https://www.tiktok.com/@lofigirl/live?lang=en&enter_from=share")
    ).toEqual({ handle: "lofigirl" });
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@lofigirl/live/")).toEqual({
      handle: "lofigirl",
    });
  });

  test("the /live/@handle form resolves too (defensive accept)", () => {
    expect(parseTikTokLiveUrl("https://www.tiktok.com/live/@lofigirl")).toEqual({
      handle: "lofigirl",
    });
    expect(parseTikTokLiveUrl("https://www.tiktok.com/live/@lofigirl/")).toEqual({
      handle: "lofigirl",
    });
  });

  test("the encoded-sigil form decodes before the handle law runs", () => {
    expect(parseTikTokLiveUrl("https://www.tiktok.com/%40lofigirl/live")).toEqual({
      handle: "lofigirl",
    });
  });

  test("the G20 law: multi-sigil collapses to one identity (case rides along)", () => {
    expect(parseTikTokLiveUrl("https://www.tiktok.com/%40%40LoFiGirl/live")).toEqual({
      handle: "LoFiGirl",
    });
    expect(parseTikTokLiveUrl("https://www.tiktok.com/live/@@lofigirl")).toEqual({
      handle: "lofigirl",
    });
  });

  test("bare handles are NOT live URLs (profile parsing owns those)", () => {
    expect(parseTikTokLiveUrl("lofigirl")).toBeNull();
    expect(parseTikTokLiveUrl("@lofigirl")).toBeNull();
  });

  test("video/player/profile paths are not live URLs", () => {
    expect(
      parseTikTokLiveUrl("https://www.tiktok.com/@lofigirl/video/6718335390845095173")
    ).toBeNull();
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@lofigirl")).toBeNull();
    expect(parseTikTokLiveUrl("https://www.tiktok.com/player/v1/6718335390845095173")).toBeNull();
  });

  test("short links stay honestly null (the vm.tiktok.com law)", () => {
    expect(parseTikTokLiveUrl("https://vm.tiktok.com/ZMhKjXqTt/")).toBeNull();
  });

  test("invalid handles stay invalid after normalization", () => {
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@bad handle!/live")).toBeNull();
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@b@d/live")).toBeNull();
    expect(parseTikTokLiveUrl("https://www.tiktok.com/@/live")).toBeNull();
  });

  test("garbage input never throws", () => {
    expect(parseTikTokLiveUrl("")).toBeNull();
    expect(parseTikTokLiveUrl("not a url")).toBeNull();
    expect(parseTikTokLiveUrl("https://evil.example.com/@lofigirl/live")).toBeNull();
  });
});

describe("the live URL constructors (urls.ts stays the only source)", () => {
  test("tiktokLiveRoomUrl — the outbound deep link", () => {
    expect(tiktokLiveRoomUrl("lofigirl")).toBe("https://www.tiktok.com/@lofigirl/live");
    // the G20 law: sigil soup never leaks into the constructed URL (case rides)
    expect(tiktokLiveRoomUrl("@@LoFiGirl")).toBe("https://www.tiktok.com/@LoFiGirl/live");
  });

  test("tiktokLiveRoomUrl rejects what the handle law rejects", () => {
    expect(() => tiktokLiveRoomUrl("bad handle!")).toThrow();
  });

  test("tiktokLiveHref — the internal route (no sigil, app-relative)", () => {
    expect(tiktokLiveHref("lofigirl")).toBe("/tiktok/lofigirl/live");
    expect(tiktokLiveHref("@@LoFiGirl")).toBe("/tiktok/LoFiGirl/live");
  });

  test("tiktokWebcastRoomInfoUrl — the documented webcast contract", () => {
    expect(tiktokWebcastRoomInfoUrl("1234567890123456789")).toBe(
      "https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=1234567890123456789"
    );
    // a non-numeric room id is refused at the URL law, not downstream
    expect(() => tiktokWebcastRoomInfoUrl("abc")).toThrow();
  });
});
