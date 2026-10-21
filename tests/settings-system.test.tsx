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
// WFX2-P36 — the per-user OAuth connection store (the REAL module, Map
// fallback — env-clean) + the real token-crypto, for the route tests below
const { putYouTubeConnection, resetYoutubeConnectionStore } = await import(
  "@/lib/auth/youtube-connection-store"
);
const { encryptSecret } = await import("@/lib/youtube/oauth");
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

  test("Account: the WebFlix identity summary + the /account link + the per-user truth wording law", async () => {
    await renderSignedInSettings();
    expect(host!.textContent).toContain("The Operator");
    expect(host!.textContent).toContain("operator@webflix.test");
    const accountLink = all("a").find((a) => a.getAttribute("href") === "/account");
    expect(accountLink).toBeDefined();
    // the account section's P36 wording: the server session READS public
    // pages; every user write acts on the user's OWN connected account
    expect(host!.textContent).toContain(
      "Operator read session connected — WebFlix's server uses it to read public YouTube pages. It never performs your actions: your likes, subscribes and playlists act on your own connected YouTube account (see YouTube account below)."
    );
    expect(host!.textContent).toContain(
      "Your WebFlix account is local to WebFlix — it is not a YouTube account, and WebFlix never fabricates YouTube-account data."
    );
  });

  test("Account: the honest public-mode wording when no read session is configured", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/watch/session")) {
        return Response.json({ operatorSession: false });
      }
      return new Response("{}", { status: 200 });
    };
    await renderSignedInSettings();
    expect(host!.textContent).toContain(
      "No operator read session is configured (public mode). Reads stay fully live; your own actions run through your connected YouTube account (see YouTube account below)."
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
// Part 1c — Task 4-b → P33: the YouTube connection (settings card + client + API)
// ---------------------------------------------------------------------------

describe("P36 settings: the per-user YouTube account card (the OAuth connection, honestly)", () => {
  /** The honest actions capability map the route always answers. */
  const CONNECT_ACTIONS = {
    like: "official",
    dislike: "official",
    subscribe: "official",
    playlists: "official",
    watchLater: "local",
    comments: "local",
    notInterested: "local",
    bell: "unsupported",
    history: "unsupported",
  };
  const CONNECTED_ENVELOPE = {
    mode: "oauth",
    status: "connected",
    connected: true,
    account: {
      channelId: "UCown0000000000000001",
      channelTitle: "Your Own Channel",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      connectedAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    actions: CONNECT_ACTIONS,
    oauth: {
      configured: true,
      missingEnv: [],
      redirectUri: "https://webflix.example/api/connection/youtube/oauth/callback",
      connectUrl: "/api/connection/youtube/oauth/start",
      disconnectUrl: "/api/connection/youtube/disconnect",
    },
    serverReadSession: { configured: true },
    checkedAt: new Date().toISOString(),
  };
  const NEEDS_REAUTH_ENVELOPE = {
    ...CONNECTED_ENVELOPE,
    status: "needs-reauth",
    connected: false,
  };
  const NOT_CONFIGURED_ENVELOPE = {
    mode: "oauth",
    status: "not-configured",
    connected: false,
    actions: CONNECT_ACTIONS,
    oauth: {
      configured: false,
      missingEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      redirectUri: "https://webflix.example/api/connection/youtube/oauth/callback",
      connectUrl: "/api/connection/youtube/oauth/start",
      disconnectUrl: "/api/connection/youtube/disconnect",
    },
    serverReadSession: { configured: false },
    checkedAt: new Date().toISOString(),
  };
  const NOT_CONNECTED_ENVELOPE = {
    mode: "oauth",
    status: "not-connected",
    connected: false,
    actions: CONNECT_ACTIONS,
    oauth: {
      configured: true,
      missingEnv: [],
      redirectUri: "https://webflix.example/api/connection/youtube/oauth/callback",
      connectUrl: "/api/connection/youtube/oauth/start",
      disconnectUrl: "/api/connection/youtube/disconnect",
    },
    serverReadSession: { configured: false },
    checkedAt: new Date().toISOString(),
  };
  const serve = (envelope: unknown, session = true) => (url: string) => {
    if (url.includes("/api/connection/youtube")) return Response.json(envelope);
    if (url.includes("/api/watch/session")) return Response.json({ operatorSession: session });
    return new Response("{}", { status: 200 });
  };

  test("connected → the account identity + the capability lines + the read-session disclosure + Disconnect; Recheck forces a fresh probe past the cache", async () => {
    fetchHandler = serve(CONNECTED_ENVELOPE);
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section).not.toBeNull();
    expect(section!.querySelector('[data-connection-state="connected"]')).not.toBeNull();
    expect(section!.textContent).toContain("Connected as Your Own Channel");
    expect(section!.textContent).toContain("Actions run on your own account through the official YouTube API.");
    // the honest capability lines (the same disclosure on every actionable state)
    expect(section!.textContent).toContain("Runs on your account: like, dislike, subscribe, playlists.");
    expect(section!.textContent).toContain("On WebFlix only: watch later, comments, feed feedback.");
    expect(section!.textContent).toContain("Not API-supported: bell preferences, history writes — hand off to YouTube.");
    // the deployment-wide READ session disclosure — never used for actions
    expect(section!.textContent).toContain(
      "WebFlix's server keeps a separate read-only YouTube session for public pages — it is never used for your actions."
    );
    expect(section!.textContent).toContain("Checked");
    expect(section!.querySelector('button[aria-label="Disconnect your YouTube account"]')).not.toBeNull();
    const recheck = section!.querySelector(
      'button[aria-label="Recheck the YouTube account connection"]'
    ) as unknown as HTMLButtonElement | null;
    expect(recheck).not.toBeNull();
    // the retired operator/broker doctrine never renders again
    expect(section!.textContent).not.toContain("never have to go back to youtube.com");
    expect(section!.textContent).not.toContain("connected tab is on a watch page");

    // Recheck → a FORCED second probe (a cache hit would issue no second fetch)
    const probes = () => fetchLog.filter((f) => f.url.includes("/api/connection/youtube")).length;
    expect(probes()).toBe(1);
    fetchHandler = serve(NEEDS_REAUTH_ENVELOPE);
    await act(async () => {
      recheck!.click();
    });
    expect(probes()).toBe(2);
    expect(section!.querySelector('[data-connection-state="needs-reauth"]')).not.toBeNull();
  });

  test("needs-reauth → the honest re-connect card (Google expired or revoked the grant)", async () => {
    fetchHandler = serve(NEEDS_REAUTH_ENVELOPE);
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section!.querySelector('[data-connection-state="needs-reauth"]')).not.toBeNull();
    expect(section!.textContent).toContain("Re-connect your YouTube account");
    expect(section!.textContent).toContain(
      "Google expired or revoked the authorization — your actions pause until you re-connect."
    );
    // the Connect affordance is the same-origin OAuth start link
    const connect = all("a").find((a) => a.getAttribute("href") === "/api/connection/youtube/oauth/start");
    expect(connect).toBeDefined();
    expect(connect!.textContent).toContain("Connect your YouTube account");
    expect(section!.textContent).toContain("Checked");
    expect(section!.textContent).not.toContain("Connected as");
  });

  test("not-configured → the deployment's honest setup card (the exact missing env vars + the redirect URI to register)", async () => {
    fetchHandler = serve(NOT_CONFIGURED_ENVELOPE);
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section!.querySelector('[data-connection-state="not-configured"]')).not.toBeNull();
    expect(section!.textContent).toContain("YouTube account connection isn't configured");
    expect(section!.textContent).toContain(
      "Users can't connect their own YouTube accounts yet — the deployment is missing its Google OAuth credentials."
    );
    expect(section!.textContent).toContain("Missing environment variables:");
    expect(section!.textContent).toContain("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
    expect(section!.textContent).toContain("Register this redirect URI in the Google Cloud console:");
    expect(section!.textContent).toContain("https://webflix.example/api/connection/youtube/oauth/callback");
    expect(section!.textContent).toContain(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployment env to let users connect their own accounts."
    );
    expect(section!.textContent).toContain("Checked");
    expect(
      section!.querySelector('button[aria-label="Recheck the YouTube account connection"]')
    ).not.toBeNull();
    // the retired broker-era copy never renders again
    expect(section!.textContent).not.toContain("connected tab");
  });

  test("checking → not-connected: the pre-probe Checking card, then the honest Connect card + capability lines + the same-origin OAuth link", async () => {
    // the probe defers — the card is honestly "Checking" until the server answers
    let resolveProbe: ((r: Response) => void) | null = null;
    fetchHandler = (url) => {
      if (url.includes("/api/connection/youtube")) {
        return new Promise<Response>((res) => {
          resolveProbe = res;
        });
      }
      if (url.includes("/api/watch/session")) return Response.json({ operatorSession: true });
      return new Response("{}", { status: 200 });
    };
    await renderSignedInSettings();
    const section = q('[data-settings-section="youtube-connection"]');
    expect(section!.textContent).toContain("Checking your YouTube account…");
    expect(section!.querySelector('[data-connection-state]')).toBeNull();
    // the probe resolves → the honest per-user Connect card
    await act(async () => {
      resolveProbe?.(Response.json(NOT_CONNECTED_ENVELOPE));
    });
    await act(async () => {});
    expect(section!.querySelector('[data-connection-state="not-connected"]')).not.toBeNull();
    expect(section!.textContent).toContain("Connect your YouTube account");
    expect(section!.textContent).toContain(
      "Your likes, subscribes and playlists act on your own YouTube account, through the official YouTube API — WebFlix never acts as someone else."
    );
    expect(section!.textContent).toContain("Runs on your account: like, dislike, subscribe, playlists.");
    expect(section!.textContent).toContain("Checked");
    const connect = all("a").find((a) => a.getAttribute("href") === "/api/connection/youtube/oauth/start");
    expect(connect).toBeDefined();
    expect(connect!.textContent).toContain("Connect your YouTube account");
    // THE LAW: never the retired operator/broker claims
    expect(section!.textContent).not.toContain("never have to go back to youtube.com");
    expect(section!.textContent).not.toContain("No server-side YouTube session is configured");
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

describe("P4B /api/connection/youtube: the gated, per-user OAuth status route", () => {
  let AUTH_COOKIE = "";
  beforeAll(async () => {
    AUTH_COOKIE = await mintSessionCookie();
  });

  // env-clean per test: no OAuth client vars, no Upstash (the store rides its
  // Map fallback), no operator cookies — restored after each test
  const ENV_KEYS = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "YT_COOKIES",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    resetYoutubeConnectionStore();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
    resetYoutubeConnectionStore();
  });

  /** A connected record for the ACTING user (or another user): real
   * encryptSecret token blobs, a non-expiring access token (the transparent
   * refresh must never fire — no network). */
  async function putConnection(
    opts: {
      userId?: string;
      status?: "connected" | "needs_reauth";
      expired?: boolean;
      withRefresh?: boolean;
    } = {},
  ): Promise<void> {
    const userId = opts.userId ?? "u_wfx2_test";
    await putYouTubeConnection({
      userId,
      channelId: "UCown0000000000000001",
      channelTitle: "Your Own Channel",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("user-access-token"),
      refreshTokenEnc:
        opts.withRefresh === false ? null : await encryptSecret("user-refresh-token"),
      accessExpiresAt: opts.expired ? Date.now() - 1_000 : Date.now() + 3_600_000,
      status: opts.status ?? "connected",
      connectedAt: new Date(Date.now() - 86_400_000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  test("guests → the uniform 401 (the gate fires before any store or env read)", async () => {
    const res = await connectionGet(new Request("http://localhost/api/connection/youtube") as never);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
    // the per-user route probes NOTHING upstream (no broker, no Google)
    expect(fetchLog).toHaveLength(0);
  });

  test("no GOOGLE_CLIENT_ID/SECRET env → the honest not-configured envelope (the exact missing vars + the redirect URI to register)", async () => {
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      mode: string;
      status: string;
      connected: boolean;
      account?: unknown;
      actions: Record<string, string>;
      oauth: { configured: boolean; missingEnv: string[]; redirectUri: string; connectUrl: string; disconnectUrl: string };
      serverReadSession: { configured: boolean };
      checkedAt: string;
    };
    expect(data.mode).toBe("oauth");
    expect(data.status).toBe("not-configured");
    expect(data.connected).toBe(false);
    expect(data.account).toBeUndefined();
    expect(data.oauth.configured).toBe(false);
    expect(data.oauth.missingEnv).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(data.oauth.connectUrl).toBe("/api/connection/youtube/oauth/start");
    expect(data.oauth.disconnectUrl).toBe("/api/connection/youtube/disconnect");
    expect(data.oauth.redirectUri).toBe("http://localhost/api/connection/youtube/oauth/callback");
    expect(data.actions).toMatchObject({
      like: "official",
      dislike: "official",
      subscribe: "official",
      playlists: "official",
      watchLater: "local",
      comments: "local",
      notInterested: "local",
      bell: "unsupported",
      history: "unsupported",
    });
    expect(data.serverReadSession).toEqual({ configured: false });
    expect(data.checkedAt).toBeTruthy();
    // zero upstream probes — the operator tiers are retired
    expect(fetchLog).toHaveLength(0);
  });

  test("env configured + no connection → not-connected (the honest per-user miss; the redirect-URI env override wins)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.org/api/connection/youtube/oauth/callback";
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      connected: boolean;
      account?: unknown;
      oauth: { configured: boolean; missingEnv: string[]; redirectUri: string };
    };
    expect(data.status).toBe("not-connected");
    expect(data.connected).toBe(false);
    expect(data.account).toBeUndefined();
    expect(data.oauth.configured).toBe(true);
    expect(data.oauth.missingEnv).toEqual([]);
    expect(data.oauth.redirectUri).toBe("https://example.org/api/connection/youtube/oauth/callback");
    expect(fetchLog).toHaveLength(0);
  });

  test("env configured + the user's own connected record → connected + the account block (the store is the truth — no upstream probe)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.YT_COOKIES = "SAPISID=fake; SID=x"; // the read-session disclosure flips true
    await putConnection();
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      connected: boolean;
      account: { channelId: string | null; channelTitle: string | null; channelThumbUrl: string | null; scope: string | null; connectedAt: string | null };
      serverReadSession: { configured: boolean };
      checkedAt: string;
    };
    expect(data.status).toBe("connected");
    expect(data.connected).toBe(true);
    expect(data.account).toEqual({
      channelId: "UCown0000000000000001",
      channelTitle: "Your Own Channel",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      connectedAt: expect.any(String),
    });
    expect(data.serverReadSession).toEqual({ configured: true });
    expect(data.checkedAt).toBeTruthy();
    // NO broker healthz, NO account_menu, NO googleapis — the retired probes are gone
    expect(
      fetchLog.filter(
        (f) => f.url.includes("/healthz") || f.url.includes("account_menu") || f.url.includes("googleapis")
      )
    ).toHaveLength(0);
  });

  test("a needs_reauth record → the honest needs-reauth verdict (the revoked grant)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    await putConnection({ status: "needs_reauth" });
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean };
    expect(data.status).toBe("needs-reauth");
    expect(data.connected).toBe(false);
  });

  test("an expired access token with no refresh grant → needs-reauth (the same verdict the action tier reaches)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    await putConnection({ expired: true, withRefresh: false });
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean };
    expect(data.status).toBe("needs-reauth");
    expect(data.connected).toBe(false);
  });

  test("another user's connection never leaks — the acting user honestly not-connected (the per-user isolation law)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    await putConnection({ userId: "u_someone_else_entirely" });
    const res = await connectionGet(
      new Request("http://localhost/api/connection/youtube", {
        headers: { cookie: AUTH_COOKIE },
      }) as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; connected: boolean; account?: unknown };
    expect(data.status).toBe("not-connected");
    expect(data.connected).toBe(false);
    expect(data.account).toBeUndefined();
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
      category: "General Feedback", // YouTube's actual list's default option (P20)
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

    await post({ category: "General Feedback", message: "second submission" }); // append, not overwrite
    const lines = readFileSync(logFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const record = JSON.parse(lines[0]) as { id: string; category: string; message: string; at: string };
    expect(record.id).toBe(payload.id);
    expect(record.category).toBe(FEEDBACK_CATEGORIES[5]); // YouTube's actual list, index 5 (P20)
    expect(record.message).toBe("The watch page queue button does nothing."); // trimmed
    expect(typeof record.at).toBe("string");
  });

  test("rejects an empty message", async () => {
    const res = await post({ category: "General Feedback", message: "   " });
    expect(res.status).toBe(400);
  });

  test("rejects an over-long message", async () => {
    const res = await post({ category: "General Feedback", message: "x".repeat(4001) });
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
    expect(host!.textContent).toContain("Under review"); // YouTube's state wording (P20)
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
