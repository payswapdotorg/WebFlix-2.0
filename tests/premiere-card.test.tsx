/// <reference types="bun-types" />
/**
 * P21-LIVE-PREMIERES card + Live-view tests (happy-dom + createRoot/act —
 * the search-layout/subscriptions-layout idiom; mocked modules, NEVER the
 * network):
 *
 *  - THE CARD's premiere state: premieredAt future → the PREMIERE badge +
 *    "Premieres M/D" in the meta line (the year appended for a different
 *    year) with NO views/age (none exist before the premiere starts);
 *  - THE BADGE CHAIN unchanged elsewhere: a live card keeps the red LIVE
 *    badge (and wins the chain when both states could apply), a regular
 *    card keeps the duration badge + views · age meta, a PAST premieredAt
 *    is not the premiere state (an already-played premiere is a VOD);
 *  - THE LIVE VIEW's "Premiering soon" rail: the VideoCard row AHEAD of
 *    the watching-now grid, every rail card linking to /watch/<id>; the
 *    rail is honestly absent when premieringSoon is empty, and the page's
 *    honest empty state covers the both-empty case.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { VideoDTO } from "@/lib/types";

// ---- happy-dom window (the repo's search-layout harness idiom) ----
const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).window = win;
for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement"]) {
  (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
win.IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof IntersectionObserver;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- module mocks (the search-layout set) ----
mock.module("next/navigation", () => ({
  usePathname: () => "/explore/live",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// URL-aware useApi stub: the session probe (guest) vs the Live page
let viewData: any = null;
let viewError: string | null = null;
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    if (url && url.includes("/api/auth/session")) {
      return { data: null, loading: false, error: null, reload: () => {} };
    }
    return {
      data: viewData,
      loading: url !== null && viewData === null && viewError === null,
      error: viewError,
      reload: () => {},
    };
  },
  postJson: async () => ({}),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
mock.module("@/lib/queue/queue-actions", () => ({
  addToQueue: async () => ({ status: "error", message: "no" }),
}));

const { VideoCard } = await import("@/components/video/video-card");
const { default: LivePage } = await import("@/app/explore/live/view");
const { isUpcomingPremiere } = await import("@/lib/format");

// ---- fixtures (the REAL DTO shape the card consumes) ----
const CHAN = {
  id: "UC1",
  handle: "@chanone",
  name: "Chan One",
  avatarUrl: "https://example.com/a.jpg",
  verified: true,
  subscriberCount: 1400000,
};

const video = (id: string, over: Record<string, any> = {}): VideoDTO => ({
  id,
  title: `Video ${id}`,
  description: "",
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  videoUrl: `/watch/${id}`,
  durationSec: 213,
  views: 149000,
  viewsText: "149K views",
  publishedText: "2 days ago",
  likes: 0,
  dislikes: 0,
  visibility: "public",
  isMembersOnly: false,
  membersTier: null,
  category: "All",
  isShort: false,
  isLive: false,
  premieredAt: null as string | null,
  createdAt: null,
  channel: CHAN,
  ...over,
} as VideoDTO);

/** A future premiere date N days out at 18:00 UTC (same calendar year). */
const inDays = (days: number, hour = 18): string => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), 11, Math.min(28, 15 + days), hour));
  // December of the current year — always ≥ now within the same year unless
  // it is already late December; roll to next year then.
  if (d.getTime() <= now.getTime()) {
    return new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 15, hour)).toISOString();
  }
  return d.toISOString();
};

// ---- render helpers (the search-layout idiom) ----
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
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const text = (sel: string): string =>
  all(sel)
    .map((e) => (e.textContent ?? "").trim())
    .join("\n");

beforeEach(() => {
  viewData = null;
  viewError = null;
  win.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

// ---------------------------------------------------------------------------

describe("VideoCard — the premiere state (P21)", () => {
  test("premieredAt future → the PREMIERE badge + \"Premieres M/D\" meta, no views/age", async () => {
    const startsAt = inDays(20); // Dec 5-ish of this year, 18:00 UTC
    await render(createElement(VideoCard, { video: video("p1", { premieredAt: startsAt, durationSec: null, views: 0, viewsText: null, publishedText: null }) }));
    const d = new Date(startsAt);
    // the badge (renders "Premiere"; CSS uppercases it on screen)
    const badge = all("span").find((e) => e.getAttribute("class")?.includes("duration-badge"));
    expect(badge?.textContent?.trim().toLowerCase()).toBe("premiere");
    // the meta line: YouTube's wording (the viewer's local date — the same
    // semantics formatPremiereDate uses), no views/age (none exist yet)
    const meta = all("p").map((e) => e.textContent ?? "");
    const metaLine = meta.find((t) => t.includes("Premieres")) ?? "";
    expect(metaLine).toContain(`Premieres ${d.getMonth() + 1}/${d.getDate()}`);
    expect(metaLine).not.toMatch(/views|ago/i);
    // and the card links to the watch page (the premiere state)
    expect(all(`a[href="/watch/p1"]`).length).toBeGreaterThan(0);
  });

  test("a premiere in a different year appends the year (\"Premieres 1/15/2027\")", async () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    const startsAt = new Date(Date.UTC(nextYear, 0, 15, 18)).toISOString();
    await render(createElement(VideoCard, { video: video("p2", { premieredAt: startsAt, durationSec: null, views: 0, viewsText: null, publishedText: null }) }));
    const d = new Date(startsAt);
    const metaLine = all("p").map((e) => e.textContent ?? "").find((t) => t.includes("Premieres")) ?? "";
    expect(metaLine).toContain(`Premieres ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
  });

  test("the LIVE badge is unchanged: a live card keeps its red badge + watching meta", async () => {
    await render(createElement(VideoCard, { video: video("l1", { isLive: true, durationSec: null, viewsText: "1,001 watching", publishedText: null }) }));
    const liveBadge = all("span").find((e) => (e.textContent ?? "").trim().toLowerCase() === "live");
    expect(liveBadge).toBeTruthy();
    expect(liveBadge?.getAttribute("class") ?? "").toContain("bg-yt-red");
    const metaLine = all("p").map((e) => e.textContent ?? "").find((t) => /watching/.test(t)) ?? "";
    expect(metaLine).toContain("1,001 watching");
  });

  test("actual live wins the badge chain when both states could apply", async () => {
    // belt-and-braces: a (contradictory) live card with a future premieredAt
    // still renders LIVE — isLive is the fresher truth, per the chain
    const v = video("l2", { isLive: true, durationSec: null, premieredAt: inDays(5), viewsText: "512 watching", publishedText: null });
    await render(createElement(VideoCard, { video: v }));
    expect(isUpcomingPremiere(v)).toBe(true); // the premise holds…
    const badges = all("span").filter((e) => e.getAttribute("class")?.includes("absolute"));
    const texts = badges.map((b) => (b.textContent ?? "").trim().toLowerCase());
    expect(texts).toContain("live");
    expect(texts).not.toContain("premiere");
  });

  test("a regular card keeps the duration badge + views · age meta", async () => {
    await render(createElement(VideoCard, { video: video("r1") }));
    const badge = all("span").find((e) => e.getAttribute("class")?.includes("duration-badge"));
    expect(badge?.textContent?.trim()).toBe("3:33");
    const metaLine = all("p").map((e) => e.textContent ?? "").find((t) => /views/.test(t)) ?? "";
    expect(metaLine).toContain("149K views");
    expect(metaLine).toContain("2 days ago");
  });

  test("a PAST premieredAt is not the premiere state (the premiere already played)", async () => {
    await render(createElement(VideoCard, { video: video("r2", { premieredAt: "2020-01-01T00:00:00Z", publishedText: "Streamed 5 years ago" }) }));
    const badges = all("span").map((e) => (e.textContent ?? "").trim().toLowerCase());
    expect(badges).not.toContain("premiere");
    const metaLine = all("p").map((e) => e.textContent ?? "").find((t) => /views/.test(t)) ?? "";
    expect(metaLine).toContain("Streamed 5 years ago"); // a played premiere ages like a VOD
  });
});

describe("the Live view — the \"Premiering soon\" rail (P21)", () => {
  const liveVideo = video("lv1", { isLive: true, durationSec: null, viewsText: "3,505 watching", publishedText: null });
  const upcoming = (id: string) =>
    video(id, { premieredAt: inDays(9), durationSec: null, views: 0, viewsText: null, publishedText: null });

  test("the rail renders AHEAD of the watching-now grid with VideoCards linking to /watch/<id>", async () => {
    viewData = { videos: [liveVideo], premieringSoon: [upcoming("pv1"), upcoming("pv2")] };
    await render(createElement(LivePage));
    // the rail section + its cards
    const rail = win.document.querySelector('section[aria-label="Premiering soon"]');
    expect(rail).toBeTruthy();
    expect(rail?.textContent).toContain("Premiering soon");
    expect(rail?.querySelectorAll('a[href="/watch/pv1"]').length).toBeGreaterThan(0);
    expect(rail?.querySelectorAll('a[href="/watch/pv2"]').length).toBeGreaterThan(0);
    // the watching-now grid follows, unchanged (live badge + watching meta)
    const grid = win.document.querySelector('section[aria-label="Watching now"]');
    expect(grid).toBeTruthy();
    expect(grid?.querySelectorAll('a[href="/watch/lv1"]').length).toBeGreaterThan(0);
    expect(grid?.textContent).toContain("3,505 watching");
    // rail BEFORE grid in document order
    const position = (rail as Element).compareDocumentPosition(grid as Element);
    expect(position & (win.Node as typeof Node).DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("premieringSoon empty → the rail is honestly absent, the grid stands alone", async () => {
    viewData = { videos: [liveVideo], premieringSoon: [] };
    await render(createElement(LivePage));
    expect(win.document.querySelector('section[aria-label="Premiering soon"]')).toBeNull();
    expect(win.document.querySelector('section[aria-label="Watching now"]')).toBeTruthy();
  });

  test("both sets empty → the honest empty state (never a faked rail)", async () => {
    viewData = { videos: [], premieringSoon: [] };
    await render(createElement(LivePage));
    expect(win.document.querySelector('section[aria-label="Premiering soon"]')).toBeNull();
    expect(text("p")).toContain("No live streams matching right now — try again in a moment.");
  });
});
