/**
 * P23-B (G3) — the search AI answer card through the real SearchPage view
 * (the search-layout idiom: happy-dom + mocked useApi with a viewData
 * fixture + a stubbed global fetch for the ask POST). Pins:
 *  - the card fires ONLY for conversational queries, ABOVE the results list;
 *  - citation chips are real links to the cited videos + the sources row;
 *  - the type-out reveal completes to the full answer;
 *  - collapse; the honest error + Retry; disabled → the card stays hidden;
 *    no-results → hidden.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).window = win;
for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement"]) {
  (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
}
win.IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof IntersectionObserver;

/** Reduced-motion switch: true → the type-out reveals instantly. */
let reducedMotion = true;
(win as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q: string) => ({
  matches: /reduce/.test(q) && reducedMotion,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
});

const routerPushes: string[] = [];
mock.module("next/navigation", () => ({
  usePathname: () => "/search",
  useRouter: () => ({ push: (u: string) => routerPushes.push(u), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(viewParams),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("@/hooks/use-api", () => ({
  useApi: () => ({ data: viewData, loading: false, error: null, reload: () => {} }),
  // the REAL postJson body (rides the stubbed global fetch below)
  postJson: async <T,>(url: string, body: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    return j;
  },
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
mock.module("@/lib/queue/queue-actions", () => ({ addToQueue: async () => ({ status: "error", message: "no" }) }));

const { default: SearchPage } = await import("@/app/search/view");

let viewParams = "q=what is lofi music?";
let viewData: any = null;

const ASK_OK = {
  status: "ok",
  answer: "Lofi is relaxing music [1], often streamed live for studying [2].",
  citations: [
    { n: 1, videoId: "v1", title: "cozy autumn lofi beats", channelName: "Lofi Girl" },
    { n: 2, videoId: "v2", title: "lofi hip hop radio", channelName: "Lofi Girl" },
  ],
};

/** ask fetch stub — mutable per test. */
let askResponses: { status: number; body: unknown }[] = [];
const askCalls: string[] = [];
const realFetch = globalThis.fetch;
(globalThis as Record<string, unknown>).fetch = async (url: string) => {
  const u = String(url);
  if (u.includes("/api/search/ask")) {
    askCalls.push(u);
    const next = askResponses.shift() ?? { status: 200, body: ASK_OK };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
};
afterAll(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

const video = (id: string, title: string) => ({
  id,
  title,
  description: `The description snippet for ${title}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
  videoUrl: `/watch/${id}`,
  durationSec: 213,
  views: 149000,
  viewsText: "149K views",
  publishedText: "23 hours ago",
  likes: 0,
  dislikes: 0,
  visibility: "public",
  isMembersOnly: false,
  membersTier: null,
  category: "Music",
  isShort: false,
  isLive: false,
  premieredAt: null,
  createdAt: null,
  channel: {
    id: "UC123",
    handle: "@LofiGirl",
    name: "Lofi Girl",
    avatarUrl: "https://example.com/a.jpg",
    verified: true,
    subscriberCount: 14000000,
  },
});

const RESULTS_PAGE = {
  query: "what is lofi music?",
  videos: [video("v1", "cozy autumn lofi beats"), video("v2", "lofi hip hop radio")],
  channels: [],
  playlists: [],
  resultCountText: "About 3,839,607 results",
  correction: null,
  nextCursor: null,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
  await settle();
}

const settle = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const ids = () => all("[data-testid]").map((e) => e.getAttribute("data-testid"));

beforeEach(() => {
  routerPushes.length = 0;
  viewParams = "q=what is lofi music?";
  viewData = RESULTS_PAGE;
  askResponses = [];
  askCalls.length = 0;
  reducedMotion = true;
});
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("P23-B G3 — the search AI answer card", () => {
  test("conversational query → the card renders ABOVE the results list", async () => {
    await render(createElement(SearchPage));
    expect(all('[data-testid="ask-answer-card"]').length).toBe(1);
    expect(ids().indexOf("ask-answer-card")).toBeLessThan(ids().indexOf("search-results-list"));
    expect(all('[data-testid="ask-collapse"]').length).toBe(1);
  });

  test("citation chips are real links to the cited videos + the sources row lists them", async () => {
    await render(createElement(SearchPage));
    await settle();
    const chip1 = all('[data-testid="ask-citation-1"]')[0];
    const chip2 = all('[data-testid="ask-citation-2"]')[0];
    expect(chip1.getAttribute("href")).toBe("/watch/v1");
    expect(chip2.getAttribute("href")).toBe("/watch/v2");
    const sources = all('[data-testid="ask-sources"] a').map((a) => a.textContent ?? "");
    expect(sources.length).toBe(2);
    expect(sources[0]).toContain("cozy autumn lofi beats");
    expect(sources[0]).toContain("Lofi Girl");
  });

  test("the type-out reveal completes to the full answer text", async () => {
    reducedMotion = false; // the animated path
    await render(createElement(SearchPage));
    await settle(900); // 24 ticks × 24ms + margin
    // the citation chips render the number (the brackets are the chip chrome)
    expect(all('[data-testid="ask-answer-text"]')[0].textContent).toBe(
      "Lofi is relaxing music 1, often streamed live for studying 2."
    );
    // and the ask POST fired exactly once with the query
    expect(askCalls.length).toBe(1);
  });

  test("collapse hides the card body (aria-expanded flips)", async () => {
    await render(createElement(SearchPage));
    const toggle = all('[data-testid="ask-collapse"]')[0];
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(all('[data-testid="ask-sources"]').length).toBe(0);
  });

  test("failure → the honest error + Retry refetches and recovers", async () => {
    askResponses = [
      { status: 502, body: { error: "The AI request failed — model unavailable" } },
      { status: 200, body: ASK_OK },
    ];
    await render(createElement(SearchPage));
    expect(all('[role="alert"]').length).toBe(1);
    expect(all('[data-testid="ask-retry"]')[0].textContent).toContain("Retry");
    await act(async () => {
      all('[data-testid="ask-retry"]')[0].click();
    });
    await settle();
    expect(askCalls.length).toBe(2);
    expect(all('[data-testid="ask-answer-text"]')[0].textContent).toBe(
      "Lofi is relaxing music 1, often streamed live for studying 2."
    );
  });

  test("disabled (no ZAI_API_KEY) → the card stays hidden — the honest absence", async () => {
    askResponses = [{ status: 200, body: { status: "disabled" } }];
    await render(createElement(SearchPage));
    expect(all('[data-testid="ask-answer-card"]').length).toBe(0);
    expect(askCalls.length).toBe(1);
  });

  test("a non-conversational query → no card and no ask fetch", async () => {
    viewParams = "q=lofi+beats";
    await render(createElement(SearchPage));
    expect(all('[data-testid="ask-answer-card"]').length).toBe(0);
    expect(askCalls.length).toBe(0);
    // the results grid itself still renders
    expect(all('[data-testid="search-results-list"]').length).toBe(1);
  });

  test("no results to ground on → the card hides (the grid's zero-state speaks)", async () => {
    askResponses = [{ status: 200, body: { status: "no-results" } }];
    await render(createElement(SearchPage));
    expect(all('[data-testid="ask-answer-card"]').length).toBe(0);
  });
});
