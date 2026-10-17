/**
 * P23-B (G4) — the watch Ask panel + the AI summary block, component-level
 * (happy-dom + createRoot/act + a stubbed global fetch — the search-suggest/
 * miniplayer idiom; the REAL @/hooks/use-api postJson rides the stub).
 * Pins:
 *  - suggested prompts from the title + chapters, clickable into a question;
 *  - a question → the answer with [:ss] seek chips that fire onSeek;
 *  - the honest disabled note + disabled input; failure → error + Retry;
 *  - close restores (the panel unmounts);
 *  - the summary: text + key moments on the REAL chapter timestamps (chip
 *    clicks seek); disabled → renders nothing; failure → retry.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).window = win;
for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement", "Event", "CustomEvent", "Node", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "navigator"]) {
  (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
}
win.IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof IntersectionObserver;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** The repo's input-typing idiom (feedback-form): the prototype's value
 * setter + a keyup event — React's controlled-input contract. */
async function typeInto(input: HTMLInputElement, text: string) {
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

import { AskPanel } from "@/components/watch/ask-panel";
import { AiSummary } from "@/components/watch/ai-summary";

const CHAPTERS = [
  { startSec: 0, endSec: 75, title: "Intro" },
  { startSec: 75, endSec: 184, title: "A peaceful morning" },
  { startSec: 184, endSec: null, title: "The rodent gang" },
];

const ASK_OK = {
  status: "ok",
  answer: "The rodents bully the butterfly at [2:12]. The bunny plots revenge by [3:04].",
  seeks: [
    { sec: 132, label: "2:12" },
    { sec: 184, label: "3:04" },
  ],
};

/** mutable per-test fetch responses by URL substring */
let askReply: { status: number; body: unknown } = { status: 200, body: ASK_OK };
let summaryReply: { status: number; body: unknown } = {
  status: 200,
  body: {
    status: "ok",
    summary: "A giant rabbit's gentle, cartoon-style revenge on three rodents.",
    keyMoments: [
      { sec: 75, label: "1:15", title: "A peaceful morning" },
      { sec: 184, label: "3:04", title: "The rodent gang" },
    ],
  },
};
const askCalls: { url: string; body: unknown }[] = [];

const realFetch = globalThis.fetch;
(globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/ask")) {
    askCalls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(askReply.body), {
      status: askReply.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (u.includes("/summary")) {
    return new Response(JSON.stringify(summaryReply.body), {
      status: summaryReply.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
};
afterAll(() => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
  await settle();
}
const settle = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

beforeEach(() => {
  askReply = { status: 200, body: ASK_OK };
  summaryReply = {
    status: 200,
    body: {
      status: "ok",
      summary: "A giant rabbit's gentle, cartoon-style revenge on three rodents.",
      keyMoments: [
        { sec: 75, label: "1:15", title: "A peaceful morning" },
        { sec: 184, label: "3:04", title: "The rodent gang" },
      ],
    },
  };
  askCalls.length = 0;
});
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("P23-B G4 — the Ask panel", () => {
  test("suggested prompts derive from the title + chapters and submit on click", async () => {
    await render(
      createElement(AskPanel, {
        videoId: "bbb",
        title: "Big Buck Bunny — Blender Open Movie (Full HD)",
        chapters: CHAPTERS,
        onSeek: () => {},
        onClose: () => {},
      })
    );
    const suggestions = all('[data-testid="ask-suggested"] button').map((b) => b.textContent ?? "");
    expect(suggestions).toContain("What is this video about?");
    expect(suggestions).toContain("What happens in “Intro”?");
    expect(suggestions).toContain("What happens in “A peaceful morning”?");
    // clicking a suggestion submits it as the question
    await act(async () => {
      all('[data-testid="ask-suggested"] button')[0].click();
    });
    await settle();
    expect(askCalls.length).toBe(1);
    expect(askCalls[0].body).toEqual({ question: "What is this video about?" });
    expect(all('[data-testid="ask-turn-question"]').map((e) => e.textContent)).toContain(
      "What is this video about?"
    );
  });

  test("a submitted question renders the answer with seek chips that fire onSeek", async () => {
    const seeks: number[] = [];
    await render(
      createElement(AskPanel, {
        videoId: "bbb",
        title: "Big Buck Bunny",
        chapters: CHAPTERS,
        onSeek: (s: number) => seeks.push(s),
        onClose: () => {},
      })
    );
    const input = all('[data-testid="ask-input"]')[0] as HTMLInputElement;
    await typeInto(input, "what happens to the bunny");
    await act(async () => {
      all('[data-testid="ask-submit"]')[0].click();
    });
    await settle();
    expect(askCalls.length).toBe(1);
    expect(askCalls[0].url).toContain("/api/videos/bbb/ask");
    const answer = all('[data-testid="ask-turn-answer"]')[0];
    expect(answer.textContent).toContain("butterfly");
    // the REAL timestamps are chips; both fire onSeek with their seconds
    expect(all('[data-testid="ask-seek-132"]').length).toBe(1);
    expect(all('[data-testid="ask-seek-184"]').length).toBe(1);
    await act(async () => {
      all('[data-testid="ask-seek-132"]')[0].click();
    });
    expect(seeks).toEqual([132]);
  });

  test("disabled → the honest note + the input stands down (never a fake answer)", async () => {
    askReply = { status: 200, body: { status: "disabled" } };
    await render(
      createElement(AskPanel, {
        videoId: "bbb",
        title: "Big Buck Bunny",
        chapters: [],
        onSeek: () => {},
        onClose: () => {},
      })
    );
    const input = all('[data-testid="ask-input"]')[0] as HTMLInputElement;
    await typeInto(input, "what is this");
    await act(async () => {
      all('[data-testid="ask-submit"]')[0].click();
    });
    await settle();
    expect(all('[data-testid="ask-disabled"]').length).toBe(1);
    expect(
      (all('[data-testid="ask-input"]')[0] as HTMLInputElement).hasAttribute("disabled")
    ).toBe(true);
  });

  test("failure → the honest error + Retry recovers the answer", async () => {
    const replies = [
      { status: 502, body: { error: "The AI request failed — model down" } },
      { status: 200, body: ASK_OK },
    ];
    let call = 0;
    (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/ask")) {
        const next = replies[call++];
        return new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    };
    try {
      await render(
        createElement(AskPanel, {
          videoId: "bbb",
          title: "Big Buck Bunny",
          chapters: [],
          onSeek: () => {},
          onClose: () => {},
        })
      );
      const input = all('[data-testid="ask-input"]')[0] as HTMLInputElement;
      await typeInto(input, "what happens");
      await act(async () => {
        all('[data-testid="ask-submit"]')[0].click();
      });
      await settle();
      expect(all('[role="alert"]').length).toBe(1);
      expect(all('[data-testid="ask-turn-retry"]').length).toBe(1);
      await act(async () => {
        all('[data-testid="ask-turn-retry"]')[0].click();
      });
      await settle();
      expect(all('[data-testid="ask-turn-answer"]').length).toBe(1);
    } finally {
      (globalThis as Record<string, unknown>).fetch = realFetch;
      // restore the standard stub for afterEach teardown safety
      (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/ask")) {
          askCalls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
          return new Response(JSON.stringify(askReply.body), {
            status: askReply.status,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.includes("/summary")) {
          return new Response(JSON.stringify(summaryReply.body), { status: summaryReply.status });
        }
        return new Response("{}", { status: 200 });
      };
    }
  });

  test("close fires onClose (the watch page restores the related rail)", async () => {
    let closed = 0;
    await render(
      createElement(AskPanel, {
        videoId: "bbb",
        title: "Big Buck Bunny",
        chapters: [],
        onSeek: () => {},
        onClose: () => {
          closed += 1;
        },
      })
    );
    await act(async () => {
      all('[data-testid="ask-close"]')[0].click();
    });
    expect(closed).toBe(1);
  });
});

describe("P23-B G4 — the AI summary block", () => {
  test("summary text + key moment chips on the real chapter timestamps (click seeks)", async () => {
    const seeks: number[] = [];
    await render(createElement(AiSummary, { videoId: "bbb", onSeek: (s: number) => seeks.push(s) }));
    expect(all('[data-testid="ai-summary"]').length).toBe(1);
    expect(all('[data-testid="ai-summary-text"]')[0].textContent).toContain("gentle");
    expect(all('[data-testid="key-moment-75"]').length).toBe(1);
    expect(all('[data-testid="key-moment-184"]').length).toBe(1);
    expect(all('[data-testid="key-moment-75"]')[0].textContent).toContain("A peaceful morning");
    await act(async () => {
      all('[data-testid="key-moment-75"]')[0].click();
    });
    expect(seeks).toEqual([75]);
  });

  test("disabled → the block renders nothing (the honest absence)", async () => {
    summaryReply = { status: 200, body: { status: "disabled" } };
    await render(createElement(AiSummary, { videoId: "bbb", onSeek: () => {} }));
    await settle();
    expect(all('[data-testid="ai-summary"]').length).toBe(0);
  });

  test("failure → the honest error + Retry recovers", async () => {
    summaryReply = { status: 502, body: { error: "The AI request failed — down" } };
    await render(createElement(AiSummary, { videoId: "bbb", onSeek: () => {} }));
    expect(all('[role="alert"]').length).toBe(1);
    expect(all('[data-testid="ai-summary-retry"]').length).toBe(1);
    summaryReply = {
      status: 200,
      body: { status: "ok", summary: "Recovered summary.", keyMoments: [] },
    };
    await act(async () => {
      all('[data-testid="ai-summary-retry"]')[0].click();
    });
    await settle();
    expect(all('[data-testid="ai-summary-text"]')[0].textContent).toContain("Recovered summary.");
    // no chapters in the payload → the key moments row honestly doesn't render
    expect(all('[data-testid="key-moments"]').length).toBe(0);
  });
});
