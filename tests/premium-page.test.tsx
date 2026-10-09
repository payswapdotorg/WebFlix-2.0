/// <reference types="bun-types" />
/**
 * WFX2-P20 tests — the Premium page at youtube.com/premium's full
 * structural depth (happy-dom + createRoot/act, the settings-system
 * pattern; no next mocks needed — the page renders plain Link/anchor
 * structure; NO network, NO database):
 *
 *   - the hero band (headline + sub + honest CTA per YouTube's layout),
 *   - the plans comparison (Individual / Family / Student — the real
 *     plan-card structure: plan name, price line, perk list, CTA; the
 *     honest-absence "on youtube.com" CTAs),
 *   - the benefits rows (the P5-SS honest cards, ON YOUTUBE.COM labels),
 *   - the FAQ accordion (YouTube's real items; opens, closes, honest
 *     YouTube-only answers),
 *   - the footer links row (Terms · Privacy, like YouTube's),
 *   - the no-fake-checkout law (no subscribe/trial buttons anywhere).
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

const PremiumPage = (await import("@/app/premium/page")).default;

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
    root!.render(<PremiumPage />);
  });
}

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

describe("P20 /premium: the hero band (YouTube's hero layout, honest CTA)", () => {
  test("headline + the unchanged no-paid-tier subline + the nothing-to-buy pill", () => {
    expect(q("[data-premium-banner]")).not.toBeNull();
    expect(host!.textContent).toContain("WebFlix Premium");
    expect(host!.textContent).toContain("WebFlix has no paid tier — everything here is free.");
    expect(host!.textContent).toContain("Nothing to buy — everything on WebFlix is free");
  });

  test("the hero CTA links the real product on youtube.com (honest, labeled)", () => {
    const cta = q("[data-premium-cta]");
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toBe("https://www.youtube.com/premium");
    expect(cta!.textContent).toContain("youtube.com");
  });
});

describe("P20 /premium: the plans comparison (YouTube's real plan-card structure)", () => {
  test("the three real plans render as plan cards: name, who-it's-for, price line, perks, CTA", () => {
    const plans = all("[data-premium-plan]");
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.getAttribute("data-premium-plan"))).toEqual([
      "individual",
      "family",
      "student",
    ]);
    expect(host!.textContent).toContain("Individual");
    expect(host!.textContent).toContain("Family");
    expect(host!.textContent).toContain("Student");
    // the real price lines (YouTube's listed US rates)
    expect(host!.textContent).toContain("$15.99/month");
    expect(host!.textContent).toContain("$26.99/month");
    expect(host!.textContent).toContain("$8.99/month");
    // YouTube's real perk structure
    for (const perk of [
      "Ad-free videos",
      "Background play",
      "Downloads",
      "YouTube Music Premium included",
      "Each member gets their own membership",
      "Annual verification required",
    ]) {
      expect(host!.textContent).toContain(perk);
    }
  });

  test("every plan CTA is an honest on-youtube.com link — never a WebFlix checkout", () => {
    const ctas = all("[data-premium-plan] a");
    expect(ctas).toHaveLength(3);
    for (const cta of ctas) {
      expect(cta.getAttribute("href")).toBe("https://www.youtube.com/premium");
      expect((cta.textContent ?? "").trim()).toBe("on youtube.com");
    }
  });

  test("the price provenance is disclosed (US rates as listed on youtube.com)", () => {
    expect(host!.textContent).toContain(
      "US rate as listed on youtube.com/premium — your region's price shows there"
    );
    expect(host!.textContent).toContain("WebFlix sells none of these");
  });
});

describe("P20 /premium: the benefits rows (the honest cards in YouTube's row layout)", () => {
  test("all four honest benefits render with the ON YOUTUBE.COM labels", () => {
    const benefits = all("[data-premium-benefit]");
    expect(benefits).toHaveLength(4);
    expect(all("[data-premium-benefits] [data-premium-benefit]")).toHaveLength(4);
    expect(host!.textContent).toContain("ON YOUTUBE.COM");
    // the P5-SS honest copy, intact
    for (const body of [
      "A YouTube Premium benefit on youtube.com. WebFlix has no paid tier, so there is no ad-free upgrade to buy here — nothing on WebFlix is for sale.",
      "Not a WebFlix product — nothing on WebFlix is for sale.",
      "WebFlix doesn't sell it and doesn't gate anything behind it.",
      "Included with YouTube Premium on youtube.com. WebFlix has no music offering.",
    ]) {
      expect(host!.textContent).toContain(body);
    }
  });
});

describe("P20 /premium: the FAQ accordion (YouTube's real items, honest answers)", () => {
  const faqButtons = () =>
    all("[data-premium-faq] button").filter((b) =>
      /what is youtube premium|how do downloads work|can i cancel my membership anytime/i.test(
        (b.textContent ?? "").trim(),
      ),
    );

  test("the three real FAQ items render collapsed (answers hidden, not rendered open)", () => {
    expect(faqButtons()).toHaveLength(3);
    expect(host!.textContent).toContain("What is YouTube Premium?");
    expect(host!.textContent).toContain("How do downloads work?");
    expect(host!.textContent).toContain("Can I cancel my membership anytime?");
    const answers = all("[data-premium-faq-item] > div");
    expect(answers).toHaveLength(3);
    for (const answer of answers) {
      expect(answer.hasAttribute("hidden")).toBe(true);
    }
    for (const button of faqButtons()) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
  });

  test("clicking a question opens its answer (aria-expanded + visible); clicking again closes it", async () => {
    const first = faqButtons()[0]!;
    await act(async () => {
      first.click();
    });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    const answers = all("[data-premium-faq-item] > div");
    expect(answers[0]!.hasAttribute("hidden")).toBe(false);
    expect(answers[1]!.hasAttribute("hidden")).toBe(true); // others stay closed
    // the honest answer is revealed
    expect(answers[0]!.textContent).toContain("WebFlix has no paid tier");
    await act(async () => {
      first.click();
    });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(answers[0]!.hasAttribute("hidden")).toBe(true);
  });

  test("each answer carries the honest YouTube-only disclosure", async () => {
    const downloads = faqButtons().find((b) =>
      /how do downloads work/i.test((b.textContent ?? "").trim()),
    )!;
    await act(async () => {
      downloads.click();
    });
    const answers = all("[data-premium-faq-item] > div");
    expect(answers[1]!.textContent).toContain(
      "Downloads are a YouTube Premium feature on youtube.com"
    );
    expect(answers[1]!.textContent).toContain("WebFlix has no download offering");
  });
});

describe("P20 /premium: the footer links row (Terms · Privacy, like YouTube's)", () => {
  test("Terms and Privacy link YouTube's real documents; the Help link survives", () => {
    const terms = all("[data-premium-footer] a").find((a) =>
      (a.textContent ?? "").includes("Terms"),
    );
    const privacy = all("[data-premium-footer] a").find((a) =>
      (a.textContent ?? "").includes("Privacy"),
    );
    expect(terms).toBeDefined();
    expect(terms!.getAttribute("href")).toBe("https://www.youtube.com/t/terms");
    expect(privacy).toBeDefined();
    expect(privacy!.getAttribute("href")).toBe("https://www.youtube.com/t/privacy");
    expect(all("a").find((a) => a.getAttribute("href") === "/help")).toBeDefined();
    expect(host!.textContent).toContain("WebFlix has no paid tier, so");
    expect(host!.textContent).toContain("no WebFlix purchase terms");
  });
});

describe("P20 /premium: the no-fake-checkout law (unchanged doctrine)", () => {
  test("no subscribe/trial/get-premium button exists anywhere on the page", () => {
    const forbidden =
      /^(get premium|try it free|subscribe|start free trial|start your free trial)$/i;
    for (const button of all("button")) {
      expect(forbidden.test((button.textContent ?? "").trim())).toBe(false);
    }
  });
});
