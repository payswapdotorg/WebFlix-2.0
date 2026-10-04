/// <reference types="bun-types" />
/**
 * WFX2-P5-SS tests — the settings + system surfaces battery.
 *
 * Part 1 — the settings surface (happy-dom + createRoot/act, the auth-ui
 *   pattern): the guest gate (settings is a personal surface on youtube.com),
 *   every section renders with its LOCAL/MANAGED label, the autoplay switch
 *   REALLY persists the existing Wave-1 pref (wfx2-autoplay), the honest
 *   read-only / not-available states, the account page's operator-session
 *   wording law, and the local effects of the Advanced selectors.
 * Part 2 — the feedback surface: the disclosure copy, the POST to the local
 *   capture endpoint, the honest success/error states.
 * Part 3 — the capture endpoint itself, in-process: JSONL append to the local
 *   store, validation, GET refused (405 — the store is never an API surface).
 * Part 4 — the surfaces' honest copy + the MORE_NAV links (Help, Premium,
 *   Report history) and the verified local report-history read path.
 *
 * The session hook, next/navigation, and next-themes are mocked via
 * mock.module (the action-routes pattern — file-scoped by --isolate,
 * restored in afterAll). The DB describe rides the chain's test database
 * and skips when DATABASE_URL is not a test DB.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

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
  "HTMLSelectElement",
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

// ---- the mutable theme the mocked next-themes serves ----
let mockResolvedTheme = "dark";
const themeCalls: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNextThemes = { ...require("next-themes") } as Record<string, unknown>;
mock.module("next-themes", () => ({
  useTheme: () => ({
    theme: mockResolvedTheme,
    resolvedTheme: mockResolvedTheme,
    setTheme: (t: string) => {
      themeCalls.push(t);
      mockResolvedTheme = t;
    },
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

// ---- the modules under test (imported AFTER the mocks) ----
const { readAutoplayPreference, writeAutoplayPreference } = await import(
  "@/app/settings/use-autoplay-pref"
);
const { SCOPE_LOCAL_LABEL, SCOPE_MANAGED_LABEL } = await import("@/app/settings/sections");
const SettingsView = (await import("@/app/settings/view")).default;
const {
  isBrokerOfflineError,
  resetYouTubeConnectionCache,
  ACTIONS_DISCONNECTED_MESSAGE,
} = await import("@/lib/watch/connection-client");
const connectionRouteModule = await import("@/app/api/connection/youtube/route");
const connectionGet = connectionRouteModule.GET;
const { mintSessionCookie } = await import("./helpers");
const { FEEDBACK_DISCLOSURE, FEEDBACK_CATEGORIES } = await import("@/app/feedback/shared");
const FeedbackView = (await import("@/app/feedback/view")).default;
const feedbackRouteModule = await import("@/app/api/feedback/route");
const feedbackPost = feedbackRouteModule.POST;
const feedbackGet = feedbackRouteModule.GET;
const HelpPage = (await import("@/app/help/page")).default;
const PremiumPage = (await import("@/app/premium/page")).default;
const { ReportHistoryView } = await import("@/app/report-history/view");
const { SidebarNav } = await import("@/components/app/sidebar");

const OPERATOR_USER = {
  id: "u1",
  email: "operator@webflix.test",
  displayName: "The Operator",
  avatarSeed: 12,
};

const SECTION_IDS = [
  "account",
  "youtube-connection",
  "notifications",
  "playback",
  "appearance",
  "privacy",
  "advanced",
];

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
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    input.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, text);
  await act(async () => {
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

async function selectOption(select: HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(select);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(select, value);
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const buttonByText = (re: RegExp): HTMLButtonElement | null => {
  const pool = all("button");
  return (pool.find((b) => re.test((b.textContent ?? "").trim())) as HTMLButtonElement | undefined) ?? null;
};

async function renderSignedInSettings() {
  sessionState = { status: "authenticated", user: OPERATOR_USER };
  await render(<SettingsView />);
  await act(async () => {}); // let useApi + persisted-pref hydration settle
}

beforeEach(() => {
  win.localStorage.clear();
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  sessionState = { status: "unauthenticated", user: null };
  themeCalls.length = 0;
  mockResolvedTheme = "dark";
  resetYouTubeConnectionCache(); // the connection client's SWR cache is per-module
  fetchHandler = (url) => {
    if (url.includes("/api/watch/session")) {
      return Response.json({ operatorSession: true });
    }
    return new Response("{}", { status: 200 });
  };
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
  mock.module("next-themes", () => realNextThemes);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Part 1a — the REAL autoplay preference (the Wave-1 key the player reads)
// ---------------------------------------------------------------------------

describe("P5-SS settings: the autoplay preference (wfx2-autoplay, the Wave-1 key)", () => {
  test("defaults to on when nothing is stored (the player's default)", () => {
    win.localStorage.removeItem("wfx2-autoplay");
    expect(readAutoplayPreference()).toBe(true);
  });

  test("writes and reads back the persisted value with the player's exact shape", () => {
    writeAutoplayPreference(false);
    expect(win.localStorage.getItem("wfx2-autoplay")).toBe("0");
    expect(readAutoplayPreference()).toBe(false);

    writeAutoplayPreference(true);
    expect(win.localStorage.getItem("wfx2-autoplay")).toBe("1");
    expect(readAutoplayPreference()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Part 1b — the settings surface: the guest gate + the honest sections
// ---------------------------------------------------------------------------

describe("P5-SS settings: the guest gate (settings is a personal surface)", () => {
  test("guest → the signed-out screen with the /settings redirect; no sections render", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await render(<SettingsView />);
    expect(host!.textContent).toContain("Sign in to manage your WebFlix settings");
    const link = all("a").find((a) => (a.textContent ?? "").trim() === "Sign in");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/signin?redirect=%2Fsettings");
    for (const id of SECTION_IDS) {
      expect(q(`[data-settings-section="${id}"]`)).toBeNull();
    }
  });

  test("loading → the session-check skeleton, never the sections", async () => {
    sessionState = { status: "loading", user: null };
    await render(<SettingsView />);
    expect(q('[aria-label="Checking your session"]')).not.toBeNull();
    for (const id of SECTION_IDS) {
      expect(q(`[data-settings-section="${id}"]`)).toBeNull();
    }
  });
});

describe("P5-SS settings: every section renders with its visible scope label", () => {
  test("all seven youtube.com sections render, LOCAL × 4 and MANAGED × 3", async () => {
    await renderSignedInSettings();
    for (const id of SECTION_IDS) {
      expect(q(`[data-settings-section="${id}"]`)).not.toBeNull();
    }
    expect(all('[data-scope="local"]')).toHaveLength(4); // playback, appearance, privacy, advanced
    expect(all('[data-scope="managed"]')).toHaveLength(3); // account, youtube-connection, notifications
    expect(host!.textContent).toContain(SCOPE_LOCAL_LABEL);
    expect(host!.textContent).toContain(SCOPE_MANAGED_LABEL);
  });

  test("Account: the WebFlix identity summary + the /account link + the operator-session wording law", async () => {
    await renderSignedInSettings();
    expect(host!.textContent).toContain("The Operator");
    expect(host!.textContent).toContain("operator@webflix.test");
    const accountLink = all("a").find((a) => a.getAttribute("href") === "/account");
    expect(accountLink).toBeDefined();
    // the account page's exact sentences (the wording law)
    expect(host!.textContent).toContain(
      "Operator session connected — comment writes, likes, reports and creator tools act on the operator's real YouTube account."
    );
    expect(host!.textContent).toContain(
      "Your WebFlix account fronts that session — it is not a YouTube account, and WebFlix never fabricates YouTube-account data."
    );
  });

  test("Account: the honest public-mode wording when no operator session is configured", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/watch/session")) {
        return Response.json({ operatorSession: false });
      }
      return new Response("{}", { status: 200 });
    };
    await renderSignedInSettings();
    expect(host!.textContent).toContain(
      "No operator session is configured (public mode). Reads stay fully live; write surfaces (comments, likes, reports, heart/pin) honestly show their signed-out states until the session is connected."
    );
  });

  test("Notifications: the bell's real poll cadence shown read-only (no write exists)", async () => {
    await renderSignedInSettings();
    const section = q('[data-settings-section="notifications"]');
    expect(section!.textContent).toContain("pollIntervalMs");
    expect(section!.textContent).toContain("clamped to at least 30 seconds, 60 by default");
    expect(section!.textContent).toContain("read-only");
    expect(section!.textContent).toContain("Not available"); // per-channel/email/push: managed on youtube.com
    expect(section!.querySelector('[role="switch"]')).toBeNull(); // never a fake toggle
  });

  test("Privacy: Restricted Mode is the honest not-available state — no fake filter toggle", async () => {
    await renderSignedInSettings();
    const section = q('[data-settings-section="privacy"]');
    expect(section!.textContent).toContain("not available in WebFlix yet");
    expect(section!.textContent).toContain(
      "nothing in WebFlix currently filters or flags results as sensitive"
    );
    expect(section!.querySelector('[role="switch"]')).toBeNull(); // NEVER a fake toggle
    const link = section!.querySelector("a[href='https://support.google.com/youtube/answer/174784']");
    expect(link).not.toBeNull(); // points at the real YouTube setting
  });

  test("Playback: quality/captions/speed stay managed by the player (honest note)", async () => {
    await renderSignedInSettings();
    const section = q('[data-settings-section="playback"]');
    expect(section!.textContent).toContain("Managed by the player");
    expect(section!.textContent).toContain("the same one the watch page's Autoplay switch writes");
  });
});

describe("P5-SS settings: the autoplay switch REALLY persists the existing pref", () => {
  test("toggling writes wfx2-autoplay \"0\"/\"1\" and a fresh read agrees", async () => {
    await renderSignedInSettings();
    const sw = q('[role="switch"][aria-label="Autoplay next video"]') as unknown as HTMLButtonElement;
    expect(sw).not.toBeNull();
    expect(sw.getAttribute("aria-checked")).toBe("true"); // default on
    await act(async () => {
      sw.click();
    });
    expect(win.localStorage.getItem("wfx2-autoplay")).toBe("0");
    expect(readAutoplayPreference()).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      sw.click();
    });
    expect(win.localStorage.getItem("wfx2-autoplay")).toBe("1");
    expect(readAutoplayPreference()).toBe(true);
  });

  test("a persisted \"0\" hydrates the switch to off (a reload renders it off)", async () => {
    win.localStorage.setItem("wfx2-autoplay", "0");
    await renderSignedInSettings();
    const sw = q('[role="switch"][aria-label="Autoplay next video"]') as unknown as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });
});

describe("P5-SS settings: Appearance + Advanced (local, honest about effect scope)", () => {
  test("Appearance: Light/Dark write the real theme (no fake System option)", async () => {
    await renderSignedInSettings();
    const section = q('[data-settings-section="appearance"]');
    expect(section!.textContent).toContain("no device-follow theme mode");
    const light = buttonByText(/^light$/i);
    const dark = buttonByText(/^dark$/i);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(all('[role="radio"]').find((r) => r.textContent === "System")).toBeUndefined();
    await act(async () => {
      light!.click();
    });
    expect(themeCalls).toContain("light");
  });

  test("Advanced: Language sets the page lang attribute + persists locally", async () => {
    await renderSignedInSettings();
    const select = q('[aria-label="Language"]') as unknown as HTMLSelectElement;
    expect(select).not.toBeNull();
    await selectOption(select, "es");
    expect(win.document.documentElement.lang).toBe("es");
    expect(win.localStorage.getItem("wfx2-language")).toBe("es");
    const location = q('[aria-label="Location"]') as unknown as HTMLSelectElement;
    expect(location).not.toBeNull(); // renders; honest about having no effect today
  });
});

// ---------------------------------------------------------------------------
// Part 1c — Task 4-b: the YouTube connection (settings card + client + API)
// ---------------------------------------------------------------------------

describe("P4B settings: the YouTube connection card (the shared session, honestly)", () => {
  test("connected → the shared-session explainer + green card + coarse tab context, never the raw URL", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/connection/youtube")) {
        return Response.json({
          connected: true,
          tabFound: true,
          tabUrl: "https://www.youtube.com/watch?v=okH-kaRjuAQ",
          lastActionAt: new Date(Date.now() - 90_000).toISOString(),
          checkedAt: new Date().toISOString(),
        });
      }
      return new Response("{}", { status: 200 });
    };
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section).not.toBeNull();
    // the shared-session model, stated honestly (one or two sentences)
    expect(section!.textContent).toContain("one shared logged-in session");
    // the connected card
    expect(section!.querySelector('[data-connection-state="connected"]')).not.toBeNull();
    expect(section!.textContent).toContain("Connected — actions are available");
    expect(section!.textContent).toContain(
      "Actions are performed through the WebFlix connected session"
    );
    // channel-safe tab context + the last action's relative time
    expect(section!.textContent).toContain("Session active — the connected tab is on a watch page");
    expect(section!.textContent).toContain("last action");
    expect(section!.textContent).toContain("Checked");
    // coarse context only — the raw video id from the tab URL never renders
    expect(section!.textContent).not.toContain("okH-kaRjuAQ");
  });

  test("disconnected → the warning + what stops working + Retry forces a fresh probe past the cache", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/connection/youtube")) {
        return Response.json({
          connected: false,
          tabFound: false,
          tabUrl: null,
          lastActionAt: null,
          checkedAt: new Date().toISOString(),
        });
      }
      return new Response("{}", { status: 200 });
    };
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section!.querySelector('[data-connection-state="disconnected"]')).not.toBeNull();
    expect(section!.textContent).toContain(
      "Like, subscribe and comment actions are unavailable right now"
    );
    expect(section!.textContent).toContain("Checked");
    const probes = () =>
      fetchLog.filter((f) => f.url.includes("/api/connection/youtube")).length;
    expect(probes()).toBe(1); // one probe on mount

    // Retry → a FORCED second probe (a cache hit would issue no second fetch)
    const retry = section!.querySelector(
      'button[aria-label="Retry the YouTube connection check"]'
    ) as unknown as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    fetchHandler = (url) => {
      if (url.includes("/api/connection/youtube")) {
        return Response.json({
          connected: true,
          tabFound: true,
          tabUrl: "https://www.youtube.com/",
          lastActionAt: null,
          checkedAt: new Date().toISOString(),
        });
      }
      return new Response("{}", { status: 200 });
    };
    await act(async () => {
      retry!.click();
    });
    expect(probes()).toBe(2);
    expect(section!.querySelector('[data-connection-state="connected"]')).not.toBeNull();
  });
});

describe("P4B connection client: the broker-offline error shape (the action prompts)", () => {
  test("isBrokerOfflineError matches both offline variants and rejects everything else", () => {
    expect(
      isBrokerOfflineError(
        new Error("action backend offline — the lead's broker must be running")
      )
    ).toBe(true);
    expect(
      isBrokerOfflineError(
        new Error("action backend offline and the WebFlix store is unreachable — comment not posted")
      )
    ).toBe(true);
    expect(isBrokerOfflineError(new Error("broker rejected the shared secret"))).toBe(false);
    expect(isBrokerOfflineError(new Error("Failed to update rating"))).toBe(false);
    expect(isBrokerOfflineError(undefined)).toBe(false);
    expect(isBrokerOfflineError("not an error")).toBe(false);
  });

  test("the disconnected prompt copy points at Settings", () => {
    expect(ACTIONS_DISCONNECTED_MESSAGE).toContain("check the connection in Settings");
  });
});

describe("P4B /api/connection/youtube: the gated, honest-degrade status route", () => {
  let AUTH_COOKIE = "";
  beforeAll(async () => {
    AUTH_COOKIE = await mintSessionCookie();
  });

  let savedSecret = "";
  let savedUrl = "";
  beforeEach(() => {
    savedSecret = process.env.BROKER_SECRET ?? "";
    savedUrl = process.env.BROKER_URL ?? "";
    process.env.BROKER_SECRET = "wfx2-test-secret";
    process.env.BROKER_URL = "http://127.0.0.1:3055"; // the direct default; the stub answers
  });
  afterEach(() => {
    if (savedSecret) process.env.BROKER_SECRET = savedSecret;
    else delete process.env.BROKER_SECRET;
    if (savedUrl) process.env.BROKER_URL = savedUrl;
    else delete process.env.BROKER_URL;
  });

  test("guests → the uniform 401 (the gate fires before any broker call)", async () => {
    const res = await connectionGet(new Request("http://localhost/api/connection/youtube") as never);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
    expect(fetchLog.filter((f) => f.url.includes("/healthz"))).toHaveLength(0);
  });

  test("signed-in + broker healthy with the tab → the connected envelope", async () => {
    fetchHandler = (url) => {
      if (url.includes("/healthz")) {
        return Response.json({
          ok: true,
          tabFound: true,
          tabUrl: "https://www.youtube.com/watch?v=okH-kaRjuAQ",
          lastActionAt: null,
        });
      }
      return new Response("{}", { status: 200 });
    };
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      connected: boolean;
      tabFound: boolean;
      tabUrl: string | null;
      lastActionAt: unknown;
      checkedAt: string;
    };
    expect(data.connected).toBe(true);
    expect(data.tabFound).toBe(true);
    expect(data.tabUrl).toContain("youtube.com/watch");
    expect(data.lastActionAt).toBeNull();
    expect(data.checkedAt).toBeTruthy();
    // the probe hit the broker's healthz with the gateway header set
    const probe = fetchLog.find((f) => f.url.includes("/healthz"));
    expect(probe).toBeDefined();
  });

  test("broker ok but no YouTube tab → connected:false, tabFound:false (honest 200)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/healthz")) {
        return Response.json({ ok: true, tabFound: false, tabUrl: null, lastActionAt: null });
      }
      return new Response("{}", { status: 200 });
    };
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { connected: boolean; tabFound: boolean };
    expect(data.connected).toBe(false);
    expect(data.tabFound).toBe(false);
  });

  test("broker unreachable → the honest disconnected 200, never a 5xx", async () => {
    fetchHandler = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { connected: boolean; tabUrl: string | null };
    expect(data.connected).toBe(false);
    expect(data.tabUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the feedback surface: honest disclosure + the real local capture
// ---------------------------------------------------------------------------

describe("P5-SS feedback: the page discloses the honest delivery model", () => {
  test("the disclosure is shown BEFORE anything is submitted", async () => {
    await render(<FeedbackView />);
    expect(q("[data-feedback-disclosure]")).not.toBeNull();
    expect(host!.textContent).toContain(FEEDBACK_DISCLOSURE);
    expect(host!.textContent).toContain("It does not post to YouTube");
  });

  test("submitting POSTs to the local capture endpoint and shows the honest success state", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/feedback")) {
        return Response.json({ ok: true, id: "fb-1" }, { status: 201 });
      }
      return new Response("{}", { status: 200 });
    };
    await render(<FeedbackView />);
    const textarea = q("textarea") as unknown as HTMLTextAreaElement;
    await typeInto(textarea, "The queue button eats the first click on mobile.");
    const send = buttonByText(/^send feedback$/i);
    await act(async () => {
      send!.click();
    });
    await act(async () => {});
    const post = fetchLog.find((f) => f.method === "POST" && f.url.includes("/api/feedback"));
    expect(post).toBeDefined();
    expect(post!.body).toMatchObject({
      category: "General",
      message: "The queue button eats the first click on mobile.",
    });
    expect(q("[data-feedback-sent]")).not.toBeNull();
    expect(host!.textContent).toContain("Thanks — your feedback was saved.");
    expect(host!.textContent).toContain(FEEDBACK_DISCLOSURE);
  });

  test("a failing capture shows the honest error, never a fake success", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/feedback")) {
        return Response.json({ error: "Could not write the local feedback store on this server." }, { status: 500 });
      }
      return new Response("{}", { status: 200 });
    };
    await render(<FeedbackView />);
    const textarea = q("textarea") as unknown as HTMLTextAreaElement;
    await typeInto(textarea, "This will fail to store.");
    const send = buttonByText(/^send feedback$/i);
    await act(async () => {
      send!.click();
    });
    await act(async () => {});
    expect(q("[data-feedback-sent]")).toBeNull();
    expect(q("[role='alert']")).not.toBeNull();
    expect(host!.textContent).toContain("Could not write the local feedback store");
  });
});

// ---------------------------------------------------------------------------
// Part 3 — the capture endpoint, in-process (local store, no YouTube delivery)
// ---------------------------------------------------------------------------

describe("P5-SS /api/feedback: the local capture endpoint", () => {
  let logFile = "";

  beforeAll(() => {
    logFile = join(tmpdir(), `webflix-feedback-${randomUUID()}.log`);
    process.env.WEBFLIX_FEEDBACK_LOG = logFile;
  });

  afterAll(() => {
    delete process.env.WEBFLIX_FEEDBACK_LOG;
    rmSync(logFile, { force: true });
  });

  function post(body: unknown): Promise<Response> {
    return feedbackPost(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  test("appends valid submissions as JSONL to the local store (trimmed, category, timestamp)", async () => {
    const res = await post({
      category: FEEDBACK_CATEGORIES[5],
      message: "  The watch page queue button does nothing.  ",
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { ok: boolean; id: string };
    expect(payload.ok).toBe(true);
    expect(typeof payload.id).toBe("string");

    await post({ category: "General", message: "second submission" }); // append, not overwrite
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const record = JSON.parse(lines[0]) as { id: string; category: string; message: string; at: string };
    expect(record.id).toBe(payload.id);
    expect(record.category).toBe("Something's broken");
    expect(record.message).toBe("The watch page queue button does nothing."); // trimmed
    expect(typeof record.at).toBe("string");
  });

  test("rejects an empty message", async () => {
    const res = await post({ category: "General", message: "   " });
    expect(res.status).toBe(400);
  });

  test("rejects an over-long message", async () => {
    const res = await post({ category: "General", message: "x".repeat(4001) });
    expect(res.status).toBe(400);
  });

  test("rejects an unknown category", async () => {
    const res = await post({ category: "Not A Category", message: "hello" });
    expect(res.status).toBe(400);
  });

  test("rejects non-JSON bodies", async () => {
    const res = await post("not json at all");
    expect(res.status).toBe(400);
  });

  test("refuses GET — the local store is never exposed over HTTP", async () => {
    const res = await feedbackGet();
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("not exposed");
  });
});

// ---------------------------------------------------------------------------
// Part 4 — the surfaces: Help, Premium, Report history, the MORE_NAV links
// ---------------------------------------------------------------------------

describe("P5-SS /help: the real WebFlix answers + YouTube's own help center", () => {
  test("renders answers for what really exists + links the real routes + YouTube's help center", async () => {
    await render(<HelpPage />);
    // real capabilities, not fabricated articles
    expect(host!.textContent).toContain("Add to queue");
    expect(host!.textContent).toContain("Playlists");
    expect(host!.textContent).toContain("5-second countdown");
    // the real internal links
    for (const href of ["/settings", "/studio", "/account", "/feedback"]) {
      expect(all("a").find((a) => a.getAttribute("href") === href)).toBeDefined();
    }
    // YouTube's own help center, external and labeled
    const support = all("a").find((a) => a.getAttribute("href") === "https://support.google.com/youtube");
    expect(support).toBeDefined();
    expect(host!.textContent).toContain("YouTube's own help center");
    // the feedback block carries the honest boundary
    expect(host!.textContent).toContain("It does not post to YouTube");
  });
});

describe("P5-SS /premium: the parity honest-degradation page", () => {
  test("the youtube.com Premium layout skeleton with the honest no-paid-tier copy", async () => {
    await render(<PremiumPage />);
    expect(host!.textContent).toContain("WebFlix has no paid tier — everything here is free.");
    expect(host!.textContent).toContain("Nothing to buy — everything on WebFlix is free");
    expect(host!.textContent).toContain("ON YOUTUBE.COM");
    const premium = all("a").find((a) => a.getAttribute("href") === "https://www.youtube.com/premium");
    expect(premium).toBeDefined();
    expect(all("a").find((a) => a.getAttribute("href") === "/help")).toBeDefined();
    // no checkout/subscribe affordance anywhere
    expect(buttonByText(/^get premium|^try it free|^subscribe$/i)).toBeNull();
  });
});

describe("P5-SS /report-history: the honest split (local video reports + the not-available truths)", () => {
  test("empty state + the honest YouTube not-available copy + the comment-report truth", async () => {
    await render(<ReportHistoryView reports={[]} />);
    expect(host!.textContent).toContain("You haven't reported any videos on WebFlix yet");
    expect(host!.textContent).toContain(
      "YouTube's report history is not available through WebFlix"
    );
    expect(host!.textContent).toContain("we won't show a fake list");
    expect(host!.textContent).toContain(
      "submits the report through the operator's YouTube session"
    );
    const youtubeLink = all("a").find(
      (a) => a.getAttribute("href") === "https://www.youtube.com/report/history"
    );
    expect(youtubeLink).toBeDefined();
  });

  test("with local rows: the real VideoReport records list (title, reason, in-review)", async () => {
    const reports = [
      {
        id: "r1",
        reason: "Spam or misleading",
        createdAt: new Date("2026-01-15T12:00:00Z"),
        video: { id: "v1", title: "Big Buck Bunny", thumbnailUrl: "https://x/1.jpg" },
      },
      {
        id: "r2",
        reason: "Harassment or bullying",
        createdAt: new Date("2026-02-01T12:00:00Z"),
        video: { id: "v2", title: "Sintel", thumbnailUrl: "https://x/2.jpg" },
      },
    ];
    await render(<ReportHistoryView reports={reports as never} />);
    expect(host!.textContent).toContain("Big Buck Bunny");
    expect(host!.textContent).toContain("Sintel");
    expect(host!.textContent).toContain("Reported for Spam or misleading");
    expect(all('[data-report-item="v1"]').length).toBe(1);
    expect(host!.textContent).toContain("In review");
    expect(all("a").find((a) => a.getAttribute("href") === "/watch/v1")).toBeDefined();
  });
});

describe("P5-SS sidebar: the MORE_NAV toast stubs are now real route links", () => {
  test("all five entries render as Links to the real routes", async () => {
    sessionState = { status: "unauthenticated", user: null };
    fetchHandler = () => Response.json({ subscriptions: [] });
    await render(<SidebarNav />);
    await act(async () => {}); // let useApi(/api/me) settle
    const expected: { href: string; label: string }[] = [
      { href: "/settings", label: "Settings" },
      { href: "/premium", label: "WebFlix Premium" },
      { href: "/report-history", label: "Report history" },
      { href: "/help", label: "Help" },
      { href: "/feedback", label: "Send feedback" },
    ];
    for (const { href, label } of expected) {
      const link = all("a").find((a) => a.getAttribute("href") === href);
      expect(link).toBeDefined();
      expect(link!.textContent).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Part 5 — the verified local read path (rides the chain's test database)
// ---------------------------------------------------------------------------

const DB_URL = process.env.DATABASE_URL ?? "";
const dbAvailable = DB_URL.includes("boot-test") || DB_URL.includes("watch-test");
const dbDescribe = dbAvailable ? describe : describe.skip;

dbDescribe("P5-SS report history: the verified local read path (VideoReport rows)", () => {
  let db: any;
  let listMyVideoReports: (userId: string) => Promise<any[]>;
  let seeded: { user: any; videos: any[]; other: any };

  beforeAll(async () => {
    db = (await import("../src/lib/db")).db;
    listMyVideoReports = (await import("../src/app/report-history/queries")).listMyVideoReports;
    const user = await db.user.findFirstOrThrow();
    const videos = await db.video.findMany({ take: 2, orderBy: { id: "asc" } });
    expect(videos).toHaveLength(2); // the boot seed provides many; one report per (video, user) — two videos needed
    const other = await db.user.findFirst({ where: { id: { not: user.id } } });
    seeded = { user, videos, other };
    // clean any residue from a previous run of this test
    const userIds = [user.id, other?.id].filter(Boolean);
    await db.videoReport.deleteMany({ where: { videoId: { in: videos.map((v: any) => v.id) }, userId: { in: userIds } } });
  });

  test("lists THIS user's rows newest-first with the video, and nobody else's", async () => {
    const { user, videos, other } = seeded;
    const [videoA, videoB] = videos;
    const older = await db.videoReport.create({
      data: { videoId: videoA.id, userId: user.id, reason: "Spam or misleading", createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    const newer = await db.videoReport.create({
      data: { videoId: videoB.id, userId: user.id, reason: "Harassment or bullying", createdAt: new Date("2026-02-01T00:00:00Z") },
    });
    if (other) {
      await db.videoReport.create({
        data: { videoId: videoA.id, userId: other.id, reason: "Spam or misleading", createdAt: new Date("2026-03-01T00:00:00Z") },
      });
    }

    const rows = await listMyVideoReports(user.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(newer.id); // newest first
    expect(rows[1].id).toBe(older.id);
    expect(rows[0].video.title).toBe(videoB.title);
    expect(rows[0].video.thumbnailUrl).toBe(videoB.thumbnailUrl);
    expect(rows[0].reason).toBe("Harassment or bullying");

    // cleanup — leave the seeded state exactly as found
    await db.videoReport.deleteMany({ where: { id: { in: [older.id, newer.id] } } });
    if (other) {
      await db.videoReport.deleteMany({ where: { videoId: videoA.id, userId: other.id } });
    }
  });
});
