/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 — Worker 4-c (UI lane) tests: the replay/
 * recorder surfaces (REC console + program recorder hook, replay player,
 * discovery replay shelf).
 *
 * happy-dom + createRoot/act (the auth-ui harness pattern, mirroring
 * tests/live-ui-phase3.test.tsx exactly: same DOM bootstrap, same render/
 * cleanup helpers), PLUS the fetch-swap idiom (the p36/youtube-direct
 * pattern): globalThis.fetch is monkeypatched per test — NO network, no
 * db, no module mocks. Fixtures are inline typed DTOs with every field
 * filled honestly.
 *
 * Pins (the 4-c row of the lane table):
 * - REC console: the honest program-view copy, start 200 → REC badge +
 *   zero-start elapsed timer + onRecordingChange(true) with the "{}" body,
 *   409 egress-not-configured → the honest egress copy, 403/429 copies,
 *   the stop flow (raw bytes, Content-Type from the take, ?durationMs=
 *   on the URL, success copy with the formatted size), the honest
 *   no-take guard, and the consent note while recording;
 * - useProgramRecorder: idle/double-stop resolves null, unsupported flips
 *   true where MediaRecorder is missing (happy-dom);
 * - replay panel: ready → data-testid="replay-video" with the server-minted
 *   playbackUrl + "(approx.)" metadata; failed/expired/recording honest
 *   copies; 404 → nothing; hostView visibility PATCH reflects the server
 *   asset;
 * - replay shelf: the "Replays" heading + one card per summary (title,
 *   @handle, approximate duration, room href); empty → renders null.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type {
  LiveReplayAssetDto,
  LiveReplaySummaryDto,
} from "@/lib/live/types";
import type {
  LiveRecordingTake,
  ProgramRecorder,
} from "@/components/live/live-recorder-console";

// ---- happy-dom as the global DOM (the auth-ui harness) ------------------
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
  "HTMLMediaElement",
  "HTMLVideoElement",
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

// ---- the three surfaces (imported after the DOM exists, the harness law) -
const { LiveRecorderConsole, useProgramRecorder } = await import(
  "@/components/live/live-recorder-console"
);
const { LiveReplayPanel } = await import("@/components/live/live-replay-panel");
const { LiveReplayShelf } = await import("@/components/live/live-replay-shelf");

// ---- fetch swap (the p36 idiom): controllable responses, recorded wire ---
const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** The per-test responder (default: an empty 200 JSON body). */
let respond: (url: string, init: RequestInit) => Response | Promise<Response> =
  () => jsonResponse({});

beforeEach(() => {
  fetchLog.length = 0;
  respond = () => jsonResponse({});
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    fetchLog.push({ url: u, init: i });
    return respond(u, i);
  }) as unknown as typeof fetch;
});

// ---- harness -------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): Element | null =>
  host ? (host.querySelector(sel) as unknown as Element | null) : null;
const all = (sel: string): Element[] =>
  host ? (Array.from(host.querySelectorAll(sel)) as unknown as Element[]) : [];

async function render(el: ReactElement) {
  // a test may re-render (state transitions) — retire the previous tree first
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  host?.remove();
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Let the mocked fetch chain + the resulting state update settle. */
async function flush() {
  await act(async () => {
    await sleep(0);
  });
}

/** React-safe select change: set through the prototype descriptor, then bubble. */
async function selectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    desc?.set?.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  globalThis.fetch = realFetch;
});

// ═══════════════════════════════════════════════════════════════════
// Fixtures — typed, every field filled honestly.
// ═══════════════════════════════════════════════════════════════════

const ROOM = "room-4c";
const PLAYBACK_URL = `/api/live-rooms/${ROOM}/replay/stream`;

function assetFixture(over: Partial<LiveReplayAssetDto> = {}): LiveReplayAssetDto {
  return {
    id: "replay-4c",
    roomId: ROOM,
    sessionId: "sess-4c",
    sink: "host-capture",
    status: "ready",
    mimeType: "video/webm",
    sizeBytes: 34567,
    durationMs: 125_000, // → 2:05
    visibility: "inherit",
    error: null,
    recordingStartedAt: "2026-11-04T12:00:00.000Z",
    stoppedAt: "2026-11-04T12:02:05.000Z",
    readyAt: "2026-11-04T12:02:06.000Z",
    retentionExpiresAt: "2026-12-04T12:02:06.000Z",
    ...over,
  };
}

function summaryFixture(over: Partial<LiveReplaySummaryDto> = {}): LiveReplaySummaryDto {
  return {
    roomId: ROOM,
    sessionId: "sess-4c",
    title: "Season finale recap",
    hostHandle: "hostly",
    hostName: "Hostly Host",
    readyAt: "2026-11-04T12:02:06.000Z",
    durationMs: 125_000,
    ...over,
  };
}

/**
 * Stateful parent harness — the console's recording state law: the PARENT
 * owns the state and this one flips it exactly through onRecordingChange.
 */
function RecorderHarness(props: {
  initialRecording?: boolean;
  changes: boolean[];
  getRecordingTake?: () => Promise<LiveRecordingTake | null>;
}) {
  const [recording, setRecording] = useState(props.initialRecording ?? false);
  return (
    <LiveRecorderConsole
      roomId={ROOM}
      recording={recording}
      onRecordingChange={(v) => {
        props.changes.push(v);
        setRecording(v);
      }}
      getRecordingTake={props.getRecordingTake}
    />
  );
}

function RecorderProbe({
  onReady,
}: {
  onReady: (recorder: ProgramRecorder) => void;
}) {
  const recorder = useProgramRecorder();
  useEffect(() => {
    onReady(recorder);
  });
  return null;
}

async function click(testId: string): Promise<void> {
  const button = q(`[data-testid="${testId}"]`) as unknown as HTMLButtonElement | null;
  if (!button) throw new Error(`missing button ${testId}`);
  await act(async () => {
    button.click();
  });
  await flush();
}

// ═══════════════════════════════════════════════════════════════════
// LiveRecorderConsole — the host REC control
// ═══════════════════════════════════════════════════════════════════

describe("4-c LiveRecorderConsole — the host REC control", () => {
  test("idle: the honest program-view copy + Start recording; a 200 start flips the REC badge on via onRecordingChange(true) and POSTs {}", async () => {
    respond = () => jsonResponse({ asset: assetFixture({ status: "recording" }) });
    const changes: boolean[] = [];
    await render(<RecorderHarness changes={changes} />);

    // idle honesty: the copy is part of the consent law
    expect(host!.textContent).toContain(
      "Records the program view in this console (camera, mic and rendered guests). Every participant sees the REC indicator.",
    );
    expect(q('[data-testid="recorder-start"]')).not.toBeNull();
    expect(q('[data-testid="rec-badge"]')).toBeNull();

    await click("recorder-start");

    const startCall = fetchLog.find((c) => c.url.includes("/replay/start"));
    expect(startCall).toBeDefined();
    expect(startCall!.init.method).toBe("POST");
    expect(startCall!.init.body).toBe("{}");
    expect(changes).toEqual([true]); // the server accepted → the parent is told

    // the recording state: pulsing REC badge + hydration-safe zero timer
    expect(q('[data-testid="rec-badge"]')).not.toBeNull();
    expect(q('[data-testid="rec-badge"]')!.className).toContain("animate-pulse");
    expect(q('[data-testid="rec-elapsed"]')!.textContent).toContain("0:00");
    expect(q('[data-testid="recorder-stop"]')!.textContent).toContain(
      "Stop & save replay",
    );
  });

  test("start 409 egress-not-configured → the honest egress copy, no state flip", async () => {
    respond = () => jsonResponse({ error: "conflict", message: "egress-not-configured" }, 409);
    const changes: boolean[] = [];
    await render(<RecorderHarness changes={changes} />);

    await click("recorder-start");

    expect(q('[data-testid="recorder-error"]')!.textContent).toContain(
      "Server-side recording is not configured on this deployment.",
    );
    expect(changes).toEqual([]); // a failed start never flips the state
    expect(q('[data-testid="rec-badge"]')).toBeNull();
  });

  test("start 403 → the host-only copy; start 429 → the rate-limit copy", async () => {
    respond = () => jsonResponse({ error: "forbidden" }, 403);
    const changes: boolean[] = [];
    await render(<RecorderHarness changes={changes} />);
    await click("recorder-start");
    expect(q('[data-testid="recorder-error"]')!.textContent).toContain(
      "Only the host can control recording.",
    );
    expect(changes).toEqual([]);

    respond = () => jsonResponse({ error: "rate-limited" }, 429);
    await render(<RecorderHarness changes={changes} />);
    await click("recorder-start");
    expect(q('[data-testid="recorder-error"]')!.textContent).toContain(
      "Slow down — too many recording changes.",
    );
    expect(changes).toEqual([]);
  });

  test("recording: stop supplies the take → RAW-byte POST with ?durationMs=4200 + Content-Type video/webm, success copy with the formatted size, onRecordingChange(false)", async () => {
    respond = (url) => {
      if (url.includes("/replay/stop")) {
        return jsonResponse({
          asset: assetFixture({ status: "ready", sizeBytes: 34567, durationMs: 4200 }),
        });
      }
      return jsonResponse({});
    };
    const take: LiveRecordingTake = {
      blob: new Blob([new Uint8Array(16)], { type: "video/webm" }),
      durationMs: 4200,
    };
    const changes: boolean[] = [];
    await render(
      <RecorderHarness initialRecording changes={changes} getRecordingTake={async () => take} />,
    );

    // the consent note is a recording-state fact
    expect(q('[data-testid="rec-badge"]')).not.toBeNull();
    expect(q('[data-testid="rec-consent-note"]')!.textContent).toContain(
      "Guests on stage can see the REC indicator.",
    );

    await click("recorder-stop");

    const stopCall = fetchLog.find((c) => c.url.includes("/replay/stop"));
    expect(stopCall).toBeDefined();
    expect(stopCall!.init.method).toBe("POST");
    expect(stopCall!.url).toContain("durationMs=4200");
    expect((stopCall!.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "video/webm",
    );
    expect(stopCall!.init.body).toBe(take.blob); // the RAW bytes, never JSON
    expect(changes).toEqual([false]);

    expect(q('[data-testid="recorder-saved"]')!.textContent).toContain(
      "Replay saved — it will appear when the stream ends.",
    );
    expect(q('[data-testid="recorder-saved"]')!.textContent).toContain("33.8 KB");
    // back to idle, the saved note persists
    expect(q('[data-testid="recorder-start"]')).not.toBeNull();
  });

  test("stop with no take (getRecordingTake → null) → the honest no-take error and NOTHING uploaded", async () => {
    const changes: boolean[] = [];
    await render(
      <RecorderHarness initialRecording changes={changes} getRecordingTake={async () => null} />,
    );
    await click("recorder-stop");

    expect(q('[data-testid="recorder-error"]')!.textContent).toContain(
      "The recorder had no take to save.",
    );
    expect(fetchLog.some((c) => c.url.includes("/replay/stop"))).toBe(false);
    expect(changes).toEqual([]); // no take → no server answer → no flip
  });
});

// ═══════════════════════════════════════════════════════════════════
// useProgramRecorder — the parent-owned MediaRecorder lifecycle
// ═══════════════════════════════════════════════════════════════════

describe("4-c useProgramRecorder — the local capture hook", () => {
  test("stop with nothing recorded resolves null (the idle/double-stop guard); unsupported flips true where MediaRecorder is missing", async () => {
    let probe: ProgramRecorder | undefined;
    await render(<RecorderProbe onReady={(r) => (probe = r)} />);
    await flush();

    expect(probe).toBeDefined();
    expect(probe!.recording).toBe(false);
    // happy-dom has no MediaRecorder — the honest capability fact shows after mount
    expect(probe!.unsupported).toBe(true);
    const take = await probe!.stop();
    expect(take).toBeNull();
    // the double-stop guard: still null, never a fake take
    const again = await probe!.stop();
    expect(again).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// LiveReplayPanel — the honest replay player
// ═══════════════════════════════════════════════════════════════════

describe("4-c LiveReplayPanel — the replay player", () => {
  test("ready: data-testid=replay-video with the server-minted playbackUrl + the (approx.) metadata line; no visibility select without hostView", async () => {
    respond = () => jsonResponse({ asset: assetFixture(), playbackUrl: PLAYBACK_URL });
    await render(<LiveReplayPanel roomId={ROOM} />);
    await flush();

    const video = q('[data-testid="replay-video"]');
    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe(PLAYBACK_URL);
    expect(host!.textContent).toContain("2:05"); // 125000 ms → 2:05
    expect(host!.textContent).toContain("(approx.)"); // recorder-reported duration
    expect(host!.textContent).toContain("33.8 KB"); // 34567 bytes
    expect(host!.textContent).toContain("Recorded");
    expect(q('[data-testid="replay-visibility"]')).toBeNull();
  });

  test("failed → the asset's own error; expired → the 30-day retention copy; recording → the honest not-yet copy", async () => {
    respond = () =>
      jsonResponse({
        asset: assetFixture({ status: "failed", error: "egress-write-failed" }),
        playbackUrl: "",
      });
    await render(<LiveReplayPanel roomId={ROOM} />);
    await flush();
    expect(q('[data-testid="replay-status"]')!.textContent).toContain(
      "Replay failed: egress-write-failed",
    );

    respond = () =>
      jsonResponse({ asset: assetFixture({ status: "expired" }), playbackUrl: "" });
    await render(<LiveReplayPanel roomId={ROOM} />);
    await flush();
    expect(q('[data-testid="replay-status"]')!.textContent).toContain(
      "This replay expired (30-day retention).",
    );

    respond = () =>
      jsonResponse({ asset: assetFixture({ status: "recording" }), playbackUrl: "" });
    await render(<LiveReplayPanel roomId={ROOM} />);
    await flush();
    expect(q('[data-testid="replay-status"]')!.textContent).toContain(
      "Replay is being recorded — check back after the stream ends.",
    );
  });

  test("404 / asset-null renders nothing — the parent decides", async () => {
    respond = () => jsonResponse({ error: "not-found" }, 404);
    await render(<LiveReplayPanel roomId={ROOM} />);
    await flush();
    expect(host!.childElementCount).toBe(0);
    expect(host!.textContent).toBe("");
  });

  test("hostView: the visibility select PATCHes { visibility } and follows the server's asset", async () => {
    respond = (url, init) => {
      if ((init.method ?? "GET") === "PATCH") {
        return jsonResponse({ asset: assetFixture({ visibility: "unlisted" }) });
      }
      return jsonResponse({ asset: assetFixture(), playbackUrl: PLAYBACK_URL });
    };
    await render(<LiveReplayPanel roomId={ROOM} hostView />);
    await flush();

    const select = q(
      'select[aria-label="Replay visibility"]',
    ) as unknown as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("inherit"); // the value is the SERVER's asset

    await selectValue(select, "unlisted");
    await flush();

    const patch = fetchLog.find((c) => c.url.includes("/replay") && c.init.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch!.init.body).toBe('{"visibility":"unlisted"}');
    expect(select.value).toBe("unlisted"); // the 200 asset replaced the local one
    expect(q('[data-testid="replay-visibility-note"]')!.textContent).toContain(
      "Visibility updated.",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// LiveReplayShelf — the discovery shelf
// ═══════════════════════════════════════════════════════════════════

describe("4-c LiveReplayShelf — the discovery shelf", () => {
  test("two summaries → the Replays heading + two cards with room hrefs, @handles and approximate durations", async () => {
    respond = () =>
      jsonResponse({
        replays: [
          summaryFixture(),
          summaryFixture({
            roomId: "room-2",
            sessionId: "sess-2",
            title: "Second recap",
            hostHandle: "guestly",
            hostName: "Guestly Guest",
          }),
        ],
      });
    await render(<LiveReplayShelf />);
    await flush();

    expect(q('[data-testid="live-replay-shelf"]')).not.toBeNull();
    expect(host!.textContent).toContain("Replays");
    const cards = all('[data-testid="replay-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0]!.getAttribute("href")).toBe(`/live/${ROOM}`);
    expect(cards[0]!.textContent).toContain("Season finale recap");
    expect(cards[0]!.textContent).toContain("Hostly Host");
    expect(cards[0]!.textContent).toContain("@hostly");
    expect(cards[0]!.textContent).toContain("2:05");
    expect(cards[0]!.textContent).toContain("(approx.)");
    expect(cards[1]!.getAttribute("href")).toBe("/live/room-2");
    expect(cards[1]!.textContent).toContain("@guestly");

    // the limit prop caps the rendered cards client-side
    await render(<LiveReplayShelf limit={1} />);
    await flush();
    expect(all('[data-testid="replay-card"]').length).toBe(1);
  });

  test("empty → renders null; a failed load renders the honest error line", async () => {
    respond = () => jsonResponse({ replays: [] });
    await render(<LiveReplayShelf />);
    await flush();
    expect(host!.childElementCount).toBe(0);
    expect(host!.textContent).toBe("");

    respond = () => jsonResponse({ error: "provider-failed" }, 500);
    await render(<LiveReplayShelf />);
    await flush();
    expect(q('[data-testid="replay-shelf-error"]')!.textContent).toContain(
      "Replays couldn't be loaded right now.",
    );
  });
});
