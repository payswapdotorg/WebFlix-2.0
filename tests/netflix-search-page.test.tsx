/// <reference types="bun-types" />
/**
 * P50-NETFLIX-SEARCH-PAGE — the in-hub Netflix search battery (the house
 * happy-dom idiom): the box initializes from ?q=, the debounce commits the
 * URL, the results grid renders real cards, the kind tabs filter the
 * ANSWERED set, and the honest states (prompt / empty / scope note) hold —
 * the Top-10 universe is never faked wider.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM (the netflix-ui setup) --------------------
const dom = await import("happy-dom");
// P52 — the app origin as the Window base: next/image (the P52 optimizer
// lane) renders RELATIVE /_next/image URLs, and a base-less happy-dom
// window (about:blank) cannot parse them — the real document always has
// an origin, so the test window does too.
const win = new dom.Window({ url: "http://localhost:3000" }) as unknown as typeof globalThis;
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
  "SVGElement",
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

// ---- module mocks (captured + swapped, the lane idiom) --------------------
let useApiData: unknown = null;
let useApiUrls: (string | null)[] = [];
let searchParamsQ = "";
let routerPushes: string[] = [];
let routerReplaces: string[] = [];

mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    useApiUrls.push(url);
    return { data: useApiData, loading: false, error: null, reload: () => {} };
  },
  postJson: async () => ({}),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/netflix/search",
  useRouter: () => ({
    push: (href: string) => routerPushes.push(href),
    replace: (href: string) => routerReplaces.push(href),
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(searchParamsQ ? `q=${encodeURIComponent(searchParamsQ)}` : ""),
  useParams: () => ({}),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));

const { default: NetflixSearchView } = await import("@/app/netflix/search/view");
import type { NetflixSearchResultsDTO, NetflixTitleDTO } from "@/lib/netflix/types";

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

const all = (sel: string): HTMLElement[] =>
  win.document
    ? (Array.from(win.document.body.querySelectorAll(sel)) as unknown as HTMLElement[])
    : [];
const one = (sel: string): HTMLElement | null => all(sel)[0] ?? null;

const fixtureTitle: NetflixTitleDTO = {
  netflixId: 82023496,
  title: "Doing Life",
  kind: "movie",
  synopsis: "A family fights for freedom.",
  releaseYear: 2026,
  maturityRating: "PG-13",
  backdropUrl: "https://dnm.nflximg.net/storyart.jpg",
  posterUrl: "https://dnm.nflximg.net/sdp.jpg",
  logoUrl: null,
  weeklyRank: 2,
  allTimeRank: null,
  weeksInTop10: 1,
  weeklyHoursViewed: 21400000,
  weeklyViews: 12100000,
  countryRanks: { US: 2, GB: 3 },
  weekEndDate: "2026-10-25",
  pool: "weekly-films",
  isPlayable: true,
  deepLinkUrl: "https://www.netflix.com/watch/82023496",
  titlePageUrl: "https://www.netflix.com/title/82023496",
};

const fixtureResults: NetflixSearchResultsDTO = {
  q: "doing",
  titles: [
    fixtureTitle,
    { ...fixtureTitle, netflixId: 81558834, title: "Us", kind: "series", weeklyRank: 1 },
    { ...fixtureTitle, netflixId: 81757047, title: "Animals", kind: "movie", weeklyRank: 3 },
  ],
  catalogSize: 42,
  source: "netflix-catalog",
  note: "Searching Netflix's official Top 10 & Most Popular universe — the catalog Netflix itself publishes for tracking.",
};

beforeEach(() => {
  useApiData = null;
  useApiUrls = [];
  searchParamsQ = "";
  routerPushes = [];
  routerReplaces = [];
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  win.document.body.innerHTML = "";
  host = null;
});

describe("the Netflix search page (/netflix/search, P50)", () => {
  test("the empty query renders the honest prompt and queries nothing", async () => {
    await render(createElement(NetflixSearchView));
    expect(one('[data-testid="netflix-search-prompt"]')).toBeTruthy();
    expect(one('[data-testid="netflix-search-form"]')).toBeTruthy();
    expect(useApiUrls.every((u) => u === null || !u.includes("/api/netflix/search"))).toBe(true);
  });

  test("initializes from ?q=, queries the search API, and renders the grid with real cards", async () => {
    searchParamsQ = "doing";
    useApiData = fixtureResults;
    await render(createElement(NetflixSearchView));
    const input = one('[data-testid="netflix-search-input"]') as HTMLInputElement | null;
    expect(input?.value).toBe("doing");
    expect(
      useApiUrls.some((u) => u === "/api/netflix/search?q=doing")
    ).toBe(true);
    const results = one('[data-testid="netflix-search-results"]');
    expect(results).toBeTruthy();
    expect(all('[data-testid="netflix-search-results"] [data-testid="netflix-card"]').length).toBe(3);
    expect(one('[data-testid="netflix-search-count"]')?.textContent).toContain("3 titles");
    // the honest scope note rides the DTO into the UI
    expect(one('[data-testid="netflix-search-note"]')?.textContent).toContain("Top 10");
  });

  test("the kind tabs filter the ANSWERED set", async () => {
    searchParamsQ = "doing";
    useApiData = fixtureResults;
    await render(createElement(NetflixSearchView));
    const tabs = all('[data-testid="netflix-search-kind-tabs"] button');
    expect(tabs.length).toBe(3);
    // "TV Shows" is the third tab
    await act(async () => {
      tabs[2].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(all('[data-testid="netflix-search-results"] [data-testid="netflix-card"]').length).toBe(1);
    expect(one('[data-testid="netflix-search-count"]')?.textContent).toContain("1 title");
  });

  test("no matches renders the honest empty note (never a fake row)", async () => {
    searchParamsQ = "zzqqxx";
    useApiData = { ...fixtureResults, q: "zzqqxx", titles: [] };
    await render(createElement(NetflixSearchView));
    expect(one('[data-testid="netflix-search-empty"]')).toBeTruthy();
    expect(one('[data-testid="netflix-search-results"]')).toBeNull();
    expect(one('[data-testid="netflix-search-empty"]')?.textContent).toContain("zzqqxx");
  });

  test("typing commits the query into the URL (shareable search)", async () => {
    await render(createElement(NetflixSearchView));
    const input = one('[data-testid="netflix-search-input"]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    // the house value-tracker sequence: the PROTOTYPE's native value setter
    // (React's tracker would swallow a plain .value assignment) + input/keyup
    const desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input!),
      "value"
    );
    await act(async () => {
      desc?.set?.call(input, "us");
      input!.dispatchEvent(new win.Event("input", { bubbles: true }));
      input!.dispatchEvent(new win.Event("keyup", { bubbles: true }));
    });
    // the debounce is 300ms — wait past it
    await new Promise((r) => setTimeout(r, 420));
    expect(
      routerReplaces.some((href) => href === `/netflix/search?q=${encodeURIComponent("us")}`)
    ).toBe(true);
  });

  test("the clear button empties the box and the URL", async () => {
    searchParamsQ = "doing";
    useApiData = fixtureResults;
    await render(createElement(NetflixSearchView));
    const clear = one('[data-testid="netflix-search-clear"]');
    expect(clear).toBeTruthy();
    await act(async () => {
      clear!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 420));
    expect(routerReplaces.some((href) => href === "/netflix/search")).toBe(true);
    const input = one('[data-testid="netflix-search-input"]') as HTMLInputElement | null;
    expect(input?.value).toBe("");
  });

  test("every result card's Play sibling stays the direct in-app watch link", async () => {
    searchParamsQ = "doing";
    useApiData = fixtureResults;
    await render(createElement(NetflixSearchView));
    const playLinks = all(
      '[data-testid="netflix-search-results"] a[data-testid="netflix-card-play"]'
    );
    // the card's Play circle is the sibling link into the watch lane
    expect(playLinks.length).toBeGreaterThanOrEqual(1);
    for (const a of playLinks) {
      expect(a.getAttribute("href")).toMatch(/^\/netflix\/watch\/\d+$/);
    }
  });
});
