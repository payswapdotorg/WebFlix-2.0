/// <reference types="bun-types" />
/**
 * WFX2-P23-A tests — the Share dialog's Clip tab (the measured
 * yt-clip-creation family): the tab row, the name field (char counter),
 * the trimmer's default window + the 15–60s law through the EDITABLE
 * timestamp inputs (youtube.com's own #text-inputs row), the guest gate
 * (no write attempted), the create POST + the post-create share sheet
 * with the honest upstream note, and the honest create failure.
 * happy-dom + createRoot/act (the comment-composer pattern).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
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
  "PointerEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
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

// ---- stubs: sonner + fetch (the create POST) ----
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const posted: { url: string; body: any }[] = [];
let createResult: { status: number; body: Record<string, unknown> } = {
  status: 200,
  body: { ok: true, clipId: "clnewclip00000001", url: "/clip/clnewclip00000001", note: "This clip lives on WebFlix — the link shares the trimmed range of the video." },
};
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.includes("/api/clip") && init?.method === "POST") {
    posted.push({ url: u, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(createResult.body), {
      status: createResult.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({}), { status: 200 });
}) as unknown as typeof fetch;

Object.defineProperty(win.navigator, "clipboard", {
  value: {
    writeText: () => Promise.resolve(),
  },
  configurable: true,
  writable: true,
});

const { ShareDialog } = await import("@/components/watch/share-dialog");

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

// radix Dialog portals into document.body — query the DOCUMENT, not host
const q = (sel: string): HTMLElement | null =>
  win.document.querySelector(sel) as unknown as HTMLElement | null;
const qa = (sel: string): HTMLElement[] =>
  Array.from(win.document.querySelectorAll(sel) as unknown as HTMLElement[]);
const buttons = (): HTMLElement[] => qa("button");

const VIEWER = { name: "Demo User", avatarUrl: "https://x/a.png" };

beforeEach(() => {
  posted.length = 0;
  createResult = {
    status: 200,
    body: { ok: true, clipId: "clnewclip00000001", url: "/clip/clnewclip00000001", note: "This clip lives on WebFlix — the link shares the trimmed range of the video." },
  };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
});

async function render(opts: { guest?: boolean } = {}) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <ShareDialog
        open
        onOpenChange={() => {}}
        videoId="dQw4w9WgXcQ"
        title="Rick Astley - Never Gonna Give You Up"
        currentTime={120}
        durationSec={600}
        viewer={opts.guest ? null : VIEWER}
        guest={opts.guest ?? false}
        signInPath="/watch/dQw4w9WgXcQ"
      />
    );
  });
}

/** click the Clip tab (radix TabsTrigger: pointerdown → mousedown → click;
 *  retried while radix's portal commit lands). */
async function openClipTab() {
  const tab = buttons().find((b) => (b.textContent ?? "").trim() === "Clip");
  expect(tab).toBeTruthy();
  for (let i = 0; i < 10 && !q('[data-testid="clip-tab"]'); i++) {
    await act(async () => {
      tab!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      tab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
  expect(q('[data-testid="clip-tab"]')).toBeTruthy();
}

/** type into the name textarea (the house typeInto idiom). */
async function typeName(text: string) {
  const ta = q('[data-testid="clip-name-input"]') as HTMLTextAreaElement | null;
  expect(ta).toBeTruthy();
  await act(async () => {
    ta!.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(ta);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(ta, text);
  await act(async () => {
    ta!.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

/** set + blur a timestamp input (the house idiom: focusin → proto-set →
 *  keyup makes React's onChange see the value; focusout commits via onBlur). */
async function commitTimeInput(testid: string, text: string) {
  const input = q(`[data-testid="${testid}"]`) as HTMLInputElement | null;
  expect(input).toBeTruthy();
  await act(async () => {
    input!.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, text);
  await act(async () => {
    input!.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
  await act(async () => {
    input!.dispatchEvent(new Event("focusout", { bubbles: true }));
  });
}

describe("the Share dialog's Clip tab (the measured creation family)", () => {
  test("the tab row: Share | Clip; the Clip tab renders the measured form", async () => {
    await render();
    // the Share tab is the default (the link box)
    expect(q('[data-testid="share-tab"]')).toBeTruthy();
    await openClipTab();
    expect(q('[data-testid="clip-tab"]')).toBeTruthy();
    // the measured structure: name field + trimmer + start/end inputs + footer
    expect(q('[data-testid="clip-name-input"]')).toBeTruthy();
    expect(q('[data-testid="clip-trimmer"]')).toBeTruthy();
    expect(q('[data-testid="clip-start-input"]')).toBeTruthy();
    expect(q('[data-testid="clip-end-input"]')).toBeTruthy();
    expect(buttons().some((b) => /Cancel/.test(b.textContent ?? ""))).toBe(true);
    expect(buttons().some((b) => /Create Clip/.test(b.textContent ?? ""))).toBe(true);
    // the title row: viewer name + Public (the measured #title)
    expect(win.document.body.textContent).toContain("Demo User");
    expect(win.document.body.textContent).toContain("Public");
  });

  test("the default window: 15s at the playhead (2:00 – 2:15 on a 600s video)", async () => {
    await render();
    await openClipTab();
    expect((q('[data-testid="clip-start-input"]') as HTMLInputElement)?.value).toBe("2:00");
    expect((q('[data-testid="clip-end-input"]') as HTMLInputElement)?.value).toBe("2:15");
    expect(q('[data-testid="clip-duration-label"]')?.textContent).toContain("15s");
    expect(q('[data-testid="clip-duration-label"]')?.textContent).toContain("2:00 – 2:15");
  });

  test("the 15s floor through the end input: 2:05 clamps to 2:15", async () => {
    await render();
    await openClipTab();
    await commitTimeInput("clip-end-input", "2:05");
    expect((q('[data-testid="clip-end-input"]') as HTMLInputElement)?.value).toBe("2:15");
  });

  test("the 60s ceiling through the end input: 4:00 clamps to 3:00", async () => {
    await render();
    await openClipTab();
    await commitTimeInput("clip-end-input", "4:00");
    expect((q('[data-testid="clip-end-input"]') as HTMLInputElement)?.value).toBe("3:00");
  });

  test("the start input obeys the same law (anchored at end 2:15: 15s floor up, 60s ceiling up)", async () => {
    await render();
    await openClipTab();
    // 2:25 is only 10s before the 2:15 end → the 15s floor clamps UP to 2:00
    await commitTimeInput("clip-start-input", "2:25");
    expect((q('[data-testid="clip-start-input"]') as HTMLInputElement)?.value).toBe("2:00");
    // 0:00 is 135s before the 2:15 end → the 60s ceiling clamps UP to 1:15
    await commitTimeInput("clip-start-input", "0:00");
    expect((q('[data-testid="clip-start-input"]') as HTMLInputElement)?.value).toBe("1:15");
  });

  test("junk time input → the warning icon state, the WINDOW unchanged", async () => {
    await render();
    await openClipTab();
    await commitTimeInput("clip-end-input", "abc");
    // the measured warning icon (aria-labeled, per #warning-end)
    expect(q('[aria-label="Invalid end time"]')).toBeTruthy();
    // the window state is unchanged (never a junk commit) — the duration
    // label still reads the 2:00 – 2:15 default
    expect(q('[data-testid="clip-duration-label"]')?.textContent).toContain("2:00 – 2:15");
    expect(q('[data-testid="clip-too-short"]')).toBeFalsy();
  });

  test("Create Clip disabled until named; enabled after; posts the honest body", async () => {
    await render();
    await openClipTab();
    const createBtn = () => buttons().find((b) => /Create Clip/.test(b.textContent ?? ""))!;
    expect(createBtn().hasAttribute("disabled")).toBe(true);
    await typeName("My test clip");
    expect(createBtn().hasAttribute("disabled")).toBe(false);
    await act(async () => {
      createBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(posted.length).toBe(1);
    expect(posted[0].url).toContain("/api/clip");
    expect(posted[0].body).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: "My test clip",
      startSec: 120,
      endSec: 135,
    });
  });

  test("post-create: the share sheet with the clip URL + the honest upstream note + Open clip", async () => {
    await render();
    await openClipTab();
    await typeName("Shared clip");
    await act(async () => {
      buttons()
        .find((b) => /Create Clip/.test(b.textContent ?? ""))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(q('[data-testid="clip-created-sheet"]')).toBeTruthy();
    expect(q('[data-testid="share-url"]')?.textContent).toBe(
      `${win.location.origin}/clip/clnewclip00000001`
    );
    expect(q('[data-testid="clip-honest-note"]')?.textContent).toContain("lives on WebFlix");
    expect((q('[data-testid="clip-open-link"]') as HTMLAnchorElement)?.getAttribute("href")).toBe(
      "/clip/clnewclip00000001"
    );
    // no second create is possible from the sheet (the form is gone)
    expect(q('[data-testid="clip-create-button"]')).toBeFalsy();
  });

  test("a failed create → the honest error line (never a fake success)", async () => {
    createResult = { status: 400, body: { error: "Clips must be at least 15 seconds long" } };
    await render();
    await openClipTab();
    await typeName("Doomed clip");
    await act(async () => {
      buttons()
        .find((b) => /Create Clip/.test(b.textContent ?? ""))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(q('[data-testid="clip-error"]')?.textContent).toContain("at least 15 seconds");
    expect(q('[data-testid="clip-created-sheet"]')).toBeFalsy();
  });

  test("guests: the create routes to sign-in — NO write is attempted", async () => {
    const assigns: string[] = [];
    Object.defineProperty(win.location, "assign", {
      value: (u: string) => assigns.push(u),
      configurable: true,
      writable: true,
    });
    await render({ guest: true });
    await openClipTab();
    await typeName("Guest clip");
    await act(async () => {
      buttons()
        .find((b) => /Create Clip/.test(b.textContent ?? ""))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(posted.length).toBe(0);
    expect(assigns.length).toBe(1);
    expect(assigns[0]).toContain("/signin");
    expect(assigns[0]).toContain("redirect=");
  });

  test("the char counter caps at 100 (the title-family limit)", async () => {
    await render();
    await openClipTab();
    await typeName("a".repeat(140));
    expect((q('[data-testid="clip-name-input"]') as HTMLTextAreaElement)?.value.length).toBe(100);
    expect(win.document.body.textContent).toContain("100/100");
  });
});
