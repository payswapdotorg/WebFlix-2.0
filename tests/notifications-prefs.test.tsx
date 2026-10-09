/// <reference types="bun-types" />
/**
 * P18-SUBS-NOTIFS tests — the notification center's per-channel prefs
 * battery (happy-dom + createRoot/act, the you-hub/auth-ui pattern; the
 * session seam, use-api, next/link, navigation and sonner are mocked via
 * mock.module — NEVER the network):
 *
 *  - THE STORE: "wf-notif-channel-prefs" persistence (the sidebar-store
 *    idiom — skipHydration + explicit rehydrate), invalid stored values
 *    dropped, the channel key fallback chain, and the honest filter
 *    semantics (ONLY "none" filters; all/personalized/unset pass through);
 *  - THE GEAR SHEET (YouTube's bell-menu gear flow): the header gear, the
 *    per-channel rows with the EXACT three-way segmented control (All /
 *    Personalized / None), no active segment for unset channels (never a
 *    guess of YouTube's own state), the honest upstream disclosure, and the
 *    "Notification settings" link row → /settings;
 *  - APPLICATION: rows from channels set to None are filtered from the list
 *    view (badge math + unread counts untouched — the filter is WebFlix-side
 *    view state), prefs survive a simulated reload, the sheet still lists
 *    MUTED channels (un-mute path), and the all-muted honest state;
 *  - THE PER-ITEM KEBAB: "Mark as read" on unread rows only — the same
 *    local-overlay + menu re-read semantics as opening the row;
 *  - THE UNCHANGED SEAMS: the empty-feed promo, mark-all-read, and the
 *    open-marks-read POST.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

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

// ---- module mocks ----
mock.module("next/navigation", () => ({
  usePathname: () => "/notifications",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// URL-aware useApi stub: the session probe vs the notification center feed
let sessionData: any = null;
let centerData: any = null;
let centerError: string | null = null;
const postJsonCalls: { url: string; body: unknown }[] = [];
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    if (url && url.includes("/api/auth/session")) {
      return { data: sessionData, loading: sessionData === null, error: null, reload: () => {} };
    }
    return {
      data: centerData,
      loading: url !== null && centerData === null && centerError === null,
      error: centerError,
      reload: () => {},
    };
  },
  postJson: async <T,>(url: string, body: unknown): Promise<T> => {
    postJsonCalls.push({ url, body });
    return {} as T;
  },
}));

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

import type { ChannelLite, NotificationDTO } from "@/lib/types";
import type { ChannelNotifPref } from "@/app/notifications/channel-prefs-store";

const { default: NotificationsCenterPage } = await import("@/app/notifications/view");
const {
  useChannelPrefs,
  CHANNEL_PREFS_STORAGE_KEY,
  createChannelPrefsStore,
  channelAllowsNotification,
  channelKeyOf,
  notificationChannelKey,
} = await import("@/app/notifications/channel-prefs-store");
const { useLocalRead } = await import("@/app/notifications/local-read-store");
const { feedChannels } = await import("@/app/notifications/channel-prefs-sheet");

// ---- fixtures (the REAL payload shapes) ----
const AUTHED_SESSION = { user: { id: "u1", name: "The Operator", email: "operator@webflix.test", avatarSeed: 12 } };

const notif = (id: string, ch: ChannelLite, over: Partial<NotificationDTO> = {}): NotificationDTO => ({
  id,
  kind: "video",
  title: `${ch.name} uploaded: Video ${id}`,
  body: "3 hours ago",
  read: false,
  createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  videoId: `v_${id}`,
  videoThumbnailUrl: "https://example.com/t.jpg",
  channel: ch,
  ...over,
});

const RICK: ChannelLite = { id: "UCrick", handle: "@RickAstley", name: "Rick Astley", avatarUrl: "https://example.com/rick.jpg", verified: false, subscriberCount: 0 };
const LOFI: ChannelLite = { id: "UClofi", handle: "@LofiGirl", name: "Lofi Girl", avatarUrl: "https://example.com/lofi.jpg", verified: false, subscriberCount: 0 };
const ALJ: ChannelLite = { id: "UCalj", handle: "@AlJazeeraEnglish", name: "Al Jazeera English", avatarUrl: "https://example.com/alj.jpg", verified: false, subscriberCount: 0 };

const CENTER = {
  items: [
    notif("n1", RICK), // unread
    notif("n2", LOFI, { read: true, body: "1 day ago" }), // read upstream
    notif("n3", ALJ, { body: "2 days ago" }), // unread
  ],
  total: 3,
  unread: 2,
  loginRequired: false,
  pollIntervalMs: null,
  session: true,
  page: 1,
  pageSize: 50,
  hasMore: false,
};

const EMPTY_CENTER = {
  items: [],
  total: 0,
  unread: 0,
  loginRequired: false,
  pollIntervalMs: null,
  session: true,
  page: 1,
  pageSize: 50,
  hasMore: false,
};

// ---- render helpers (the you-hub idiom) ----
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

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
const docAll = (sel: string): HTMLElement[] =>
  Array.from(win.document.querySelectorAll(sel) as unknown as HTMLElement[]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  toasts.length = 0;
  postJsonCalls.length = 0;
  sessionData = AUTHED_SESSION;
  centerData = null;
  centerError = null;
  useLocalRead.getState().reset();
  useChannelPrefs.setState({ prefs: {} }); // the wrapped setState persists the default…
  win.localStorage.clear(); // …then the browser storage is cleaned
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
  // close any portal that outlived the host (radix sheets/dropdowns)
  win.document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("the channel-prefs store (persistence + the honest filter semantics)", () => {
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

  test("setPref persists under wf-notif-channel-prefs; a fresh store rehydrates", async () => {
    const storage = memoryStorage();
    const store = createChannelPrefsStore(storage);
    store.getState().setPref("UCrick", "none");
    store.getState().setPref("UClofi", "all");
    const raw = storage.dump()[CHANNEL_PREFS_STORAGE_KEY];
    expect(raw).toBeTruthy();
    expect(raw).toContain('"UCrick":"none"');
    expect(raw).toContain('"UClofi":"all"');
    const second = createChannelPrefsStore(storage);
    await second.persist.rehydrate();
    expect(second.getState().prefs).toEqual({ UCrick: "none", UClofi: "all" });
  });

  test("invalid stored values are dropped on rehydrate (only the three real levels survive)", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CHANNEL_PREFS_STORAGE_KEY,
      JSON.stringify({
        state: { prefs: { UCRick: "banana", UClofi: "personalized", "": "none", bad: 42 } },
        version: 0,
      })
    );
    const store = createChannelPrefsStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().prefs).toEqual({ UClofi: "personalized" });
  });

  test("corrupted raw storage never throws — no prefs stand", async () => {
    const storage = memoryStorage();
    storage.setItem(CHANNEL_PREFS_STORAGE_KEY, "not json {{{");
    const store = createChannelPrefsStore(storage);
    await store.persist.rehydrate();
    expect(store.getState().prefs).toEqual({});
  });

  test("channelAllowsNotification — ONLY 'none' filters; all/personalized/unset pass", () => {
    const n1 = notif("n1", RICK);
    const n2 = notif("n2", LOFI);
    const prefs: Record<string, ChannelNotifPref> = {
      UCrick: "none",
      UClofi: "all",
      UCalj: "personalized",
    };
    expect(channelAllowsNotification(n1, prefs)).toBe(false); // none → filtered
    expect(channelAllowsNotification(n2, prefs)).toBe(true); // all → passes
    expect(channelAllowsNotification(notif("n3", ALJ), prefs)).toBe(true); // personalized → passes
    expect(channelAllowsNotification(n1, {})).toBe(true); // unset → passes
  });

  test("channelKeyOf — the channel key falls back honestly: id → handle → name (the DTO's own fields)", () => {
    expect(channelKeyOf(RICK)).toBe("UCrick");
    expect(channelKeyOf({ ...RICK, id: "" })).toBe("@RickAstley");
    expect(channelKeyOf({ ...RICK, id: "", handle: "" })).toBe("Rick Astley");
    expect(notificationChannelKey(notif("n1", RICK))).toBe("UCrick");
    // notification rows whose payload carried no browseId still key stably
    expect(notificationChannelKey(notif("n1", { ...RICK, id: "" }))).toBe("@RickAstley");
  });

  test("feedChannels — the distinct channels in first-seen order (muted included)", () => {
    const items = [...CENTER.items, notif("n4", RICK)];
    expect(feedChannels(items).map((c) => c.id)).toEqual(["UCrick", "UClofi", "UCalj"]);
  });
});

describe("P18 — the gear → per-channel prefs sheet (the YouTube bell-menu flow)", () => {
  test("the header gear renders signed-in; guests get the signed-out screen (no gear)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    expect(all('[data-testid="channel-prefs-gear"]').length).toBe(1);
    expect(all('[data-testid="channel-prefs-gear"]')[0].getAttribute("aria-label")).toBe(
      "Channel notification settings"
    );
    // guest
    act(() => root?.unmount());
    host?.remove();
    sessionData = {}; // a session payload without a user → guest
    await render(createElement(NotificationsCenterPage));
    expect((host!.textContent ?? "")).toContain("Sign in to see your notifications on WebFlix");
    expect(all('[data-testid="channel-prefs-gear"]').length).toBe(0);
  });

  test("the sheet lists every feed channel with the EXACT three-way control; unset rows carry NO active segment", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await act(async () => {
      all('[data-testid="channel-prefs-gear"]')[0].click();
    });
    await sleep(40);
    expect(docAll('[data-testid="channel-prefs-sheet"]').length).toBe(1);
    // one row per distinct channel — 3 channels
    const rows = docAll("[data-testid^='channel-pref-control-']");
    expect(rows).toHaveLength(3);
    expect(docAll("[data-testid='channel-pref-control-UCrick']").length).toBe(1);
    // YouTube's exact three-way wording
    const rickButtons = docAll("[data-testid='channel-pref-control-UCrick'] button");
    expect(rickButtons.map((b) => (b.textContent ?? "").trim())).toEqual([
      "All",
      "Personalized",
      "None",
    ]);
    expect(rickButtons.map((b) => b.getAttribute("role"))).toEqual(["radio", "radio", "radio"]);
    // UNSET → no active segment (never a guess of YouTube's own state)
    expect(rickButtons.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    // the channel row carries the channel name (radix avatars render their
    // fallback initial until the avatar image loads — happy-dom never loads
    // images, so the img assert would be dishonest here)
    const rickRow = docAll("[data-testid='channel-pref-control-UCrick']")[0].parentElement;
    expect((rickRow!.textContent ?? "")).toContain("Rick Astley");
  });

  test("the honest upstream disclosure + the 'Notification settings' link row → /settings", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await act(async () => {
      all('[data-testid="channel-prefs-gear"]')[0].click();
    });
    await sleep(40);
    const sheetText = docAll('[data-testid="channel-prefs-sheet"]')[0].textContent ?? "";
    // the All/Personalized distinction is disclosed as YouTube's own server-side logic
    expect(sheetText).toContain("All / Personalized");
    expect(sheetText).toContain("managed on youtube.com");
    // YouTube's gear → settings flow
    const settingsLink = docAll("[data-testid='notification-settings-link']")[0] as unknown as HTMLAnchorElement;
    expect(settingsLink).not.toBeUndefined();
    expect(settingsLink.getAttribute("href")).toBe("/settings");
    expect((settingsLink.textContent ?? "").trim()).toContain("Notification settings");
  });
});

describe("P18 — applying the prefs (the honest view filter)", () => {
  async function openSheet() {
    await act(async () => {
      all('[data-testid="channel-prefs-gear"]')[0].click();
    });
    await sleep(40);
  }

  async function setLevel(controlTestId: string, level: "all" | "personalized" | "none") {
    const btn = docAll(
      `[data-testid='${controlTestId}'] button[data-level='${level}']`
    )[0] as unknown as HTMLElement;
    await act(async () => {
      btn.click();
    });
    await act(async () => {});
  }

  test("None filters ONLY that channel's rows — the badge math and other rows stay untouched", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    expect(all('[data-testid="notification-center-row"]').length).toBe(3);
    expect((host!.textContent ?? "")).toContain("2 unread"); // the upstream badge math
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "none");
    // Rick's row is gone; Lofi (read) + Al Jazeera stay
    expect(all('[data-testid="notification-center-row"]').length).toBe(2);
    expect((host!.textContent ?? "")).not.toContain("Rick Astley uploaded");
    expect((host!.textContent ?? "")).toContain("Lofi Girl");
    expect((host!.textContent ?? "")).toContain("Al Jazeera English");
    // the badge math is the filter's own honest scope — unchanged
    expect((host!.textContent ?? "")).toContain("2 unread");
  });

  test("Personalized and All both pass through (the distinction is upstream-only)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "personalized");
    await setLevel("channel-pref-control-UClofi", "all");
    expect(all('[data-testid="notification-center-row"]').length).toBe(3);
    await setLevel("channel-pref-control-UCrick", "all");
    expect(all('[data-testid="notification-center-row"]').length).toBe(3);
  });

  test("switching a muted channel back to All restores its rows (the un-mute path)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "none");
    expect(all('[data-testid="notification-center-row"]').length).toBe(2);
    await setLevel("channel-pref-control-UCrick", "all");
    expect(all('[data-testid="notification-center-row"]').length).toBe(3);
    expect((host!.textContent ?? "")).toContain("Rick Astley uploaded");
  });

  test("prefs persist under wf-notif-channel-prefs and survive a simulated reload", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "none");
    const stored = win.localStorage.getItem(CHANNEL_PREFS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(stored).toContain('"UCrick":"none"');

    // simulate the reload: fresh store state, the app's own bytes restored,
    // a fresh mount rehydrates them
    act(() => {
      root?.unmount();
    });
    host?.remove();
    useChannelPrefs.setState({ prefs: {} }); // the wrapped setState clobbers storage…
    win.localStorage.setItem(CHANNEL_PREFS_STORAGE_KEY, String(stored)); // …restore the app's own bytes
    await render(createElement(NotificationsCenterPage));
    await act(async () => {
      await useChannelPrefs.persist.rehydrate(); // the view's mount effect (deterministic here)
    });
    await act(async () => {});
    expect(all('[data-testid="notification-center-row"]').length).toBe(2); // still filtered
  });

  test("the sheet still lists MUTED channels (from the unfiltered feed — the un-mute path)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "none");
    expect(all('[data-testid="notification-center-row"]').length).toBe(2);
    // the sheet's row set is the UNFILTERED feed
    await act(async () => {
      all('[data-testid="channel-prefs-gear"]')[0].click();
    });
    await sleep(40);
    expect(docAll("[data-testid^='channel-pref-control-']").length).toBe(3);
    expect(docAll("[data-testid='channel-pref-control-UCrick']").length).toBe(1);
  });

  test("every channel muted → the honest all-muted state (NOT the empty promo)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await openSheet();
    await setLevel("channel-pref-control-UCrick", "none");
    await setLevel("channel-pref-control-UClofi", "none");
    await setLevel("channel-pref-control-UCalj", "none");
    expect(all('[data-testid="notification-center-row"]').length).toBe(0);
    const muted = all('[data-testid="notifications-all-muted"]');
    expect(muted).toHaveLength(1);
    expect((muted[0].textContent ?? "")).toContain("Every channel in this feed is set to None");
    // the inbox is NOT empty — the promo must not render
    expect(all('[data-testid="notifications-empty-promo"]').length).toBe(0);
    // the sheet can still be opened from the honest state
    await act(async () => {
      all('[data-testid="notifications-all-muted"] button')[0].click();
    });
    await sleep(40);
    expect(docAll('[data-testid="channel-prefs-sheet"]').length).toBe(1);
  });
});

describe("P18 — the per-item kebab (Mark as read)", () => {
  test("unread rows carry the kebab; read rows carry none", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    expect(all('[data-testid="notification-row-kebab"]').length).toBe(2); // n1 + n3
    const rows = all('[data-testid="notification-center-row"]');
    // n2 (read upstream) renders no unread dot and no kebab
    const n2Row = rows.find((r) => (r.textContent ?? "").includes("Lofi Girl"));
    expect(n2Row!.parentElement!.querySelector('[data-testid="notification-row-kebab"]')).toBeNull();
  });

  test("Mark as read marks ONE row — dot + kebab gone, the header count decrements, the menu re-read POST fires", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    expect((host!.textContent ?? "")).toContain("2 unread");
    const kebab = all('[data-testid="notification-row-kebab"]')[0]; // Rick's unread row
    await act(async () => {
      kebab.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
      );
    });
    await act(async () => {});
    const markRead = docAll("[data-testid='notification-mark-read']");
    expect(markRead).toHaveLength(1);
    expect((markRead[0].textContent ?? "").trim()).toBe("Mark as read");
    await act(async () => {
      markRead[0].click();
    });
    await act(async () => {});
    await sleep(40); // let the dropdown close + effects settle
    // the overlay marks the row read: header count 2 → 1
    expect((host!.textContent ?? "")).toContain("1 unread");
    expect((host!.textContent ?? "")).not.toContain("2 unread");
    // the row lost its unread dot AND its kebab (the action no longer applies)
    const rickRow = all('[data-testid="notification-center-row"]').find((r) =>
      (r.textContent ?? "").includes("Rick Astley")
    );
    expect(rickRow!.querySelector('[data-testid="unread-dot"]')).toBeNull();
    expect(rickRow!.parentElement!.querySelector('[data-testid="notification-row-kebab"]')).toBeNull();
    // the OTHER unread row keeps its dot + kebab
    expect(all('[data-testid="unread-dot"]').length).toBe(1);
    expect(all('[data-testid="notification-row-kebab"]').length).toBe(1);
    // the same per-item menu re-read the open-marks-read path fires
    expect(postJsonCalls.filter((c) => c.url.includes("/api/notifications/n1/read"))).toHaveLength(1);
  });
});

describe("P18 — the unchanged seams (regression guards)", () => {
  test("empty feed → the existing promo; the gear still renders and the sheet carries the honest no-channels note", async () => {
    centerData = EMPTY_CENTER;
    await render(createElement(NotificationsCenterPage));
    expect(all('[data-testid="notifications-empty-promo"]').length).toBe(1);
    expect(all('[data-testid="mark-all-read"]').length).toBe(0); // nothing to mark
    expect(all('[data-testid="channel-prefs-gear"]').length).toBe(1); // YouTube's gear is always there
    await act(async () => {
      all('[data-testid="channel-prefs-gear"]')[0].click();
    });
    await sleep(40);
    expect(docAll('[data-testid="channel-prefs-sheet"]').length).toBe(1);
    expect((docAll('[data-testid="channel-prefs-sheet"]')[0].textContent ?? "")).toContain(
      "No channels in the current feed"
    );
  });

  test("open-marks-read stays wired (clicking a row fires the per-item read POST)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    const rickRow = all('[data-testid="notification-center-row"]')[0];
    await act(async () => {
      rickRow.click();
    });
    await act(async () => {});
    expect(postJsonCalls.filter((c) => c.url.includes("/api/notifications/n1/read"))).toHaveLength(1);
    expect((host!.textContent ?? "")).toContain("1 unread"); // the overlay decremented
  });

  test("Mark all as read fires the mark-ALL route (unchanged)", async () => {
    centerData = CENTER;
    await render(createElement(NotificationsCenterPage));
    await act(async () => {
      all('[data-testid="mark-all-read"]')[0].click();
    });
    await act(async () => {});
    expect(postJsonCalls.filter((c) => c.url.includes("/api/notifications/read"))).toHaveLength(1);
    expect(toasts.filter((t) => t.includes("All notifications marked as read"))).toHaveLength(1);
  });
});
