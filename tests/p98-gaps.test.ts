/// <reference types="bun-types" />
/**
 * P98 — the first signed-in walk's pins
 * (docs/research/2026-11-05-p98-signed-in-walk-report.md):
 *
 *  - G22's resilient identity seam: a transient shadow-upsert failure
 *    (Neon hiccup) falls back to the DETERMINISTIC shadow id — the authed
 *    feed lane never 502s from one unguarded DB touch again (the sibling
 *    lanes' resilient-read shape, now at the identity step);
 *  - G21's linked acknowledgment: the channel DTO carries viewerLinked —
 *    true ONLY when the acting viewer's linked TikTok handle IS the page's
 *    handle (normalize+lowercase both sides), false for guests and every
 *    non-owner viewer — and the About tab swaps the stranger prompt for
 *    the linked statement.
 *
 * The module boundary is mocked at FILE scope (the action-routes idiom):
 * the session and connection stores are mutable holders each test flips.
 * The upstream stays null (the cold-wall state — never the network); the
 * DB rides the boot-test datasource (the test:boot lane).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";
import { setTikTokUpstream } from "@/lib/tiktok/upstream";

// ---- the file-scope mock holders -------------------------------------
let sessionUser: { id: string; email: string; displayName: string; avatarSeed: number } | null = null;
let linkedHandle: string | null = null;
let shadowThrows = false;

mock.module("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
  authRequiredResponse: () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }),
}));
mock.module("@/lib/auth/tiktok-connection-store", () => ({
  getTikTokConnection: async () =>
    linkedHandle
      ? {
          userId: sessionUser?.id ?? "",
          mode: "profile_link" as const,
          handle: linkedHandle,
          nickname: null,
          avatarUrl: null,
          openId: null,
          unionId: null,
          scope: "",
          accessTokenEnc: null,
          refreshTokenEnc: null,
          accessExpiresAt: 0,
          status: "linked" as const,
          connectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : null,
}));
mock.module("@/lib/watch/local-comments", () => ({
  ensureShadowUser: async (sessionUser: { id: string }) => {
    if (shadowThrows) throw new Error("Neon ServerlessError: connection closed unexpectedly");
    return { id: `wf-${sessionUser.id}`, handle: "wfabc", name: "X", avatarUrl: "" };
  },
  shadowUserId: (sessionUserId: string) => `wf-${sessionUserId}`,
  uniqueSessionHandle: async (s: string) => `wf${s.slice(0, 6)}`,
}));

beforeEach(() => {
  clearCache();
  clearRateLimits();
  setTikTokUpstream(null);
  sessionUser = null;
  linkedHandle = null;
  shadowThrows = false;
});

describe("importUserId — the G22 resilient identity seam", () => {
  test("a transient upsert failure degrades to the DETERMINISTIC shadow id", async () => {
    const { importUserId } = await import("@/lib/tiktok/imports");
    shadowThrows = true;
    const id = await importUserId({ id: "abc123", email: "x@y.z", displayName: "X", avatarSeed: 7 });
    expect(id).toBe("wf-abc123");
  });

  test("the happy path resolves the SAME id the fallback would (the deterministic law)", async () => {
    const { importUserId } = await import("@/lib/tiktok/imports");
    shadowThrows = false;
    const id = await importUserId({ id: "abc123", email: "x@y.z", displayName: "X", avatarSeed: 7 });
    expect(id).toBe("wf-abc123");
  });
});

describe("GET /api/tiktok/channel/[handle] — the G21 viewerLinked stamp", () => {
  const req = (handle: string) =>
    new NextRequest(`http://localhost:3000/api/tiktok/channel/${handle}`);

  test("the linked viewer's OWN handle answers viewerLinked: true (case-insensitive)", async () => {
    const { GET } = await import("@/app/api/tiktok/channel/[handle]/route");
    sessionUser = { id: "u1", email: "x@y.z", displayName: "X", avatarSeed: 7 };
    linkedHandle = "scout2015";
    const res = await GET(req("scout2015"), { params: Promise.resolve({ handle: "scout2015" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewerLinked).toBe(true);
    // the rest of the DTO is untouched (additive field, the P95 pattern)
    expect(body.channel.handle).toBe("scout2015");
    expect(typeof body.universeSize).toBe("number");
  });

  test("case + sigil variants of the SAME handle still answer true (the P97 law composing)", async () => {
    const { GET } = await import("@/app/api/tiktok/channel/[handle]/route");
    sessionUser = { id: "u1", email: "x@y.z", displayName: "X", avatarSeed: 7 };
    linkedHandle = "scout2015";
    const messy = await GET(req("@@Scout2015"), {
      params: Promise.resolve({ handle: "@@Scout2015" }),
    });
    expect(messy.status).toBe(200);
    expect((await messy.json()).viewerLinked).toBe(true);
  });

  test("a DIFFERENT linked handle answers false (never a stranger's acknowledgment)", async () => {
    const { GET } = await import("@/app/api/tiktok/channel/[handle]/route");
    sessionUser = { id: "u1", email: "x@y.z", displayName: "X", avatarSeed: 7 };
    linkedHandle = "othercreator";
    const res = await GET(req("scout2015"), { params: Promise.resolve({ handle: "scout2015" }) });
    expect((await res.json()).viewerLinked).toBe(false);
  });

  test("a guest answers false (the field exists — additive, never absent)", async () => {
    const { GET } = await import("@/app/api/tiktok/channel/[handle]/route");
    sessionUser = null;
    linkedHandle = "scout2015"; // even a stored link is invisible without the session
    const res = await GET(req("scout2015"), { params: Promise.resolve({ handle: "scout2015" }) });
    expect((await res.json()).viewerLinked).toBe(false);
  });
});

describe("the About tab — the G21 linked statement (the component law)", () => {
  test("viewerLinked renders the linked statement, not the stranger prompt", async () => {
    // the DOM deps (module scope, the p95-gaps idiom)
    const dom = await import("happy-dom");
    const win = new dom.Window() as unknown as typeof globalThis;
    (globalThis as Record<string, unknown>).window = win;
    for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement"]) {
      (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
    }
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { TikTokChannelView } = await import("@/app/tiktok/[handle]/view");
    // useApi's fetch seam: answer the DTO directly
    const dto = {
      channel: {
        handle: "scout2015",
        nickname: null,
        avatarUrl: "https://unavatar.io/tiktok/scout2015",
        profileUrl: "https://www.tiktok.com/@scout2015",
        postCount: 1,
        bannerUrl: null,
      },
      videos: [],
      universeSize: 17,
      note: null,
      viewerLinked: true,
    };
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (() =>
      Promise.resolve(new Response(JSON.stringify(dto), { status: 200 }))) as unknown as typeof fetch;
    try {
      const container = win.document.createElement("div");
      win.document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(createElement(TikTokChannelView, { handle: "scout2015" }));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      // the About tab is LAZY — switch to it before asserting (the tab
      // memory is per-handle in localStorage; happy-dom's window serves it)
      const aboutTab = container.querySelector('[data-testid="tiktok-channel-tab-about"]');
      expect(aboutTab).not.toBeNull();
      await act(async () => {
        (aboutTab as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 20));
      });
      const html = container.innerHTML;
      expect(html).toContain("tiktok-about-linked");
      expect(html).toContain("This is you — linked as @scout2015");
      expect(html).not.toContain("Is this you?");
      root.unmount();
    } finally {
      (globalThis as { fetch: unknown }).fetch = realFetch;
    }
  });
});
