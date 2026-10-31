/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 P68 — the ReattachCard UI pins.
 *
 * happy-dom + createRoot/act (the auth-ui harness pattern, mirroring
 * tests/live-ui-phase4.test.tsx exactly: same DOM bootstrap, same render/
 * cleanup helpers). ReattachCard is PURELY presentational — the console
 * owns the probe, the re-attach call and every honest failure copy — so
 * these pins need NO fetch swap and NO db: the callbacks are spies.
 *
 * Pins:
 * - the card renders the honest surface: "You have a live session running",
 *   the room title + started line + the approximate viewer count line, the
 *   Re-attach console button and the Dismiss button;
 * - while reattaching, the Re-attach button is DISABLED and labelled
 *   "Re-attaching…" (no double submit), Dismiss is disabled too;
 * - clicking Re-attach fires onReattach exactly once; clicking Dismiss
 *   fires onDismiss exactly once;
 * - the honest dismiss note is present verbatim: dismissing does NOT end
 *   the stream, and a new Go Live below creates a DIFFERENT room.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { LiveRoomDto } from "@/lib/live/types";

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

// ---- the surface (imported after the DOM exists, the harness law) -------
const { ReattachCard } = await import("@/components/live/live-reattach-card");

// ---- fixtures (inline typed FROZEN DTO, every field filled honestly) ----
function roomFixture(overrides: Partial<LiveRoomDto> = {}): LiveRoomDto {
  return {
    id: "room_reattach_1",
    hostId: "wf-u_wfx2_live_host",
    hostHandle: "livehost",
    hostName: "Live Host",
    title: "Station rebuild night",
    status: "live",
    visibility: "public",
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:05:00.000Z",
    currentSession: {
      id: "sess_reattach_1",
      roomId: "room_reattach_1",
      provider: "livekit",
      providerRoomId: "wfl-test-session",
      status: "live",
      startedAt: "2026-10-31T10:01:00.000Z",
      endedAt: null,
      endReason: null,
    },
    viewerCount: 2,
    isHost: true,
    ...overrides,
  } as LiveRoomDto;
}

// ---- harness -------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): Element | null =>
  host ? (host.querySelector(sel) as unknown as Element | null) : null;

async function render(el: ReactElement) {
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

/** React-safe click through the real event system. */
async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("ReattachCard (P68)", () => {
  test("renders the honest surface: heading, room line with viewer count, both buttons", async () => {
    let onReattach = 0;
    let onDismiss = 0;
    await render(
      <ReattachCard
        room={roomFixture()}
        reattaching={false}
        onReattach={() => {
          onReattach += 1;
        }}
        onDismiss={() => {
          onDismiss += 1;
        }}
      />,
    );

    expect(q('[data-testid="reattach-card"]')).not.toBeNull();
    const text = host!.textContent ?? "";
    expect(text).toContain("You have a live session running");
    expect(text).toContain("Station rebuild night");
    expect(text).toContain("2 approximate viewers");
    const reattachBtn = q('[data-testid="reattach-button"]') as HTMLButtonElement | null;
    const dismissBtn = q('[data-testid="reattach-dismiss"]') as HTMLButtonElement | null;
    expect(reattachBtn).not.toBeNull();
    expect(reattachBtn!.disabled).toBe(false);
    expect(reattachBtn!.textContent).toContain("Re-attach console");
    expect(dismissBtn).not.toBeNull();
    expect(dismissBtn!.disabled).toBe(false);

    await click(reattachBtn!);
    await click(dismissBtn!);
    expect(onReattach).toBe(1);
    expect(onDismiss).toBe(1);
  });

  test("while reattaching both buttons disable and the label flips to Re-attaching…", async () => {
    await render(
      <ReattachCard
        room={roomFixture()}
        reattaching={true}
        onReattach={() => {}}
        onDismiss={() => {}}
      />,
    );
    const reattachBtn = q('[data-testid="reattach-button"]') as HTMLButtonElement;
    const dismissBtn = q('[data-testid="reattach-dismiss"]') as HTMLButtonElement;
    expect(reattachBtn.disabled).toBe(true);
    expect(reattachBtn.textContent).toContain("Re-attaching…");
    expect(dismissBtn.disabled).toBe(true);
  });

  test("the honest dismiss note is present verbatim — dismissing never ends the stream", async () => {
    await render(
      <ReattachCard
        room={roomFixture()}
        reattaching={false}
        onReattach={() => {}}
        onDismiss={() => {}}
      />,
    );
    const text = host!.textContent ?? "";
    expect(text).toContain("Dismissing does not end the stream");
    expect(text).toContain("Starting a new Go Live below creates a different room");
    expect(text).toContain("nothing starts or stops");
  });
});
