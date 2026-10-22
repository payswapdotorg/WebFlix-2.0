/// <reference types="bun-types" />
/**
 * WFX2-P23-C tests — the shorts engagement rail's P23-C additions:
 *  - the SOUND DISC (G5): renders ONLY when the DTO carries a sound token
 *    (honest absence — never a dead link), links /sound/<encoded-key>,
 *    rotates while the slide plays (the data-paused gate), carries
 *    youtube.com's own contentDescription ("See more videos using this
 *    sound") and the disc artwork.
 *  - REMIX (G6): youtube.com's own rail slot between Share and the disc,
 *    rendered in youtube.com's own DISABLED honest form (aria-disabled) —
 *    the click surfaces the honest note ("Shorts creation is not available
 *    in WebFlix"), never a fake flow.
 * happy-dom + createRoot/act (the clip-page pattern).
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

// ---- happy-dom as the global DOM ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeList",
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

// ---- stubs: sonner + fetch (the rail's write seams) ----
const toasts: string[] = [];
// P24-SEND (G12): the toast ACTION capture — the feedback-toast UNDO
// affordance (label + onClick) is part of the family's contract.
const toastCalls: { text: string; action?: { label: string; onClick: () => void } }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(
    (msg: string, opts?: { action?: { label: string; onClick: () => void } }) => {
      toasts.push(String(msg));
      toastCalls.push({ text: String(msg), action: opts?.action });
    },
    {
      success: (m: string) => toasts.push(`success:${m}`),
      error: (m: string) => toasts.push(`error:${m}`),
      info: (m: string) => toasts.push(`info:${m}`),
    },
  ),
}));

const posts: { url: string; body: unknown }[] = [];
// P24-SEND (G12): the stub is programmable per-test (the honest undo
// failure needs a 502); the default stays the original always-200 shape.
let fetchStatus = 200;
let fetchBody: unknown = { added: true, yourLike: "like", likes: 5 };
let fetchError: string | null = null;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url);
  posts.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response(
    JSON.stringify(fetchError ? { error: fetchError } : fetchBody),
    {
      status: fetchError ? 502 : fetchStatus,
      headers: { "Content-Type": "application/json" },
    },
  );
}) as unknown as typeof fetch;

const { ShortsEngagementRail } = await import(
  "@/components/shorts/shorts-engagement-rail"
);

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const qa = (sel: string): HTMLElement[] =>
  host ? Array.from(host.querySelectorAll(sel) as unknown as HTMLElement[]) : [];

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  toasts.length = 0;
  toastCalls.length = 0;
  posts.length = 0;
  fetchStatus = 200;
  fetchBody = { added: true, yourLike: "like", likes: 5 };
  fetchError = null;
});

async function renderRail(opts: {
  meta: Record<string, unknown> | null;
  playing?: boolean;
  guest?: boolean;
}) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <ShortsEngagementRail
        videoId="H3ONg7SPSWU"
        meta={opts.meta as never}
        metaLoading={false}
        guest={opts.guest ?? true}
        playing={opts.playing ?? true}
        onOpenComments={() => {}}
        onShare={() => {}}
        onReport={() => {}}
      />,
    );
  });
}

const META_NO_SOUND = {
  id: "H3ONg7SPSWU",
  title: "A short",
  channel: { id: "", handle: null, name: null, avatarUrl: null },
  viewsText: "1.2K views",
  likesText: "100 likes",
  commentsCountText: "30 comments",
  thumbnailUrl: null,
  isLive: false,
};

const META_WITH_SOUND = {
  ...META_NO_SOUND,
  soundId: "abc%3D%3Dtoken",
  soundTitle: "Original Sound",
  soundImageUrl: "https://yt3.ggpht.com/disc176.jpg",
};

describe("the sound disc (P23-C G5 — youtube.com's rail-end pivot)", () => {
  test("renders when the DTO carries the sound; links /sound/<encoded-key>", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const disc = q('[data-testid="shorts-sound-disc"]');
    expect(disc).toBeTruthy();
    const link = disc!.closest("a");
    expect(link?.getAttribute("href")).toBe(
      `/sound/${encodeURIComponent("abc%3D%3Dtoken")}`,
    );
    // youtube.com's own contentDescription (measured)
    expect(link?.getAttribute("aria-label")).toBe(
      "See more videos using this sound: Original Sound",
    );
    // the disc artwork (the pivot thumbnail's largest source)
    expect(disc!.querySelector("img")?.getAttribute("src")).toBe(
      "https://yt3.ggpht.com/disc176.jpg",
    );
  });

  test("NO sound on the DTO → the disc hides entirely (honest absence)", async () => {
    await renderRail({ meta: META_NO_SOUND });
    expect(q('[data-testid="shorts-sound-disc"]')).toBeNull();
  });

  test("the rotation gate: data-paused flips with the playing prop", async () => {
    await renderRail({ meta: META_WITH_SOUND, playing: true });
    expect(q('[data-testid="shorts-sound-disc"]')?.getAttribute("data-paused")).toBe(
      null,
    );
    await renderRail({ meta: META_WITH_SOUND, playing: false });
    expect(q('[data-testid="shorts-sound-disc"]')?.getAttribute("data-paused")).toBe(
      "true",
    );
  });

  test("the sound title renders under the disc (the pivot's attribution)", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    expect(host!.textContent).toContain("Original Sound");
  });

  test("no artwork → the disc still links (the Disc3 icon fallback, never a dead image link)", async () => {
    await renderRail({
      meta: { ...META_WITH_SOUND, soundImageUrl: null },
    });
    const disc = q('[data-testid="shorts-sound-disc"]');
    expect(disc).toBeTruthy();
    expect(disc!.querySelector("img")).toBeNull();
    expect(disc!.closest("a")?.getAttribute("href")).toContain("/sound/");
  });
});

describe("Remix (P23-C G6 — youtube.com's own disabled honest form)", () => {
  test("the entry rides between Share and the disc with aria-disabled", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    expect(remix).toBeTruthy();
    expect(remix!.getAttribute("aria-disabled")).toBe("true");
    // youtube.com's slot: Share < Remix < disc (the DOM order, measured)
    const labels = qa("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter(Boolean);
    const shareIdx = labels.findIndex((l) => l.includes("Share"));
    const remixIdx = labels.indexOf("Remix");
    expect(remixIdx).toBeGreaterThan(shareIdx);
    // the label under the button (youtube.com: the word "Remix")
    expect(host!.textContent).toContain("Remix");
  });

  test("the click surfaces the honest note WITH the measured reason — never a fake flow (no navigation, no fetch)", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    await act(async () => {
      remix!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // P25 G14 — the upgraded disclosure: the measured reason rides the toast
    expect(toasts).toContain(
      "info:Shorts creation is not available in WebFlix — YouTube's Shorts editor (incl. the 2026 AI editing family) is studio/app-side",
    );
    // no write seam fired (the affordance cannot work — it never pretends)
    expect(posts).toHaveLength(0);
  });

  test("Remix renders even without sound data (youtube.com's rail always carries it)", async () => {
    await renderRail({ meta: META_NO_SOUND });
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    expect(remix).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// P25 G14 — the Shorts-AI honest verdict, pinned on the rail: youtube.com's
// 2026 Shorts AI editing family (AI first-draft editing) is studio/app-side
// and UNREACHABLE from this egress (re-measured 2026-10-19: studio.youtube
// .com → 302 → accounts.google.com; /shorts/create → 404; the reel
// sequence payload's ⋯ sheet + rail carry ZERO AI-editing entries — and the
// Remix button itself renders DISABLED with youtube.com's own honest toast
// on the measured short). The P23-B LLM seam is READ-side; a local
// "AI edit" editor cannot save anything to youtube.com — the
// fake-affordance law. The honest deliverable: the disabled Remix entry's
// disclosure (the measured reason) + ZERO invented editing affordance in
// the rail and the ⋯ menu.
// ---------------------------------------------------------------------------

describe("P25 G14 — the Shorts-AI honest-absent disclosure (zero editing affordance)", () => {
  test("the rail carries ZERO editing/AI affordances beyond the honest-disabled Remix entry", async () => {
    await renderRail({ meta: META_WITH_SOUND });
    const buttons = qa("button").map((b) => (b.getAttribute("aria-label") ?? "").toLowerCase());
    // youtube.com's measured rail: like / dislike / comments / share /
    // remix / more — nothing else; NO "edit", "create", "draft", "AI" label
    for (const forbidden of ["ai", "edit", "create", "draft", "veo", "gemini"]) {
      expect(buttons.some((l) => l.includes(forbidden) && l !== "remix")).toBe(false);
    }
    // the one creation-family entry (Remix) is the honest-disabled form
    const remix = qa("button").find((b) => b.getAttribute("aria-label") === "Remix");
    expect(remix!.getAttribute("aria-disabled")).toBe("true");
    expect(remix!.hasAttribute("disabled")).toBe(false); // stays focusable (youtube.com's own form)
  });

  test("the ⋯ menu carries ZERO editing/AI entries (the measured sheet family only)", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    // open the menu (the G12 openMenu idiom)
    const more = qa("button").find((b) => b.getAttribute("aria-label") === "More actions");
    await act(async () => {
      more!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {});
    const items = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).map((el) => (el.textContent ?? "").trim().toLowerCase());
    // the app's real ⋯ actions only (Report / Save to Watch later / Copy
    // link / Not interested / Don't recommend channel) — youtube.com's
    // measured sheet carries Description / Save to playlist / Captions /
    // Full screen / Playback speed / Report / Send feedback: ZERO
    // AI-editing entries on either side. NEVER an invented "AI edit" item.
    for (const forbidden of ["ai", "edit", "create", "draft", "veo", "gemini"]) {
      expect(items.some((t) => t.includes(forbidden))).toBe(false);
    }
    expect(items).toContain("report");
    expect(items).toContain("save to watch later");
    expect(items).toContain("copy link");
  });

  test("the honest-absence law: no Captions / Playback speed items either (the player-bound defer family, G15)", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    const more = qa("button").find((b) => b.getAttribute("aria-label") === "More actions");
    await act(async () => {
      more!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {});
    const items = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).map((el) => (el.textContent ?? "").trim());
    // youtube.com's sheet DOES carry Captions/Playback-speed (player-bound
    // commands); the app's shorts player is the embed (controls=0) with NO
    // host control seam — the items stay deferred (the player ladder's own
    // rung), so they are honestly ABSENT here, never dead controls
    expect(items).not.toContain("Captions");
    expect(items).not.toContain("Playback speed");
  });
});

// ---------------------------------------------------------------------------
// P24-SEND (G12) — the shorts ⋯ menu's "Don't recommend channel" + the
// feedback-toast UNDO family. The item LEFT the honest-absence list (the
// seam is real now — the broker's home-feed kebab drive, the not-
// interested sibling); youtube.com's own menu adjacency (the repo's real
// ssr_trending.json capture): "Not interested" then "Don't recommend
// channel". The toast family: "Video removed · Undo" / "We won't
// recommend this channel anymore · Undo" — the undo click drives the
// broker's feedback-undo while youtube.com's toast window is live.
// ---------------------------------------------------------------------------

describe("the ⋯ menu — Don't recommend channel + the undo family (P24-SEND G12)", () => {
  const docItems = () =>
    Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).map((el) => (el.textContent ?? "").trim());

  async function openMenu() {
    const more = qa("button").find((b) => b.getAttribute("aria-label") === "More actions");
    expect(more).toBeTruthy();
    await act(async () => {
      more!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {});
  }

  const findItem = (label: string) =>
    Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === label)!;

  test("the ⋯ menu carries 'Don't recommend channel' AFTER 'Not interested' (the measured adjacency; the seam landed)", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    await openMenu();
    const items = docItems();
    expect(items).toContain("Not interested");
    expect(items).toContain("Don't recommend channel");
    expect(items.indexOf("Don't recommend channel")).toBe(items.indexOf("Not interested") + 1);
  });

  test("Don't recommend channel → the real write + the UNDO toast affordance", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    await openMenu();
    await act(async () => {
      findItem("Don't recommend channel").click();
    });
    await act(async () => {});
    await act(async () => {});
    expect(posts).toContainEqual({
      url: "/api/dont-recommend-channel",
      body: { videoId: "H3ONg7SPSWU" },
    });
    const t = toastCalls.find((x) => x.text === "We won't recommend this channel anymore");
    expect(t).toBeDefined();
    expect(t?.action?.label).toBe("Undo");
    // the undo click drives the undo route (youtube.com's own toast button)
    await act(async () => {
      t!.action!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(posts).toContainEqual({ url: "/api/dont-recommend-channel/undo", body: null });
    expect(toasts).toContain("success:Recommendations restored");
  });

  test("Not interested carries the UNDO family too (the shared seam)", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    await openMenu();
    await act(async () => {
      findItem("Not interested").click();
    });
    await act(async () => {});
    await act(async () => {});
    expect(posts).toContainEqual({
      url: "/api/videos/H3ONg7SPSWU/not-interested",
      body: null,
    });
    const t = toastCalls.find((x) => x.text === "Video removed");
    expect(t?.action?.label).toBe("Undo");
    await act(async () => {
      t!.action!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(posts).toContainEqual({ url: "/api/not-interested/undo", body: null });
    expect(toasts).toContain("success:Recommendations restored");
  });

  test("an expired undo window → the honest error toast, never a fake restoration", async () => {
    await renderRail({ meta: META_NO_SOUND, guest: false });
    await openMenu();
    await act(async () => {
      findItem("Don't recommend channel").click();
    });
    await act(async () => {});
    // the NEXT undo call answers the drive's honest expired-window error
    fetchError = "undo-toast-not-found";
    const t = toastCalls.find((x) => x.text === "We won't recommend this channel anymore");
    expect(t).toBeDefined();
    await act(async () => {
      t!.action!.onClick();
    });
    await act(async () => {});
    await act(async () => {});
    expect(toasts.some((s) => s.startsWith("error:undo-toast-not-found"))).toBe(true);
    expect(toasts).not.toContain("success:Recommendations restored");
  });
});

// ---------------------------------------------------------------------------
// WFX2-P39 — the Watch-later save carries the display snapshot: the rail's
// meta (title + channel.name) rides the POST body so the local WL list's
// rows render the short's REAL title/channel, never the generic
// "YouTube video <id>" / "YouTube channel" fallback.
// ---------------------------------------------------------------------------

describe("WFX2-P39 — Save to Watch later carries the display snapshot", () => {
  test("the ⋯ menu's Watch-later save posts {videoId, title, channelName} — the meta's real display data", async () => {
    await renderRail({
      meta: {
        ...META_NO_SOUND,
        title: "A short with a real title",
        channel: {
          id: "UCshorts1",
          handle: "@shortschannel",
          name: "Shorts Channel",
          avatarUrl: null,
        },
      },
      guest: false,
    });
    // the G12 openMenu idiom
    const more = qa("button").find((b) => b.getAttribute("aria-label") === "More actions");
    expect(more).toBeTruthy();
    await act(async () => {
      more!.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {});
    const saveItem = Array.from(
      win.document.querySelectorAll("[role='menuitem']") as unknown as HTMLElement[],
    ).find((el) => (el.textContent ?? "").trim() === "Save to Watch later");
    expect(saveItem).toBeDefined();
    await act(async () => {
      saveItem!.click();
    });
    await act(async () => {});
    await act(async () => {});
    // the tracked post body carries the display snapshot (the exact shape
    // /api/playlists/watch-later's snapshot parse consumes)
    expect(posts).toContainEqual({
      url: "/api/playlists/watch-later",
      body: {
        videoId: "H3ONg7SPSWU",
        title: "A short with a real title",
        channelName: "Shorts Channel",
      },
    });
    expect(toasts).toContain("success:Saved to Watch later"); // the honest add toast
  });
});
