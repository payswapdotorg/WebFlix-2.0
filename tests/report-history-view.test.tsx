/// <reference types="bun-types" />
/**
 * WFX2-P20 tests — the report-history surface at youtube.com's
 * report-history layout depth (happy-dom + createRoot/act, the
 * settings-system pattern; the view is presentational — pure props; NO
 * network, NO database):
 *
 *   - the intro line in YouTube's wording,
 *   - report entries in YouTube's entry structure: reported-content
 *     summary (thumbnail + title), reason category, timestamp, and the
 *     status chip in YouTube's states (Under review),
 *   - the honest status disclosure (Under review → Resolved; no local
 *     resolution step; YouTube-side only),
 *   - the empty state, the comment-report truth, and the YouTube
 *     not-available truth (never a fake list).
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

const { ReportHistoryView } = await import("@/app/report-history/view");

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

async function render(reports: unknown[]) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<ReportHistoryView reports={reports as never} />);
  });
}

const TWO_REPORTS = [
  {
    id: "r1",
    reason: "Spam or misleading",
    createdAt: new Date("2026-01-15T12:00:00Z"),
    video: { id: "v1", title: "Big Buck Bunny", thumbnailUrl: "https://x/1.jpg" },
  },
  {
    id: "r2",
    reason: "Harassment or bullying",
    createdAt: new Date("2026-02-01T12:00:00Z"),
    video: { id: "v2", title: "Sintel", thumbnailUrl: "https://x/2.jpg" },
  },
];

beforeEach(async () => {
  await render([]);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("P20 /report-history: the intro line (YouTube's wording)", () => {
  test("the page opens with YouTube's thanks-for-reporting intro + the honest split summary", () => {
    expect(q("[data-report-history-intro]")).not.toBeNull();
    expect(host!.textContent).toContain("Thanks for reporting");
    expect(host!.textContent).toContain("see the status of the reports you've made");
    expect(host!.textContent).toContain("comment reports and YouTube's own report history");
  });
});

describe("P20 /report-history: the entries in YouTube's entry structure", () => {
  test("each entry: reported-content summary, reason category, timestamp, status chip", async () => {
    await render(TWO_REPORTS);
    const items = all("[data-report-item]");
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(first.textContent).toContain("Big Buck Bunny");
    expect(first.textContent).toContain("Reported for Spam or misleading");
    // the timestamp line (semantic <time>)
    const time = first.querySelector("time");
    expect(time).not.toBeNull();
    expect(time!.getAttribute("datetime")).toBe("2026-01-15T12:00:00.000Z");
    expect(time!.textContent).toContain("Reported Jan 15, 2026");
    // the thumbnail + the watch link
    expect(first.querySelector("img")!.getAttribute("src")).toBe("https://x/1.jpg");
    expect(all("a").find((a) => a.getAttribute("href") === "/watch/v1")).toBeDefined();
    expect(all("a").find((a) => a.getAttribute("href") === "/watch/v2")).toBeDefined();
    // the status chip
    expect(first.textContent).toContain("Under review");
    expect(all('[data-report-status="under-review"]')).toHaveLength(2);
  });

  test("honest absence: no local row ever shows a Resolved chip (no resolution step exists)", async () => {
    await render(TWO_REPORTS);
    expect(all('[data-report-status="resolved"]')).toHaveLength(0);
    // but the two states are disclosed below the list
    expect(q("[data-report-history-states]")).not.toBeNull();
    expect(host!.textContent).toContain("Under review, then Resolved");
    expect(host!.textContent).toContain("no local resolution step");
    expect(host!.textContent).toContain("only visible on YouTube itself");
  });
});

describe("P20 /report-history: the YouTube-parity empty state", () => {
  test("no reports → the empty state, no entry rows, the disclosures still present", () => {
    expect(q("[data-report-history-empty]")).not.toBeNull();
    expect(all("[data-report-item]")).toHaveLength(0);
    expect(host!.textContent).toContain(
      "You haven't reported any videos on WebFlix yet"
    );
    expect(host!.textContent).toContain(
      "Reports you make from a video's report dialog will appear here"
    );
  });
});

describe("P20 /report-history: the honest split (unchanged truths)", () => {
  test("comment reports: the operator-session wording — nothing to list", () => {
    expect(q("[data-report-history-comments]")).not.toBeNull();
    expect(host!.textContent).toContain(
      "submits the report through the operator's YouTube session"
    );
    expect(host!.textContent).toContain("leave no local record");
  });

  test("YouTube's own report history: not available, never a fake list, link out", () => {
    expect(q("[data-report-history-youtube]")).not.toBeNull();
    expect(host!.textContent).toContain(
      "YouTube's report history is not available through WebFlix"
    );
    expect(host!.textContent).toContain("we won't show a fake list");
    const link = all("a").find(
      (a) => a.getAttribute("href") === "https://www.youtube.com/report/history",
    );
    expect(link).toBeDefined();
  });
});
