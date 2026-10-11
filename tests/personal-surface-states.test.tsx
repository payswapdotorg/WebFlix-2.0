/// <reference types="bun-types" />
/**
 * P22-B view-state tests — the personal-surface states at the UI seam
 * (happy-dom + createRoot/act, the you-hub idiom). Fixtures only: global
 * fetch is stubbed per-test; the session hook, next/navigation (with a
 * mutable useParams for the /playlist/[id] route) and sonner are mocked via
 * mock.module (file-scoped by --isolate, restored in afterAll).
 *
 * The laws pinned here:
 *   - the special lists (WL/LL) on /playlist/[id]: guests get the honest
 *     gate ask; signed-in viewers NEVER get a login ask — `unavailable`
 *     (session configured, read not served) and `loginRequired` (no
 *     session) are two different states and the page says which one it is;
 *   - the reorder ⋯ menu is never offered for the special lists (the route
 *     honestly 400s — YouTube's own lists);
 *   - the sidebar You section = youtube.com's guide order (Your channel,
 *     History, Playlists, Your videos, Watch later, Liked videos, Downloads)
 *     with "Your channel" honestly hidden when the seam unresolved;
 *   - the Downloads page is the honest no-tier state (no fake rows, no
 *     fake buttons);
 *   - the details dialog carries the same unavailable/no-session split.
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

  test("signed-in + unavailable (session configured, read not served) → the honest unavailable note, never a login ask", async () => {
    routeParams = { id: "WL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) return Response.json(makeSpecialPage("WL", [], { unavailable: true }));
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    const note = q("[data-testid='playlist-special-unavailable']");
    expect(note).not.toBeNull();
    expect(note!.textContent ?? "").toContain("didn't return your watch later list");
    expect(note!.textContent ?? "").toContain("Open it on youtube.com to check");
    // never a login ask inside the note
    expect(note!.textContent ?? "").not.toMatch(/sign in/i);
    // the header still carries the honest identity of the list
    expect(q("[data-testid='playlist-title']")?.textContent).toBe("Watch later");
    expect(q("[data-testid='playlist-meta']")?.textContent).toContain("You");
    // no empty-claim while unavailable
    expect(q("[data-testid='playlist-special-empty']")).toBeNull();
  });

  test("signed-in + loginRequired (no YT session) → the honest no-session note (the WebFlix sign-in is fine)", async () => {
    routeParams = { id: "WL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) return Response.json(makeSpecialPage("WL", [], { loginRequired: true }));
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    const note = q("[data-testid='playlist-special-no-session']");
    expect(note).not.toBeNull();
    expect(note!.textContent ?? "").toContain("No YouTube session is connected to this deployment yet");
    expect(note!.textContent ?? "").toContain("your WebFlix sign-in is fine");
    expect(note!.textContent ?? "").not.toMatch(/sign in to /i);
    expect(q("[data-testid='playlist-special-unavailable']")).toBeNull();
  });

  test("served + empty → the honest empty state (the read came back; the list is empty)", async () => {
    routeParams = { id: "WL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) return Response.json(makeSpecialPage("WL", []));
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    expect(q("[data-testid='playlist-special-empty']")?.textContent ?? "").toContain(
      "No videos in Watch later yet"
    );
    expect(q("[data-testid='playlist-special-unavailable']")).toBeNull();
    expect(q("[data-testid='playlist-special-no-session']")).toBeNull();
  });

  test("served with videos → the grid + Play all + the You owner row; the reorder ⋯ menu is NEVER offered", async () => {
    routeParams = { id: "WL" };
    const videos = [makeVideo("v1", "Saved one"), makeVideo("v2", "Saved two"), makeVideo("v3", "Saved three")];
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/WL")) return Response.json(makeSpecialPage("WL", videos));
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    expect(q("[data-testid='playlist-meta']")?.textContent).toContain("You");
    expect(q("[data-testid='playlist-meta']")?.textContent).toContain("3 videos");
    expect(all("a[href^='/watch/']").length).toBeGreaterThanOrEqual(3);
    const playAll = all("a").find((a) => /Play all/.test(a.textContent ?? ""));
    expect(playAll).toBeDefined();
    expect(playAll!.getAttribute("href")).toBe("/watch/v1");
    // the special lists cannot be reordered — no ⋯ affordance anywhere
    expect(all("[aria-label^='Actions for']")).toHaveLength(0);
    expect(win.document.body.textContent ?? "").not.toContain("Move up");
  });

  test("LL variant: the unavailable note names the liked list; the title falls back honestly", async () => {
    routeParams = { id: "LL" };
    fetchHandler = (url) => {
      if (url.includes("/api/playlist/LL")) return Response.json(makeSpecialPage("LL", [], { unavailable: true }));
      return Response.json({}, { status: 200 });
    };
    await render(<PlaylistPage />);
    await act(async () => {});
    expect(q("[data-testid='playlist-special-unavailable']")?.textContent ?? "").toContain(
      "didn't return your liked videos list"
    );
    expect(q("[data-testid='playlist-title']")?.textContent).toBe("Liked videos");
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

  test("unavailable → the honest unavailable note (never a login ask)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/playlists/WL")) {
        return Response.json({
          playlist: null,
          videos: [],
          nextCursor: null,
          loginRequired: false,
          unavailable: true,
          special: true,
        });
      }
      return Response.json({}, { status: 200 });
    };
    await renderDialog(makeDialogPlaylist("WL", "Watch later"));
    await act(async () => {});
    expect(docq("[data-testid='dialog-unavailable']")?.textContent ?? "").toContain(
      "didn't return this list"
    );
    expect(docq("[data-testid='dialog-no-session']")).toBeNull();
  });

  test("loginRequired (no YT session) → the honest no-session note", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/playlists/WL")) {
        return Response.json({
          playlist: null,
          videos: [],
          nextCursor: null,
          loginRequired: true,
          unavailable: false,
          special: true,
        });
      }
      return Response.json({}, { status: 200 });
    };
    await renderDialog(makeDialogPlaylist("WL", "Watch later"));
    await act(async () => {});
    expect(docq("[data-testid='dialog-no-session']")?.textContent ?? "").toContain(
      "no YouTube session is connected right now"
    );
    expect(docq("[data-testid='dialog-unavailable']")).toBeNull();
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
});
