/// <reference types="bun-types" />
/**
 * WFX2-P20 tests — the send-feedback form at YouTube's real structure
 * depth (happy-dom + createRoot/act, the settings-system pattern; fetch
 * is stubbed in-process — NO network, NO database):
 *
 *   - the category select over YouTube's ACTUAL feedback-tool list
 *     (mirrored verbatim; the provenance disclosure),
 *   - the description textarea with the live character count,
 *   - the screenshot-attach row — YouTube's row, honestly absent (no
 *     checkbox, no file input, never a fake capture),
 *   - the legal notice line (YouTube's wording, honestly adapted),
 *   - submit → the existing /api/feedback local capture + YouTube's
 *     confirmation wording on top of the honest copy.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

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

// ---- the fetch stub (per-test programmable; logs every call) ----
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

const {
  FEEDBACK_CATEGORIES,
  FEEDBACK_DISCLOSURE,
  MAX_FEEDBACK_LENGTH,
} = await import("@/app/feedback/shared");
const FeedbackView = (await import("@/app/feedback/view")).default;

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const buttons = () => all("button") as unknown as HTMLButtonElement[];

async function render() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<FeedbackView />);
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

const sendButton = () =>
  buttons().find((b) => /^send feedback$/i.test((b.textContent ?? "").trim())) ?? null;

beforeEach(async () => {
  fetchLog.length = 0;
  fetchHandler = () => new Response("{}", { status: 200 });
  await render();
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

describe("P20 /feedback: the category select (YouTube's actual categories list)", () => {
  test("renders YouTube's real feedback-tool list, verbatim and complete", () => {
    const select = q("select") as unknown as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual([...FEEDBACK_CATEGORIES]);
    // spot-checks: the real first option, a real TV category, a real
    // feature request, the last option
    expect(options[0]).toBe("General Feedback");
    expect(options).toContain("Casting - Can't connect");
    expect(options).toContain("Feature request - Want to block a channel");
    expect(options[options.length - 1]).toBe("Feature request - Other");
  });

  test("the list's provenance is disclosed on the page (mirrored exactly, never curated)", () => {
    expect(q("[data-feedback-category-note]")).not.toBeNull();
    expect(host!.textContent).toContain(
      "YouTube's own feedback-tool category list"
    );
    expect(host!.textContent).toContain("TV and app categories included");
    expect(host!.textContent).toContain("it never leaves this server");
  });

  test("the default selection is YouTube's first option", () => {
    const select = q("select") as unknown as HTMLSelectElement;
    expect(select.value).toBe("General Feedback");
  });
});

describe("P20 /feedback: the description textarea with the live character count", () => {
  const textarea = () => q("textarea") as unknown as HTMLTextAreaElement;
  const charCount = () => q("[data-feedback-char-count]")!;

  test("starts at the full budget and decrements live as you type", async () => {
    expect(charCount().textContent).toBe(`${MAX_FEEDBACK_LENGTH} characters left`);
    await typeInto(textarea(), "The player eats clicks");
    expect(charCount().textContent).toBe(
      `${MAX_FEEDBACK_LENGTH - "The player eats clicks".length} characters left`,
    );
  });

  test("clearing the text restores the full budget", async () => {
    await typeInto(textarea(), "abc");
    await typeInto(textarea(), "");
    expect(charCount().textContent).toBe(`${MAX_FEEDBACK_LENGTH} characters left`);
  });
});

describe("P20 /feedback: the screenshot-attach row (honest absence, never a fake capture)", () => {
  test("YouTube's row renders in structure with the exact disclosure", () => {
    const row = q("[data-feedback-screenshot-row]");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Include screenshot");
    expect(row!.textContent).toContain(
      "Screenshot capture is a YouTube-only feature"
    );
    expect(row!.textContent).toContain(
      "WebFlix's feedback store is text-only, so there is no screenshot to attach here"
    );
  });

  test("NO checkbox, NO file input — the row cannot pretend to attach anything", () => {
    expect(all("input")).toHaveLength(0);
    expect(all('input[type="file"]')).toHaveLength(0);
    expect(all('input[type="checkbox"]')).toHaveLength(0);
  });
});

describe("P20 /feedback: the legal notice line (YouTube's wording, honestly adapted)", () => {
  test("carries YouTube's canonical opening with the WebFlix adaptation", () => {
    const legal = q("[data-feedback-legal]");
    expect(legal).not.toBeNull();
    expect(legal!.textContent).toContain(
      "Some account and system information may be sent to the WebFlix operator"
    );
    expect(legal!.textContent).toContain(
      "YouTube's own feedback tool sends this information to Google; WebFlix's does not"
    );
  });
});

describe("P20 /feedback: submit → the existing local capture + YouTube's confirmation", () => {
  test("submitting POSTs {category, message} to /api/feedback and shows the confirmation", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/feedback")) {
        return Response.json({ ok: true, id: "fb-p20" }, { status: 201 });
      }
      return new Response("{}", { status: 200 });
    };
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "The watch rail loses position.");
    const send = sendButton()!;
    await act(async () => {
      send.click();
    });
    await act(async () => {});
    const post = fetchLog.find((f) => f.method === "POST" && f.url.includes("/api/feedback"));
    expect(post).toBeDefined();
    expect(post!.body).toEqual({
      category: "General Feedback",
      message: "The watch rail loses position.",
    });
    // YouTube's confirmation wording + the honest copy beneath it
    expect(q("[data-feedback-sent]")).not.toBeNull();
    expect(host!.textContent).toContain("Thanks for your feedback!");
    expect(host!.textContent).toContain("Thanks — your feedback was saved.");
    expect(host!.textContent).toContain(FEEDBACK_DISCLOSURE);
  });

  test("the chosen category rides the POST body (the select really works)", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/feedback")) {
        return Response.json({ ok: true, id: "fb-p20" }, { status: 201 });
      }
      return new Response("{}", { status: 200 });
    };
    const select = q("select") as unknown as HTMLSelectElement;
    const proto = Object.getPrototypeOf(select);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    await act(async () => {
      desc?.set?.call(select, "Video Playback - Buffering");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "It buffers forever.");
    const send = sendButton()!;
    await act(async () => {
      send.click();
    });
    await act(async () => {});
    const post = fetchLog.find((f) => f.method === "POST" && f.url.includes("/api/feedback"));
    expect(post!.body).toMatchObject({ category: "Video Playback - Buffering" });
  });

  test("a failing capture shows the honest error, never a fake success", async () => {
    fetchHandler = (url) => {
      if (url.includes("/api/feedback")) {
        return Response.json(
          { error: "Could not write the local feedback store on this server." },
          { status: 500 },
        );
      }
      return new Response("{}", { status: 200 });
    };
    await typeInto(q("textarea") as unknown as HTMLTextAreaElement, "This will fail to store.");
    const send = sendButton()!;
    await act(async () => {
      send.click();
    });
    await act(async () => {});
    expect(q("[data-feedback-sent]")).toBeNull();
    expect(q('[role="alert"]')).not.toBeNull();
    expect(host!.textContent).toContain("Could not write the local feedback store");
  });
});
