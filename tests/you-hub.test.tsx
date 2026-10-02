/// <reference types="bun-types" />
/**
 * WFX2-P5-YA tests — the You hub / account-menu depth / keyboard-shortcuts
 * battery (happy-dom + createRoot/act, the auth-ui test pattern). The session
 * hook, next/navigation, sonner and the auth client are mocked via
 * mock.module (file-scoped by --isolate, restored in afterAll); global fetch
 * is stubbed per-test so every /you section renders against the REAL payload
 * shapes of the existing seams (/api/history, /api/playlists, /api/studio).
 *
 * The final describe enforces the honesty law: every shortcut the overlay
 * documents must literally be wired in src/components/watch/video-player.tsx.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import type {
  YouHistoryPayload,
  YouPlaylistsPayload,
  YouStudioPayload,
} from "@/app/you/sections";

// ---- happy-dom as the global DOM (the auth-ui setup) ----
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
let sessionState: SessionState = { status: "unauthenticated", user: null };

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

// the auth client: real signInHref/safeRedirect, spied sign-out
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realAuthClient = { ...require("@/lib/auth/client") } as Record<string, unknown>;
const signOutSpy = mock(async () => {});
mock.module("@/lib/auth/client", () => ({
  ...realAuthClient,
  signOutFromWebFlix: signOutSpy,
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

const YouView = (await import("@/app/you/view")).default;
const { AccountMenu, SessionAvatar } = await import("@/components/app/account-menu");
const {
  KeyboardShortcutsMount,
  openKeyboardShortcuts,
  OPEN_KEYBOARD_SHORTCUTS_EVENT,
  PLAYER_SHORTCUTS,
} = await import("@/components/app/keyboard-shortcuts");
const PurchasesView = (await import("@/app/account/purchases/view")).default;
const YourDataView = (await import("@/app/account/data/view")).default;

// ---- fixtures (the REAL payload shapes) ----

const AUTHED_USER = {
  id: "u1",
  email: "operator@webflix.test",
  displayName: "The Operator",
  avatarSeed: 12,
};

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

function makePlaylist(id: string, title: string, videoCount: number) {
  return {
    id,
    title,
    visibility: "private" as const,
    isWatchLater: id === "WL",
    createdAt: "2026-09-01T00:00:00Z",
    videoCount,
    coverUrl: id === "PLx" ? "https://x/c.jpg" : null,
    videos: [],
  };
}

const STUDIO_CHANNEL = {
  id: "UCop",
  handle: "@operator",
  name: "Operator Channel",
  avatarUrl: "https://x/a.jpg",
  bannerUrl: null,
  description: null,
  verified: false,
  subscriberCount: 10,
  subscriberCountText: "10 subscribers",
  videoCountText: "2 videos",
  links: [],
};

function makeStudioVideo(id: string, title: string) {
  return {
    id,
    title,
    thumbnailUrl: "https://x/u.jpg",
    durationSec: 90,
    views: 42,
    viewsText: "42 views",
    publishedText: "2 days ago",
    createdAt: "2026-09-28T00:00:00Z",
    isShort: false,
    isLive: false,
    likes: null,
    commentCount: null,
  };
}

function makeStudio(videos: ReturnType<typeof makeStudioVideo>[], channel: typeof STUDIO_CHANNEL | null): YouStudioPayload {
  return {
    session: channel !== null,
    loginRequired: channel === null,
    channel,
    videos,
    totals: {
      subscribers: 0,
      subscriberCountText: null,
      videoCount: videos.length,
      views: 0,
      likes: 0,
      comments: 0,
      enrichedCount: 0,
    },
    analytics: { mode: "no-session" as const, metrics: null, note: "no session" },
    deepLinks: {
      studioRoot: "https://studio.youtube.com",
      analytics: "https://studio.youtube.com",
      content: "https://studio.youtube.com",
      customization: "https://studio.youtube.com",
      upload: "https://www.youtube.com/upload",
    },
  };
}

// the per-test payloads the stubbed fetch serves
let historyPayload: YouHistoryPayload;
let playlistsPayload: YouPlaylistsPayload;
let studioPayload: YouStudioPayload;

function serveYouSeams() {
  fetchHandler = (url: string) => {
    if (url.includes("/api/history")) return Response.json(historyPayload);
    if (url.includes("/api/playlists")) return Response.json(playlistsPayload);
    if (url.includes("/api/studio")) return Response.json(studioPayload);
    return Response.json({}, { status: 200 });
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

async function openAccountMenu() {
  await render(<AccountMenu />);
  const trigger = win.document.querySelector(
    "[data-testid='account-avatar-button']"
  ) as unknown as HTMLButtonElement;
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
    );
  });
  await act(async () => {});
}

beforeEach(() => {
  toasts.length = 0;
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  sessionState = { status: "authenticated", user: AUTHED_USER };
  historyPayload = {
    groups: [],
    nextCursor: null,
    loginRequired: false,
    watchHistoryPaused: false,
    searchHistoryPaused: false,
    total: 0,
    session: true,
  };
  playlistsPayload = { playlists: [], loginRequired: false, session: true };
  studioPayload = makeStudio([], null);
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
  mock.module("@/lib/auth/client", () => realAuthClient);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("YouView — the guest gate (the AU law)", () => {
  test("guest → the PersonalSurfaceGate signed-out screen, no seam fetches", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<YouView />);
    expect(win.document.body.textContent ?? "").toContain("Sign in to manage your WebFlix identity");
    expect(win.document.body.textContent ?? "").toContain("Sign in");
    expect(q("[data-testid='you-profile-header']")).toBeNull();
    // children never render → the hub's seams are never called
    expect(fetchLog.filter((f) => f.url.includes("/api/history"))).toHaveLength(0);
    expect(fetchLog.filter((f) => f.url.includes("/api/playlists"))).toHaveLength(0);
  });

  test("the gate's sign-in link redirects back to /you", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<YouView />);
    const link = docAll("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin?redirect=%2Fyou");
  });
});

describe("YouView — the profile header (the WebFlix identity, real session data)", () => {
  test("avatar initial + display name + email from the session", async () => {
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(q("[data-testid='you-display-name']")?.textContent).toBe("The Operator");
    expect(q("[data-testid='you-profile-header']")?.textContent).toContain("operator@webflix.test");
    // the avatar renders the initial (the SessionAvatar law)
    const avatar = q("[data-testid='you-profile-header'] span");
    expect(avatar?.textContent?.trim()).toBe("T");
  });

  test("SessionAvatar keeps its contract (initial + avatarSeed hue)", async () => {
    await render(<SessionAvatar displayName="Zed" avatarSeed={200} />);
    expect(host!.textContent?.trim()).toBe("Z");
    expect(q("span")?.getAttribute("style")).toContain("hsl(200 65% 45%)");
  });
});

describe("YouView — History section (the real /api/history seam)", () => {
  test("real count + the recent strip from the read", async () => {
    historyPayload = {
      groups: [
        { label: "Today", items: [makeVideo("v1", "History one"), makeVideo("v2", "History two")] },
      ],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: false,
      searchHistoryPaused: false,
      total: 128,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(q("[data-testid='you-history-count']")?.textContent).toBe("128 videos watched");
    // the strip renders the real items as video cards linking /watch/<id>
    const watchLinks = q("[data-testid='you-history']") 
      ? all("a[href='/watch/v1']")
      : [];
    expect(watchLinks.length).toBeGreaterThan(0);
    expect(all("a[href='/watch/v2']").length).toBeGreaterThan(0);
    // View all → /history
    expect(all("a[href='/history']").length).toBeGreaterThan(0);
  });

  test("honest empty state — no fabricated count", async () => {
    historyPayload = {
      groups: [],
      nextCursor: null,
      loginRequired: false,
      watchHistoryPaused: false,
      searchHistoryPaused: false,
      total: 0,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("Videos you watch will show up here.");
    expect(q("[data-testid='you-history-count']")).toBeNull();
  });

  test("loginRequired (public operator mode) → the honest note, not the empty state", async () => {
    historyPayload = {
      groups: [],
      nextCursor: null,
      loginRequired: true,
      watchHistoryPaused: null,
      searchHistoryPaused: null,
      total: 0,
      session: false,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("connect the operator session");
    expect(win.document.body.textContent ?? "").not.toContain("Videos you watch will show up here.");
  });
});

describe("YouView — Playlists section (the real /api/playlists seam)", () => {
  test("created playlists render (WL and LL excluded — they have their own cards)", async () => {
    playlistsPayload = {
      playlists: [
        makePlaylist("WL", "Watch later", 7),
        makePlaylist("LL", "Liked videos", 3),
        makePlaylist("PLx", "Roadtrip", 12),
      ],
      loginRequired: false,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const cards = all("[data-testid='you-playlist-card']");
    expect(cards).toHaveLength(1); // only the created library
    expect(cards[0].textContent).toContain("Roadtrip");
    expect(cards[0].getAttribute("href")).toBe("/playlist/PLx");
    expect(cards[0].textContent).toContain("12");
    expect(all("a[href='/playlists']").length).toBeGreaterThan(0); // View all
  });

  test("honest empty state when no created playlists exist", async () => {
    playlistsPayload = {
      playlists: [makePlaylist("WL", "Watch later", 7)],
      loginRequired: false,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("Playlists you create will show up here.");
    expect(all("[data-testid='you-playlist-card']")).toHaveLength(0);
  });
});

describe("YouView — Your videos section (the real /api/studio seam)", () => {
  test("the operator channel's public uploads render as watch links", async () => {
    studioPayload = makeStudio(
      [makeStudioVideo("s1", "Upload one"), makeStudioVideo("s2", "Upload two")],
      STUDIO_CHANNEL
    );
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const cards = all("[data-testid='you-upload-card']");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("href")).toBe("/watch/s1");
    expect(cards[0].textContent).toContain("Upload one");
    expect(cards[0].textContent).toContain("42 views");
    // the manage link rides the real studio redirect route
    expect(all("a[href='/studio']").length).toBeGreaterThan(0);
  });

  test("honest degradation when the operator session is not connected", async () => {
    studioPayload = makeStudio([], null);
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain(
      "The operator YouTube session isn't connected"
    );
    expect(all("[data-testid='you-upload-card']")).toHaveLength(0);
    expect(all("a[href='/studio']").length).toBeGreaterThan(0);
  });

  test("honest empty when the channel is resolved but has no public uploads", async () => {
    studioPayload = makeStudio([], STUDIO_CHANNEL);
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("No public uploads on the operator channel");
  });
});

describe("YouView — Watch later + Liked cards (the special lists)", () => {
  test("Watch later links the WL playlist with the read's real count", async () => {
    playlistsPayload = {
      playlists: [makePlaylist("WL", "Watch later", 7)],
      loginRequired: false,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const wl = q("[data-testid='you-watch-later']");
    expect(wl?.getAttribute("href")).toBe("/playlist/WL");
    expect(wl?.textContent).toContain("7 videos");
  });

  test("Watch later stays honest (no count) when the read carries no WL entry", async () => {
    playlistsPayload = { playlists: [], loginRequired: false, session: true };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const wl = q("[data-testid='you-watch-later']");
    expect(wl?.getAttribute("href")).toBe("/playlist/WL");
    expect(wl?.textContent).toContain("Videos you save for later");
    expect(wl?.textContent).not.toMatch(/\d+ videos/);
  });

  test("Liked links /liked with the read's real count when LL is present", async () => {
    playlistsPayload = {
      playlists: [makePlaylist("LL", "Liked videos", 3)],
      loginRequired: false,
      session: true,
    };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const liked = q("[data-testid='you-liked']");
    expect(liked?.getAttribute("href")).toBe("/liked");
    expect(liked?.textContent).toContain("3 videos");
  });

  test("Liked stays honest (no count) when the read carries no LL entry", async () => {
    playlistsPayload = { playlists: [], loginRequired: false, session: true };
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    const liked = q("[data-testid='you-liked']");
    expect(liked?.getAttribute("href")).toBe("/liked");
    expect(liked?.textContent).toContain("Videos you like");
    expect(liked?.textContent).not.toMatch(/\d+ videos/);
  });
});

describe("YouView — the More from WebFlix rail", () => {
  test("Creator Studio (real link) + WebFlix Premium (href only — SS lane)", async () => {
    serveYouSeams();
    await render(<YouView />);
    await act(async () => {});
    expect(q("[data-testid='you-more-studio']")?.getAttribute("href")).toBe("/studio");
    expect(q("[data-testid='you-more-premium']")?.getAttribute("href")).toBe("/premium");
  });
});

// ---------------------------------------------------------------------------

describe("AccountMenu — the depth (youtube.com's items, honest)", () => {
  test("guest pill unchanged (the pre-P5 behavior)", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<AccountMenu />);
    const link = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin");
  });

  test("the deepened item list renders with the preserved items", async () => {
    await openAccountMenu();
    const body = win.document.body.textContent ?? "";
    for (const label of [
      "Your account",
      "WebFlix Studio",
      "Purchases & memberships",
      "Your data in YouTube",
      "Appearance",
      "Language",
      "Restricted Mode",
      "Location",
      "Keyboard shortcuts",
      "Settings",
      "Sign out",
    ]) {
      expect(body).toContain(label);
    }
    // the identity label keeps the real session data
    expect(body).toContain("The Operator");
    expect(body).toContain("operator@webflix.test");
  });

  test("Your channel: the operator session's REAL handle (lazy /api/studio read)", async () => {
    studioPayload = makeStudio([], STUDIO_CHANNEL);
    serveYouSeams();
    await openAccountMenu();
    await act(async () => {});
    const channelLink = docAll("a").find((a) => a.getAttribute("href") === "/channel/@operator");
    expect(channelLink).toBeDefined();
    expect(channelLink?.textContent).toContain("Your channel");
    // the lazy read happened exactly once, only because the menu opened
    const studioCalls = fetchLog.filter((f) => f.url.includes("/api/studio"));
    expect(studioCalls).toHaveLength(1);
  });

  test("Your channel is honestly hidden when the channel is unresolved", async () => {
    studioPayload = makeStudio([], null);
    serveYouSeams();
    await openAccountMenu();
    await act(async () => {});
    const body = win.document.body.textContent ?? "";
    expect(body).not.toContain("Your channel");
    expect(docAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("/channel/"))).toHaveLength(0);
  });

  test("the settings items deep-link to /settings (SS lane — href only)", async () => {
    await openAccountMenu();
    for (const label of ["Appearance", "Language", "Restricted Mode", "Location", "Settings"]) {
      const item = Array.from(win.document.querySelectorAll("[role='menuitem']")).find(
        (el) => (el.textContent ?? "").trim() === label
      );
      expect(item).toBeDefined();
      const href = item?.querySelector("a")?.getAttribute("href") ?? item?.getAttribute("href");
      expect(href).toBe("/settings");
    }
  });

  test("Purchases & memberships + Your data link the honest pages", async () => {
    await openAccountMenu();
    const purchases = docAll("a").find((a) => a.getAttribute("href") === "/account/purchases");
    const data = docAll("a").find((a) => a.getAttribute("href") === "/account/data");
    expect(purchases).toBeDefined();
    expect(purchases?.textContent).toContain("Purchases & memberships");
    expect(data).toBeDefined();
    expect(data?.textContent).toContain("Your data in YouTube");
  });

  test("Sign out is preserved (the stock sign-out route flow)", async () => {
    await openAccountMenu();
    const item = Array.from(win.document.querySelectorAll("[role='menuitem']")).find(
      (el) => (el.textContent ?? "").trim() === "Sign out"
    );
    expect(item).toBeDefined();
    await act(async () => {
      (item as unknown as HTMLElement).click();
    });
    await act(async () => {});
    expect(signOutSpy.mock.calls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("KeyboardShortcutsMount — the shift+/ overlay", () => {
  async function overlayIsOpen() {
    return docAll("[role='dialog']").length > 0;
  }

  test("opens on ? (shift+/) from any page; lists every documented row", async () => {
    await render(<KeyboardShortcutsMount />);
    expect(await overlayIsOpen()).toBe(false);
    await act(async () => {
      win.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "?", shiftKey: true, cancelable: true })
      );
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(true);
    const body = win.document.body.textContent ?? "";
    expect(body).toContain("Keyboard shortcuts");
    for (const shortcut of PLAYER_SHORTCUTS) {
      expect(body).toContain(shortcut.description);
    }
  });

  test("opens on the raw slash form with shift held", async () => {
    await render(<KeyboardShortcutsMount />);
    await act(async () => {
      win.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "/", shiftKey: true, cancelable: true })
      );
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(true);
  });

  test("Esc closes (radix dialog)", async () => {
    await render(<KeyboardShortcutsMount />);
    await act(async () => {
      win.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "?", shiftKey: true, cancelable: true })
      );
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(true);
    await act(async () => {
      win.document.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(false);
  });

  test("never hijacks typing — ? inside an input does not open it", async () => {
    serveYouSeams();
    await render(
      <>
        <input aria-label="editor" />
        <KeyboardShortcutsMount />
      </>
    );
    const input = q("input") as unknown as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "?",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      );
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(false);
  });

  test("openKeyboardShortcuts() (the menu bridge event) opens the overlay", async () => {
    await render(<KeyboardShortcutsMount />);
    await act(async () => {
      openKeyboardShortcuts();
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(true);
    expect(OPEN_KEYBOARD_SHORTCUTS_EVENT).toBe("webflix:open-keyboard-shortcuts");
  });

  test("the account-menu entry opens the overlay end-to-end", async () => {
    studioPayload = makeStudio([], null);
    serveYouSeams();
    await render(
      <>
        <AccountMenu />
        <KeyboardShortcutsMount />
      </>
    );
    const trigger = win.document.querySelector(
      "[data-testid='account-avatar-button']"
    ) as unknown as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
      );
    });
    await act(async () => {});
    const entry = Array.from(win.document.querySelectorAll("[role='menuitem']")).find(
      (el) => (el.textContent ?? "").trim() === "Keyboard shortcuts"
    );
    expect(entry).toBeDefined();
    await act(async () => {
      (entry as unknown as HTMLElement).click();
    });
    await act(async () => {});
    expect(await overlayIsOpen()).toBe(true);
  });
});

describe("the honesty law — documented shortcuts match the player's real wiring", () => {
  const playerSource = readFileSync("src/components/watch/video-player.tsx", "utf8");

  // the literal tokens video-player.tsx's keydown handler contains per key
  const KEY_TOKENS: Record<string, string[]> = {
    k: ['key === "k"'],
    Space: ['key === " "'],
    j: ['key === "j"'],
    l: ['key === "l"'],
    "←": ['e.key === "ArrowLeft"'],
    "→": ['e.key === "ArrowRight"'],
    "↑": ['e.key === "ArrowUp"'],
    "↓": ['e.key === "ArrowDown"'],
    m: ['key === "m"'],
    f: ['key === "f"'],
    t: ['key === "t"'],
    c: ['key === "c"'],
    "0–9": ["/^[0-9]$/"],
    Home: ['key === "home"'],
    End: ['key === "end"'],
    "<": ['e.key === "<"'],
    ">": [`e.key === ">"`],
  };

  const documentedKeys = PLAYER_SHORTCUTS.flatMap((shortcut) => shortcut.keys);

  test("the player source is readable, so the wiring can be verified", () => {
    expect(playerSource.length).toBeGreaterThan(1000);
    expect(playerSource).toContain("keyboard shortcuts");
  });

  for (const key of documentedKeys) {
    test(`the overlay's documented key “${key}” is really wired in the player`, () => {
      const tokens = KEY_TOKENS[key] ?? [];
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some((token) => playerSource.includes(token))).toBe(true);
    });
  }

  test("the documented list covers every distinct key once (no padding, no dupes)", () => {
    const unique = new Set(documentedKeys);
    expect(unique.size).toBe(documentedKeys.length);
  });
});

// ---------------------------------------------------------------------------

describe("the honest-degradation account pages", () => {
  test("purchases: guests get the gate's signed-out screen", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<PurchasesView />);
    expect(win.document.body.textContent ?? "").toContain("Sign in to manage your WebFlix identity");
  });

  test("purchases: honest copy instead of a fabricated list", async () => {
    await render(<PurchasesView />);
    await act(async () => {});
    expect(win.document.body.textContent ?? "").toContain("Purchases & memberships");
    expect(win.document.body.textContent ?? "").toContain("Nothing to show yet");
    expect(win.document.body.textContent ?? "").toContain("never a fabricated list");
    expect(all("a[href='/you']").length).toBeGreaterThan(0);
  });

  test("your data: guests get the gate's signed-out screen", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<YourDataView />);
    expect(win.document.body.textContent ?? "").toContain("Sign in to manage your WebFlix identity");
  });

  test("your data: links only the surfaces that really exist", async () => {
    await render(<YourDataView />);
    await act(async () => {});
    const hrefs = all("[data-testid='you-data-surface']").map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("/history");
    expect(hrefs).toContain("/playlists");
    expect(hrefs).toContain("/liked");
    expect(hrefs).toContain("/account");
    expect(win.document.body.textContent ?? "").toContain("isn't available on WebFlix yet");
  });
});
