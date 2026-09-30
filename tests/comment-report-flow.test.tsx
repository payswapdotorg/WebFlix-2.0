/// <reference types="bun-types" />
/**
 * WFX2-B-S tests — the comment report dialog (YouTube's ⋮ → Report flow):
 * the reasons list renders, one is selected, and the submit posts
 * /api/comments/[id]/report with {reason, videoId, commentText} (the
 * broker's DOM locator). happy-dom + createRoot/act (the
 * comment-composer test pattern).
 */
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
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

const reported: { url: string; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  reported.push({ url: u, body });
  return new Response(JSON.stringify({ ok: true, reported: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(String(m)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

const { CommentReportDialog, COMMENT_REPORT_REASONS } = await import(
  "@/components/watch/comment-report-dialog"
);

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;
let reportedCallback = 0;

async function render(open: boolean) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <CommentReportDialog
        open={open}
        onOpenChange={() => {}}
        commentId="Ugzge340dBgB75hWBm54AaABAg"
        videoId="dQw4w9WgXcQ"
        commentText="the comment text"
        onReported={() => {
          reportedCallback++;
        }}
      />
    );
  });
  await act(async () => {});
}

const bodyText = () => win.document.body.textContent ?? "";
const radios = () =>
  Array.from(win.document.querySelectorAll('[role="radio"]')) as unknown as HTMLElement[];
const buttons = () =>
  Array.from(win.document.querySelectorAll("button")) as unknown as HTMLElement[];
const reportButton = () =>
  buttons().find((b) => /^(report)$/i.test((b.textContent ?? "").trim())) ?? null;
const reportButtonStrict = () => {
  const b = reportButton();
  if (!b) throw new Error("report button missing");
  return b;
};

beforeEach(() => {
  reported.length = 0;
  toasts.length = 0;
  reportedCallback = 0;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("CommentReportDialog — YouTube report flow parity", () => {
  test("renders the comment report reasons list (radiogroup parity)", async () => {
    await render(true);
    expect(bodyText()).toContain("Report comment");
    const rows = radios();
    expect(rows.length).toBe(COMMENT_REPORT_REASONS.length);
    for (const r of COMMENT_REPORT_REASONS) {
      expect(bodyText()).toContain(r);
    }
  });

  test("the Report button stays disabled until a reason is selected", async () => {
    await render(true);
    const reportBtn = reportButton();
    expect(reportBtn).not.toBeNull();
    expect((reportBtn as unknown as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      radios()[1].click();
    });
    expect((reportBtn as unknown as HTMLButtonElement).disabled).toBe(false);
  });

  test("submit posts the reason + videoId + commentText locator", async () => {
    await render(true);
    await act(async () => {
      radios()[0].click(); // "Spam or misleading"
    });
    const reportBtn = reportButtonStrict();
    await act(async () => {
      reportBtn.click();
    });
    expect(reported).toHaveLength(1);
    expect(reported[0].url).toBe("/api/comments/Ugzge340dBgB75hWBm54AaABAg/report");
    expect(reported[0].body).toEqual({
      videoId: "dQw4w9WgXcQ",
      reason: "Spam or misleading",
      commentText: "the comment text",
    });
    expect(reportedCallback).toBe(1); // the row disappears from the list
    expect(toasts.some((t) => t.startsWith("success:Thanks for reporting"))).toBe(true);
  });

  test("closed dialog renders nothing (no fake surface)", async () => {
    await render(false);
    expect(bodyText().includes("Report comment")).toBe(false);
    expect(reported).toHaveLength(0);
  });
});
