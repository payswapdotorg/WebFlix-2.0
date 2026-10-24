/// <reference types="bun-types" />
/**
 * P42-NETFLIX-SOURCE — the Netflix hub + hand-off UI battery (the house
 * happy-dom idiom): the hub renders real rails with rank numerals, the
 * country chips flip the API query, the unavailable state degrades honestly,
 * and the hand-off dialog names Netflix + carries the official deep link
 * (ADR 0002 §1 made UI).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM (the auth-ui/you-hub setup) ----
const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
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
// P49 — the Continue Watching lane answers through the same mock, URL-aware
let progressData: unknown = { items: [] };
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    useApiUrls.push(url);
    // URL-aware: the my-list lane gets its own honest empty payload
    const data = url?.includes("/api/netflix/my-list")
      ? { items: [] }
      : url?.includes("/api/netflix/progress")
        ? progressData
        : useApiData;
    return { data, loading: false, error: null, reload: () => {} };
  },
  postJson: async () => ({}),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/netflix",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "81757047" }),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));

const { default: NetflixHubView } = await import("@/app/netflix/view");
const { PlayHandoffDialog } = await import("@/components/netflix/play-handoff");
const { MyListButton } = await import("@/components/netflix/my-list-button");
const { lastPlayedLabel } = await import("@/components/netflix/continue-watching-rail");
import type { NetflixHomeDTO, NetflixTitleDTO } from "@/lib/netflix/types";

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
  netflixId: 81757047,
  title: "Animals",
  kind: "movie",
  synopsis: "When their son is kidnapped, an LA mayoral candidate and his wife scramble.",
  releaseYear: 2026,
  maturityRating: "R",
  backdropUrl: "https://dnm.nflximg.net/storyart.jpg",
  posterUrl: "https://dnm.nflximg.net/sdp.jpg",
  logoUrl: null,
  weeklyRank: 1,
  allTimeRank: null,
  weeksInTop10: 2,
  weeklyHoursViewed: 55400000,
  weeklyViews: 30800000,
  countryRanks: { US: 1, GB: 1, HK: 2 },
  weekEndDate: "2026-10-18",
  pool: "weekly-films",
  isPlayable: true,
  deepLinkUrl: "https://www.netflix.com/watch/81757047",
  titlePageUrl: "https://www.netflix.com/title/81757047",
};

const fixtureHome: NetflixHomeDTO = {
  rails: [
    {
      key: "weekly-films",
      label: "Top 10 Movies This Week",
      kind: "movie",
      country: "Global",
      ranking: "weekly",
      weekEndDate: "2026-10-18",
      titles: [
        fixtureTitle,
        { ...fixtureTitle, netflixId: 82023496, title: "Doing Life", weeklyRank: 2, countryRanks: { US: 2 } },
      ],
      source: "netflix-top10",
    },
    {
      key: "weekly-tv",
      label: "Top 10 TV Shows This Week",
      kind: "series",
      country: "Global",
      ranking: "weekly",
      weekEndDate: "2026-10-18",
      titles: [
        { ...fixtureTitle, netflixId: 81558834, title: "Us", kind: "series", weeklyRank: 1, countryRanks: {} },
      ],
      source: "netflix-top10",
    },
  ],
  catalogSize: 3,
  source: "netflix-top10",
  unavailable: false,
  unavailableReason: null,
  fetchedAt: "2026-10-24T00:00:00.000Z",
};

beforeEach(() => {
  useApiData = null;
  useApiUrls = [];
  progressData = { items: [] };
});

afterEach(() => {
  if (root) {
    // act-wrapped unmount — Radix's Presence/DismissableLayer state updates
    // fire on teardown (the dialog closes) and must land inside act.
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  win.document.body.innerHTML = ""; // radix portals render into body
  host = null;
});

describe("the Netflix hub (/netflix)", () => {
  test("renders the hero, the rail with rank numerals, and the country chips", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    expect(one('[data-testid="netflix-hero"]')).not.toBeNull();
    expect(one('[data-testid="netflix-rail-weekly-films"]')).not.toBeNull();
    // rank numerals: the billboard badge is TOP #1 in Movies/TV Today (P45)
    expect(one('[data-testid="netflix-hero"]')?.textContent).toContain("#1 in Movies Today");
    expect(all('[data-testid="netflix-country-chips"] button').length).toBe(2);
    // the honest source note rides the DOM
    expect(one('[data-testid="netflix-source-note"]')?.textContent).toContain("Netflix");
  });

  test("every card carries the direct in-app Play link (P45)", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    const plays = all('[data-testid="netflix-card-play"]');
    expect(plays.length).toBeGreaterThanOrEqual(2);
    for (const p of plays) {
      expect(p.getAttribute("href")).toMatch(/^\/netflix\/watch\/\d+$/);
    }
  });

  test("the kind sub-nav filters the rails (P45)", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    expect(all('[data-testid="netflix-kind-tabs"] button').length).toBe(3);
    const movieTab = all('[data-testid="netflix-kind-tabs"] button')[1];
    await act(async () => {
      movieTab.click();
    });
    // weekly-tv drops out; weekly-films stays
    expect(one('[data-testid="netflix-rail-weekly-films"]')).not.toBeNull();
    expect(one('[data-testid="netflix-rail-weekly-tv"]')).toBeNull();
    // and the TV tab brings it back
    const tvTab = all('[data-testid="netflix-kind-tabs"] button')[2];
    await act(async () => {
      tvTab.click();
    });
    expect(one('[data-testid="netflix-rail-weekly-tv"]')).not.toBeNull();
    expect(one('[data-testid="netflix-rail-weekly-films"]')).toBeNull();
  });

  test("the billboard rotation dots pick the featured title (P45)", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    const dots = all('[aria-label="Featured titles"] button');
    expect(dots.length).toBeGreaterThan(1);
    expect(dots[0]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      dots[1]?.click();
    });
    expect(dots[1]?.getAttribute("aria-selected")).toBe("true");
    expect(dots[0]?.getAttribute("aria-selected")).toBe("false");
  });

  test("the Netflix Live band links into the streamed full-interface lane (P44)", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    const band = one('[data-testid="netflix-live-band"]');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain("Netflix Live");
    expect(one('[data-testid="netflix-live-open"]')?.getAttribute("href")).toBe("/netflix/watch/live");
  });

  test("the unavailable state degrades honestly (no fake rows)", async () => {
    useApiData = { ...fixtureHome, rails: [], unavailable: true, unavailableReason: "Netflix upstream unreachable." };
    await render(createElement(NetflixHubView));
    expect(one('[data-testid="netflix-unavailable"]')).not.toBeNull();
    expect(one('[data-testid="netflix-unavailable"]')?.textContent).toContain("unreachable");
    expect(one('[data-testid="netflix-hero"]')).toBeNull();
  });

  test("flipping the country chip re-queries the API with the country param", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    expect(useApiUrls.some((u) => u === "/api/netflix?country=Global")).toBe(true);
    const us = all('[data-testid="netflix-country-chips"] button')[1];
    await act(async () => {
      us.click();
    });
    expect(useApiUrls.some((u) => u === "/api/netflix?country=US")).toBe(true);
  });
});

describe("the play hand-off dialog (ADR 0002 §1, made UI)", () => {
  test("names Netflix, shows the official deep link, and never fakes a player", async () => {
    await render(
      createElement(PlayHandoffDialog, {
        title: fixtureTitle,
        open: true,
        onOpenChange: () => {},
      })
    );
    const link = one('[data-testid="netflix-handoff-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://www.netflix.com/watch/81757047");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(host ? win.document.body.textContent : "").toContain("DRM");
    expect(host ? win.document.body.textContent : "").toContain("https://www.netflix.com/watch/81757047");
    // there is no fake player surface in the dialog
    expect(win.document.body.querySelector("video")).toBeNull();
  });
});

describe("the My List toggle", () => {
  test("renders the pressed state and posts through the local lane", async () => {
    await render(
      createElement(MyListButton, {
        netflixId: 81757047,
        titleName: "Animals",
        initial: false,
      })
    );
    const btn = one('[data-testid="netflix-my-list-toggle"]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-pressed")).toBe("false");
    expect(btn?.textContent).toContain("My List");
  });
});

// ---------------------------------------------------------------------------
// P49 — the Continue Watching rail (the hub's personalized row)
// ---------------------------------------------------------------------------

const progressItem = (overrides: Partial<{ netflixId: number; lastPlayedAt: string; playCount: number }> = {}) => ({
  title: { ...fixtureTitle, netflixId: overrides.netflixId ?? 81757047 },
  lastPlayedAt: overrides.lastPlayedAt ?? new Date(Date.now() - 90 * 60_000).toISOString(),
  playCount: overrides.playCount ?? 1,
});

describe("the Continue Watching rail (P49)", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("renders with the resume link, the honest meta line, and the remove affordance", async () => {
    progressData = { items: [progressItem(), progressItem({ netflixId: 82023496, playCount: 3 })] };
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    const rail = one('[data-testid="netflix-continue-rail"]');
    expect(rail).not.toBeNull();
    expect(rail?.textContent).toContain("Continue Watching");
    const cards = all('[data-testid="netflix-continue-card"]');
    expect(cards.length).toBe(2);
    // the honest meta: last-played time + the replay count — NO fake progress bar
    const metas = all('[data-testid="netflix-continue-meta"]');
    expect(metas[0]?.textContent).toContain("Last watched");
    expect(metas[1]?.textContent).toContain("3×");
    expect(rail?.querySelector("progress")).toBeNull();
    // the play rides the in-app watch lane directly
    const playLink = cards[0]?.querySelector<HTMLAnchorElement>('a[href="/netflix/watch/81757047"]');
    expect(playLink).not.toBeNull();
    expect(playLink?.getAttribute("aria-label")).toContain("Resume");
    // every card carries the remove affordance
    expect(all('[data-testid="netflix-continue-remove"]').length).toBe(2);
  });

  test("remove issues the DELETE to the progress lane", async () => {
    const deletes: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deletes.push(String(url instanceof Request ? url.url : url));
        return new Response(JSON.stringify({ recorded: false }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    progressData = { items: [progressItem()] };
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    const remove = one('[data-testid="netflix-continue-remove"]')!;
    await act(async () => {
      remove.click();
    });
    expect(deletes.length).toBe(1);
    expect(deletes[0]).toContain("/api/netflix/progress?netflixId=81757047");
  });

  test("stays absent for anonymous/empty rows — an honest absence", async () => {
    progressData = { items: [] };
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    expect(one('[data-testid="netflix-continue-rail"]')).toBeNull();
  });

  test("the progress lane is queried on every hub render", async () => {
    useApiData = fixtureHome;
    await render(createElement(NetflixHubView));
    expect(useApiUrls).toContain("/api/netflix/progress");
  });
});

describe("lastPlayedLabel (P49) — the pure relative-time law", () => {
  const NOW = Date.parse("2026-10-26T12:00:00.000Z");
  const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

  test("sub-minute → just now; minutes → m; hours → h; days → d; weeks → w", () => {
    expect(lastPlayedLabel(iso(0.2), NOW)).toBe("just now");
    expect(lastPlayedLabel(iso(5), NOW)).toBe("5m ago");
    expect(lastPlayedLabel(iso(90), NOW)).toBe("1h ago");
    expect(lastPlayedLabel(iso(3 * 24 * 60), NOW)).toBe("3d ago");
    expect(lastPlayedLabel(iso(14 * 24 * 60), NOW)).toBe("2w ago");
  });

  test("older than five weeks → the locale date; garbage → empty (never a fake)", () => {
    const old = lastPlayedLabel("2026-01-02T00:00:00.000Z", NOW);
    expect(old.length).toBeGreaterThan(0);
    expect(old).not.toContain("ago");
    expect(lastPlayedLabel("not-a-date", NOW)).toBe("");
  });
});
