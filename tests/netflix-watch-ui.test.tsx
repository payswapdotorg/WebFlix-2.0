/// <reference types="bun-types" />
/**
 * P43 — the Netflix watch-view UI battery (the house happy-dom idiom).
 * The cloud session is a fetch seam: no real sandbox, no real stream, no
 * socket ever opens (io is stubbed; MediaSource is absent in happy-dom and
 * the audio effect stands down).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
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
  "SVGElement",
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

// ---- module mocks ----
let useApiData: unknown = null;
let mockParams: Record<string, string> = { id: "81757047" };
mock.module("@/hooks/use-api", () => ({
  useApi: (url: string | null) => {
    // the my-list lane rides the same hook on the title page; the watch view
    // only pulls the title payload (and nothing at all in Netflix Live mode)
    return { data: useApiData, loading: false, error: null, reload: () => {} };
  },
  postJson: async () => ({}),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/netflix/watch/81757047",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => mockParams,
}));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {}, info: () => {} }),
}));
let ioInstance: {
  on: (ev: string, cb: (arg?: unknown) => void) => void;
  emit: (ev: string, arg?: unknown) => void;
  disconnect: () => void;
} | null = null;
mock.module("socket.io-client", () => ({
  io: () => {
    ioInstance = {
      on: () => {},
      emit: () => {},
      disconnect: () => {},
    };
    return ioInstance;
  },
}));

const { default: NetflixWatchView } = await import("@/app/netflix/watch/[id]/view");
import type { NetflixTitlePageDTO } from "@/lib/netflix/types";

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReactElement) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(node);
  });
}

const q = (sel: string) => (host ? host.querySelector(sel) : null);
const text = () => (host ? host.textContent ?? "" : "");

// ---- the fetch seam (the broker proxy) ----
const originalFetch = globalThis.fetch;
let brokerStatus: unknown = { phase: "provisioning" };
let postCalls: string[] = [];

function mockFetch() {
  // @ts-expect-error — test seam
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/netflix/watch/session")) {
      if (init?.method === "POST") {
        postCalls.push(String(init.body ?? ""));
        return new Response(JSON.stringify({ phase: "provisioning" }), { status: 202 });
      }
      return new Response(JSON.stringify(brokerStatus), { status: 200 });
    }
    if (url.includes("/api/netflix/watch/release") || url.includes("/api/netflix/watch/retry-auth")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
}

beforeEach(() => {
  useApiData = {
    title: {
      netflixId: 81757047,
      title: "Animals",
      kind: "movie",
      synopsis: "When their son is kidnapped…",
      releaseYear: 2026,
      maturityRating: "R",
      backdropUrl: null,
      posterUrl: null,
      logoUrl: null,
      weeklyRank: 1,
      allTimeRank: null,
      weeksInTop10: 2,
      weeklyHoursViewed: 55400000,
      weeklyViews: null,
      countryRanks: {},
      weekEndDate: "2026-10-18",
      pool: "weekly-films",
      isPlayable: true,
      deepLinkUrl: "https://www.netflix.com/watch/81757047",
      titlePageUrl: "/netflix/t/81757047",
    },
    countryRanks: [],
    relatedTitles: [],
    myList: false,
    source: "netflix-top10",
    unavailable: false,
    unavailableReason: null,
  } satisfies NetflixTitlePageDTO;
  brokerStatus = { phase: "provisioning" };
  postCalls = [];
  mockParams = { id: "81757047" };
  mockFetch();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  host = null;
  globalThis.fetch = originalFetch;
});

describe("the Netflix watch view — the honest session states", () => {
  test("kicks the session with the title id and shows the provisioning ladder", async () => {
    await render(createElement(NetflixWatchView));
    expect(postCalls.some((b) => b.includes("81757047"))).toBe(true);
    expect(text()).toContain("Preparing Netflix");
    expect(q('[data-testid="netflix-watch-progress"]')).not.toBeNull();
    expect(text()).toContain("Starting the secure cloud desktop");
  });

  test("auth-required shows the connect overlay over the live window and the cookie lane", async () => {
    brokerStatus = {
      phase: "auth-required",
      message: "sign in to netflix inside the secure window",
      sandboxId: "sbx1",
      streamUrl: "https://6080-sbx1.e2b.app/vnc.html?autoconnect=true",
    };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(q('[data-testid="netflix-watch-auth-overlay"]')).not.toBeNull();
    expect(text()).toContain("Connect your Netflix account");
    const frame = q('[data-testid="netflix-watch-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toContain("vnc.html");
    expect(q('[data-testid="netflix-watch-retry-auth"]')).not.toBeNull();
    // the cookie lane opens with instructions
    await act(async () => {
      (q('[data-testid="netflix-watch-cookie-connect"]') as HTMLElement)?.click();
    });
    expect(q('[data-testid="netflix-watch-cookie-input"]')).not.toBeNull();
    expect(text()).toContain("NetflixId");
    expect(text()).toContain("DRM stays intact");
  });

  test("ready state seats the stream iframe with the room chrome", async () => {
    brokerStatus = {
      phase: "ready",
      sandboxId: "sbx1",
      streamUrl: "https://6080-sbx1.e2b.app/vnc.html?autoconnect=true",
      videoId: 81757047,
    };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const frame = q('[data-testid="netflix-watch-frame"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toContain("6080-sbx1");
    expect(q('[data-testid="netflix-watch-audio-toggle"]')).not.toBeNull();
    expect(q('[data-testid="netflix-watch-title"]')?.textContent).toContain("Animals");
    expect(text()).toContain("netflix.com");
  });

  test("error state offers the restart lane", async () => {
    brokerStatus = { phase: "error", message: "cloud desktop gone" };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(text()).toContain("hit a snag");
    expect(text()).toContain("Restart the session");
  });

  test("P48 — a generic error still hands off to netflix.com (the handoff left the unreachable-only lane)", async () => {
    brokerStatus = { phase: "error", message: "cloud desktop gone" };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(q('[data-testid="netflix-watch-unreachable-handoff"]')).not.toBeNull();
  });

  test("P48 — the keyed snag (no E2B key) renders the operator setup wizard", async () => {
    brokerStatus = {
      phase: "error",
      message:
        "API key is required, please visit the API Keys tab at https://e2b.dev/dashboard?tab=keys to get your API key. You can either set the environment variable `E2B_API_KEY` …",
    };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // the wizard replaces the generic snag copy
    expect(q('[data-testid="netflix-watch-snag-keyed"]')).not.toBeNull();
    expect(text()).toContain("Playback needs an E2B key on this server.");
    // the fix is one click away + the movie is never blocked
    expect(q('[data-testid="netflix-watch-snag-e2b-link"]')?.getAttribute("href")).toContain("e2b.dev/dashboard");
    expect(q('[data-testid="netflix-watch-unreachable-handoff"]')).not.toBeNull();
    // and the pairing lane still lives right there (the P47 surface)
    expect(q('[data-testid="netflix-watch-error-autoauth-toggle"]')).not.toBeNull();
  });

  test("P47 — the error state still surfaces the automatic sign-in lane (pair now, validate on the next bootstrap)", async () => {
    brokerStatus = { phase: "error", message: "E2B key missing" };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // collapsed by default — no lane, no duplicate testids with the overlay
    expect(q('[data-testid="netflix-watch-error-autoauth"]')).toBeNull();
    await act(async () => {
      (q('[data-testid="netflix-watch-error-autoauth-toggle"]') as HTMLElement)?.click();
    });
    expect(q('[data-testid="netflix-watch-error-autoauth"]')).not.toBeNull();
    // the SAME P46 lane: token block, copy, rotate, honest status line
    expect(q('[data-testid="netflix-watch-autoauth-lane"]')).not.toBeNull();
    expect(q('[data-testid="netflix-watch-autoauth-copy"]')).not.toBeNull();
    expect(q('[data-testid="netflix-watch-autoauth-rotate"]')).not.toBeNull();
    expect(text()).toContain("pairing token");
  });

  test("Netflix Live mode kicks the browse lane instead of a title deep link (P44)", async () => {
    mockParams = { id: "live" };
    useApiData = null; // live mode pulls no title payload
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(postCalls.some((b) => b.includes('"path":"/browse"'))).toBe(true);
    expect(postCalls.some((b) => b.includes("videoId"))).toBe(false);
    expect(q('[data-testid="netflix-watch-title"]')?.textContent).toContain("Netflix Live");
  });

  test("the cookie panel gives instant paste feedback on the two session cookies (P44)", async () => {
    brokerStatus = {
      phase: "auth-required",
      message: "sign in to netflix inside the secure window",
      sandboxId: "sbx1",
      streamUrl: "https://6080-sbx1.e2b.app/vnc.html?autoconnect=true",
    };
    await render(createElement(NetflixWatchView));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      (q('[data-testid="netflix-watch-cookie-connect"]') as HTMLElement)?.click();
    });
    const input = q('[data-testid="netflix-watch-cookie-input"]') as unknown as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    // type the way a user would — the repo-verified sequence (comment-composer):
    // focusin first, then the prototype's native value setter + keyup
    const typeInto = async (text: string) => {
      await act(async () => {
        input.dispatchEvent(new win.Event("focusin", { bubbles: true }) as unknown as Event);
      });
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
      desc?.set?.call(input, text);
      await act(async () => {
        input.dispatchEvent(new win.Event("keyup", { bubbles: true }) as unknown as Event);
      });
    };
    // a paste without NetflixId warns honestly
    await typeInto("SecureNetflixId=v%3D2; other=1");
    expect(q('[data-testid="netflix-watch-cookie-hint"]')?.textContent).toContain("No NetflixId");
    // adding NetflixId flips the hint green
    await typeInto("NetflixId=v%3D3; SecureNetflixId=v%3D2");
    expect(q('[data-testid="netflix-watch-cookie-hint"]')?.textContent).toContain("Looks right");
    // the privacy note stays honest
    expect(text()).toContain("stay on this server only");
  });
});
