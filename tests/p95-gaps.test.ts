/// <reference types="bun-types" />
/**
 * P95 — the remaining-gaps wave pins
 * (docs/research/2026-11-05-p95-remaining-gaps-closure-report.md):
 *
 *  - G14's LAW: the seeded demo-channel handles carry the `-wf` suffix — a
 *    local handle can never collide with (and mis-attribute the demo
 *    videos to) a real YouTube channel again (the @pixel-studios ↔ live
 *    FiveM-channel collision that the P95 re-walk proved live);
 *  - G14's FALLBACK: a handle a LOCAL row owns serves the local universe
 *    through the SAME ChannelPageDTO, BEFORE the live ladder (the re-walk's
 *    measured mis-attribution: the compose rung answered @pixel-studios-wf
 *    with the unrelated "Pixel Studio") — and an unknown handle keeps the
 *    honest walled degrade;
 *  - G10's honest absence: an empty description renders "No description"
 *    (collapsed + expanded), never invented copy.
 *
 * The mapper/route pins run against the seeded boot DB (the test:boot lane:
 * DATABASE_URL=file:../db/boot-test.db + prisma/seed.ts). The upstream stays
 * null for the whole file (the cold-wall state — never the network).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// the happy-dom window (module scope — describe bodies are sync)
const dom = await import("happy-dom");
const win = new dom.Window() as unknown as typeof globalThis;
(globalThis as Record<string, unknown>).window = win;
for (const k of ["document", "MutationObserver", "SVGElement", "HTMLElement"]) {
  (globalThis as Record<string, unknown>)[k] = (win as unknown as Record<string, unknown>)[k];
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { localChannelPage } from "@/lib/watch/local-channel";
import { GET as channelRoute } from "@/app/api/channel/[handle]/route";
import { DescriptionBox } from "@/components/watch/description-box";
import { afterAll as afterAllFn, mock } from "bun:test";

// the whole file lives in the cold-wall state: no InnerTube upstream, so
// every /api/channel read misses live and exercises the P95 fallback rung
setUpstream(null);

// AND the live ladder itself is pinned to the cold miss for the route pins —
// the P95 re-walk's lesson: the LIVE search-compose rung resolves almost any
// handle-ish string to a real channel ("@this-never-existed" once answered a
// real 572K-subscriber channel), so a deterministic route test mocks the
// resilient read at the module boundary (the action-routes idiom; file-scoped
// by --isolate). The REAL ladder's wall behavior stays channel-wall.test.ts's
// domain; the REAL compose's behavior stays channel-compose.test.ts's.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realChannels = { ...require("@/lib/youtube/channels") } as Record<string, unknown>;
mock.module("@/lib/youtube/channels", () => ({
  getChannelPageResilient: async () => ({ page: null, walled: true }),
}));
afterAllFn(() => {
  mock.module("@/lib/youtube/channels", () => realChannels);
});

beforeEach(() => {
  clearCache();
});

// ---------------------------------------------------------------------------
// G14 — the seed-handle collision law
// ---------------------------------------------------------------------------
describe("P95 G14: the demo handles never collide with real YouTube handles", () => {
  test("every seeded CHANNEL handle carries the -wf suffix (structural pin)", () => {
    const src = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
    const channelsSection = src.slice(
      src.indexOf("---- channels"),
      src.indexOf("---- videos")
    );
    expect(channelsSection.length).toBeGreaterThan(0);
    const handles = Array.from(
      channelsSection.matchAll(/handle: "([a-z0-9-]+)"/g),
      (m) => m[1]
    );
    // the five demo channels of the P95 rename (pixel/gamevault/wanderlust/
    // sound-forge/codecraft) — the law: EVERY channel handle is namespaced
    expect(handles.length).toBeGreaterThanOrEqual(5);
    const offenders = handles.filter((h) => !h.endsWith("-wf"));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G14 — the local-universe channel page (mapper + route fallback)
// ---------------------------------------------------------------------------
describe("P95 G14: the local-channel fallback serves the demo universe", () => {
  test("mapper: @pixel-studios-wf renders its own rows through the channel DTO", async () => {
    const page = await localChannelPage("@pixel-studios-wf");
    expect(page).not.toBeNull();
    const dto = page!;
    expect(dto.channel.handle).toBe("pixel-studios-wf"); // the bare-handle law
    expect(dto.channel.name).toBe("Pixel Studios");
    expect(dto.channel.local).toBe(true);
    expect(dto.channel.isSubscribed).toBe(false);
    expect(dto.channel.isOwner).toBe(false);
    expect(dto.channel.videoCount).toBeGreaterThan(0);
    expect(dto.local).toBe(true);
    expect(dto.joinable).toBe(false);
    expect(dto.walled).toBeUndefined();
    expect(dto.tabs).toEqual(["home", "videos", "about"]);
    // attribution coherence: every served video belongs to THIS channel row
    const all = [...dto.videos, ...dto.shorts];
    expect(all.length).toBe(dto.channel.videoCount);
    for (const v of all) {
      expect(v.channel.handle).toBe("pixel-studios-wf");
    }
  });

  test("mapper: bare handle form + other demo channels + honest null on a miss", async () => {
    const bare = await localChannelPage("pixel-studios-wf");
    expect(bare?.channel.handle).toBe("pixel-studios-wf");
    const gamevault = await localChannelPage("@gamevault-wf");
    expect(gamevault?.channel.name).toBe("GameVault");
    expect(await localChannelPage("@no-such-demo-channel-xyz")).toBeNull();
    expect(await localChannelPage("")).toBeNull();
  });

  test("route: a local handle answers LOCAL-FIRST (before the live ladder) — HTTP 200 local DTO", async () => {
    const res = await channelRoute(
      new Request("http://localhost/api/channel/@codecraft-wf"),
      { params: Promise.resolve({ handle: "@codecraft-wf" }) }
    );
    expect(res.status).toBe(200);
    const dto = (await res.json()) as {
      channel: { handle: string; name: string; local?: boolean; videoCount: number } | null;
      walled?: boolean;
      local?: boolean;
      tabs?: string[];
    };
    expect(dto.walled).toBe(false);
    expect(dto.local).toBe(true);
    expect(dto.channel?.local).toBe(true);
    expect(dto.channel?.handle).toBe("codecraft-wf"); // the demo account's OWN channel
    expect(dto.tabs).toEqual(["home", "videos", "about"]);
  });

  test("route: the cold-wall miss + an UNKNOWN handle → the honest walled degrade stands", async () => {
    // the resilient read is mocked to the cold miss (header note) — an
    // unknown handle misses locally too, so the degrade stands untouched
    const res = await channelRoute(new Request("http://localhost/api/channel/@no-such-handle-qqq"), {
      params: Promise.resolve({ handle: "@no-such-handle-qqq" }),
    });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { channel: null; walled: boolean; note: string };
    expect(dto.channel).toBeNull();
    expect(dto.walled).toBe(true);
    expect(typeof dto.note).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// G10 — the honest empty-description line
// ---------------------------------------------------------------------------
describe("P95 G10: an empty description renders the honest absence", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterAll(() => {
    root?.unmount();
  });

  function render(description: string) {
    // one live root at a time (three mounted roots thrash happy-dom's
    // MutationObserver — the solo-run/order interaction)
    root?.unmount();
    if (host?.parentNode) host.parentNode.removeChild(host);
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host!);
    act(() => {
      root!.render(
        createElement(DescriptionBox, {
          videoId: "p95test",
          description,
          views: 1234,
          createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
          durationSec: 60,
          thumbnailUrl: "https://example.com/t.jpg",
          onSeek: () => {},
        })
      );
    });
  }

  test("blank description → 'No description' (collapsed), never an empty box", () => {
    render("");
    const html = host!.innerHTML;
    expect(html).toContain("No description");
    expect(win.document.querySelector('[data-testid="description-empty"]')).not.toBeNull();
  });

  test("whitespace-only description → the same honest absence (expanded too)", () => {
    render("   \n  ");
    act(() => {
      // expand via the "...more" toggle
      const more = [...host!.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("more")
      );
      more?.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    });
    expect(win.document.querySelector('[data-testid="description-empty-expanded"]')).not.toBeNull();
  });

  test("a real description renders the body — the honest line stays hidden", () => {
    render("A real seeded description with #tags");
    expect(host!.innerHTML).toContain("A real seeded description");
    expect(win.document.querySelector('[data-testid="description-empty"]')).toBeNull();
    expect(win.document.querySelector('[data-testid="description-empty-expanded"]')).toBeNull();
  });
});
