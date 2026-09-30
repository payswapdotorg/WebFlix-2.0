/// <reference types="bun-types" />
/**
 * WFX2-C-S tests — the replay-chat re-anchor loop inside useLiveChat:
 * backward seeks drop future messages instantly and re-bootstrap with
 * ?replayOffsetSec (session-start walk); forward leaps past window+10s
 * walk from the CURRENT token; in-window reveals need no fetch; scrub
 * drags coalesce (newest intent wins, older fetches aborted); stale
 * advance-frames are discarded (dropSeq); live chat never re-anchors;
 * refresh() re-anchors to the playhead.
 *
 * happy-dom + createRoot/act (the youtube-player.test.tsx pattern) with a
 * DEFERRED fetch stub: every fetch lands in a pending queue the test
 * settles explicitly, so in-flight frames can be raced against seeks.
 * Fixtures mirror the /api/videos/[id]/livechat envelope (replay frames
 * with offsetMsec-carrying messages + continuation tokens).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { useEffect } from "react";
import { act } from "react";
import { useLiveChat, type UseLiveChatResult } from "@/hooks/use-live-chat";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

// ---- happy-dom as the global DOM (set before any component runs) ----
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
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
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures ---------------------------------------------------------------

const VIDEO = "REPLAY1";
const BASE = `/api/videos/${VIDEO}/livechat`;

/** Minimal replay-message fixture (offsetSec → offsetMsec). */
function rmsg(id: string, offsetSec: number | null): LiveChatMessageDTO {
  return {
    id,
    author: { id: `a-${id}`, name: `Author ${id}`, avatarUrl: null, badges: [], memberSinceText: null },
    body: `body ${id}`,
    timestampUsec: "0",
    kind: "text",
    isSuperChat: false,
    superChat: null,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: offsetSec === null ? null : offsetSec * 1000,
  };
}

function parseQuery(u: string): { token: string | null; offset: number | null } {
  const i = u.indexOf("?");
  const params = new URLSearchParams(i === -1 ? "" : u.slice(i + 1));
  const token = params.get("token");
  const off = params.get("replayOffsetSec");
  return { token, offset: off === null ? null : Number(off) };
}

// ---- deferred fetch stub ----------------------------------------------------

const realFetch = globalThis.fetch;
type Pending = { url: string; resolve: (body: unknown) => void };
let pending: Pending[] = [];
let urls: string[] = [];

/** Route table for the stubbed /livechat endpoint (per-test overridable). */
const defaultRouter: (url: string) => Record<string, unknown> = (u) => {
  if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
  const { token, offset } = parseQuery(u);
  if (offset !== null) {
    // re-anchor bootstrap (no token) OR forward leap-walk (token present):
    // the server walk returns only messages at/after the target offset
    return {
      mode: "replay",
      isReplay: true,
      pollMs: 0,
      participants: null,
      nextToken: "tok-after-seek",
      messages: [rmsg("s0", offset), rmsg("s1", offset + 30)],
    };
  }
  if (token !== null) {
    // plain advance frame
    return {
      mode: "replay",
      isReplay: true,
      pollMs: 0,
      participants: null,
      nextToken: "tok-2",
      messages: [rmsg("adv0", 100), rmsg("adv1", 115)],
    };
  }
  // bootstrap first frame (window 0s..10s)
  return {
    mode: "replay",
    isReplay: true,
    pollMs: 0,
    participants: null,
    nextToken: "tok-1",
    messages: [rmsg("m0", 0), rmsg("m1", 5), rmsg("m2", 10)],
  };
};
let router: (url: string) => Record<string, unknown> = defaultRouter;

globalThis.fetch = (async (url: string | URL | Request, _init?: RequestInit) => {
  const u = String(url);
  urls.push(u);
  return await new Promise<Response>((resolve) => {
    pending.push({
      url: u,
      resolve: (body) =>
        resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });
  });
}) as typeof fetch;

/** Resolve every in-flight fetch (drains chained fetches too). */
async function settle() {
  let guard = 0;
  while (pending.length > 0 && guard < 20) {
    guard += 1;
    const snapshot = pending.splice(0, pending.length);
    for (const p of snapshot) p.resolve(router(p.url));
    await act(async () => {
      await sleep(15);
    });
  }
}

// ---- harness ----------------------------------------------------------------

let latest: UseLiveChatResult | null = null;

function Harness(props: {
  videoId: string;
  currentTimeSec?: number;
  onResult: (r: UseLiveChatResult) => void;
}) {
  const chat = useLiveChat(props.videoId, { currentTimeSec: props.currentTimeSec });
  useEffect(() => {
    props.onResult(chat);
  });
  return <div data-testid="state">{chat.state}</div>;
}

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

async function renderAt(currentTimeSec?: number) {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(
      <Harness
        videoId={VIDEO}
        currentTimeSec={currentTimeSec}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );
  });
}

async function moveTo(currentTimeSec?: number) {
  await act(async () => {
    root!.render(
      <Harness
        videoId={VIDEO}
        currentTimeSec={currentTimeSec}
        onResult={(r) => {
          latest = r;
        }}
      />,
    );
  });
}

const ids = () => (latest?.messages ?? []).map((m) => m.id);

beforeEach(() => {
  pending = [];
  urls = [];
  latest = null;
  router = defaultRouter;
});

afterEach(() => {
  const r = root;
  if (r) {
    act(() => {
      r.unmount();
    });
    root = null;
  }
  host?.remove();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("useLiveChat — replay seek re-anchor loop", () => {
  test("backward seek drops future messages instantly, then re-anchors from the session-start token (?replayOffsetSec, no token)", async () => {
    await renderAt();
    await settle();
    expect(latest!.state).toBe("replay");
    expect(ids()).toEqual(["m0", "m1", "m2"]);

    await moveTo(6); // first observation → record only
    await moveTo(4); // backward 2s → re-anchor
    expect(ids()).toEqual(["m0"]); // m1@5s and m2@10s are future → dropped INSTANTLY
    expect(latest!.seeking).toBe(true);

    await settle();
    expect(urls[1]).toBe(`${BASE}?replayOffsetSec=4`);
    expect(latest!.state).toBe("replay");
    expect(latest!.seeking).toBe(false);
    // kept history (<= 4s) + the walked window (messages >= 4s)
    expect(ids()).toEqual(["m0", "s0", "s1"]);
    expect(latest!.messages.map((m) => m.offsetMsec)).toContain(4000);
  });

  test("forward leap past windowEnd+10s walks from the CURRENT token (?token&mode=replay&replayOffsetSec)", async () => {
    await renderAt();
    await settle();
    await moveTo(6);
    await moveTo(25); // window 10s + 10s grace = 20s < 25s → walk
    await settle();
    expect(urls[1]).toBe(`${BASE}?token=tok-1&mode=replay&replayOffsetSec=25`);
    expect(ids()).toEqual(["m0", "m1", "m2", "s0", "s1"]);
    expect(latest!.nextToken).toBe("tok-after-seek");
  });

  test("forward seek within the fetched window → reveal, NO fetch", async () => {
    await renderAt();
    await settle();
    await moveTo(4);
    await moveTo(9); // in-window (<= windowEnd 10s)
    expect(urls).toHaveLength(1); // bootstrap only
    expect(ids()).toEqual(["m0", "m1", "m2"]);
    expect(latest!.seeking).toBe(false);
  });

  test("±1s youtube.com tolerance → no fetch, no drop", async () => {
    await renderAt();
    await settle();
    await moveTo(8);
    await moveTo(7); // -1s
    await moveTo(8); // +1s
    expect(urls).toHaveLength(1);
    expect(ids()).toEqual(["m0", "m1", "m2"]);
    expect(latest!.state).toBe("replay");
  });

  test("scrub drags coalesce: two rapid backward seeks → newest target wins (older bootstrap aborted)", async () => {
    await renderAt();
    await settle();
    await moveTo(6);
    await moveTo(4); // re-anchor #1 (fetch in flight, NOT resolved yet)
    await moveTo(2); // re-anchor #2 supersedes: aborts #1's fetch
    await settle();
    // both bootstrap walks fired, but only the NEWEST window landed
    expect(urls[1]).toBe(`${BASE}?replayOffsetSec=4`);
    expect(urls[2]).toBe(`${BASE}?replayOffsetSec=2`);
    expect(ids()).toEqual(["m0", "s0", "s1"]);
    expect(latest!.messages.every((m) => m.offsetMsec === null || m.offsetMsec <= 2000 || m.offsetMsec >= 2000)).toBe(true);
    // the offset-4 frame's messages (>= 4s, < ... hmm — s0@4/s1@34 from intent #1) must NOT be there:
    expect(latest!.messages.map((m) => m.offsetMsec)).not.toContain(4000);
    expect(latest!.messages.map((m) => m.offsetMsec)).not.toContain(34000);
  });

  test("dropSeq: an advance frame captured before a backward seek is DISCARDED on arrival", async () => {
    await renderAt();
    await settle();
    await moveTo(12); // playhead past windowEnd 10s → advance fetch IN FLIGHT (held)
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(`${BASE}?token=tok-1&mode=replay`);
    await moveTo(2); // backward seek aborts + discards that advance
    await settle();
    expect(ids()).toEqual(["m0", "s0", "s1"]); // adv0/adv1 NEVER applied
    expect(latest!.messages.map((m) => m.id)).not.toContain("adv0");
    expect(latest!.messages.map((m) => m.id)).not.toContain("adv1");
  });

  test("pause freeze (constant playhead → no fetches) and resume catch-up (advance fires once past the window)", async () => {
    await renderAt();
    await settle();
    await moveTo(8);
    await moveTo(8); // frozen playhead
    expect(urls).toHaveLength(1);
    await moveTo(11); // resume: 11s > windowEnd 10s → catch-up advance
    await settle();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(`${BASE}?token=tok-1&mode=replay`);
    expect(ids()).toEqual(["m0", "m1", "m2", "adv0", "adv1"]);
  });

  test("live chat never re-anchors on playhead jumps", async () => {
    router = (u) => {
      if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
      return {
        mode: "live",
        isReplay: false,
        pollMs: 10_000,
        participants: 5,
        nextToken: "live-tok",
        messages: [rmsg("lv0", null), rmsg("lv1", null)],
      };
    };
    await renderAt();
    await settle();
    expect(latest!.state).toBe("live");
    await moveTo(60);
    await moveTo(30); // big backward jump — live chat ignores it
    expect(urls).toHaveLength(1); // bootstrap only
    expect(latest!.state).toBe("live");
    expect(ids()).toEqual(["lv0", "lv1"]);
  });

  test("a seek racing the initial bootstrap re-anchors (loading-state classification)", async () => {
    await renderAt(50); // bootstrap fetch held (not settled)
    expect(urls).toHaveLength(1);
    await moveTo(30); // backward while loading → re-anchor intent
    await settle();
    expect(urls[0]).toBe(BASE);
    expect(urls[1]).toBe(`${BASE}?replayOffsetSec=30`);
    // the FIRST (plain) bootstrap frame was aborted → only the seek window landed
    expect(ids()).toEqual(["s0", "s1"]);
    expect(latest!.state).toBe("replay");
  });

  test("refresh() in replay mode re-anchors to the CURRENT playhead", async () => {
    await renderAt();
    await settle();
    await moveTo(4);
    await act(async () => {
      latest!.refresh();
    });
    expect(urls[1]).toBe(`${BASE}?replayOffsetSec=4`);
    await settle();
    expect(latest!.state).toBe("replay");
    // refresh re-fetches at the playhead and MERGES (dedupe) — the kept
    // buffer stays, the walked window at the playhead appends
    expect(ids()).toEqual(["m0", "m1", "m2", "s0", "s1"]);
  });

  test("exhausted replay (no continuation) → forward leaps never fetch", async () => {
    router = (u) => {
      if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
      return {
        mode: "replay",
        isReplay: true,
        pollMs: 0,
        participants: null,
        nextToken: null,
        messages: [rmsg("m0", 0), rmsg("m1", 5)],
      };
    };
    await renderAt();
    await settle();
    await moveTo(4);
    await moveTo(200); // way past the window — but hasMore=false → reveal
    expect(urls).toHaveLength(1);
    expect(latest!.seeking).toBe(false);
  });

  test("a walk intent superseded by a newer backward seek is discarded (newest wins across kinds)", async () => {
    await renderAt();
    await settle();
    await moveTo(6);
    await moveTo(25); // walk intent → fetch held in flight
    expect(urls[1]).toBe(`${BASE}?token=tok-1&mode=replay&replayOffsetSec=25`);
    await moveTo(2); // backward seek supersedes the walk
    await settle();
    expect(ids()).toEqual(["m0", "s0", "s1"]); // the walk frame never applied
  });
});
