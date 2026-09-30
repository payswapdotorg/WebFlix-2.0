/// <reference types="bun-types" />
/**
 * WFX2-C-S tests — ambient mode: the watch-page player glow renders from
 * the STATIC thumbnail (never a canvas frame-grab — the cross-origin
 * iframe can't be read): blurred + desaturated CSS filter, radial mask,
 * light/dark theme variants, decorative-only (aria-hidden,
 * pointer-events-none, absolutely positioned → no layout shift), and the
 * keyed remount on video change (cross-fade instead of a pop).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AmbientBackdrop } from "@/components/watch/ambient-backdrop";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

/** Query the rendered host (cast through unknown: happy-dom element tree). */
const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

async function renderBackdrop(thumbnailUrl: string | null) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<AmbientBackdrop thumbnailUrl={thumbnailUrl} />);
  });
}

async function rerenderBackdrop(thumbnailUrl: string | null) {
  await act(async () => {
    root!.render(<AmbientBackdrop thumbnailUrl={thumbnailUrl} />);
  });
}

afterEach(() => {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
    root = null;
  }
  host?.remove();
});

describe("AmbientBackdrop — the watch-page player glow", () => {
  test("renders the static thumbnail, blurred + desaturated, inside an aria-hidden decorative layer", async () => {
    await renderBackdrop("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    const layer = q("div[aria-hidden='true']");
    expect(layer).not.toBeNull();
    const img = layer!.querySelector("img") as HTMLElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    expect(img!.getAttribute("alt")).toBe("");
    // the glow: heavy blur + desaturation + darkening
    expect(img!.className).toContain("blur-[64px]");
    expect(img!.className).toContain("saturate-50");
    expect(img!.className).toContain("object-cover");
    // light theme: softer opacity
    expect(img!.className).toContain("opacity-25");
  });

  test("dark theme variant honored (stronger glow)", async () => {
    await renderBackdrop("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    const img = q("img") as HTMLElement;
    expect(img.className).toContain("dark:opacity-40");
    expect(img.className).toContain("dark:saturate-75");
  });

  test("radial mask fades the glow out (CSS maskImage, no canvas frame-grab)", async () => {
    await renderBackdrop("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    const img = q("img") as HTMLElement;
    expect(img.style.maskImage).toContain("radial-gradient");
    // (happy-dom's style serializer drops the -webkit- prefixed twin;
    // React still emits it for Safari — the unprefixed one proves the mask)
    expect(img.getAttribute("style")).toContain("mask-image");
    // no <canvas> anywhere — the static thumbnail is the ONLY source
    expect(q("canvas")).toBeNull();
  });

  test("decorative-only: absolutely positioned + pointer-events-none → no layout shift, never intercepts", async () => {
    await renderBackdrop("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    const layer = q("div[aria-hidden='true']") as HTMLElement;
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("absolute");
  });

  test("no thumbnail → renders nothing (empty variant)", async () => {
    await renderBackdrop(null);
    expect(q("div[aria-hidden='true']")).toBeNull();
    expect(q("img")).toBeNull();
  });

  test("video change → keyed remount swaps the glow source (cross-fade, no pop)", async () => {
    await renderBackdrop("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    const first = q("img") as HTMLElement;
    expect(first.getAttribute("src")).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    await rerenderBackdrop("https://i.ytimg.com/vi/xyz/hqdefault.jpg");
    const second = q("img") as HTMLElement;
    expect(second.getAttribute("src")).toBe("https://i.ytimg.com/vi/xyz/hqdefault.jpg");
    // the key change remounts the img (a fresh node — React key semantics)
    expect(second).not.toBe(first);
  });
});
