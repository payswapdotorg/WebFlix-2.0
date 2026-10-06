/// <reference types="bun-types" />
/**
 * WFX2-P6-CH tests — the channel page's YouTube-parity surfaces (happy-dom +
 * createRoot/act, the you-hub test pattern). next/navigation, sonner and the
 * session hook are mocked via mock.module (file-scoped by --isolate,
 * restored in afterAll); global fetch is stubbed per-test.
 *
 * The battery proves the FULL chain for the doubled-@ handle fix — the real
 * /api/channel/[handle] route (fixture bytes through the test-only
 * setUpstream() seam, never the network) → the real mapper → the real page
 * component → the DOM: an upstream handle of "@/mind_warehouse" (or
 * "@mind_warehouse") renders EXACTLY "@mind_warehouse". Plus:
 *  - the Videos tab's sort-chip row (render, click refetch via the chip's
 *    own continuation token, the grid swap, the re-marked selected chip, NO
 *    chip-row when the payload carries none, the walled honest degrade);
 *  - the header composition (name + verified badge, @handle, live
 *    subscriber text + video count on one line, the description snippet
 *    with the …more affordance into the About tab, and the composed-page
 *    honest omissions — never a fabricated count).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";

/* ---- happy-dom as the global DOM (the you-hub setup) ---- */
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

/* ---- the module mocks (mock.module — restored in afterAll) ---- */

// the route handle the page renders under (mutable per test)
let routeHandle = "@mind_warehouse";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNavigation = { ...require("next/navigation") } as Record<string, unknown>;
mock.module("next/navigation", () => ({
  useParams: () => ({ handle: routeHandle }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/channel/${routeHandle}`,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSessionHook = { ...require("@/hooks/use-webflix-session") } as Record<string, unknown>;
mock.module("@/hooks/use-webflix-session", () => ({
  useWebFlixSession: () => ({ status: "unauthenticated", user: null }),
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

/* ---- the fetch stub (per-test programmable) ---- */
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
const fetchLog: string[] = [];
// P14-YOU: the own-channel seam's read (/api/studio?enrich=0) defaults to
// public mode (no operator session). A test that exercises the own-channel
// affordances sets `studioResponse` to the operator channel.
let studioResponse: unknown = { session: false, channel: null };
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  fetchLog.push(u);
  if (u.includes("/api/studio")) {
    return new Response(JSON.stringify(studioResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

/* ---- modules under test (imported after the mocks) ---- */
const ChannelPage = (await import("@/app/channel/[handle]/page")).default;
const { GET: channelRoute } = await import("@/app/api/channel/[handle]/route");
const { GET: tabRoute } = await import("@/app/api/channel/[handle]/tab/route");
const { clearCache } = await import("@/lib/youtube/cache");
const { setUpstream } = await import("@/lib/youtube/innertube");

/* ------------------------------------------------------------------ */
/* fixtures (the REAL payload shapes; SYNTHETIC chips marked below)    */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = "tests/fixtures/yt";
const loadFixture = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

/** The real sanitized capture with the shelves stripped (the header is the
 * surface under test — a lean DOM) and the upstream header's handle text
 * replaced with the doubled-@ forms the live bug carried. */
function leanChannelWithHandle(upstreamHandle: string): any {
  const clone = JSON.parse(JSON.stringify(loadFixture("channel_rickastley")));
  for (const t of clone.contents.twoColumnBrowseResultsRenderer.tabs) {
    if (t?.tabRenderer) delete t.tabRenderer.content; // strip the shelves
  }
  const rows =
    clone.header.pageHeaderRenderer.content.pageHeaderViewModel.metadata.contentMetadataViewModel
      .metadataRows;
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      if (String(part?.text?.content ?? "").startsWith("@")) {
        part.text.content = upstreamHandle;
        return clone;
      }
    }
  }
  return clone;
}

const CHANNEL = {
  id: "UCchtest0000000000000",
  handle: "mind_warehouse", // BARE — the mapper's WFX2-P6-CH contract
  name: "Mind Warehouse",
  avatarUrl: "https://example.com/avatar.jpg",
  verified: true,
  subscriberCount: 1_230_000,
  subscriberCountText: "1.23M subscribers",
  bannerUrl: null,
  description: "The best facts, visualized.",
  createdAt: null,
  isSubscribed: false,
  isOwner: false,
  videoCount: 437,
};

function makeVideo(id: string, title: string) {
  return {
    id,
    title,
    description: "",
    thumbnailUrl: "https://example.com/t.jpg",
    videoUrl: "https://example.com/v.mp4",
    durationSec: 300,
    views: 12345,
    viewsText: "12K views",
    publishedText: "2 days ago",
    likes: 100,
    dislikes: 0,
    visibility: "public" as const,
    isMembersOnly: false,
    membersTier: null,
    category: "Education",
    isShort: false,
    isLive: false,
    premieredAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    badges: [],
    channel: CHANNEL,
  };
}

/** A page DTO with the sort chips present (SYNTHETIC tokens — the shape the
 * real videos-tab browse carries; see ChannelSortChipDTO in types.ts). The
 * `channel` override MERGES over the base channel (never replaces it); any
 * other override lands at the top level. */
function pageDto(overrides: Record<string, unknown> = {}): any {
  const { channel, ...rest } = overrides as { channel?: object } & Record<string, unknown>;
  return {
    channel: { ...CHANNEL, ...(channel ?? {}) },
    videos: [makeVideo("v-default-1", "Latest default video one"), makeVideo("v-default-2", "Latest default video two")],
    shorts: [],
    tabs: ["home", "videos", "about"],
    joinable: false,
    sortChips: [
      { label: "Latest", token: "T_LATEST", selected: true },
      { label: "Popular", token: "T_POPULAR", selected: false },
      { label: "Oldest", token: "T_OLDEST", selected: false },
    ],
    ...rest,
  };
}

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/* ---- the render harness ---- */

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

const qAll = (sel: string): HTMLElement[] =>
  host ? ([...host.querySelectorAll(sel)] as unknown as HTMLElement[]) : [];

async function renderPage() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<ChannelPage />);
  });
  await sleep(40);
}

async function clickToVideosTab() {
  await act(async () => {
    const videosTab = qAll('[role="tab"]').find((b) => b.textContent === "Videos");
    (videosTab as HTMLElement).click();
  });
  await sleep(20);
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
  host = null;
  setUpstream(null);
});

beforeEach(() => {
  routeHandle = "@mind_warehouse";
  win.localStorage.clear();
  fetchLog.length = 0;
  studioResponse = { session: false, channel: null };
  fetchHandler = () => new Response("{}", { status: 200 });
});

afterAll(() => {
  mock.module("next/navigation", () => realNavigation);
  mock.module("@/hooks/use-webflix-session", () => realSessionHook);
  globalThis.fetch = realFetch;
});

/* ------------------------------------------------------------------ */
/* 1. the doubled-@ handle fix — the FULL upstream → route → mapper →   */
/*    page → DOM chain                                                  */
/* ------------------------------------------------------------------ */

describe("the channel page header handle (WFX2-P6-CH — the bare-handle law)", () => {
  /** Serve the real route against fixture bytes whose upstream header
   * carries the given (doubled-@) handle form. */
  function serveRouteWithUpstreamHandle(upstreamHandle: string) {
    clearCache();
    const channel = leanChannelWithHandle(upstreamHandle);
    const htmlFor = (data: unknown) =>
      `<!doctype html><html><head></head><body><script>var ytInitialData = ${JSON.stringify(
        data
      )};</script></body></html>`;
    setUpstream(async (url: string) => {
      if (url.includes("/youtubei/v1/browse")) return jsonResponse(channel);
      if (url.includes("youtube.com/@")) {
        return new Response(htmlFor(channel), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    fetchHandler = (u) =>
      channelRoute(new Request(new URL(u, "http://localhost").toString()), {
        params: Promise.resolve({ handle: routeHandle }),
      });
  }

  test("upstream handle \"@/mind_warehouse\" renders exactly \"@mind_warehouse\"", async () => {
    serveRouteWithUpstreamHandle("@/mind_warehouse");
    await renderPage();
    // the metadata line: handle · subscribers · videos — the handle carries
    // exactly ONE leading "@" and no "/"
    const meta = qAll("p").find((p) => p.textContent?.includes("subscribers"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("@mind_warehouse · 4.55M subscribers · 437 videos");
    expect(host!.textContent).not.toContain("@/@mind_warehouse");
    expect(host!.textContent).not.toContain("@//mind_warehouse");
  });

  test("upstream handle \"@mind_warehouse\" (the plain leading-@ form) renders exactly \"@mind_warehouse\" too", async () => {
    serveRouteWithUpstreamHandle("@mind_warehouse");
    await renderPage();
    const meta = qAll("p").find((p) => p.textContent?.includes("subscribers"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("@mind_warehouse · 4.55M subscribers · 437 videos");
    expect(host!.textContent).not.toContain("@/@mind_warehouse");
  });
});

/* ------------------------------------------------------------------ */
/* 2. the Videos tab's sort chips                                       */
/* ------------------------------------------------------------------ */

describe("the Videos tab's sort chips (WFX2-P6-CH)", () => {
  test("chips present: the row renders, Latest marked; clicking a chip refetches via its own token, the grid swaps, the selected chip re-marks — no chip-list refetch", async () => {
    let chipReads = 0;
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=videos&chip=T_POPULAR")) {
        chipReads++;
        return jsonResponse({
          tab: "videos",
          videos: [makeVideo("v-popular-1", "Popular sorted video one")],
          sortChips: [
            { label: "Latest", token: "T_LATEST", selected: false },
            { label: "Popular", token: "T_POPULAR", selected: true },
            { label: "Oldest", token: "T_OLDEST", selected: false },
          ],
        });
      }
      return jsonResponse(pageDto());
    };
    await renderPage();
    await clickToVideosTab();

    // the chip row: three chips, the payload's own marker (Latest) selected
    const chipBar = q('[role="group"][aria-label="Sort videos"]');
    expect(chipBar).not.toBeNull();
    const chips = [...chipBar!.querySelectorAll("button")] as unknown as HTMLElement[];
    expect(chips.map((c) => c.textContent)).toEqual(["Latest", "Popular", "Oldest"]);
    const latestBtn = chips.find((c) => c.textContent === "Latest")!;
    const popularBtn = chips.find((c) => c.textContent === "Popular")!;
    expect(latestBtn.getAttribute("aria-pressed")).toBe("true");
    expect(popularBtn.getAttribute("aria-pressed")).toBe("false");
    // the default grid serves
    expect(host!.textContent).toContain("Latest default video one");

    // click Popular → refetch via the chip's own continuation token
    const fetchesBefore = fetchLog.length;
    await act(async () => {
      popularBtn.click();
    });
    await sleep(40);
    // exactly ONE new fetch — the chip read (the chip list itself is never
    // refetched per click; only the grid data changes)
    expect(fetchLog.length).toBe(fetchesBefore + 1);
    expect(fetchLog[fetchLog.length - 1]).toContain("/tab?tab=videos&chip=T_POPULAR");
    expect(chipReads).toBe(1);
    // the grid swapped to the sorted videos
    expect(host!.textContent).toContain("Popular sorted video one");
    expect(host!.textContent).not.toContain("Latest default video one");
    // the response re-marked the selected chip
    expect(popularBtn.getAttribute("aria-pressed")).toBe("true");
    expect(latestBtn.getAttribute("aria-pressed")).toBe("false");
  });

  test("chips absent: NO chip row (honest omission — never fabricated Latest/Popular/Oldest)", async () => {
    const dto = pageDto();
    delete dto.sortChips;
    fetchHandler = () => jsonResponse(dto);
    await renderPage();
    await clickToVideosTab();
    expect(q('[role="group"][aria-label="Sort videos"]')).toBeNull();
    expect(host!.textContent).toContain("Latest default video one");
  });

  test("a walled chip read → the honest unavailable note (never a fake grid)", async () => {
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=videos&chip=T_POPULAR")) {
        return jsonResponse({ tab: "videos", walled: true });
      }
      return jsonResponse(pageDto());
    };
    await renderPage();
    await clickToVideosTab();
    const chipBar = q('[role="group"][aria-label="Sort videos"]');
    expect(chipBar).not.toBeNull();
    const popularBtn = ([...chipBar!.querySelectorAll("button")] as unknown as HTMLElement[]).find(
      (c) => c.textContent === "Popular"
    )!;
    await act(async () => {
      popularBtn.click();
    });
    await sleep(40);
    // the chip row stays; the honest walled note replaces the grid
    expect(q('[role="group"][aria-label="Sort videos"]')).not.toBeNull();
    const note = q('[role="status"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("unavailable from this egress");
    expect(host!.textContent).not.toContain("Latest default video one");
  });
});

/* ------------------------------------------------------------------ */
/* 3. the header composition vs youtube.com                            */
/* ------------------------------------------------------------------ */

describe("the channel header composition (WFX2-P6-CH)", () => {
  test("name + verified badge, @handle, subscriber text + video count on one line, description + …more into the About tab", async () => {
    let aboutReads = 0;
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=about")) {
        aboutReads++;
        return jsonResponse({
          tab: "about",
          about: {
            description: "The full channel description.",
            joinedDateText: "Joined Mar 3, 2011",
            viewCountText: "1,234,567,890 views",
            subscriberCountText: "1.23M subscribers",
            videoCountText: "437 videos",
            country: "United States",
            links: [],
          },
        });
      }
      return jsonResponse(pageDto());
    };
    await renderPage();

    // name + the verified badge the DTO carries
    expect(q("h1")?.textContent).toContain("Mind Warehouse");
    expect(q('[role="img"][aria-label="Verified"]')).not.toBeNull();
    // the metadata line: @handle · subscribers · videos (one line)
    const meta = qAll("p").find((p) => p.textContent?.includes("subscribers"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("@mind_warehouse · 1.23M subscribers · 437 videos");
    // the truncated description snippet
    expect(host!.textContent).toContain("The best facts, visualized.");

    // …more opens the About tab (the real tab-route fetch)
    const more = q('button[aria-label="More about Mind Warehouse"]');
    expect(more).not.toBeNull();
    await act(async () => {
      more!.click();
    });
    await sleep(40);
    expect(aboutReads).toBe(1);
    expect(fetchLog.some((u) => u.includes("/tab?tab=about"))).toBe(true);
    // the About panel serves (the tab switched)
    expect(host!.textContent).toContain("The full channel description.");
    expect(host!.textContent).toContain("Mar 3, 2011"); // the Joined dd value
  });

  test("composed page without subscriber data: no subscriber segment, no fabricated counts (typed-absent)", async () => {
    const dto = pageDto({
      channel: {
        composed: true,
        subscriberCount: 0,
        subscriberCountText: null,
        description: null,
        verified: false,
        videoCount: 7,
      },
      videos: [makeVideo("v-comp-1", "Composed video one")],
      tabs: ["videos"], // composed pages offer only the tabs they can fill
      sortChips: undefined,
    });
    fetchHandler = () => jsonResponse(dto);
    await renderPage();

    // the metadata line: @handle · 7 videos — NO subscriber segment (the
    // honest omission, never a fake "0 subscribers")
    const meta = qAll("p").find((p) => p.textContent?.includes("videos"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("@mind_warehouse · 7 videos");
    expect(host!.textContent).not.toContain("0 subscribers");
    // no description row and no …more affordance (no About tab, no snippet)
    expect(q('button[aria-label="More about Mind Warehouse"]')).toBeNull();
    expect(host!.textContent).not.toContain("The best facts, visualized.");
    // no verified badge in the HEADER (the composed DTO carries none — the
    // video cards' own channel badges are their own data)
    expect(q("h1")?.querySelector('[role="img"][aria-label="Verified"]') ?? null).toBeNull();
  });

  test("the composed page's watch-enriched subscriber text DOES show (real data, no longer hidden)", async () => {
    const dto = pageDto({
      channel: {
        composed: true,
        subscriberCount: 4_550_000,
        subscriberCountText: "4.55M subscribers",
      },
    });
    fetchHandler = () => jsonResponse(dto);
    await renderPage();
    const meta = qAll("p").find((p) => p.textContent?.includes("subscribers"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("@mind_warehouse · 4.55M subscribers · 437 videos");
  });

  test("a UC… id handle (the no-@handle fallback) renders as the id — never a fabricated @handle", async () => {
    const dto = pageDto({
      channel: { handle: "UCuAXFkgsw1L7xaCfnd5JJOw", description: null },
    });
    fetchHandler = () => jsonResponse(dto);
    await renderPage();
    const meta = qAll("p").find((p) => p.textContent?.includes("subscribers"));
    expect(meta).toBeDefined();
    expect(meta!.textContent).toBe("UCuAXFkgsw1L7xaCfnd5JJOw · 1.23M subscribers · 437 videos");
  });
});

/* ------------------------------------------------------------------ */
/* 4. WFX2-P7-CH — the Membership tab                                  */
/* ------------------------------------------------------------------ */

describe("the Membership tab (WFX2-P7-CH)", () => {
  async function clickToMembershipTab() {
    await act(async () => {
      const membershipTab = qAll('[role="tab"]').find((b) => b.textContent === "Membership");
      (membershipTab as HTMLElement).click();
    });
    await sleep(40);
  }

  test("joinable channel + tiers: the tab renders, the real tier cards serve (title, priceText, perk rows split on newlines/commas)", async () => {
    let membershipReads = 0;
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=membership")) {
        membershipReads++;
        return jsonResponse({
          tab: "membership",
          joinable: true,
          membership: {
            joinable: true,
            tiers: [
              {
                title: "Fan",
                priceText: "$4.99/month",
                perksText: "Loyalty badges\nCustom emojis\nMembers-only videos",
              },
              {
                title: "VIP",
                priceText: "$9.99/month",
                perksText: "Everything in Fan, Early access, VIP badge",
              },
              { title: "Studio Backer", priceText: "$0.99/month", perksText: null },
            ],
            signinRequired: false,
            note: null,
          },
        });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    // the Membership tab button renders (the own tab list carries it + joinable)
    const membershipTab = qAll('[role="tab"]').find((b) => b.textContent === "Membership");
    expect(membershipTab).toBeDefined();
    await clickToMembershipTab();
    // the lazy tab fetch happened exactly once (the tab route's membership branch)
    expect(membershipReads).toBe(1);
    expect(fetchLog.some((u) => u.includes("/tab?tab=membership"))).toBe(true);
    // the "Join this channel" header line
    expect(host!.textContent).toContain("Join this channel");
    // the tier cards: title + priceText (the channel's own tier order)
    expect(host!.textContent).toContain("Fan");
    expect(host!.textContent).toContain("$4.99/month");
    expect(host!.textContent).toContain("VIP");
    expect(host!.textContent).toContain("$9.99/month");
    // the perks split into rows — newlines AND commas
    const perks = qAll("li").map((li) => li.textContent);
    expect(perks).toContain("Loyalty badges");
    expect(perks).toContain("Custom emojis");
    expect(perks).toContain("Members-only videos");
    expect(perks).toContain("Everything in Fan");
    expect(perks).toContain("Early access");
    expect(perks).toContain("VIP badge");
    // null perksText → NO perk rows for that tier (honest empty) — the tier itself still renders
    expect(host!.textContent).toContain("Studio Backer");
    const studioPerks = qAll("li").filter((li) => li.closest("div")?.textContent?.includes("Studio Backer"));
    expect(studioPerks).toHaveLength(0);
  });

  test("NOT rendered when the channel isn't joinable (own list carries it, no Join renderer) — honest absence", async () => {
    fetchHandler = () =>
      jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: false }));
    await renderPage();
    expect(qAll('[role="tab"]').map((b) => b.textContent)).not.toContain("Membership");
    expect(fetchLog.some((u) => u.includes("/tab?tab=membership"))).toBe(false);
  });

  test("NOT rendered when the own tab list doesn't carry it (even joinable) — honest absence", async () => {
    fetchHandler = () => jsonResponse(pageDto({ joinable: true }));
    await renderPage();
    expect(qAll('[role="tab"]').map((b) => b.textContent)).not.toContain("Membership");
    expect(fetchLog.some((u) => u.includes("/tab?tab=membership"))).toBe(false);
  });

  test("session absent → the tab renders YouTube's logged-out copy + the sign-in affordance (no fabricated tiers)", async () => {
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=membership")) {
        return jsonResponse({
          tab: "membership",
          joinable: true,
          membership: {
            joinable: true,
            tiers: null,
            signinRequired: true,
            note: "Sign in to become a member.",
          },
        });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    await clickToMembershipTab();
    expect(host!.textContent).toContain("Sign in to become a member.");
    // the sign-in affordance (the sheet's own /account pattern)
    const signin = qAll("a").find((a) => a.getAttribute("href") === "/account");
    expect(signin).toBeDefined();
    expect(signin!.textContent).toBe("Sign in");
    // NEVER a fabricated tier or price
    expect(host!.textContent).not.toContain("$");
  });

  test("tiers unreadable from the session → the honest note line (never a fabricated tier)", async () => {
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=membership")) {
        return jsonResponse({
          tab: "membership",
          joinable: true,
          membership: {
            joinable: true,
            tiers: null,
            signinRequired: false,
            note: "Membership tiers are not readable from this session right now.",
          },
        });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    await clickToMembershipTab();
    expect(host!.textContent).toContain(
      "Membership tiers are not readable from this session right now."
    );
    expect(host!.textContent).not.toContain("$");
  });

  test("a walled membership read → the tab family's standard honest degrade (never a fake grid)", async () => {
    fetchHandler = (u) => {
      if (u.includes("/tab?tab=membership")) {
        return jsonResponse({ tab: "membership", walled: true });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    await clickToMembershipTab();
    const note = q('[role="status"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("unavailable from this egress");
    expect(host!.textContent).not.toContain("Join this channel");
  });
});

/* ------------------------------------------------------------------ */
/* 5. WFX2-P7-CH — the Join sheet's per-tier CTA (the href law)        */
/* ------------------------------------------------------------------ */

describe("the Join sheet's per-tier CTA (WFX2-P7-CH)", () => {
  test("each tier card carries a 'Join on YouTube' CTA — BARE-handle href, _blank, noopener noreferrer — + the honest checkout note; the fake in-app Join is gone", async () => {
    fetchHandler = (u) => {
      if (u.includes("/join")) {
        return jsonResponse({
          joinable: true,
          tiers: [
            { title: "Fan", priceText: "$4.99/month", perksText: "Loyalty badges, Custom emojis" },
            { title: "VIP", priceText: "$9.99/month", perksText: null },
          ],
          signinRequired: false,
          note: null,
        });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    // the header's Join button opens the sheet
    const joinBtn = q('button[aria-label="Join Mind Warehouse"]');
    expect(joinBtn).not.toBeNull();
    await act(async () => {
      joinBtn!.click();
    });
    await sleep(40);
    // the join surface fetched exactly once
    expect(fetchLog.filter((u) => u.includes("/join"))).toHaveLength(1);
    // radix portals the sheet into document.body — assert against the document
    // the per-tier CTAs: the BARE handle in the URL, external target, noopener
    const ctas = Array.from(
      win.document.querySelectorAll('a[href="https://www.youtube.com/mind_warehouse/join"]')
    ) as unknown as HTMLAnchorElement[];
    expect(ctas).toHaveLength(2); // one per tier card
    for (const cta of ctas) {
      expect(cta.getAttribute("target")).toBe("_blank");
      expect(cta.getAttribute("rel")).toBe("noopener noreferrer");
      expect(cta.textContent).toContain("Join on YouTube");
    }
    // never the doubled-@ form in the href
    expect(win.document.body.innerHTML).not.toContain("@mind_warehouse/join");
    // the one-line honest explainer
    expect(win.document.body.textContent).toContain(
      "Checkout and payment happen on YouTube"
    );
    // the fake in-app Join button (the old /account stand-in) is GONE
    expect(Array.from(win.document.querySelectorAll('a[href="/account"]'))).toHaveLength(0);
  });

  test("tiers null (signinRequired) → the sheet's existing honest state stays byte-identical (copy + sign-in affordance, NO CTA)", async () => {
    fetchHandler = (u) => {
      if (u.includes("/join")) {
        return jsonResponse({
          joinable: true,
          tiers: null,
          signinRequired: true,
          note: "Sign in to become a member.",
        });
      }
      return jsonResponse(pageDto({ tabs: ["home", "videos", "membership"], joinable: true }));
    };
    await renderPage();
    const joinBtn = q('button[aria-label="Join Mind Warehouse"]');
    await act(async () => {
      joinBtn!.click();
    });
    await sleep(40);
    const body = win.document.body.textContent ?? "";
    expect(body).toContain("Sign in to become a member.");
    expect(body).toContain("single-tenant live mode");
    const signin = Array.from(win.document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/account"
    );
    expect(signin).toBeDefined();
    expect(signin!.textContent).toBe("Sign in");
    // NO Join-on-YouTube CTA on a tierless honest state
    expect(
      Array.from(win.document.querySelectorAll('a[href^="https://www.youtube.com/"]'))
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* P14-YOU — the own-channel affordances (Customize channel / Manage)  */
/* ------------------------------------------------------------------ */

describe("the own-channel affordances (P14-YOU)", () => {
  test("the operator's OWN channel: Customize channel + Manage videos replace Subscribe/Join (live 2026 order)", async () => {
    // the studio seam resolves the operator's channel = the viewed channel
    studioResponse = {
      session: true,
      channel: { id: "UC-mind-warehouse", handle: "@mind_warehouse", name: "Mind Warehouse" },
    };
    fetchHandler = () => jsonResponse(pageDto({}));
    await renderPage();
    const buttons = win.document.querySelectorAll("button, a");
    const labels = Array.from(buttons).map((b) => (b.textContent ?? "").trim());
    expect(labels).toContain("Customize channel");
    expect(labels).toContain("Manage videos");
    expect(labels.some((l) => /^Subscribe/.test(l))).toBe(false);
    expect(labels.some((l) => l === "Join")).toBe(false);
  });

  test("every OTHER channel keeps Subscribe (the seam resolves a different channel)", async () => {
    studioResponse = {
      session: true,
      channel: { id: "UC-someone-else", handle: "@someone_else", name: "Someone Else" },
    };
    fetchHandler = () => jsonResponse(pageDto({}));
    await renderPage();
    const buttons = win.document.querySelectorAll("button, a");
    const labels = Array.from(buttons).map((b) => (b.textContent ?? "").trim());
    expect(labels).toContain("Subscribe");
    expect(labels).not.toContain("Customize channel");
    expect(labels).not.toContain("Manage videos");
  });
});
