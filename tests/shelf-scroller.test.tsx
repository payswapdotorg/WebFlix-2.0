/// <reference types="bun-types" />
/**
 * P90 — the home shelf scroller battery (component lane): the chevron-paging
 * affordance (the ShelfScroller, the netflix-rail law generalized) that
 * fixes the operator's report — "the horizontal list of shorts/tiktok
 * videos is not scrollable on the home page". Pinned here: the button
 * pair, the edge-disabled states driven by real scroll geometry, and the
 * viewport-step scrollBy. The per-shelf integration pins ride each shelf's
 * own battery file (the tiktok-home-shelf / shorts-shelf lanes).
 *
 * happy-dom + createRoot/act (the shorts-shelf.test.tsx idiom). The scroll
 * geometry is driven by defining the layout getters on the scroller element
 * (happy-dom performs no layout — the lane stubs the measures the law reads)
 * and dispatching real scroll events.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM -------------------------------------------
const dom = await import("happy-dom");
const win = new dom.Window({ url: "http://localhost:3000" }) as unknown as typeof globalThis;
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "navigator",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
] as const) {
  (globalThis as Record<string, unknown>)[key] = win[key as keyof typeof win];
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as Record<string, unknown>).fetch = async () => new Response("{}", { status: 200 });
});
afterEach(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

const { ShelfScroller } = await import("@/components/home/shelf-scroller");

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {});
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

const q = (sel: string): HTMLElement | null =>
  win.document.body.querySelector(sel) as unknown as HTMLElement | null;

/** Stub the layout measures the arrow law reads onto a happy-dom element. */
function measure(
  el: HTMLElement,
  geometry: { scrollLeft: number; clientWidth: number; scrollWidth: number },
) {
  for (const [key, value] of Object.entries(geometry)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
}

function scrollEvent(): Event {
  return new win.Event("scroll", { bubbles: true }) as unknown as Event;
}

describe("ShelfScroller — the chevron paging law", () => {
  test("renders the button pair with the honest edge states", async () => {
    await render(
      createElement(
        ShelfScroller,
        { label: "Shorts", testId: "scroller-under-test" },
        createElement("div", { key: "1", className: "w-[168px] shrink-0" }, "t1"),
        createElement("div", { key: "2", className: "w-[168px] shrink-0" }, "t2"),
        createElement("div", { key: "3", className: "w-[168px] shrink-0" }, "t3"),
      ),
    );
    const left = q('[data-testid="scroller-under-test-page-left"]') as HTMLButtonElement;
    const right = q('[data-testid="scroller-under-test-page-right"]') as HTMLButtonElement;
    expect(left.getAttribute("aria-label")).toBe("Scroll Shorts back");
    expect(right.getAttribute("aria-label")).toBe("Scroll Shorts forward");
    // at the left edge the back chevron is disabled
    expect(left.disabled).toBe(true);

    // mid-rail geometry: both directions live
    const row = q('[data-testid="scroller-under-test"]')!;
    measure(row, { scrollLeft: 400, clientWidth: 800, scrollWidth: 2000 });
    await act(() => {
      row.dispatchEvent(scrollEvent());
    });
    expect(left.disabled).toBe(false);
    expect(right.disabled).toBe(false);

    // the right edge: forward disables, back stays live
    measure(row, { scrollLeft: 1200, clientWidth: 800, scrollWidth: 2000 });
    await act(() => {
      row.dispatchEvent(scrollEvent());
    });
    expect(right.disabled).toBe(true);
    expect(left.disabled).toBe(false);
  });

  test("the paging chevron scrolls a full viewport step, smooth", async () => {
    await render(
      createElement(
        ShelfScroller,
        { label: "TikTok", testId: "scroller-under-test" },
        createElement("div", { key: "1", className: "w-[168px] shrink-0" }, "t1"),
      ),
    );
    const row = q('[data-testid="scroller-under-test"]')!;
    const right = q('[data-testid="scroller-under-test-page-right"]') as HTMLButtonElement;
    measure(row, { scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 });
    await act(() => {
      row.dispatchEvent(scrollEvent());
    });
    const calls: { left: number; behavior: string }[] = [];
    Object.defineProperty(row, "scrollBy", {
      value: (opts: { left: number; behavior: string }) => calls.push(opts),
      configurable: true,
    });
    await act(() => {
      right.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
    expect(calls).toEqual([{ left: 800 * 0.85, behavior: "smooth" }]);
  });
});
