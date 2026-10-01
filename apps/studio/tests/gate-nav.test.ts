import { expect, test } from "bun:test";
import { isPublicPath, PUBLIC_PATHS } from "@/lib/auth-gate";
import { NAV_ITEMS } from "@/lib/nav";

test("sign-in gating: public paths pass, app surfaces are gated", () => {
  for (const p of PUBLIC_PATHS) expect(isPublicPath(p)).toBe(true);
  expect(isPublicPath("/dashboard")).toBe(false);
  expect(isPublicPath("/api/studio/videos")).toBe(false);
  expect(isPublicPath("/sign-in/extra")).toBe(true);
});

test("nav structure: exact studio.youtube.com surfaces in order", () => {
  expect(NAV_ITEMS.map((i) => i.href)).toEqual([
    "/dashboard", "/content", "/analytics", "/community", "/subtitles",
    "/copyright", "/earn", "/customization", "/audio-library", "/settings",
  ]);
  expect(NAV_ITEMS.map((i) => i.label)).toContain("Audio library");
  expect(NAV_ITEMS).toHaveLength(10);
});
