/// <reference types="bun-types" />
/**
 * WFX2-P5-MQ tests — the miniplayer queue chrome battery:
 * - the queue button + count badge (reflects the store; the honest zero
 *   state — NO queue chrome at all while the queue is empty);
 * - the attached queue drawer (opens from the bar's queue button, closes
 *   on toggle / Escape / mini death / watch-page takeover; reuses
 *   QueuePanel — the now-playing highlight + remove via the REAL WL write
 *   with honest outcomes);
 * - prev/next enabled-states match the queue's order — the ENGINE'S order:
 *   next is the store's nextAfter (the same order the queue engine and the
 *   watch page's countdown drive); prev is the item before now-playing;
 * - prev/next clicks drive the engine's exact advance (next consumes the
 *   played video from the session queue and takes the mini over in place;
 *   prev never consumes; no player remount either way);
 * - the global mount — the REAL AppShell renders the drawer next to the
 *   player host layer (shell chrome stubbed; the mount composition is
 *   real), so the queue works on every page with no watch page present;
 * - the watch-page panel regression guard — QueuePanel with a STRING
 *   currentVideoId (exactly how watch-page.tsx mounts it) keeps its P4-QT
 *   semantics after the additive string|null widening.
 *
 * Idiom: miniplayer + queue (happy-dom + createRoot/act + a stubbed fetch
 * at the queue-actions client seam + mock.module seams). No network, no
 * live CDP.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, type ComponentProps, type ReactNode } from "react";
import type { QueueItem } from "@/lib/queue/queue-store";

// ---- happy-dom as the global DOM (the miniplayer setup) ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
const realLocalStorage = globalThis.localStorage;
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- stubbed global fetch (the queue-actions client seam) ----
const postCalls: { url: string; body: Record<string, unknown> | null }[] = [];
let fetchResponse: () => Response = () =>
  new Response(JSON.stringify({ ok: true, added: true, playlistId: "WL" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const raw = typeof init?.body === "string" ? init.body : null;
  postCalls.push({ url: u, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null });
  return fetchResponse();
}) as unknown as typeof fetch;

// ---- mock seams: navigation, link, sonner (deterministic toasts) ----
const navigations: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      navigations.push(url);
    },
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/link", () => {
  const MockLink = ({ href, children, ...rest }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  return { Link: MockLink, default: MockLink };
});
const toastCalls: { kind: string; message?: string }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, {
    success: (message?: string) => {
      toastCalls.push({ kind: "success", message });
    },
    error: (message?: string) => {
      toastCalls.push({ kind: "error", message });
    },
    info: (message?: string) => {
      toastCalls.push({ kind: "info", message });
    },
  }),
}));

/* ---- the app-shell mount test stubs the shell's heavier chrome (other
 * lanes'/waves' surfaces): the MOUNT POINT + composition stay REAL — the
 * real AppShell module renders the real PlayerHostLayer + QueueDrawer. */
mock.module("@/components/app/topbar", () => ({
  Topbar: () => <header data-testid="stub-topbar" />,
}));
mock.module("@/components/app/sidebar", () => ({
  Sidebar: () => <nav data-testid="stub-sidebar" />,
}));
mock.module("@/components/app/footer", () => ({
  SiteFooter: () => <footer data-testid="stub-footer" />,
}));
mock.module("@/components/video/video-hover-preview", () => ({
  VideoHoverPreviewLayer: () => <div data-testid="stub-hover-layer" />,
}));
mock.module("next-themes", () => ({
  ThemeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

/* ---- modules under test (imported AFTER the mocks — the miniplayer idiom) */
const { PlayerHostLayer } = await import("@/components/player/player-host-layer");
const { QueueDrawer, useQueueDrawer, resetQueueDrawerForTests } = await import(
  "@/components/player/queue-drawer"
);
const { playerHost, usePlayerHost, resetPlayerHostForTests } = await import(
  "@/lib/player/player-host"
);
const { useQueueStore, resetQueueStoreForTests } = await import("@/lib/queue/queue-store");
const { selectPrevBefore } = await import("@/lib/queue/queue-neighbors");
const { QueuePanel } = await import("@/components/watch/queue-panel");
const { AppShell } = await import("@/components/app/app-shell");

// ---- the YT iframe API stub (loadScript no-op: window.YT.Player present) ----
class MockYTPlayer {
  static instances: MockYTPlayer[] = [];
  static destroyed: MockYTPlayer[] = [];
  el: Element;
  options: Record<string, unknown>;
  loadedVideoId: string | null = null;

  constructor(el: Element, options: Record<string, unknown>) {
    this.el = el;
    this.options = options;
    MockYTPlayer.instances.push(this);
  }
  playVideo(): void {}
  pauseVideo(): void {}
  seekTo(): void {}
  getCurrentTime(): number {
    return 42;
  }
  getDuration(): number {
    return 100;
  }
  getPlayerState(): number {
    return 1;
  }
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void {
    this.loadedVideoId = opts.videoId;
  }
  destroy(): void {
    MockYTPlayer.destroyed.push(this);
  }
}
(win as unknown as Record<string, unknown>).YT = {
  Player: MockYTPlayer,
  PlayerState: {},
};

// Task 2-c: the layer's embed-health probe ALSO creates offscreen players
// (inside [data-wfx-embed-probe] wrappers) — the takeover assertions below
// care about the MAIN player only, so filter the probe out.
const isProbePlayer = (p: MockYTPlayer): boolean =>
  !!(p.el as Element).closest?.("[data-wfx-embed-probe]");
const mainPlayers = (): MockYTPlayer[] => MockYTPlayer.instances.filter((p) => !isProbePlayer(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const item = (videoId: string): QueueItem => ({
  videoId,
  title: `Title ${videoId}`,
  channelName: `Channel ${videoId}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  durationSec: 100,
});

// ---- harness ---------------------------------------------------------------

/** The app-shell composition: the layer + its attached drawer, siblings
 * above the route tree (exactly how app-shell.tsx mounts them). */
function MiniplayerApp() {
  return (
    <div>
      <PlayerHostLayer />
      <QueueDrawer />
    </div>
  );
}

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

async function renderMiniplayer() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<MiniplayerApp />);
  });
  await sleep(30); // YT API-ready microtask
}

async function renderShell() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <AppShell>
        <div data-testid="route-tree">A non-watch route</div>
      </AppShell>,
    );
  });
  await sleep(30);
}

async function renderWatchPagePanel() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<QueuePanel currentVideoId="V1" />);
  });
  await sleep(30);
}

const attach = (videoId: string) =>
  act(async () => {
    playerHost.attach({
      videoId,
      title: `Title ${videoId}`,
      channelName: `Channel ${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSec: 100,
      startSec: null,
    });
  });

const setMini = (mini: boolean) =>
  act(async () => {
    playerHost.setMini(mini);
  });

const append = (...items: QueueItem[]) =>
  act(async () => {
    for (const i of items) useQueueStore.getState().append(i);
  });

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

const click = (sel: string) =>
  act(async () => {
    (q(sel) as HTMLElement).click();
  });

/** The queue button in the mini bar (aria-label starts with "Queue — N"). */
const queueButton = (): HTMLElement | null => {
  if (!host) return null;
  const buttons = Array.from(
    host.querySelectorAll("button") as unknown as HTMLElement[],
  );
  return buttons.find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Queue")) ?? null;
};

beforeEach(() => {
  MockYTPlayer.instances = [];
  MockYTPlayer.destroyed = [];
  resetPlayerHostForTests();
  resetQueueStoreForTests();
  resetQueueDrawerForTests();
  navigations.length = 0;
  postCalls.length = 0;
  toastCalls.length = 0;
  fetchResponse = () =>
    new Response(JSON.stringify({ ok: true, added: true, playlistId: "WL" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    win.localStorage.clear();
  } catch {
    /* fresh window */
  }
});

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
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realLocalStorage !== undefined) {
    Object.defineProperty(globalThis, "localStorage", {
      value: realLocalStorage,
      configurable: true,
      writable: true,
    });
  }
});

/* ------------------------------------------------------------------ */
/* 1. The chrome — badge + the honest zero state                       */
/* ------------------------------------------------------------------ */

describe("the miniplayer queue chrome: badge + the honest zero state", () => {
  test("an empty queue renders NO queue chrome at all (no badge, no prev/next, no drawer — even forced open)", async () => {
    await renderMiniplayer();
    await attach("V1");
    await setMini(true); // the mini is alive, the queue is empty
    expect(q('[aria-label="Miniplayer"]')!.className).toContain("opacity-100");
    expect(queueButton()).toBeNull();
    expect(q('[aria-label="Previous video in queue"]')).toBeNull();
    expect(q('[aria-label="Next video in queue"]')).toBeNull();
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
    // even a stale open drawer-store state renders nothing (no queue)
    await act(async () => {
      useQueueDrawer.setState({ open: true });
    });
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
  });

  test("the badge reflects the store count (live updates in both directions)", async () => {
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    const button = queueButton() as HTMLElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toContain("2 videos");
    expect(button.textContent).toContain("2");
    await append(item("V3"));
    expect(queueButton()!.getAttribute("aria-label")).toContain("3 videos");
    expect(queueButton()!.textContent).toContain("3");
    await act(async () => {
      useQueueStore.getState().remove("V2");
    });
    expect(queueButton()!.textContent).toContain("2");
    // and the queue emptying removes the whole chrome again
    await act(async () => {
      useQueueStore.getState().remove("V1");
      useQueueStore.getState().remove("V3");
    });
    expect(queueButton()).toBeNull();
    expect(q('[aria-label="Next video in queue"]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2. The drawer — open/close, attachment, honest states               */
/* ------------------------------------------------------------------ */

describe("the queue drawer: open/close + attachment", () => {
  test("the queue button opens the attached drawer (aria-expanded flips, the panel lists the queue); the second click closes it", async () => {
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    const button = queueButton() as HTMLElement;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click('button[aria-label^="Queue"]');
    expect(queueButton()!.getAttribute("aria-expanded")).toBe("true");
    const drawer = q('[aria-label="Miniplayer queue"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain("Queue");
    expect(drawer!.textContent).toContain("Title V1");
    expect(drawer!.textContent).toContain("Title V2");
    await click('button[aria-label^="Queue"]');
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
    expect(queueButton()!.getAttribute("aria-expanded")).toBe("false");
  });

  test("the now-playing row highlights (the drawer passes the player host's videoId)", async () => {
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    const rows = Array.from(
      q('[aria-label="Miniplayer queue"]')!.querySelectorAll('[role="listitem"]') as unknown as HTMLElement[],
    );
    expect(rows).toHaveLength(2);
    const playing = rows.find((r) => r.textContent!.includes("Now playing"));
    expect(playing).toBeDefined();
    expect(playing!.textContent).toContain("Title V1"); // the mini's video
    expect(rows[1].textContent!.includes("Now playing")).toBe(false);
  });

  test("the drawer closes when the mini dies (Close is the only destroy path)", async () => {
    await append(item("V1"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    expect(q('[aria-label="Miniplayer queue"]')).not.toBeNull();
    await act(async () => {
      playerHost.close();
    });
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
    expect(useQueueDrawer.getState().open).toBe(false);
  });

  test("the drawer closes when a watch page takes the player inline (the watch page owns that surface)", async () => {
    await append(item("V1"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    expect(q('[aria-label="Miniplayer queue"]')).not.toBeNull();
    await setMini(false); // the watch page's slot re-takes the player
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
    expect(useQueueDrawer.getState().open).toBe(false);
  });

  test("Escape closes the open drawer (a local affordance of this drawer)", async () => {
    await append(item("V1"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    expect(q('[aria-label="Miniplayer queue"]')).not.toBeNull();
    await act(async () => {
      win.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Parameters<
          typeof win.dispatchEvent
        >[0],
      );
    });
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
  });

  test("an emptied queue closes the drawer (the empty state has no chrome)", async () => {
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    expect(q('[aria-label="Miniplayer queue"]')).not.toBeNull();
    await act(async () => {
      useQueueStore.getState().remove("V1");
      useQueueStore.getState().remove("V2");
    });
    expect(q('[aria-label="Miniplayer queue"]')).toBeNull();
    expect(useQueueDrawer.getState().open).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Prev/next enabled-states — the engine's order                    */
/* ------------------------------------------------------------------ */

describe("prev/next enabled-states match the queue order (the engine's order)", () => {
  test("middle item: prev + next both enabled; head: prev disabled; last: next disabled", async () => {
    await append(item("V1"), item("V2"), item("V3"));
    await renderMiniplayer();
    await attach("V2");
    await setMini(true);
    // middle
    expect((q('[aria-label="Previous video in queue"]') as HTMLButtonElement).disabled).toBe(false);
    expect((q('[aria-label="Next video in queue"]') as HTMLButtonElement).disabled).toBe(false);
    // head
    await attach("V1");
    await setMini(true);
    expect((q('[aria-label="Previous video in queue"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[aria-label="Next video in queue"]') as HTMLButtonElement).disabled).toBe(false);
    // last
    await attach("V3");
    await setMini(true);
    expect((q('[aria-label="Previous video in queue"]') as HTMLButtonElement).disabled).toBe(false);
    expect((q('[aria-label="Next video in queue"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test("an unqueued now-playing: prev disabled (nothing is before it), next enabled (the queue's head — the engine's unqueued law)", async () => {
    await append(item("A"), item("B"));
    await renderMiniplayer();
    await attach("OUTSIDE");
    await setMini(true);
    expect((q('[aria-label="Previous video in queue"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[aria-label="Next video in queue"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Prev/next clicks — the engine's exact advance                    */
/* ------------------------------------------------------------------ */

describe("prev/next clicks drive the engine's exact advance", () => {
  test("next: the store's nextAfter takes the mini over in place (loadVideoById, NO remount), the played video leaves the session queue, hostMode stays mini", async () => {
    await append(item("V1"), item("V2"), item("V3"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('[aria-label="Next video in queue"]');
    expect(usePlayerHost.getState().videoId).toBe("V2");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V2", "V3"]);
    expect(usePlayerHost.getState().hostMode).toBe("mini");
    expect(mainPlayers()).toHaveLength(1); // no remount — takeover
    expect(mainPlayers()[0].loadedVideoId).toBe("V2");
  });

  test("next at the last item is disabled — nothing happens (no wraparound)", async () => {
    await append(item("V1"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('[aria-label="Next video in queue"]'); // disabled → inert
    expect(usePlayerHost.getState().videoId).toBe("V1");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1"]);
  });

  test("prev: takes over to the item before now-playing WITHOUT consuming (the current keeps its queue slot)", async () => {
    await append(item("V1"), item("V2"), item("V3"));
    await renderMiniplayer();
    await attach("V2");
    await setMini(true);
    await click('[aria-label="Previous video in queue"]');
    expect(usePlayerHost.getState().videoId).toBe("V1");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1", "V2", "V3"]); // unconsumed
    expect(usePlayerHost.getState().hostMode).toBe("mini");
    expect(mainPlayers()).toHaveLength(1);
    expect(mainPlayers()[0].loadedVideoId).toBe("V1");
  });

  test("prev at the head is disabled — nothing happens", async () => {
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('[aria-label="Previous video in queue"]'); // disabled → inert
    expect(usePlayerHost.getState().videoId).toBe("V1");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1", "V2"]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Remove-from-queue — the real WL write, honest outcomes           */
/* ------------------------------------------------------------------ */

describe("drawer remove-from-queue: the real WL write, honest outcomes", () => {
  test("remove posts the real WL remove, drops the item, updates the badge — success toast", async () => {
    await append(item("V1"), item("V2"), item("V3"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    await click('[aria-label="Remove Title V2 from queue"]');
    await sleep(30); // the WL round-trip (stubbed fetch)
    expect(postCalls).toEqual([
      { url: "/api/playlists/watch-later", body: { videoId: "V2", add: false } },
    ]);
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1", "V3"]);
    expect(queueButton()!.textContent).toContain("2"); // the badge followed
    expect(toastCalls.some((t) => t.kind === "success")).toBe(true);
    // the drawer stays open (queue still non-empty) and shows the survivors
    expect(q('[aria-label="Miniplayer queue"]')!.textContent).toContain("Title V3");
  });

  test("a failed WL write keeps the item queued — the honest error toast, the item stays (broker offline)", async () => {
    fetchResponse = () =>
      new Response(
        JSON.stringify({ error: "action backend offline — the lead's broker must be running" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    await append(item("V1"), item("V2"));
    await renderMiniplayer();
    await attach("V1");
    await setMini(true);
    await click('button[aria-label^="Queue"]');
    await click('[aria-label="Remove Title V2 from queue"]');
    await sleep(30);
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1", "V2"]);
    expect(queueButton()!.textContent).toContain("2");
    const error = toastCalls.find((t) => t.kind === "error");
    expect(error).toBeDefined();
    expect(error!.message).toContain("broker must be running");
  });
});

/* ------------------------------------------------------------------ */
/* 6. The global mount — the app-shell composition                     */
/* ------------------------------------------------------------------ */

describe("the global mount: the real AppShell renders the drawer next to the player host layer", () => {
  test("on a non-watch route with NO watch page, the shell's queue button opens the drawer (the chrome stubs are other lanes' surfaces; the mount is real)", async () => {
    await append(item("V1"), item("V2"));
    await renderShell();
    expect(q('[data-testid="stub-topbar"]')).not.toBeNull(); // the shell rendered
    expect(q('[data-testid="route-tree"]')).not.toBeNull();
    await attach("V1");
    await setMini(true);
    const button = queueButton() as HTMLElement; // inside the shell's REAL layer
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toContain("2 videos");
    await click('button[aria-label^="Queue"]');
    const drawer = q('[aria-label="Miniplayer queue"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain("Title V1");
    expect(drawer!.textContent).toContain("Title V2");
  });
});

/* ------------------------------------------------------------------ */
/* 7. The watch-page panel regression guard (P4-QT semantics)          */
/* ------------------------------------------------------------------ */

describe("the watch-page panel regression guard (QueuePanel with a string currentVideoId — unchanged)", () => {
  test("the now-playing highlight + the real WL remove still work exactly as P4-QT shipped them", async () => {
    await append(item("V1"), item("V2"));
    await renderWatchPagePanel(); // watch-page.tsx mounts it with a string
    const rows = Array.from(
      host!.querySelectorAll('[role="listitem"]') as unknown as HTMLElement[],
    );
    expect(rows).toHaveLength(2);
    const playing = rows.find((r) => r.textContent!.includes("Now playing"));
    expect(playing).toBeDefined();
    expect(playing!.textContent).toContain("Title V1");
    await click('[aria-label="Remove Title V2 from queue"]');
    await sleep(30);
    expect(postCalls).toEqual([
      { url: "/api/playlists/watch-later", body: { videoId: "V2", add: false } },
    ]);
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1"]);
  });
});

/* ------------------------------------------------------------------ */
/* 8. selectPrevBefore — the additive prev law (pure)                  */
/* ------------------------------------------------------------------ */

describe("selectPrevBefore (the additive prev selector — nextAfter's mirror)", () => {
  const items = [item("V1"), item("V2"), item("V3")];
  test("null videoId, an empty queue, the head, and an unqueued id have nothing before them", () => {
    expect(selectPrevBefore(items, null)).toBeNull();
    expect(selectPrevBefore([], "V1")).toBeNull();
    expect(selectPrevBefore(items, "V1")).toBeNull(); // the head
    expect(selectPrevBefore(items, "ZZZ")).toBeNull(); // outside the order
  });
  test("middle + last resolve to the item immediately before, in insertion order", () => {
    expect(selectPrevBefore(items, "V2")?.videoId).toBe("V1");
    expect(selectPrevBefore(items, "V3")?.videoId).toBe("V2");
  });
});
