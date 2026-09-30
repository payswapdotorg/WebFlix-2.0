/// <reference types="bun-types" />
/**
 * WFX2-B-S tests — the comment composer's YouTube-parity states:
 * "Comment..." placeholder, the 0/10000 char counter, the Comment button
 * disabled until non-empty, the canonical /api/posts submit, and the
 * signed-out (public mode) "Sign in to continue to comment" state that
 * links the account flow. happy-dom + createRoot/act (the
 * ambient-backdrop test pattern) with a stubbed fetch + sonner.
 */
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
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

// ---- stubs: fetch (the composer's POST) + sonner (toasts) ----
const submitted: { url: string; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  submitted.push({ url: u, body });
  return new Response(
    JSON.stringify({
      id: "yt-new-1",
      parentId: null,
      body: body?.body ?? "",
      author: { id: "u1", handle: "demo", name: "Demo", avatarUrl: "", isMember: false, isCreator: false },
      createdAt: new Date().toISOString(),
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
}) as unknown as typeof fetch;

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((msg: string) => toasts.push(String(msg)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const { CommentComposer } = await import("@/components/watch/comment-composer");

const VIEWER = { id: "u1", handle: "demo", name: "Demo", avatarUrl: "https://x/a.png" };

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

async function render(opts: { operatorSession?: boolean; onSubmitted?: (c: any) => void } = {}) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <CommentComposer
        videoId="dQw4w9WgXcQ"
        viewer={VIEWER}
        operatorSession={opts.operatorSession}
        onSubmitted={opts.onSubmitted ?? (() => {})}
      />
    );
  });
}

/** type into a textarea the way a user would. happy-dom + React 19: the
 * focusin → prototype-setter → keyup sequence is what triggers React's
 * change detection (the plain input event does not — verified in this
 * environment; the value tracker still gates changes correctly). */
async function typeInto(ta: HTMLTextAreaElement, text: string) {
  await act(async () => {
    ta.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(ta);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(ta, text);
  await act(async () => {
    ta.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

/** find the primary Comment submit button (text match) */
function submitButton(): HTMLButtonElement | null {
  return all("button").find((b) => /^comment$/i.test((b.textContent ?? "").trim())) as
    | HTMLButtonElement
    | undefined ?? null;
}

beforeEach(() => {
  submitted.length = 0;
  toasts.length = 0;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  globalThis.fetch = realFetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    submitted.push({ url: u, body });
    return new Response(
      JSON.stringify({ id: "yt-new-1", body: body?.body ?? "", createdAt: new Date().toISOString() }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;
});

describe("CommentComposer — YouTube parity states", () => {
  test('placeholder reads "Comment..." and maxLength is 10000', async () => {
    await render();
    const ta = q("textarea") as unknown as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta!.getAttribute("placeholder")).toBe("Comment...");
    expect(ta!.getAttribute("maxlength")).toBe("10000");
  });

  test("char counter appears when typing and reads N/10000", async () => {
    await render();
    expect(all("span").some((s) => /0\/10000/.test(s.textContent ?? ""))).toBe(false);
    const ta = q("textarea") as unknown as HTMLTextAreaElement;
    await typeInto(ta, "hello");
    expect(all("span").some((s) => /^5\/10000$/.test((s.textContent ?? "").trim()))).toBe(true);
  });

  test("Comment button disabled until non-empty; enabled with text", async () => {
    await render();
    const btn = submitButton();
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    const ta = q("textarea") as unknown as HTMLTextAreaElement;
    await typeInto(ta, "a real comment");
    expect(submitButton()!.disabled).toBe(false);
  });

  test("submit posts the canonical /api/comments route with {videoId, body}", async () => {
    const got: any[] = [];
    await render({ onSubmitted: (c) => got.push(c) });
    const ta = q("textarea") as unknown as HTMLTextAreaElement;
    await typeInto(ta, "posted from the composer test");
    await act(async () => {
      submitButton()!.click();
    });
    expect(submitted).toHaveLength(1);
    expect(submitted[0].url).toBe("/api/comments");
    expect(submitted[0].body).toEqual({ videoId: "dQw4w9WgXcQ", body: "posted from the composer test", parentId: undefined, parentText: undefined });
    expect(got).toHaveLength(1); // optimistic insert contract kept
  });

  test("signed-out (public mode): the Comment... affordance opens the Sign in dialog", async () => {
    await render({ operatorSession: false });
    // no textarea — the write surface never fakes an editable composer
    expect(q("textarea")).toBeNull();
    const affordance = all("button").find((b) => (b.textContent ?? "").trim() === "Comment...");
    expect(affordance).toBeDefined();
    await act(async () => {
      affordance!.click();
    });
    await act(async () => {});
    // radix portals the dialog into document.body — assert against the document
    expect(win.document.body.textContent).toContain("Sign in to continue to comment");
    const links = Array.from(win.document.querySelectorAll("a"));
    expect(links.some((a) => a.getAttribute("href") === "/account")).toBe(true);
  });

  test("signed-out state renders no submit button (never a fake write)", async () => {
    await render({ operatorSession: false });
    expect(submitButton()).toBeNull();
    expect(submitted).toHaveLength(0);
  });
});
