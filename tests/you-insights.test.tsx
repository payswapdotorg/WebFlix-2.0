/// <reference types="bun-types" />
/**
 * WFX2-P7-AN tests — the watch insights SURFACES battery (happy-dom +
 * createRoot/act, the you-hub test pattern): the /you/insights view (totals
 * cards, the honest all-zero note, the top-videos rail), the You hub's Watch
 * insights card (week sum + streak + See all), the description-box honest
 * "You've watched…" line, and the video-card WATCHED overlay. Global fetch is
 * stubbed per-test; recharts is stubbed (the chart's internals are recharts'
 * domain — the data wiring is what these tests assert).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { YouInsightsPayload } from "@/app/you/sections";

// ---- happy-dom as the global DOM (the you-hub setup) ----
const win = new Window();
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
  "React",
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

// ---- the mutable session state the mocked hook serves ----
type SessionState = {
  status: "loading" | "authenticated" | "unauthenticated";
  user?: Record<string, unknown> | null;
};
let sessionState: SessionState = { status: "authenticated", user: { displayName: "Op" } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSessionHook = { ...require("@/hooks/use-webflix-session") } as Record<string, unknown>;
mock.module("@/hooks/use-webflix-session", () => ({
  useWebFlixSession: () => ({
    status: sessionState.status,
    user: sessionState.user ?? null,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNavigation = { ...require("next/navigation") } as Record<string, unknown>;
mock.module("next/navigation", () => ({
  usePathname: () => "/you/insights",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

// recharts stub — hermetic rendering (the real chart is recharts' domain)
mock.module("recharts", () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="insights-chart-stub">{children}</div>
  ),
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

// ---- the fetch stub (per-test programmable) ----
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

const YouInsightsView = (await import("@/app/you/insights/view")).default;
const YouView = (await import("@/app/you/view")).default;
const { DescriptionBox } = await import("@/components/watch/description-box");
const { VideoCard } = await import("@/components/video/video-card");

// ---- fixtures (the REAL payload shapes) ----

const CHANNEL = {
  id: "c1",
  handle: "@chan",
  name: "Chan One",
  avatarUrl: "https://x/c.jpg",
  verified: false,
  subscriberCount: 1,
  subscriberCountText: "1 subscriber",
};

function makeVideo(id: string, title: string) {
  return {
    id,
    title,
    description: "",
    thumbnailUrl: "https://x/t.jpg",
    videoUrl: "https://x/v.mp4",
    durationSec: 120,
    views: 1234,
    viewsText: "1.2K views",
    publishedText: "1 day ago",
    likes: 0,
    dislikes: 0,
    visibility: "public" as const,
    isMembersOnly: false,
    membersTier: null,
    category: "Music",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    badges: [],
    channel: CHANNEL,
    watchedSec: 30,
    watchedAt: "2026-09-29T00:00:00Z",
  };
}

function makeInsights(over: Partial<YouInsightsPayload> = {}): YouInsightsPayload {
  return {
    totals: {
      watchedSecAllTime: 4980,
      videosWatched: 2,
      activeDays: 3,
      avgSecPerActiveDay: 1660,
      streakDays: 2,
    },
    series28d: Array.from({ length: 28 }, (_, i) => ({ day: `d${i}`, sec: i === 27 ? 900 : 0 })),
    topVideos: [
      {
        videoId: "v1",
        title: "Sintel Trailer",
        channelName: "Blender Studio",
        thumbnailUrl: "https://x/t1.jpg",
        watchedSec: 4200,
        lastWatchedAt: "2026-10-03T10:00:00Z",
      },
    ],
    ...over,
  };
}

// ---- render helpers (the you-hub idiom) ----

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

async function render(el: React.ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
  await act(async () => {});
}

beforeEach(() => {
  sessionState = { status: "authenticated", user: { displayName: "Op" } };
  fetchHandler = () => new Response("{}", { status: 200 });
});

afterEach(() => {
  if (root) {
    root.unmount();
    root = null;
  }
  host?.remove();
  host = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

// ---- /you/insights view ----------------------------------------------------

describe("/you/insights view", () => {
  test("renders the totals cards + the chart + the top-videos rail from the real payload", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/watch/insights")) return Response.json(makeInsights());
      return Response.json({}, { status: 200 });
    };
    await render(<YouInsightsView />);
    expect(q("[data-testid='insights-total-time']")?.textContent).toContain("1h 23m");
    expect(q("[data-testid='insights-total-videos']")?.textContent).toContain("2");
    expect(q("[data-testid='insights-total-streak']")?.textContent).toContain("2 days");
    expect(q("[data-testid='insights-total-avg']")?.textContent).toContain("27m");
    expect(q("[data-testid='insights-chart-stub']")).not.toBeNull();
    const rows = all("[data-testid='insights-top-video']");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Sintel Trailer");
    expect(rows[0].textContent).toContain("Blender Studio");
    expect(q("[data-testid='insights-top-watched']")?.textContent).toContain("1h 10m");
    // the honest note is ABSENT when there is activity
    expect(q("[data-testid='insights-honest-note']")).toBeNull();
  });

  test("the all-zero series gets the honest no-backfill note + no top rail", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/watch/insights")) {
        return Response.json(
          makeInsights({
            totals: {
              watchedSecAllTime: 0,
              videosWatched: 0,
              activeDays: 0,
              avgSecPerActiveDay: 0,
              streakDays: 0,
            },
            series28d: Array.from({ length: 28 }, (_, i) => ({ day: `d${i}`, sec: 0 })),
            topVideos: [],
          })
        );
      }
      return Response.json({}, { status: 200 });
    };
    await render(<YouInsightsView />);
    expect(q("[data-testid='insights-honest-note']")?.textContent).toContain(
      "nothing is backfilled"
    );
    expect(all("[data-testid='insights-top-video']").length).toBe(0);
    expect(q("[data-testid='insights-chart-stub']")).toBeNull(); // the empty state, not a fake chart
  });

  test("a fetch failure renders the honest error line, never a crash", async () => {
    fetchHandler = () => new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    await render(<YouInsightsView />);
    expect(q("[role='alert']")?.textContent).toContain("boom");
  });
});

// ---- the You hub's Watch insights card --------------------------------------

describe("the You hub watch insights card", () => {
  test("renders the week sum + streak meta and the See all link", async () => {
    const series = Array.from({ length: 28 }, (_, i) => ({
      day: `d${i}`,
      sec: i === 27 ? 600 : i === 26 ? 300 : 0, // this week: 15m
    }));
    fetchHandler = (url) => {
      if (url.includes("/api/watch/insights")) {
        return Response.json(makeInsights({ series28d: series }));
      }
      if (url.includes("/api/history")) {
        return Response.json({
          groups: [],
          nextCursor: null,
          loginRequired: false,
          watchHistoryPaused: null,
          searchHistoryPaused: null,
          total: 0,
          session: false,
        });
      }
      if (url.includes("/api/playlists")) {
        return Response.json({ playlists: [], loginRequired: false, session: false });
      }
      if (url.includes("/api/studio")) {
        return Response.json({ session: false, loginRequired: true, channel: null, videos: [] });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<YouView />);
    const section = q("[data-testid='you-watch-insights']");
    expect(section).not.toBeNull();
    const card = q("[data-testid='you-watch-insights-card']");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("15m watched this week");
    expect(card?.textContent).toContain("2-day streak");
    const seeAll = section?.querySelector("a[href='/you/insights']");
    expect(seeAll).not.toBeNull();
    expect(seeAll?.textContent).toContain("See all");
  });

  test("an all-zero payload degrades to the honest neutral card (never a crash)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/watch/insights")) return Response.json({});
      if (url.includes("/api/history")) {
        return Response.json({
          groups: [],
          nextCursor: null,
          loginRequired: false,
          watchHistoryPaused: null,
          searchHistoryPaused: null,
          total: 0,
          session: false,
        });
      }
      if (url.includes("/api/playlists")) {
        return Response.json({ playlists: [], loginRequired: false, session: false });
      }
      if (url.includes("/api/studio")) {
        return Response.json({ session: false, loginRequired: true, channel: null, videos: [] });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<YouView />);
    const card = q("[data-testid='you-watch-insights-card']");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Your watch time, honestly charted");
  });
});

// ---- the description-box honest watched line --------------------------------

describe("DescriptionBox — the viewer's watched line", () => {
  const base = {
    videoId: "v1",
    description: "A film",
    views: 1000,
    createdAt: "2026-09-01T00:00:00Z",
    durationSec: 120,
    thumbnailUrl: "https://x/t.jpg",
    onSeek: () => {},
  };

  test("shows the humanized lifetime watch time under the stats", async () => {
    await render(<DescriptionBox {...base} viewerWatchedSec={4980} />);
    const line = q("[data-testid='description-watched-line']");
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain("You've watched 1h 23m of this video");
  });

  test("hidden when never watched (null) or zero", async () => {
    await render(<DescriptionBox {...base} viewerWatchedSec={null} />);
    expect(q("[data-testid='description-watched-line']")).toBeNull();
    await render(<DescriptionBox {...base} viewerWatchedSec={0} />);
    expect(q("[data-testid='description-watched-line']")).toBeNull();
  });
});

// ---- the video-card WATCHED overlay -----------------------------------------

describe("VideoCard — the WATCHED overlay", () => {
  test("the watched-map entry lights the strip (accessible text 'Watched')", async () => {
    await render(<VideoCard video={makeVideo("v1", "Watched Once")} watchedSec={30} />);
    const strip = q("[data-testid='video-card-watched']");
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain("Watched");
  });

  test("no map entry → no strip (the untouched card is byte-identical)", async () => {
    await render(<VideoCard video={makeVideo("v2", "Never Seen")} />);
    expect(q("[data-testid='video-card-watched']")).toBeNull();
  });
});
