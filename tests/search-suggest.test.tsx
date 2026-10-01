/// <reference types="bun-types" />
/**
 * WFX2-P3-SG tests — search suggestions + depth parity:
 * - the suggest lib (suggestqueries JSONP read) against recorded fixtures
 *   via the setUpstream seam — honest empty on refusal/timeout/abort;
 * - the /api/search/suggest route contract (5s timeout law, honest degrade);
 * - the suggest dropdown: debounced + cancelled fetches, recents
 *   (localStorage, capped 10, dedupe, honest clear-all), keyboard
 *   navigation (arrows + wrap, Enter commit vs form-submit fallthrough,
 *   Esc/Tab close), mousedown-commit before blur;
 * - the search page zero-state (youtube.com no-results copy + honest tips +
 *   remove-filters) and the did-you-mean / showing-results-for parity.
 *
 * Idiom: happy-dom + createRoot/act (the comment-composer pattern) with a
 * stubbed global fetch for /api/search/suggest; route tests use the
 * fixture-upstream seam (yt-routes pattern). NEVER the network.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, useState, type ReactElement } from "react";

import { setUpstream } from "@/lib/youtube/innertube";
import { autocomplete, parseAutocomplete } from "@/lib/youtube/suggest";
import { GET as suggestRoute, SUGGEST_TIMEOUT_MS } from "@/app/api/search/suggest/route";
import { clearCache } from "@/lib/youtube/cache";
import {
  RECENTS_CAP,
  RECENTS_STORAGE_KEY,
  SUGGEST_LISTBOX_ID,
  SuggestDropdown,
  pushRecent,
  readRecents,
  suggestOptionId,
  useSuggestDropdown,
} from "@/components/search/suggest-dropdown";
import type { SearchPageDTO } from "@/lib/types";

// ---- happy-dom as the global DOM (the comment-composer setup) ----
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

// ---- stubbed fetch: /api/search/suggest with controllable responders ----
const suggestCalls: { q: string }[] = [];
type Responder = (q: string) => Promise<Response>;
const responders: Responder[] = [];
const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const DEFAULT_SUGGESTIONS = ["lofi hip hop", "lofi hip hop radio"];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  if (u.includes("/api/search/suggest")) {
    const q = new URL(u, "http://localhost").searchParams.get("q") ?? "";
    suggestCalls.push({ q });
    const respond = responders.length > 0 ? responders.shift()! : async () => jsonRes({ suggestions: DEFAULT_SUGGESTIONS });
    return respond(q);
  }
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

// ---- view mocks: next/navigation + use-api (per-test state) ----
const routerPushes: string[] = [];
let viewParams = "q=zzqqxx";
let viewData: SearchPageDTO | null = null;

const realNavigation = { ...(await import("next/navigation")) } as Record<string, unknown>;
const realUseApi = { ...(await import("@/hooks/use-api")) } as Record<string, unknown>;

mock.module("next/navigation", () => ({
  usePathname: () => "/search",
  useRouter: () => ({
    push: (url: string) => routerPushes.push(url),
    replace: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(viewParams),
}));
mock.module("@/hooks/use-api", () => ({
  useApi: (_url: string | null) => ({ data: viewData, loading: false, error: null, reload: () => {} }),
}));

const { default: SearchPage } = await import("@/app/search/view");

// ---- harness ----
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const all = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];
const optionTexts = () => all('[role="option"]').map((el) => (el.textContent ?? "").trim());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface HarnessProps {
  onCommit?: (query: string) => void;
  onFormSubmit?: (query: string) => void;
  debounceMs?: number;
}

/** Mirrors the topbar wiring exactly (focus/blur/keydown/submit laws). */
function SuggestHarness({ onCommit, onFormSubmit, debounceMs }: HarnessProps) {
  const [query, setQuery] = useState("");
  const suggest = useSuggestDropdown({
    query,
    onCommit: onCommit ?? (() => {}),
    debounceMs,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        suggest.recordRecent(query); // the topbar law: an executed search is a recent
        onFormSubmit?.(query);
      }}
    >
      <input
        type="text"
        aria-label="Search videos and channels"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggest.setOpen(true)}
        onBlur={() => suggest.close()}
        onKeyDown={(e) => {
          if (suggest.handleKeyDown(e)) e.preventDefault();
        }}
        role="combobox"
        aria-expanded={suggest.open}
        aria-controls={SUGGEST_LISTBOX_ID}
        aria-activedescendant={suggest.activeIndex >= 0 ? suggestOptionId(suggest.activeIndex) : undefined}
      />
      <SuggestDropdown control={suggest} />
    </form>
  );
}

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {});
}

async function renderHarness(props: HarnessProps = {}) {
  await render(<SuggestHarness {...props} />);
}

async function renderView() {
  await render(<SearchPage />);
}

async function focusInput() {
  const input = q("input")!;
  await act(async () => {
    input.focus();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}

/** Type into the input the way a user would (the repo-verified sequence). */
async function typeText(text: string) {
  const input = q("input") as HTMLInputElement;
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(input);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, text);
  await act(async () => {
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

/** Press a key on the search input; returns the event (defaultPrevented =
 * the controller consumed it — the topbar then preventDefaults). */
async function pressKey(key: string): Promise<KeyboardEvent> {
  const input = q("input")!;
  const evt = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    input.dispatchEvent(evt);
  });
  return evt;
}

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

beforeEach(() => {
  suggestCalls.length = 0;
  responders.length = 0;
  routerPushes.length = 0;
  win.localStorage.clear();
  viewParams = "q=zzqqxx";
  viewData = null;
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
  mock.module("next/navigation", () => realNavigation);
  mock.module("@/hooks/use-api", () => realUseApi);
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Part A — the suggest lib (fixtures via the setUpstream seam, never network)
// ---------------------------------------------------------------------------

describe("suggest lib — suggestqueries JSONP read", () => {
  afterEach(() => setUpstream(null));

  test("parseAutocomplete: the recorded JSONP body → clean string array", () => {
    const raw = load("autocomplete_lofi").raw as string;
    const out = parseAutocomplete(raw);
    expect(out).toHaveLength(14);
    expect(out[0]).toBe("lofi hip hop");
    expect(out.every((s: unknown) => typeof s === "string")).toBe(true);
  });

  test("parseAutocomplete: unparsable bodies → honest empty", () => {
    expect(parseAutocomplete("")).toEqual([]);
    expect(parseAutocomplete("not jsonp at all")).toEqual([]);
    expect(parseAutocomplete('window.google.ac.h(["lofi",[]])')).toEqual([]);
    expect(parseAutocomplete('window.google.ac.h(["lofi",[["ok",0],["also ok",0]]])')).toEqual(["ok", "also ok"]);
  });

  test("autocomplete: fixture upstream → suggestions (the youtube suggest endpoint)", async () => {
    let seenUrl = "";
    setUpstream(async (url) => {
      seenUrl = url;
      return new Response(load("autocomplete_lofi").raw, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const out = await autocomplete("lofi");
    expect(out[0]).toBe("lofi hip hop");
    expect(seenUrl).toContain("suggestqueries");
    expect(seenUrl).toContain("client=youtube");
    expect(seenUrl).toContain("ds=yt");
    expect(seenUrl).toContain(`q=${encodeURIComponent("lofi")}`);
  });

  test("autocomplete: upstream refusal (500) → [] (never faked)", async () => {
    setUpstream(async () => new Response("nope", { status: 500 }));
    expect(await autocomplete("lofi")).toEqual([]);
  });

  test("autocomplete: network throw → []", async () => {
    setUpstream(async () => {
      throw new Error("boom");
    });
    expect(await autocomplete("lofi")).toEqual([]);
  });

  test("autocomplete: never-settling upstream → [] on the timeout abort", async () => {
    setUpstream(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        })
    );
    expect(await autocomplete("lofi", { timeoutMs: 30 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Part B — the suggest route contract
// ---------------------------------------------------------------------------

describe("GET /api/search/suggest — route contract", () => {
  afterEach(() => {
    setUpstream(null);
    clearCache();
  });

  test("SUGGEST_TIMEOUT_MS pins the lane law: 5 seconds", () => {
    expect(SUGGEST_TIMEOUT_MS).toBe(5_000);
  });

  test("non-JSONP 200 body → 200 with empty suggestions (never an error surface)", async () => {
    setUpstream(async () => new Response("<html>not jsonp</html>", { status: 200 }));
    const res = await suggestRoute(new Request("http://localhost/api/search/suggest?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { suggestions: string[] };
    expect(data.suggestions).toEqual([]);
  });

  test("fixture JSONP through the route → clean suggestions", async () => {
    setUpstream(async () =>
      new Response(load("autocomplete_lofi").raw, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      })
    );
    const res = await suggestRoute(new Request("http://localhost/api/search/suggest?q=lofi"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { suggestions: string[] };
    expect(data.suggestions[0]).toBe("lofi hip hop");
  });
});

// ---------------------------------------------------------------------------
// Part C — the dropdown: debounce/cancel, recents, keyboard, commit
// ---------------------------------------------------------------------------

describe("suggest dropdown — debounce + cancel semantics", () => {
  test("rapid keystrokes → ONE debounced fetch for the final query", async () => {
    await renderHarness({ debounceMs: 25 });
    await typeText("l");
    await typeText("lo");
    await typeText("lof");
    await act(async () => {
      await sleep(70);
    });
    expect(suggestCalls).toHaveLength(1);
    expect(suggestCalls[0].q).toBe("lof");
    expect(optionTexts()).toContain("lofi hip hop");
  });

  test("new input cancels a stale response — only the newest renders", async () => {
    responders.push(async () => {
      await sleep(120);
      return jsonRes({ suggestions: ["lofi STALE"] });
    });
    responders.push(async () => jsonRes({ suggestions: ["lofi FRESH"] }));
    await renderHarness({ debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(50); // fetch 1 fired, still in flight
    });
    await typeText("lof");
    await act(async () => {
      await sleep(90); // fetch 2 resolves; the stale one resolves into the guard
    });
    expect(suggestCalls).toHaveLength(2);
    expect(optionTexts()).toEqual(["lofi FRESH"]);
  });

  test("upstream refusal (500) → honest empty: no fabricated rows, no dropdown", async () => {
    responders.push(async () => new Response("nope", { status: 500 }));
    await renderHarness({ debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    expect(suggestCalls).toHaveLength(1);
    expect(optionTexts()).toEqual([]);
    expect(q('[role="listbox"]')).toBeNull();
  });
});

describe("suggest dropdown — recents (localStorage, honest)", () => {
  test("focus with an empty box shows the stored recents + the clear affordance", async () => {
    win.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["lofi", "elden ring"]));
    await renderHarness();
    await focusInput();
    expect(optionTexts()).toEqual(["lofi", "elden ring"]);
    expect(all('button[aria-label="Clear all recent searches"]')).toHaveLength(1);
  });

  test("no recents + no input → focus renders nothing (never fabricated)", async () => {
    await renderHarness();
    await focusInput();
    expect(q('[role="listbox"]')).toBeNull();
    expect(optionTexts()).toEqual([]);
  });

  test("clear-all wipes storage and the rows honestly", async () => {
    win.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["lofi"]));
    await renderHarness();
    await focusInput();
    const clearBtn = q('button[aria-label="Clear all recent searches"]')!;
    await act(async () => {
      clearBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(optionTexts()).toEqual([]);
    expect(win.localStorage.getItem(RECENTS_STORAGE_KEY)).toBe("[]");
  });

  test("typing prefix-matches recents; suggestions dedupe against them", async () => {
    win.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["lofi hip hop", "elden ring"]));
    await renderHarness({ debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    const texts = optionTexts();
    expect(texts[0]).toBe("lofi hip hop"); // the recent row first
    expect(texts.filter((t) => t === "lofi hip hop")).toHaveLength(1); // deduped vs the suggestion
    expect(texts).toContain("lofi hip hop radio");
    expect(texts).not.toContain("elden ring"); // not a prefix match
  });

  test("a plain form submit records the recent (the topbar law)", async () => {
    await renderHarness();
    await typeText("elden");
    const form = q("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const stored = JSON.parse(win.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]") as string[];
    expect(stored).toEqual(["elden"]);
  });
});

describe("suggest dropdown — keyboard navigation", () => {
  test("arrows navigate with wrap; the active row is aria-selected", async () => {
    win.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["lofi"]));
    await renderHarness({ debounceMs: 25 });
    await typeText("lo"); // rows: [recent "lofi", "lofi hip hop", "lofi hip hop radio"]
    await act(async () => {
      await sleep(70);
    });
    const options = () => all('[role="option"]');
    expect(options()).toHaveLength(3);
    expect(options().every((o) => o.getAttribute("aria-selected") === "false")).toBe(true);

    await pressKey("ArrowDown"); // → 0
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(q("input")!.getAttribute("aria-activedescendant")).toBe(suggestOptionId(0));
    await pressKey("ArrowDown"); // → 1
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    await pressKey("ArrowDown"); // → 2
    await pressKey("ArrowDown"); // wrap → 0
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    await pressKey("ArrowUp"); // wrap back → 2
    expect(options()[2].getAttribute("aria-selected")).toBe("true");
  });

  test("Enter on the active row commits and does NOT submit the form", async () => {
    const commits: string[] = [];
    const formSubmits: string[] = [];
    await renderHarness({ onCommit: (t) => commits.push(t), onFormSubmit: (t) => formSubmits.push(t), debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    await pressKey("ArrowDown");
    const evt = await pressKey("Enter");
    expect(evt.defaultPrevented).toBe(true); // consumed — the form submit must not also fire
    expect(commits).toEqual(["lofi hip hop"]);
    expect(formSubmits).toEqual([]);
    expect(optionTexts()).toEqual([]); // closed on commit
    const stored = JSON.parse(win.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]") as string[];
    expect(stored[0]).toBe("lofi hip hop"); // committed searches are recents
  });

  test("Enter with NO active row falls through (not consumed → the typed query submits)", async () => {
    const commits: string[] = [];
    await renderHarness({ onCommit: (t) => commits.push(t), debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    const evt = await pressKey("Enter");
    expect(evt.defaultPrevented).toBe(false);
    expect(commits).toEqual([]);
  });

  test("Escape closes the dropdown (consumed)", async () => {
    await renderHarness({ debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    expect(optionTexts().length).toBeGreaterThan(0);
    const evt = await pressKey("Escape");
    expect(evt.defaultPrevented).toBe(true);
    expect(q('[role="listbox"]')).toBeNull();
  });

  test("Tab closes without consuming (focus moves naturally)", async () => {
    await renderHarness({ debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    const evt = await pressKey("Tab");
    expect(evt.defaultPrevented).toBe(false);
    expect(q('[role="listbox"]')).toBeNull();
  });

  test("mousedown on a row commits (before blur) and records the recent", async () => {
    const commits: string[] = [];
    await renderHarness({ onCommit: (t) => commits.push(t), debounceMs: 25 });
    await typeText("lo");
    await act(async () => {
      await sleep(70);
    });
    const row = all('[role="option"]')[1]!; // the second row (a suggestion)
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(commits).toEqual(["lofi hip hop radio"]);
    expect(optionTexts()).toEqual([]); // closed
    const stored = JSON.parse(win.localStorage.getItem(RECENTS_STORAGE_KEY) ?? "[]") as string[];
    expect(stored[0]).toBe("lofi hip hop radio");
  });

  test("blur closes the dropdown", async () => {
    win.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(["lofi"]));
    await renderHarness();
    await focusInput();
    expect(optionTexts()).toEqual(["lofi"]);
    const input = q("input")!;
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(q('[role="listbox"]')).toBeNull();
  });
});

describe("recents law (pure helpers)", () => {
  test("pushRecent: insert at front, case-insensitive dedupe, cap 10, trim", () => {
    expect(pushRecent(["b"], "a")).toEqual(["a", "b"]);
    expect(pushRecent(["a", "b"], "A")).toEqual(["A", "b"]); // dedupe moves to front
    expect(pushRecent(["  x  "], "")).toEqual(["  x  "]); // empty never recorded
    const ten = Array.from({ length: 10 }, (_, i) => `q${i}`);
    expect(pushRecent(ten, "new")).toEqual(["new", ...ten.slice(0, 9)]);
    expect(pushRecent(ten, "new")).toHaveLength(RECENTS_CAP);
  });

  test("readRecents: honest on corrupt/absent/unavailable storage", () => {
    expect(readRecents(null)).toEqual([]);
    const fake = (raw: string | null) => ({ getItem: () => raw }) as unknown as Storage;
    expect(readRecents(fake(null))).toEqual([]);
    expect(readRecents(fake("not json"))).toEqual([]);
    expect(readRecents(fake('{"a":1}'))).toEqual([]);
    expect(readRecents(fake(JSON.stringify(["ok", 42, "  ", "also ok"])))).toEqual(["ok", "also ok"]);
    const twelve = Array.from({ length: 12 }, (_, i) => `q${i}`);
    expect(readRecents(fake(JSON.stringify(twelve)))).toHaveLength(RECENTS_CAP);
  });
});

// ---------------------------------------------------------------------------
// Part D — the search page zero-state + did-you-mean parity
// ---------------------------------------------------------------------------

const EMPTY_RESULTS: SearchPageDTO = {
  query: "zzqqxx",
  videos: [],
  channels: [],
  playlists: [],
  resultCountText: null,
  correction: null,
};

describe("search page — zero-results parity", () => {
  test("no results → youtube.com copy: heading, guidance, honest tips", async () => {
    viewData = EMPTY_RESULTS;
    await renderView();
    const headings = all("h2").map((h) => (h.textContent ?? "").trim());
    expect(headings).toContain("No results found");
    expect(win.document.body.textContent).toContain("Try different keywords or remove search filters.");
    const tips = all("li").map((li) => (li.textContent ?? "").trim());
    expect(tips).toContain("Try more general keywords");
    expect(tips).toContain("Try fewer keywords");
    expect(tips).toContain("Remove search filters to widen the results");
    expect(all("button").some((b) => (b.textContent ?? "").trim() === "Remove all filters")).toBe(false);
  });

  test("no results WITH filters → the actionable Remove-all-filters button re-searches", async () => {
    viewParams = "q=zzqqxx&type=video";
    viewData = EMPTY_RESULTS;
    await renderView();
    const btn = all("button").find((b) => (b.textContent ?? "").trim() === "Remove all filters");
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.click();
    });
    expect(routerPushes).toContain("/search?q=zzqqxx"); // filters dropped, the query kept
  });
});

describe("search page — did-you-mean parity", () => {
  test("didYouMean correction → “Did you mean X?” link re-searches", async () => {
    viewData = {
      ...EMPTY_RESULTS,
      correction: { kind: "didYouMean", correctedQuery: "lofi", originalQuery: null },
    };
    await renderView();
    const links = Array.from(host!.querySelectorAll("a"));
    const dym = links.find((a) => (a.textContent ?? "").includes("Did you mean lofi"));
    expect(dym).toBeDefined();
    expect(dym!.getAttribute("href")).toBe("/search?q=lofi");
  });

  test("showingResultsFor correction → both the echo and the “Search instead for” verbatim link", async () => {
    viewData = {
      ...EMPTY_RESULTS,
      correction: { kind: "showingResultsFor", correctedQuery: "lofi hip hop", originalQuery: "lofi hio" },
    };
    await renderView();
    expect(win.document.body.textContent).toContain("Showing results for");
    const links = Array.from(host!.querySelectorAll("a"));
    const instead = links.find((a) => (a.textContent ?? "").includes("Search instead for lofi hio"));
    expect(instead).toBeDefined();
    expect(instead!.getAttribute("href")).toBe("/search?q=lofi%20hio&verbatim=1");
  });
});
