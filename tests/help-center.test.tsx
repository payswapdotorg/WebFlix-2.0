/// <reference types="bun-types" />
/**
 * WFX2-P20 tests — the Help page at the YouTube Help Center's structural
 * depth (happy-dom + createRoot/act, the settings-system pattern; the
 * pages render plain Link/anchor structure; NO network, NO database):
 *
 *   - the hero search bar ("How can we help you?" + input + the
 *     popular-topic chips),
 *   - the topic card grid over the REAL help topics (Getting started,
 *     Watching videos, Managing your account, Privacy & safety,
 *     Troubleshooting) — each card expands its topic section,
 *   - the client-side search (title + body match) and the YouTube-parity
 *     empty state with clear-search,
 *   - the contact-flow honest-absence block and YouTube's own help
 *     center handoff.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

const HelpPage = (await import("@/app/help/page")).default;

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

async function render() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<HelpPage />);
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

const cards = () => all("[data-help-topic-card]");
const sections = () => all("[data-help-topic]");
const searchInput = () => q('[aria-label="Search help topics"]') as unknown as HTMLInputElement;

beforeEach(async () => {
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

describe("P20 /help: the hero search bar (YouTube Help Center's hero layout)", () => {
  test("the hero heading, the search input, and the popular-topic chips render", () => {
    expect(q("[data-help-search]")).not.toBeNull();
    expect(host!.textContent).toContain("How can we help you?");
    const input = searchInput();
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("Describe your issue");
    const chips = all("[data-help-search] button");
    expect(chips.length).toBeGreaterThanOrEqual(6);
    for (const chip of ["Autoplay", "Queue", "Playlists", "Report a video", "Settings", "Sign in"]) {
      expect(
        chips.find((c) => (c.textContent ?? "").trim() === chip),
      ).toBeDefined();
    }
  });

  test("a chip sets the search query (the quick-path behavior)", async () => {
    const chip = all("[data-help-search] button").find(
      (c) => (c.textContent ?? "").trim() === "Playlists",
    )!;
    await act(async () => {
      chip.click();
    });
    expect(searchInput().value).toBe("Playlists");
    expect(q('[aria-label="Clear search"]')).not.toBeNull(); // the input's X appears
  });
});

describe("P20 /help: the topic card grid (the real YouTube help topics)", () => {
  test("all five real topics render as cards, expanded sections beneath", () => {
    const slugs = cards().map((c) => c.getAttribute("data-help-topic-card"));
    expect(slugs).toEqual([
      "getting-started",
      "watching-videos",
      "managing-your-account",
      "privacy-safety",
      "troubleshooting",
    ]);
    expect(sections().map((s) => s.getAttribute("data-help-topic"))).toEqual(slugs);
    expect(host!.textContent).toContain("Getting started");
    expect(host!.textContent).toContain("Watching videos");
    expect(host!.textContent).toContain("Managing your account");
    expect(host!.textContent).toContain("Privacy & safety");
    expect(host!.textContent).toContain("Troubleshooting");
  });

  test("sections are expanded by default — the honest answers are on the page", () => {
    for (const section of sections()) {
      expect(section.hasAttribute("hidden")).toBe(false);
    }
    expect(host!.textContent).toContain("Add to queue");
    expect(host!.textContent).toContain("5-second countdown");
    expect(host!.textContent).toContain("Playlists");
  });

  test("the real internal routes link out of the answers", () => {
    for (const href of ["/settings", "/studio", "/account", "/feedback", "/report-history"]) {
      expect(all("a").find((a) => a.getAttribute("href") === href)).toBeDefined();
    }
  });

  test("a card collapses its topic section and expands it again", async () => {
    const card = cards()[1]!; // Watching videos
    expect(card.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      card.click();
    });
    expect(card.getAttribute("aria-expanded")).toBe("false");
    const watching = sections().find(
      (s) => s.getAttribute("data-help-topic") === "watching-videos",
    )!;
    expect(watching.hasAttribute("hidden")).toBe(true);
    expect(host!.textContent).toContain("Expand to read this topic's answers");
    await act(async () => {
      card.click();
    });
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(watching.hasAttribute("hidden")).toBe(false);
  });
});

describe("P20 /help: the client-side search (title + body match)", () => {
  test("typing filters the topic cards by title match", async () => {
    await typeInto(searchInput(), "privacy");
    expect(cards().map((c) => c.getAttribute("data-help-topic-card"))).toEqual([
      "privacy-safety",
    ]);
    expect(host!.textContent).toContain("Reporting content");
  });

  test("a BODY match keeps the topic (not just titles)", async () => {
    await typeInto(searchInput(), "watch later");
    const slugs = cards().map((c) => c.getAttribute("data-help-topic-card"));
    expect(slugs).toContain("managing-your-account");
    expect(slugs).not.toContain("getting-started");
  });

  test("no-match → the YouTube-parity empty state; clear search restores the grid", async () => {
    await typeInto(searchInput(), "zzzznothing");
    expect(cards()).toHaveLength(0);
    expect(sections()).toHaveLength(0);
    expect(q("[data-help-empty]")).not.toBeNull();
    expect(host!.textContent).toContain("No results found");
    expect(host!.textContent).toContain("Nothing in WebFlix's help matches");
    const clear = all("[data-help-empty] button").find(
      (b) => (b.textContent ?? "").trim() === "Clear search",
    )!;
    await act(async () => {
      clear.click();
    });
    expect(cards()).toHaveLength(5);
    expect(q("[data-help-empty]")).toBeNull();
  });

  test("clearing via the input's X button also restores the grid", async () => {
    await typeInto(searchInput(), "queue");
    expect(cards().length).toBeLessThan(5);
    const clear = q('[aria-label="Clear search"]')!;
    expect(clear).not.toBeNull();
    await act(async () => {
      clear.click();
    });
    expect(cards()).toHaveLength(5);
    expect(searchInput().value).toBe("");
  });
});

describe("P20 /help: the contact flow + YouTube's own help center (honest handoffs)", () => {
  test("the contact block carries YouTube's pathway wording + the honest absence", () => {
    expect(q("[data-help-contact]")).not.toBeNull();
    expect(host!.textContent).toContain("Still need help? Contact us");
    expect(host!.textContent).toContain("WebFlix has no support team");
    expect(host!.textContent).toContain("It does not post to YouTube");
    expect(all("a").find((a) => a.getAttribute("href") === "/feedback")).toBeDefined();
  });

  test("YouTube's own help center section survives with the real link", () => {
    expect(host!.textContent).toContain("YouTube's own help center");
    const support = all("a").find(
      (a) => a.getAttribute("href") === "https://support.google.com/youtube",
    );
    expect(support).toBeDefined();
  });
});
