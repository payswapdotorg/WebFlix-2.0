/// <reference types="bun-types" />
/**
 * P21-LIVE-PREMIERES watch-state tests (happy-dom + createRoot/act — the
 * subscriptions-layout idiom; mocked modules, NEVER the network; the
 * livechat bootstrap rides a stubbed global fetch):
 *
 *  - THE PURE PIECES (lib/watch/premiere): the countdown wording table
 *    (D days / HH:MM:SS, YouTube's two forms), the scheduled-date wording
 *    (UTC — the watch mapper's UTC-midnight parse shown byte-for-byte),
 *    and the reminder set's localStorage round-trip (total functions:
 *    corrupt storage, private mode, dedupe);
 *  - THE STAGE (PremiereStage): renders the scheduled date + countdown +
 *    Set reminder + the honest youtube.com notification disclosure; the
 *    countdown TICKS live (per second); Set reminder persists across a
 *    simulated reload and untoggles; the zero crossing lifts the stage
 *    (onStarted) so the embed takes over;
 *  - THE PRE-CHAT STATE (LiveChatPanel with a future premiereStartsAt):
 *    YouTube's "Chat is disabled until the premiere starts" wording + the
 *    honest YouTube-only disclosure, with ZERO livechat machinery running
 *    (no fetch at all); dropping the prop runs the normal bootstrap (the
 *    self-hiding unavailable path);
 *  - THE ENGAGEMENT ROW (ActionRow premiere): like/dislike disabled with
 *    the count honestly absent; Share stays live; the normal row keeps
 *    its counts and enabled state.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

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
  usePathname: () => "/watch/v1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => ({
    data: url && url.includes("/api/auth/session") ? {} : null, // session probe: no user → guest
    loading: false,
    error: null,
    reload: () => {},
  }),
  postJson: async () => ({}),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
mock.module("@/lib/queue/queue-actions", () => ({
  addToQueue: async () => ({ status: "error", message: "no" }),
}));

const { PremiereStage } = await import("@/components/watch/premiere-stage");
const { LiveChatPanel } = await import("@/components/watch/live-chat-panel");
const { ActionRow } = await import("@/components/watch/action-row");
const {
  formatPremiereCountdown,
  premiereCountdownLine,
  premiereScheduledDate,
  premiereRemainingMs,
  readPremiereReminders,
  writePremiereReminders,
  togglePremiereReminder,
  PREMIERE_REMINDERS_KEY,
} = await import("@/lib/watch/premiere");

// ---- the fetch stub (the livechat bootstrap + any stray write) ----
type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
const fetchLog: string[] = [];
let fetchHandler: FetchHandler = () => new Response("{}", { status: 200 });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  fetchLog.push(u);
  return fetchHandler(u, init);
}) as unknown as typeof fetch;

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

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

/** The in-memory Storage shim (the sidebar-store.test idiom). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (name: string) => map.get(name) ?? null,
    setItem: (name: string, value: string) => void map.set(name, value),
    removeItem: (name: string) => void map.delete(name),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  };
}

beforeEach(() => {
  fetchLog.length = 0;
  fetchHandler = () => new Response(JSON.stringify({ chatAvailable: false }), { status: 200 });
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

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("premiere countdown wording (formatPremiereCountdown — YouTube's two forms)", () => {
  test.each([
    [3 * 86_400_000 + 5 * 3_600_000, "3 days"],
    [86_400_000, "1 day"],
    [7 * 86_400_000, "7 days"],
    [2 * 3_600_000 + 5 * 60_000 + 33_000, "02:05:33"],
    [3_600_000, "01:00:00"],
    [65_000, "00:01:05"],
    [59_000, "00:00:59"],
    [0, "00:00:00"],
    [-5_000, "00:00:00"], // clamped, never negative
  ] as [number, string][])("%dms → %s", (ms, expected) => {
    expect(formatPremiereCountdown(ms)).toBe(expected);
  });

  test("the full line prefixes \"Premieres in\"", () => {
    expect(premiereCountdownLine(3 * 86_400_000)).toBe("Premieres in 3 days");
    expect(premiereCountdownLine(65_000)).toBe("Premieres in 00:01:05");
  });

  test("the scheduled date is the UTC dateText wording (byte-for-byte)", () => {
    // the watch mapper's UTC-midnight parse of "Scheduled for Oct 9, 2026"
    expect(premiereScheduledDate("2026-10-09T00:00:00.000Z")).toBe("Oct 9, 2026");
    expect(premiereScheduledDate("2026-12-15T00:00:00.000Z")).toBe("Dec 15, 2026");
    expect(premiereScheduledDate("not-a-date")).toBe("");
  });

  test("remaining ms clamps at zero and survives invalid input", () => {
    expect(premiereRemainingMs("2999-01-01T00:00:00Z", Date.now())).toBeGreaterThan(0);
    expect(premiereRemainingMs("2000-01-01T00:00:00Z", Date.now())).toBe(0);
    expect(premiereRemainingMs("garbage", Date.now())).toBe(0);
  });
});

describe("the reminder set (localStorage round-trip — the WebFlix-owned pref)", () => {
  test("toggle on → persisted under wf-premiere-reminders; toggle off → removed", () => {
    const storage = memoryStorage();
    expect(togglePremiereReminder(storage, "v1")).toBe(true);
    expect(storage.dump()[PREMIERE_REMINDERS_KEY]).toContain("v1");
    expect(readPremiereReminders(storage)).toEqual(["v1"]);
    expect(togglePremiereReminder(storage, "v1")).toBe(false);
    expect(readPremiereReminders(storage)).toEqual([]);
  });

  test("multiple videos coexist, deduped", () => {
    const storage = memoryStorage();
    togglePremiereReminder(storage, "v1");
    togglePremiereReminder(storage, "v2");
    expect(readPremiereReminders(storage).sort()).toEqual(["v1", "v2"]);
    writePremiereReminders(storage, ["v1", "v1", "v2"]);
    expect(readPremiereReminders(storage)).toEqual(["v1", "v2"]);
  });

  test("corrupt / missing / absent storage → the honest empty set (never throws, never invents)", () => {
    const storage = memoryStorage();
    expect(readPremiereReminders(storage)).toEqual([]);
    storage.setItem(PREMIERE_REMINDERS_KEY, "{not json");
    expect(readPremiereReminders(storage)).toEqual([]);
    storage.setItem(PREMIERE_REMINDERS_KEY, JSON.stringify({ nope: true }));
    expect(readPremiereReminders(storage)).toEqual([]);
    storage.setItem(PREMIERE_REMINDERS_KEY, JSON.stringify(["ok", 42, null, ""]));
    expect(readPremiereReminders(storage)).toEqual(["ok"]);
    expect(readPremiereReminders(null)).toEqual([]);
  });
});

describe("PremiereStage — the watch page's premiere state", () => {
  const STAGE_PROPS = (startsAt: string, onStarted: () => void = () => {}) => ({
    videoId: "v1",
    startsAt,
    title: "The Premiere Title",
    thumbnailUrl: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
    onStarted,
  });

  test("renders the scheduled date, the countdown, Set reminder + the honest youtube.com disclosure", async () => {
    await render(
      createElement(PremiereStage, STAGE_PROPS(new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString()))
    );
    expect(q("[data-premiere-stage]")).toBeTruthy();
    expect(q("[data-premiere-scheduled]")?.textContent).toContain("Scheduled for");
    const countdown = q("[data-premiere-countdown]")?.textContent ?? "";
    expect(countdown).toMatch(/^Premieres in \d+ days?$/);
    // the bell affordance (unset by default) + the honest split
    expect(q("[data-premiere-reminder]")?.getAttribute("data-premiere-reminder")).toBe("unset");
    expect(q("[data-premiere-reminder]")?.textContent).toContain("Set reminder");
    const note = q("[data-premiere-note]")?.textContent ?? "";
    expect(note).toContain("youtube.com");
    expect(note).toContain("locally");
  });

  test("under a day out, the countdown is the live HH:MM:SS form", async () => {
    await render(createElement(PremiereStage, STAGE_PROPS(new Date(Date.now() + 2 * 3_600_000 + 5 * 60_000).toISOString())));
    expect(q("[data-premiere-countdown]")?.textContent ?? "").toMatch(/^Premieres in \d{2}:\d{2}:\d{2}$/);
  });

  test("the countdown TICKS (updates each second)", async () => {
    await render(createElement(PremiereStage, STAGE_PROPS(new Date(Date.now() + 30_000).toISOString())));
    const first = q("[data-premiere-countdown]")?.textContent ?? "";
    expect(first).toMatch(/^Premieres in 00:00:\d{2}$/);
    await wait(1_150); // > one interval tick
    const second = q("[data-premiere-countdown]")?.textContent ?? "";
    expect(second).toMatch(/^Premieres in 00:00:\d{2}$/);
    expect(second).not.toBe(first); // live-ticking, per second
  });

  test("Set reminder persists across a simulated reload and untoggles", async () => {
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await render(createElement(PremiereStage, STAGE_PROPS(startsAt)));
    const bell = q("[data-premiere-reminder]") as HTMLElement;
    expect(bell.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      bell.click();
    });
    expect(bell.getAttribute("aria-pressed")).toBe("true");
    expect(bell.textContent).toContain("Reminder set");
    expect(win.localStorage.getItem(PREMIERE_REMINDERS_KEY)).toContain("v1");
    // simulated reload: unmount, keep storage, mount again → still set
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = null;
    await render(createElement(PremiereStage, STAGE_PROPS(startsAt)));
    const bellAfterReload = q("[data-premiere-reminder]") as HTMLElement;
    expect(bellAfterReload.getAttribute("aria-pressed")).toBe("true"); // hydrated
    expect(bellAfterReload.textContent).toContain("Reminder set");
    // untoggle → cleared
    await act(async () => {
      bellAfterReload.click();
    });
    expect(bellAfterReload.getAttribute("aria-pressed")).toBe("false");
    expect(win.localStorage.getItem(PREMIERE_REMINDERS_KEY)).not.toContain("v1");
  });

  test("the zero crossing lifts the stage (onStarted) — the embed takes over", async () => {
    let started = 0;
    await render(
      createElement(
        PremiereStage,
        STAGE_PROPS(new Date(Date.now() + 300).toISOString(), () => {
          started += 1;
        })
      )
    );
    expect(q("[data-premiere-stage]")).toBeTruthy();
    await wait(1_600); // past the start + one interval tick
    expect(started).toBe(1);
    expect(q("[data-premiere-stage]")).toBeNull(); // the overlay is gone
  });
});

describe("LiveChatPanel — the pre-premiere chat state (P21)", () => {
  test("a scheduled premiere → YouTube's disabled wording + the honest disclosure, ZERO chat machinery", async () => {
    await render(
      createElement(LiveChatPanel, {
        videoId: "v1",
        premiereStartsAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    );
    const panel = q("[data-premiere-chat]");
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("aria-label")).toBe("Live chat");
    expect(panel?.textContent).toContain("Chat is disabled until the premiere starts");
    expect(panel?.textContent).toContain("youtube.com"); // the honest YouTube-only disclosure
    // the pre-premiere state runs NO livechat fetch at all
    expect(fetchLog.filter((u) => u.includes("/livechat"))).toHaveLength(0);
  });

  test("dropping the prop (premiere started / regular video) runs the normal bootstrap", async () => {
    await render(createElement(LiveChatPanel, { videoId: "v1", premiereStartsAt: null }));
    await wait(50);
    // the machinery ran: the bootstrap fetched, got chatAvailable:false,
    // and the panel self-hid (the honest unavailable path)
    expect(fetchLog.filter((u) => u.includes("/api/videos/v1/livechat")).length).toBeGreaterThan(0);
    expect(q("[data-premiere-chat]")).toBeNull();
    expect(q("section")).toBeNull();
  });
});

describe("ActionRow — the premiere engagement state (P21)", () => {
  const ROW_PROPS = (premiere: boolean) => ({
    videoId: "v1",
    likes: 1234,
    dislikes: 12,
    yourLike: null,
    savedWatchLater: false,
    guest: false,
    premiere,
    onLikeResult: () => {},
    onShare: () => {},
    onSave: () => {},
    onToggleTranscript: () => {},
    onReport: () => {},
    onAddToQueue: () => {},
  });

  test("premiere → like/dislike disabled, the count honestly absent, Share stays live", async () => {
    await render(createElement(ActionRow, ROW_PROPS(true)));
    const group = q('[role="group"][aria-label="Rate this video"]');
    expect(group?.getAttribute("aria-disabled")).toBe("true");
    const [like, dislike] = all("button")
      .filter((b) => b.getAttribute("aria-pressed") !== null)
      .map((b) => b as unknown as HTMLButtonElement);
    expect(like?.disabled).toBe(true);
    expect(dislike?.disabled).toBe(true);
    // the count is honestly absent (no rating exists before the premiere)
    expect(group?.textContent ?? "").not.toMatch(/\d/);
    expect(group?.textContent ?? "").not.toContain("1.2K");
    // Share stays live (youtube.com's premiere page keeps it)
    const share = all("button").find((b) => (b.textContent ?? "").includes("Share")) as
      | HTMLButtonElement
      | undefined;
    expect(share?.disabled ?? true).toBe(false);
    // clicking a disabled like fires nothing
    fetchLog.length = 0;
    await act(async () => {
      like?.click();
    });
    expect(fetchLog).toHaveLength(0);
  });

  test("the normal row is unchanged: enabled buttons + the live count", async () => {
    await render(createElement(ActionRow, ROW_PROPS(false)));
    const group = q('[role="group"][aria-label="Rate this video"]');
    expect(group?.getAttribute("aria-disabled")).toBe(null);
    const [like, dislike] = all("button")
      .filter((b) => b.getAttribute("aria-pressed") !== null)
      .map((b) => b as unknown as HTMLButtonElement);
    expect(like?.disabled).toBe(false);
    expect(dislike?.disabled).toBe(false);
    expect(group?.textContent ?? "").toContain("1.2K"); // compactCount(1234)
  });
});
