/// <reference types="bun-types" />
/**
 * P22-B view-state tests — the personal-surface states at the UI seam
 * (happy-dom + createRoot/act, the you-hub idiom). Fixtures only: global
 * fetch is stubbed per-test; the session hook, next/navigation (with a
 * mutable useParams for the /playlist/[id] route) and sonner are mocked via
 * mock.module (file-scoped by --isolate, restored in afterAll).
 *
 * The laws pinned here (WFX2-P36 re-point):
 *   - the special lists (WL/LL) on /playlist/[id]: guests get the honest
 *     gate ask; signed-in viewers get the HONEST SpecialListNotice — the
 *     three operator-session special notes (unavailable / no-session /
 *     empty) are RETIRED with the operator-session read itself (neither
 *     list has an official per-user read API, and the pre-P36 read served
 *     the OPERATOR's list to every signed-in user — the cross-user leak the
 *     P36 work order closes);
 *   - the special-list ROWS (and their ⋯ Action menus / reorder / remove
 *     seams) are retired with the read: the notice owns the page, Watch
 *     later hands off to the WebFlix-local save button; public playlists
 *     keep the reorder affordance exactly as before;
 *   - the details dialog carries the route's notice envelope for the
 *     special lists (the handoff copy), never the retired state notes;
 *   - the sidebar You section = youtube.com's guide order (Your channel,
 *     History, Playlists, Your videos, Watch later, Liked videos, Downloads)
 *     with "Your channel" honestly hidden when the seam unresolved;
 *   - the Downloads page is the honest no-tier state (no fake rows, no
 *     fake buttons).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM (the auth-ui/you-hub setup) ----
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

// ---- the mutable session + route-param state the mocked hooks serve ----
type SessionState = {
  status: "loading" | "authenticated" | "unauthenticated";
  user?: Record<string, unknown> | null;
};
let sessionState: SessionState = { status: "authenticated", user: null };
let routeParams: Record<string, string> = {};

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
  usePathname: () => "/",
  useParams: () => routeParams,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

// ---- the fetch stub (per-test programmable) ----
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
const fetchLog: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
  fetchLog.push({ url: u, method, body });
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

const PlaylistPage = (await import("@/app/playlist/[id]/page")).default;
const { PlaylistDetailsDialog } = await import("@/app/playlists/view");
const DownloadsView = (await import("@/app/downloads/view")).default;
const { SidebarNav, SidebarRail } = await import("@/components/app/sidebar");
const { Topbar } = await import("@/components/app/topbar");

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

function makeSpecialPage(
  id: "WL" | "LL",
  videos: ReturnType<typeof makeVideo>[],
  flags: { unavailable?: boolean; loginRequired?: boolean } = {}
) {
  return {
    playlist: {
      id,
      title: id === "WL" ? "Watch later" : "Liked videos",
      channelName: "You",
      videoCountText: videos.length > 0 ? `${videos.length} videos` : null,
      viewsText: null,
      description: null,
    },
    videos,
    nextCursor: null,
    special: true,
    loginRequired: flags.loginRequired ?? false,
    unavailable: flags.unavailable ?? false,
  };
}

/** The REAL special-list envelope /api/playlist/[id] answers for WL/LL
 * (WFX2-P36): playlist:null + the honest per-user notice — never the
 * operator's rows, never a fabricated read. */
function makeSpecialNotice() {
  return {
    playlist: null,
    videos: [],
    nextCursor: null,
    loginRequired: false,
    unavailable: false,
    special: true,
    notice:
      "YouTube's Watch Later / Liked lists have no official API — your WebFlix Watch later lives in the save button (local), and YouTube's own page has the rest",
  };
}

function makeDialogPlaylist(id: string, title: string) {
  return {
    id,
    title,
    visibility: "private" as const,
    isWatchLater: id === "WL",
    createdAt: "2026-09-01T00:00:00Z",
    videoCount: 5,
    coverUrl: null,
    videos: [],
  };
}

// ---- render helpers (the auth-ui idiom) ----

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const docAll = (sel: string): HTMLElement[] =>
  Array.from(win.document.querySelectorAll(sel) as unknown as HTMLElement[]);

async function render(el: React.ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
}

beforeEach(() => {
  toasts.length = 0;
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  sessionState = { status: "authenticated", user: { id: "u1", displayName: "Op" } };
  routeParams = {};
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

afterAll(() => {
  mock.module("@/hooks/use-webflix-session", () => realSessionHook);
  mock.module("next/navigation", () => realNavigation);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("PlaylistPage — the special lists (WL) on the playlist page route", () => {
  test("guest → the honest gate ask (surface playlists), redirect back to /playlist/WL, no data fetch", async () => {
    sessionState = { status: "unauthenticated", user: null };
    routeParams = { id: "WL" };
    await render(<PlaylistPage />);
    const body = win.document.body.textContent ?? "";
    expect(body).toContain("Sign in to see your playlists on WebFlix");
    expect(docAll("a").find((a) => (a.textContent ?? "").trim() === "Sign in")?.getAttribute("href")).toBe(
      "/signin?redirect=%2Fplaylist%2FWL"
    );
    // children never mount → the seam is never called
    expect(fetchLog.filter((f) => f.url.includes("/api/playlist/WL"))).toHaveLength(0);
  });

  test("signed-in + WL → the honest SpecialListNotice (never the operator's rows, never a login ask)", async () => {
    routeParams = { id: "WL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) return Response.json(makeSpecialNotice());
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    const note = q("[data-testid='playlist-special-notice']");
    expect(note).not.toBeNull();
    expect(note!.getAttribute("role")).toBe("status");
    expect(note!.textContent).toContain("Watch later lives outside WebFlix's reach");
    expect(note!.textContent).toContain(
      "no official API — your WebFlix Watch later lives in the save button (local)"
    );
    // the two handoffs: browse home + YouTube's own page
    expect(q("[data-testid='playlist-special-find']")?.getAttribute("href")).toBe("/");
    const ytLink = all("a").find((a) => (a.textContent ?? "").trim() === "Open watch later on YouTube");
    expect(ytLink).toBeDefined();
    expect(ytLink!.getAttribute("href")).toBe("https://www.youtube.com/feed/playlists");
    // never a login ask for a signed-in viewer, and the three retired
    // operator-session special notes are gone
    expect(note!.textContent).not.toMatch(/sign in/i);
    expect(q("[data-testid='playlist-special-unavailable']")).toBeNull();
    expect(q("[data-testid='playlist-special-no-session']")).toBeNull();
    expect(q("[data-testid='playlist-special-empty']")).toBeNull();
    // the two-column layout (title/meta/rows) is GONE — the notice owns the page
    expect(q("[data-testid='playlist-title']")).toBeNull();
    expect(q("[data-testid='playlist-meta']")).toBeNull();
  });

  test("LL variant → the notice names the liked list; the handoff opens YouTube's liked feed", async () => {
    routeParams = { id: "LL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/LL")) return Response.json(makeSpecialNotice());
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    const note = q("[data-testid='playlist-special-notice']");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("Liked videos lives outside WebFlix's reach");
    const ytLink = all("a").find((a) => (a.textContent ?? "").trim() === "Open liked videos on YouTube");
    expect(ytLink).toBeDefined();
    expect(ytLink!.getAttribute("href")).toBe("https://www.youtube.com/feed/liked");
  });

  test("WFX2-P37 — a WL payload (the route's LOCAL list) renders the user's OWN rows: the two-column layout, the remove affordances, the local disclosure — and the operator-browse seam never fires", async () => {
    routeParams = { id: "WL" };
    // the P37 route's shape: the local list payload with local:true. The
    // page renders it (the local list is the user's own saves — the route
    // structurally never serves the operator's rows: the server-side pins
    // in personal-routes.test.ts prove ZERO browse calls for WL).
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) {
        return Response.json({
          ...makeSpecialPage("WL", [makeVideo("v1", "Saved one"), makeVideo("v2", "Saved two")]),
          local: true,
        });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    // the user's own rows render (the local list — the P37 discoverability
    // cure: the pre-P37 page hid the user's saves behind an explainer);
    // 4 row links (thumbnail + title × 2) + the Play-all link
    expect(all("a[href^='/watch/']")).toHaveLength(5);
    expect(win.document.body.textContent ?? "").toContain("Saved one");
    expect(win.document.body.textContent ?? "").toContain("Saved two");
    expect(q("[data-testid='playlist-title']")?.textContent).toBe("Watch later");
    expect(q("[data-testid='playlist-wl-local-note']")?.textContent).toContain(
      "Saved on WebFlix"
    );
    // each row carries the ⋯ Action menu (the remove affordance) — and the
    // special lists stay reorder-retired (no Move up/down anywhere)
    expect(all("[aria-label^='Actions for']")).toHaveLength(2);
    expect(win.document.body.textContent ?? "").not.toContain("Move up");
    expect(win.document.body.textContent ?? "").not.toContain("Move down");
    // nothing fires without a user click (the remove write seam is wired to
    // the row menu, not to any render path)
    expect(fetchLog.filter((f) => f.method !== "GET")).toHaveLength(0);
  });

  test("a public (non-special) playlist keeps the ⋯ reorder affordance", async () => {
    routeParams = { id: "PLx" };
    const videos = [makeVideo("v1", "Public one"), makeVideo("v2", "Public two")];
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/PLx")) {
        return Response.json({
          playlist: {
            id: "PLx",
            title: "Roadtrip",
            channelName: "Chan One",
            videoCountText: "2 videos",
            viewsText: "10K views",
            description: null,
          },
          videos,
          nextCursor: null,
        });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    expect(all("[aria-label^='Actions for']").length).toBe(2);
    // and no special-state notes on a public playlist
    expect(q("[data-testid='playlist-special-unavailable']")).toBeNull();
    expect(q("[data-testid='playlist-special-no-session']")).toBeNull();
    expect(q("[data-testid='playlist-special-empty']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("PlaylistDetailsDialog — the P22-B state split (the WL row in /playlists)", () => {
  // radix Dialog portals to document.body — the document-level query helpers
  const docq = (sel: string): HTMLElement | null =>
    (win.document.querySelector(sel) as unknown as HTMLElement | null) ?? null;

  function renderDialog(playlist: ReturnType<typeof makeDialogPlaylist>) {
    return render(
      <PlaylistDetailsDialog
        playlist={playlist}
        onClose={() => {}}
        onDelete={() => {}}
        onUpdated={() => {}}
      />
    );
  }

  test("WL row → the route's honest notice envelope in the dialog (the handoff copy; never a state note)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/playlists/WL")) {
        // the REAL special envelope /api/playlists/[id] answers for WL/LL
        return Response.json({
          playlist: null,
          videos: [],
          nextCursor: null,
          loginRequired: false,
          unavailable: false,
          special: true,
          notice:
            "YouTube's Watch Later / Liked lists have no official API — your WebFlix Watch later lives in the save button (local), and YouTube's own page has the rest",
        });
      }
      return Response.json({}, { status: 200 });
    };
    await renderDialog(makeDialogPlaylist("WL", "Watch later"));
    await act(async () => {});
    const notice = docq("[data-testid='dialog-notice']");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain(
      "YouTube's Watch Later / Liked lists have no official API"
    );
    expect(notice!.textContent).toContain(
      "your WebFlix Watch later lives in the save button (local)"
    );
    // the retired P22-B state notes never ride the special envelope (the
    // notice preempts them), and no rows render to reorder or remove
    expect(docq("[data-testid='dialog-unavailable']")).toBeNull();
    expect(docq("[data-testid='dialog-no-session']")).toBeNull();
    expect(win.document.body.textContent ?? "").not.toContain("Move up");
    expect(win.document.body.textContent ?? "").not.toContain("Remove from Watch later");
  });

  test("served + empty (a created list) → the honest empty line, no state notes", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/playlists/PLx")) {
        return Response.json({
          playlist: makeDialogPlaylist("PLx", "Roadtrip"),
          videos: [],
          nextCursor: null,
          loginRequired: false,
          unavailable: false,
          special: false,
        });
      }
      return Response.json({}, { status: 200 });
    };
    await renderDialog(makeDialogPlaylist("PLx", "Roadtrip"));
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("Empty playlist");
    expect(docq("[data-testid='dialog-unavailable']")).toBeNull();
    expect(docq("[data-testid='dialog-no-session']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("DownloadsView — the honest no-tier state (P22-B)", () => {
  test("guest → the honest gate ask (signing in does NOT unlock downloads)", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<DownloadsView />);
    const body = win.document.body.textContent ?? "";
    expect(body).toContain("Sign in to open the Downloads page");
    expect(body).toContain("WebFlix has no offline downloads");
  });

  test("signed-in → the honest no-tier page: no fake rows, no fake buttons, the browse-home link", async () => {
    await render(<DownloadsView />);
    await act(async () => {});
    const section = q("[data-testid='downloads-empty']");
    expect(section).not.toBeNull();
    expect(q("[data-testid='downloads-headline']")?.textContent).toBe(
      "No downloads — WebFlix streams online only"
    );
    expect(q("[data-testid='downloads-body']")?.textContent ?? "").toContain(
      "a YouTube Premium feature"
    );
    // nothing fabricated: zero buttons inside the honest state
    expect(section!.querySelectorAll("button")).toHaveLength(0);
    // the honest forward: browse the home feed
    expect(all("a[href='/']").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("SidebarNav + SidebarRail — the You section at youtube.com's guide parity (P22-B)", () => {
  function serveMe(ownedChannel: { handle: string; name: string } | null) {
    fetchHandler = (url) => {
      if (url.includes("/api/me")) {
        return Response.json({
          user: {
            id: "u1",
            handle: "you",
            name: "The Operator",
            avatarUrl: "https://x/a.jpg",
            description: null,
          },
          ownedChannel,
          subscriptions: [],
        });
      }
      return Response.json({}, { status: 200 });
    };
  }

  test("the resolved seam → the full guide order: Your channel, History, Playlists, Your videos, Watch later, Liked videos, Downloads", async () => {
    serveMe({ handle: "@opchan", name: "Operator Channel" });
    await render(<SidebarNav onNavigate={() => {}} />);
    await act(async () => {});
    // the You section rows, in youtube.com's guide order (measured 2026-10-11)
    const links = all("nav a");
    const labels = links.map((a) => (a.textContent ?? "").trim());
    const youStart = labels.indexOf("Your channel");
    expect(youStart).toBeGreaterThan(-1);
    expect(labels.slice(youStart, youStart + 7)).toEqual([
      "Your channel",
      "History",
      "Playlists",
      "Your videos",
      "Watch later",
      "Liked videos",
      "Downloads",
    ]);
    // the P22-B targets
    const yourChannel = links.find((a) => (a.textContent ?? "").trim() === "Your channel");
    expect(yourChannel?.getAttribute("href")).toBe("/channel/@opchan");
    const yourVideos = links.find((a) => (a.textContent ?? "").trim() === "Your videos");
    expect(yourVideos?.getAttribute("href")).toBe("/studio");
    const watchLater = links.find((a) => (a.textContent ?? "").trim() === "Watch later");
    expect(watchLater?.getAttribute("href")).toBe("/playlist/WL");
    const downloads = links.find((a) => (a.textContent ?? "").trim() === "Downloads");
    expect(downloads?.getAttribute("href")).toBe("/downloads");
    // Creator Studio moved OUT of the guide (creator tools live in the
    // account menu + the /you rail — youtube.com carries no studio row)
    expect(labels).not.toContain("Creator Studio");
    expect(labels).not.toContain("Studio");
  });

  test("the unresolved seam → \"Your channel\" honestly hidden; the rest of the guide intact", async () => {
    serveMe(null);
    await render(<SidebarNav onNavigate={() => {}} />);
    await act(async () => {});
    const labels = all("nav a").map((a) => (a.textContent ?? "").trim());
    expect(labels).not.toContain("Your channel");
    expect(labels).toContain("History");
    expect(labels).toContain("Playlists");
    expect(labels).toContain("Your videos");
    expect(labels).toContain("Watch later");
    expect(labels).toContain("Liked videos");
    expect(labels).toContain("Downloads");
  });

  test("the collapsed rail carries the same additions (Your channel + Watch later + Downloads, no Studio)", async () => {
    serveMe({ handle: "@opchan", name: "Operator Channel" });
    await render(<SidebarRail />);
    await act(async () => {});
    const labels = all("nav a").map((a) => (a.textContent ?? "").trim());
    expect(labels).toContain("Your channel");
    expect(labels).toContain("Watch later");
    expect(labels).toContain("Downloads");
    expect(labels).not.toContain("Studio");
    const watchLater = all("nav a").find((a) => (a.textContent ?? "").trim() === "Watch later");
    expect(watchLater?.getAttribute("href")).toBe("/playlist/WL");
    const downloads = all("nav a").find((a) => (a.textContent ?? "").trim() === "Downloads");
    expect(downloads?.getAttribute("href")).toBe("/downloads");
  });

  // REA-3 — the station pack's guide ladder (measured logged-in
  // youtube.com 2026-10-17): Home, Shorts, Subscriptions, You, History, …
  // P42-NETFLIX-SOURCE deviation (ADR 0002 §6, deliberate): the second
  // source's hub rides the main rung AFTER Subscriptions — youtube-parity
  // PLUS the Netflix destination, never replacing a youtube row.
  // P58-TIKTOK-SOURCE deviation (ADR 0004, same class): the third source's
  // hub rides right after Netflix.
  test("the guide ladder at the pack's order: Home, Shorts, Subscriptions, Netflix(P42), TikTok(P58), You(→ /you) — Trending never rides the main rung", async () => {
    serveMe(null);
    await render(<SidebarNav onNavigate={() => {}} />);
    await act(async () => {});
    const links = all("nav a");
    const labels = links.map((a) => (a.textContent ?? "").trim());
    // the main rung: exactly Home, Shorts, Subscriptions, Netflix, TikTok
    // (the pack's ladder + the two source rows; Trending stays in Explore —
    // youtube.com's own placement)
    expect(labels.slice(0, 6)).toEqual(["Home", "Shorts", "Subscriptions", "Netflix", "TikTok", "You"]);
    const netflixRow = links.find((a) => (a.textContent ?? "").trim() === "Netflix");
    expect(netflixRow?.getAttribute("href")).toBe("/netflix");
    const tiktokRow = links.find((a) => (a.textContent ?? "").trim() === "TikTok");
    expect(tiktokRow?.getAttribute("href")).toBe("/tiktok");
    const youRow = links.find((a) => (a.textContent ?? "").trim() === "You");
    expect(youRow?.getAttribute("href")).toBe("/you");
    // the You family follows directly (the pack: You, History, Playlists, …)
    const youIdx = labels.indexOf("You");
    expect(labels.slice(youIdx + 1, youIdx + 4)).toEqual(["History", "Playlists", "Your videos"]);
    // Trending rides the Explore section only, exactly once in the guide
    const trending = links.filter((a) => (a.textContent ?? "").trim() === "Trending");
    expect(trending).toHaveLength(1);
    expect(trending[0].getAttribute("href")).toBe("/trending");
    const exploreIdx = labels.indexOf("Explore");
    expect(exploreIdx).toBeGreaterThan(-1);
    expect(labels.indexOf("Trending")).toBe(exploreIdx - 1); // the section's first rung
    expect(labels.indexOf("Trending")).toBeGreaterThan(labels.indexOf("Subscriptions"));
  });

  test("the collapsed rail mirrors the You family (You + Your videos included) and drops the topbar-only extras", async () => {
    serveMe(null);
    await render(<SidebarRail />);
    await act(async () => {});
    const links = all("nav a");
    const labels = links.map((a) => (a.textContent ?? "").trim());
    // P42+P58: the collapsed rail mirrors the extended main rung (Netflix and
    // TikTok both ride)
    expect(labels.slice(0, 6)).toEqual(["Home", "Shorts", "Subscriptions", "Netflix", "TikTok", "You"]);
    const youRow = links.find((a) => (a.textContent ?? "").trim() === "You");
    expect(youRow?.getAttribute("href")).toBe("/you");
    expect(labels).toContain("Your videos");
    const yourVideos = links.find((a) => (a.textContent ?? "").trim() === "Your videos");
    expect(yourVideos?.getAttribute("href")).toBe("/studio");
    expect(labels).not.toContain("Trending"); // the rail keeps the main+You family only
  });
});

describe("Topbar — youtube.com's topbar family (REA-3, station pack 2026-10-17)", () => {
  test("the right rail is Create + Notifications + Account (no Trending flame — that lives in the guide's Explore section)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/me")) {
        return Response.json({ user: null, ownedChannel: null, subscriptions: [] });
      }
      return Response.json({}, { status: 200 });
    };
    await render(<Topbar />);
    await act(async () => {});
    // youtube.com's measured family: Search, voice, Create, Notifications, Account
    expect(q('button[aria-label="Search"]')).not.toBeNull();
    expect(q('button[aria-label="Search with your voice"]')).not.toBeNull();
    expect(q('button[aria-label="Create"]')).not.toBeNull();
    expect(all('button[aria-label^="Notifications"]').length).toBeGreaterThan(0);
    expect(all('button[aria-label="Your account"], a[aria-label="Your account"]').length).toBeGreaterThan(0);
    // the Trending flame NEVER rode youtube.com's topbar
    expect(all('a[aria-label="Trending"]').length).toBe(0);
    expect(all('button[title="Trending"]').length).toBe(0);
    expect(win.document.body.textContent ?? "").not.toContain("Trending");
  });
});

// ---------------------------------------------------------------------------
// REA-3 F2 — the history page at youtube.com's parity (station pack,
// logged-in 2026-10-17): the TAB family + the watched-shorts shelves.
// ---------------------------------------------------------------------------

const HistoryView = (await import("@/app/history/view")).default;

function serveHistory(groups: { label: string; items: ReturnType<typeof makeVideo>[] }[]) {
  fetchHandler = (url) => {
    if (url.includes("/api/history")) {
      return Response.json({
        groups,
        nextCursor: null,
        loginRequired: false,
        watchHistoryPaused: false,
        searchHistoryPaused: null,
        total: groups.reduce((n, g) => n + g.items.length, 0),
        session: true,
      });
    }
    return Response.json({}, { status: 200 });
  };
}

describe("HistoryView — REA-3 F2: the tab family + the watched-shorts shelves", () => {
  const groups = () => [
    {
      label: "Today",
      items: [
        makeVideo("v1", "Long-form video one"),
        { ...makeVideo("s1", "Watched short one"), isShort: true },
        { ...makeVideo("s2", "Watched short two"), isShort: true },
      ],
    },
    { label: "Yesterday", items: [makeVideo("v2", "Long-form video two")] },
  ];

  test("the tab strip renders the honest subset (All / Shorts / Videos; Music/Podcasts never guessed)", async () => {
    serveHistory(groups());
    await render(<HistoryView />);
    await act(async () => {});
    const tabs = all('[data-testid="history-tabs"] [role="tab"]');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["All", "Shorts", "Videos"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    // youtube.com's Music/Podcasts need a server-side genre seam — honestly absent
    expect(win.document.body.textContent ?? "").not.toContain("Podcasts");
  });

  test("All (default): day groups render rows + the inline shorts shelf (9:16 tiles, /watch links)", async () => {
    serveHistory(groups());
    await render(<HistoryView />);
    await act(async () => {});
    // the day's rows render
    expect(all('a[aria-label="Watch Long-form video one"]').length).toBeGreaterThan(0);
    // the shorts shelf renders within the day (the group starts with a row → shelf after)
    const shelf = q('[data-testid="history-shorts-shelf"]');
    expect(shelf).not.toBeNull();
    const tileLinks = shelf ? Array.from(shelf.querySelectorAll("a")) : [];
    expect(tileLinks.map((a) => a.getAttribute("href"))).toEqual(["/watch/s1", "/watch/s2"]);
    // per-tile ⋯ remove affordance (the same Action-menu family as rows)
    expect(shelf!.querySelectorAll('button[aria-label^="Actions for"]').length).toBe(2);
  });

  test("Shorts tab: only the shorts render (shelf tiles, no long-form rows)", async () => {
    serveHistory(groups());
    await render(<HistoryView />);
    await act(async () => {});
    const shortsTab = all('[data-testid="history-tabs"] [role="tab"]').find(
      (t) => t.textContent?.trim() === "Shorts",
    )!;
    await act(async () => {
      shortsTab.click();
    });
    expect(all('a[aria-label="Watch Long-form video one"]').length).toBe(0);
    expect(all('a[aria-label="Watch Long-form video two"]').length).toBe(0);
    const shelf = q('[data-testid="history-shorts-shelf"]');
    expect(shelf).not.toBeNull();
    expect(shelf!.querySelectorAll("a").length).toBe(2);
    // the "Yesterday" group (no shorts) collapses away honestly
    expect(win.document.body.textContent ?? "").not.toContain("Yesterday");
  });

  test("Videos tab: only long-form rows render; the honest per-tab empty when a tab has nothing", async () => {
    serveHistory(groups());
    await render(<HistoryView />);
    await act(async () => {});
    const videosTab = all('[data-testid="history-tabs"] [role="tab"]').find(
      (t) => t.textContent?.trim() === "Videos",
    )!;
    await act(async () => {
      videosTab.click();
    });
    expect(all('a[aria-label="Watch Long-form video one"]').length).toBeGreaterThan(0);
    expect(q('[data-testid="history-shorts-shelf"]')).toBeNull();
    // now a history with NO shorts → the Shorts tab's honest empty
    serveHistory([{ label: "Today", items: [makeVideo("v1", "Long-form video one")] }]);
    await render(<HistoryView />);
    await act(async () => {});
    const shortsTab = all('[data-testid="history-tabs"] [role="tab"]').find(
      (t) => t.textContent?.trim() === "Shorts",
    )!;
    await act(async () => {
      shortsTab.click();
    });
    expect(win.document.body.textContent ?? "").toContain("No Shorts in your watch history");
    expect(q('[data-testid="history-shorts-shelf"]')).toBeNull();
  });

  test("the search box stays scoped to the active tab (youtube.com searches within the tab)", async () => {
    serveHistory(groups());
    await render(<HistoryView />);
    await act(async () => {});
    const shortsTab = all('[data-testid="history-tabs"] [role="tab"]').find(
      (t) => t.textContent?.trim() === "Shorts",
    )!;
    await act(async () => {
      shortsTab.click();
    });
    const input = q('input[aria-label="Search watch history"]') as HTMLInputElement;
    // the house typeInto idiom (help-center): focusin → native set → keyup —
    // React's value tracker + change plugin pick the committed value up
    await act(async () => {
      input.dispatchEvent(new Event("focusin", { bubbles: true }));
    });
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    desc?.set?.call(input, "short two");
    await act(async () => {
      input.dispatchEvent(new Event("keyup", { bubbles: true }));
    });
    const shelf = q('[data-testid="history-shorts-shelf"]');
    expect(shelf).not.toBeNull();
    expect(shelf!.querySelectorAll("a").length).toBe(1);
    expect(shelf!.querySelector('a[href="/watch/s2"]')).not.toBeNull();
    expect(shelf!.querySelector('a[href="/watch/s1"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REA-3 F3 — WFX2-P36 re-point: the special-list row Action menu is RETIRED
// with the special-list rows themselves. The pre-P36 surface rode the
// operator-session WL/LL read (one person's rows served to every signed-in
// user) and wrote through seams whose rows no longer render; the page now
// hands Watch later to the WebFlix-local save button (the video-card /
// watch-page seams) and the rest to YouTube's own pages — the SpecialListNotice
// owns /playlist/WL and /playlist/LL. These pins prove the retired surface
// is gone at the UI seam: no rows, no ⋯ menus, and the write seams
// (/api/playlists/watch-later, /api/videos/[id]/like action:"none") are
// never dispatched from the special-list pages even when a legacy-shaped
// payload would still serve rows.
// ---------------------------------------------------------------------------

describe("REA-3 F3 — the special-list row Action menu is retired with the operator-session read", () => {
  function serveSpecial(id: "WL" | "LL") {
    const videos = [makeVideo("v1", "Saved one"), makeVideo("v2", "Saved two"), makeVideo("v3", "Saved three")];
    fetchHandler = (url) => {
      if (url.includes(`/api/playlist/${id}`)) return Response.json(makeSpecialPage(id, videos));
      return Response.json({}, { status: 200 });
    };
  }

  test("WL: the local rows render with their remove affordance — the WL write seam rides the row menu (the P37 local list)", async () => {
    routeParams = { id: "WL" };
    serveSpecial("WL");
    await render(<PlaylistPage />);
    await act(async () => {});
    // the local list's rows render — the ⋯ Action menus exist for them
    expect(all("[aria-label^='Actions for']")).toHaveLength(3);
    // the special lists stay reorder-retired: no Move up/down items
    expect(win.document.body.textContent ?? "").not.toContain("Move up");
    expect(win.document.body.textContent ?? "").not.toContain("Move down");
    // no writes fire without a user click — the remove seam is menu-wired
    expect(fetchLog.filter((f) => f.url.includes("/api/playlists/watch-later"))).toHaveLength(0);
    expect(fetchLog.filter((f) => f.method !== "GET")).toHaveLength(0);
  });

  test("LL: the remove-rating like write is never dispatched — the notice owns the page", async () => {
    routeParams = { id: "LL" };
    serveSpecial("LL");
    await render(<PlaylistPage />);
    await act(async () => {});
    expect(all("[aria-label^='Actions for']")).toHaveLength(0);
    const body = win.document.body.textContent ?? "";
    expect(body).not.toContain("Remove from Liked videos");
    expect(body).not.toContain("Remove from Watch later");
    // the honest notice names the liked list
    expect(q("[data-testid='playlist-special-notice']")?.textContent).toContain(
      "Liked videos lives outside WebFlix's reach"
    );
    // the like write seam (the pre-P36 remove-rating ride) never fires here
    expect(fetchLog.filter((f) => f.url.includes("/like"))).toHaveLength(0);
    expect(fetchLog.filter((f) => f.method !== "GET")).toHaveLength(0);
    // no success/error toasts either — no write was attempted
    expect(toasts).toHaveLength(0);
  });
});
