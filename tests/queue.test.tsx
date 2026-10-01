/// <reference types="bun-types" />
/**
 * WFX2-P4-QT tests — the queue battery:
 * - store semantics (ordered append, dedupe, cap, remove, played-consumption,
 *   next-after ordering);
 * - WL-backed append/remove (queue-actions against a stubbed fetch): the
 *   session queue only mutates AFTER the real watch-later write confirms —
 *   NEVER a fake append; an offline/failed write surfaces the honest error;
 * - continuous play order (the engine advancing the miniplayer through the
 *   queue, the watch-page defer guard, the autoplay preference);
 * - the watch-later route contract the queue rides (add:true → mode "add",
 *   honest 502 when the broker is offline);
 * - the ActionRow affordance (the Add to queue pill: label, pressed state,
 *   click → the wired handler).
 *
 * Idiom: action-routes (broker mock + capture/restore), miniplayer
 * (happy-dom + createRoot/act). No network, no live CDP.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

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
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---- stubbed global fetch (the queue-actions client seams) ----
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

/* ---- the broker mock for the watch-later route (action-routes pattern:
 * capture the real module, mock, restore in afterAll) ---- */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realBroker = { ...require("@/lib/broker") } as Record<string, unknown>;

class MockBrokerError extends Error {
  kind: string;
  status: number;
  constructor(kind: string, message: string, status: number) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
  }
}

const brokerCalls: { kind: string; target: unknown; payload: unknown }[] = [];
let brokerResponse: unknown = { ok: true, verified: true, path: "ui" };

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerAction: async (kind: string, target: unknown, payload?: unknown) => {
    brokerCalls.push({ kind, target, payload });
    return typeof brokerResponse === "function"
      ? brokerResponse({ kind, target, payload })
      : brokerResponse;
  },
  brokerOk: (r: unknown) => !(r instanceof MockBrokerError),
  brokerUrl: () => "http://127.0.0.1:3055",
  brokerSecret: () => "s3cret",
  brokerConfigured: () => true,
  brokerTimeoutMs: () => 15000,
}));

/* ---- modules under test (imported after the mocks, action-routes style) ---- */
import {
  QUEUE_CAP,
  createQueueStore,
  resetQueueStoreForTests,
  useQueueStore,
  type QueueItem,
} from "@/lib/queue/queue-store";
import { addToQueue, removeFromQueue } from "@/lib/queue/queue-actions";
import { resetQueueEngineForTests, startQueueEngine } from "@/lib/queue/queue-engine";
import { playerHost, resetPlayerHostForTests, usePlayerHost } from "@/lib/player/player-host";
import { POST as postWatchLater } from "@/app/api/playlists/watch-later/route";
import { mintSessionCookie } from "./helpers";
import { ActionRow } from "@/components/watch/action-row";

const item = (videoId: string): QueueItem => ({
  videoId,
  title: `Title ${videoId}`,
  channelName: `Channel ${videoId}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  durationSec: 100,
});

let AUTH_COOKIE = "";

beforeAll(async () => {
  // the write routes sit behind the auth gate — sign in (the action-routes pattern)
  AUTH_COOKIE = await mintSessionCookie();
});

beforeEach(() => {
  postCalls.length = 0;
  brokerCalls.length = 0;
  fetchResponse = () =>
    new Response(JSON.stringify({ ok: true, added: true, playlistId: "WL" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  brokerResponse = { ok: true, verified: true, path: "ui" };
  resetQueueStoreForTests();
  resetQueueEngineForTests();
  resetPlayerHostForTests();
  try {
    win.localStorage.clear();
  } catch {
    /* fresh window */
  }
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
  mock.module("@/lib/broker", () => realBroker);
});

/* ------------------------------------------------------------------ */
/* 1. Store semantics (isolated factory store — no singleton)          */
/* ------------------------------------------------------------------ */

describe("queue store semantics", () => {
  test("append is ordered; has/clear mirror membership", () => {
    const store = createQueueStore();
    expect(store.getState().append(item("V1"))).toBe("appended");
    expect(store.getState().append(item("V2"))).toBe("appended");
    expect(store.getState().append(item("V3"))).toBe("appended");
    expect(store.getState().items.map((i) => i.videoId)).toEqual(["V1", "V2", "V3"]);
    expect(store.getState().has("V2")).toBe(true);
    expect(store.getState().has("V4")).toBe(false);
    store.getState().clear();
    expect(store.getState().items).toEqual([]);
  });

  test("append dedupes (a queued video is never re-appended)", () => {
    const store = createQueueStore();
    store.getState().append(item("V1"));
    expect(store.getState().append(item("V1"))).toBe("already-queued");
    expect(store.getState().items).toHaveLength(1);
  });

  test("append caps at QUEUE_CAP with an honest full refusal (no silent drop)", () => {
    const store = createQueueStore();
    for (let i = 0; i < QUEUE_CAP; i++) {
      expect(store.getState().append(item(`V${i}`))).toBe("appended");
    }
    expect(store.getState().items).toHaveLength(QUEUE_CAP);
    expect(store.getState().append(item("VX"))).toBe("full");
    expect(store.getState().items).toHaveLength(QUEUE_CAP); // nothing dropped
    expect(store.getState().has("VX")).toBe(false);
  });

  test("remove drops exactly the item", () => {
    const store = createQueueStore();
    store.getState().append(item("V1"));
    store.getState().append(item("V2"));
    store.getState().remove("V1");
    expect(store.getState().items.map((i) => i.videoId)).toEqual(["V2"]);
  });

  test("markPlayed consumes the played video only (session view — WL keeps it)", () => {
    const store = createQueueStore();
    store.getState().append(item("V1"));
    store.getState().append(item("V2"));
    store.getState().append(item("V3"));
    store.getState().markPlayed("V2");
    expect(store.getState().items.map((i) => i.videoId)).toEqual(["V1", "V3"]);
  });

  test("nextAfter: after the current, head for unqueued, null at the end/empty", () => {
    const store = createQueueStore();
    expect(store.getState().nextAfter(null)).toBeNull(); // empty
    store.getState().append(item("V1"));
    store.getState().append(item("V2"));
    store.getState().append(item("V3"));
    expect(store.getState().nextAfter("V1")?.videoId).toBe("V2");
    expect(store.getState().nextAfter("V2")?.videoId).toBe("V3");
    expect(store.getState().nextAfter("V3")).toBeNull(); // last
    expect(store.getState().nextAfter("ZZZ")?.videoId).toBe("V1"); // unqueued → head
    expect(store.getState().nextAfter(null)?.videoId).toBe("V1"); // no current → head
  });
});

/* ------------------------------------------------------------------ */
/* 2. WL-backed append/remove — never a fake append                    */
/* ------------------------------------------------------------------ */

describe("queue-actions: the WL-backed append/remove", () => {
  test("addToQueue posts the real watch-later add FIRST, then appends", async () => {
    const outcome = await addToQueue(item("V1"));
    expect(outcome).toEqual({ status: "appended" });
    expect(postCalls).toEqual([
      {
        url: "/api/playlists/watch-later",
        body: { videoId: "V1", add: true },
      },
    ]);
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1"]);
  });

  test("a failed write NEVER appends (never a fake append) — the honest error surfaces", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ error: "action backend offline — the lead's broker must be running" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    const outcome = await addToQueue(item("V1"));
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.message).toContain("broker must be running");
    }
    expect(useQueueStore.getState().items).toEqual([]); // the queue gained nothing
  });

  test("an already-queued video short-circuits (no duplicate WL call)", async () => {
    useQueueStore.getState().append(item("V1"));
    postCalls.length = 0;
    const outcome = await addToQueue(item("V1"));
    expect(outcome).toEqual({ status: "already-queued" });
    expect(postCalls).toEqual([]);
    expect(useQueueStore.getState().items).toHaveLength(1);
  });

  test("removeFromQueue posts the real WL remove, then removes", async () => {
    useQueueStore.getState().append(item("V1"));
    postCalls.length = 0;
    const outcome = await removeFromQueue("V1");
    expect(outcome).toEqual({ status: "removed" });
    expect(postCalls).toEqual([
      {
        url: "/api/playlists/watch-later",
        body: { videoId: "V1", add: false },
      },
    ]);
    expect(useQueueStore.getState().items).toEqual([]);
  });

  test("a failed remove keeps the item queued (honest — server truth unconfirmed)", async () => {
    useQueueStore.getState().append(item("V1"));
    fetchResponse = () =>
      new Response(JSON.stringify({ error: "action failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    const outcome = await removeFromQueue("V1");
    expect(outcome.status).toBe("error");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V1"]);
  });

  test("not-in-queue remove is a no-op (no WL call)", async () => {
    const outcome = await removeFromQueue("V9");
    expect(outcome).toEqual({ status: "not-in-queue" });
    expect(postCalls).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Continuous play — the engine advancing the miniplayer            */
/* ------------------------------------------------------------------ */

describe("queue engine: continuous play order", () => {
  test("ENDED in mini mode advances in insertion order, consuming the played video", () => {
    useQueueStore.getState().append(item("V1"));
    useQueueStore.getState().append(item("V2"));
    useQueueStore.getState().append(item("V3"));
    playerHost.attach({ videoId: "V1", title: "Title V1" });
    startQueueEngine();

    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V2");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V2", "V3"]);
    expect(usePlayerHost.getState().hostMode).toBe("mini"); // re-mini'd in the same task

    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V3");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V3"]);

    // the last item: nothing after it → the player stays (no wraparound)
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V3");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V3"]);
  });

  test("an unqueued current video falls to the queue's head, then continues in order", () => {
    useQueueStore.getState().append(item("A"));
    useQueueStore.getState().append(item("B"));
    playerHost.attach({ videoId: "OUTSIDE" });
    startQueueEngine();
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("A");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["A", "B"]);
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("B");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["B"]);
  });

  test("a watch page owning the player defers to its countdown (the engine stands down)", () => {
    useQueueStore.getState().append(item("V2"));
    playerHost.attach({ videoId: "V1" });
    playerHost.slot = win.document.createElement("div") as unknown as HTMLElement; // the watch page's slot
    startQueueEngine();
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V1"); // no advance
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V2"]);
    playerHost.slot = null;
  });

  test("the autoplay preference (off) stops the advance", () => {
    useQueueStore.getState().append(item("V2"));
    playerHost.attach({ videoId: "V1" });
    win.localStorage.setItem("wfx2-autoplay", "0");
    startQueueEngine();
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V1");
    expect(useQueueStore.getState().items.map((i) => i.videoId)).toEqual(["V2"]);
  });

  test("an empty queue never advances", () => {
    playerHost.attach({ videoId: "V1" });
    startQueueEngine();
    playerHost.ended();
    expect(usePlayerHost.getState().videoId).toBe("V1");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The route the queue rides — POST /api/playlists/watch-later      */
/* ------------------------------------------------------------------ */

describe("POST /api/playlists/watch-later (the queue's WL seam)", () => {
  test("the queue append shape: add:true → broker watch-later mode add", async () => {
    const res = await postWatchLater(
      new Request("http://localhost/api/playlists/watch-later", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
        body: JSON.stringify({ videoId: "V1", add: true }),
      }) as unknown as Parameters<typeof postWatchLater>[0]
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: boolean; playlistId: string };
    expect(body.added).toBe(true);
    expect(body.playlistId).toBe("WL");
    expect(brokerCalls[0].kind).toBe("watch-later");
    expect(brokerCalls[0].payload).toEqual({ mode: "add" });
  });

  test("guest (no session) → 401, never a write", async () => {
    const res = await postWatchLater(
      new Request("http://localhost/api/playlists/watch-later", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: "V1", add: true }),
      }) as unknown as Parameters<typeof postWatchLater>[0]
    );
    expect(res.status).toBe(401);
    expect(brokerCalls).toHaveLength(0);
  });

  test("broker offline → the honest 502 (the queue's append degrades honestly)", async () => {
    brokerResponse = new MockBrokerError(
      "offline",
      "action backend offline — the lead's broker must be running",
      502
    );
    const res = await postWatchLater(
      new Request("http://localhost/api/playlists/watch-later", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
        body: JSON.stringify({ videoId: "V1", add: true }),
      }) as unknown as Parameters<typeof postWatchLater>[0]
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("broker must be running");
  });
});

/* ------------------------------------------------------------------ */
/* 5. The ActionRow affordance                                         */
/* ------------------------------------------------------------------ */

describe("ActionRow: Add to queue affordance", () => {
  let root: Root | null = null;
  let host: ReturnType<typeof win.document.createElement> | null = null;

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

  const q = (sel: string): HTMLElement | null =>
    host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

  async function renderRow(queued: boolean, onAddToQueue: () => void) {
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <ActionRow
          videoId="V1"
          likes={1}
          dislikes={0}
          yourLike={null}
          savedWatchLater={false}
          onLikeResult={() => {}}
          onShare={() => {}}
          onSave={() => {}}
          onToggleTranscript={() => {}}
          onReport={() => {}}
          onAddToQueue={onAddToQueue}
          queued={queued}
        />
      );
    });
  }

  test("the pill renders between Save and the kebab; click fires the wired handler", async () => {
    let added = 0;
    await renderRow(false, () => {
      added += 1;
    });
    const buttons = Array.from(host!.querySelectorAll("button"));
    const pill = buttons.find((b) => b.textContent?.includes("Add to queue"));
    expect(pill).toBeDefined();
    expect(pill!.getAttribute("aria-pressed")).toBe("false");
    // between Save and the kebab (the save pill before it, more-actions after)
    const save = buttons.find((b) => b.textContent?.includes("Save"));
    const kebab = buttons.find((b) => b.getAttribute("aria-label") === "More actions");
    expect(save).toBeDefined();
    expect(kebab).toBeDefined();
    expect(buttons.indexOf(pill!)).toBeGreaterThan(buttons.indexOf(save!));
    expect(buttons.indexOf(kebab!)).toBeGreaterThan(buttons.indexOf(pill!));
    await act(async () => {
      pill!.click();
    });
    expect(added).toBe(1);
  });

  test("queued=true → the pressed affordance mirrors membership", async () => {
    await renderRow(true, () => {});
    const buttons = Array.from(host!.querySelectorAll("button"));
    const pill = buttons.find((b) => b.textContent?.includes("Add to queue"));
    expect(pill!.getAttribute("aria-pressed")).toBe("true");
  });
});
