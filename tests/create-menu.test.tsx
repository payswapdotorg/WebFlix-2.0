/// <reference types="bun-types" />
/**
 * WFX2-P6-UP tests — the topbar's "+ CREATE" pill (create-menu.tsx):
 *  - the pill renders with the preserved data-testids (create-button,
 *    create-menu, create-upload-video, create-go-live, create-new-post);
 *  - the LAZY fetch law: /api/studio is NOT called while the menu is
 *    closed — the useApi(null) idiom reads the operator channel only
 *    while the menu is open;
 *  - the honest-absence law: "New post" (the own-channel composer deep
 *    link) appears ONLY when the operator's real channel handle resolves;
 *    a null channel and a guest's 401 both degrade to its honest absence —
 *    never a dead link;
 *  - Upload video deep-links /upload (the studio wizard) and Go live
 *    deep-links the real live rail route /explore/live.
 *
 * NOTE on import order (the upload-wizard note applies here too): the
 * happy-dom globals MUST exist BEFORE the component's module graph is
 * imported — Radix's use-layout-effect shim decides
 * `useLayoutEffect = document ? real : noop` at MODULE-EVAL time, and a
 * noop would silently keep the dropdown's portal content unmounted.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/* ---- happy-dom globals (set BEFORE the component imports — see NOTE) ---- */
const win = new Window();
for (const p of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeFilter",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const) {
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

/* ---- the component imported AFTER the globals exist ---- */
const { CreateMenu } = await import("@/components/app/create-menu");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;
const { act } = await import("react");
const { createElement } = await import("react");

/* ------------------------------------------------------------------ */
/* the fetch stub — /api/studio answers from here                      */
/* ------------------------------------------------------------------ */

const studioBody = (channel: { handle: string } | null) => ({
  session: channel !== null,
  channel,
  videos: [],
  totals: null,
  analytics: null,
  deepLinks: null,
  loginRequired: false,
});

const fetchLog: string[] = [];
let studioResponse: () => Response = () =>
  new Response(JSON.stringify(studioBody(null)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const realFetch = globalThis.fetch;

function installFetch(responder: () => Response): void {
  studioResponse = responder;
  fetchLog.length = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String((input as Request)?.url ?? input);
    fetchLog.push(url);
    if (url.includes("/api/studio")) return studioResponse();
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

/* ------------------------------------------------------------------ */
/* render + open helpers                                               */
/* ------------------------------------------------------------------ */

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  host?.remove();
  host = null;
  globalThis.fetch = realFetch;
});

afterAll(() => {
  win.happyDOM?.close?.();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderMenu(): Promise<void> {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root?.render(createElement(CreateMenu));
  });
}

/** Open the dropdown the keyboard way (Radix's trigger opens on Enter). */
async function openMenu(): Promise<void> {
  const trigger = host!.querySelector(
    '[data-testid="create-button"]'
  ) as unknown as HTMLElement;
  await act(async () => {
    trigger.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event
    );
  });
  await act(async () => {
    await sleep(80); // the portal mounts on the commit after the state flip
  });
}

/* ------------------------------------------------------------------ */
/* the tests                                                           */
/* ------------------------------------------------------------------ */

describe("the + CREATE pill", () => {
  test("renders the pill trigger; the menu stays closed until opened", async () => {
    installFetch(() => new Response(JSON.stringify(studioBody(null)), { status: 200 }));
    await renderMenu();
    expect(host!.querySelector('[data-testid="create-button"]')).not.toBeNull();
    expect(host!.textContent).toContain("Create");
    expect(win.document.querySelector('[data-testid="create-menu"]')).toBeNull();
  });

  test("the LAZY fetch law: /api/studio is not read while the menu is closed", async () => {
    installFetch(() => new Response(JSON.stringify(studioBody(null)), { status: 200 }));
    await renderMenu();
    await act(async () => {
      await sleep(60);
    });
    expect(fetchLog.some((u) => u.includes("/api/studio"))).toBe(false);
    await openMenu();
    expect(fetchLog.some((u) => u.includes("/api/studio?enrich=0"))).toBe(true);
  });

  test("open: Upload video → /upload and Go live → /explore/live; NO New post while no channel resolves", async () => {
    installFetch(() => new Response(JSON.stringify(studioBody(null)), { status: 200 }));
    await renderMenu();
    await openMenu();
    const menu = win.document.querySelector('[data-testid="create-menu"]');
    expect(menu).not.toBeNull();

    const upload = win.document.querySelector(
      '[data-testid="create-upload-video"]'
    ) as unknown as HTMLAnchorElement;
    expect(upload).not.toBeNull();
    expect(upload.getAttribute("href")).toBe("/upload");
    expect(upload.textContent).toContain("Upload video");

    const live = win.document.querySelector(
      '[data-testid="create-go-live"]'
    ) as unknown as HTMLAnchorElement;
    expect(live).not.toBeNull();
    expect(live.getAttribute("href")).toBe("/explore/live");
    expect(live.textContent).toContain("Go live");

    // the honest absence: no own channel resolved → no New post deep link
    expect(win.document.querySelector('[data-testid="create-new-post"]')).toBeNull();
    expect(win.document.body.textContent).not.toContain("New post");
  });

  test("the operator channel resolving surfaces the New post composer deep link", async () => {
    installFetch(
      () =>
        new Response(JSON.stringify(studioBody({ handle: "@webflix-op" })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    await renderMenu();
    await openMenu();
    const post = win.document.querySelector(
      '[data-testid="create-new-post"]'
    ) as unknown as HTMLAnchorElement;
    expect(post).not.toBeNull();
    expect(post.getAttribute("href")).toBe("/channel/@webflix-op?compose=1");
    expect(post.textContent).toContain("New post");
  });

  test("a guest's 401 from /api/studio degrades to the honest absence too (never a dead link)", async () => {
    installFetch(
      () =>
        new Response(JSON.stringify({ error: "authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
    );
    await renderMenu();
    await openMenu();
    expect(win.document.querySelector('[data-testid="create-menu"]')).not.toBeNull();
    expect(win.document.querySelector('[data-testid="create-upload-video"]')).not.toBeNull();
    expect(win.document.querySelector('[data-testid="create-new-post"]')).toBeNull();
  });
});
