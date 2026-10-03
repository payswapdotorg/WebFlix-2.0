/// <reference types="bun-types" />
/**
 * WFX2-P6-UP tests — the RENDERED studio upload wizard (/upload's view):
 * YouTube's upload-dialog wizard walked end-to-end under happy-dom
 * (createRoot/act + synthesized events, the transcript-language pattern):
 *
 *  - step 0: the drag-and-drop target (and click-to-browse) — a non-video
 *    pick is refused honestly (the dialog never opens), a video pick opens
 *    the dialog at Details carrying the REAL file facts;
 *  - the step-gate law: Next stays disabled until a non-blank title exists
 *    (detailsStepReady), the counters render YouTube's limits;
 *  - the header chips navigate BACKWARD only, and a Checks re-entry re-runs
 *    its animation;
 *  - the Checks step's spin-then-advance state machine: entering Checks
 *    shows the running state, the local validation completes → the honest
 *    auto-advance to Visibility (NEVER YouTube's copyright checks — the
 *    copy says WebFlix's local checks);
 *  - the Visibility save payload: the chosen card rides the REAL
 *    /api/upload/stage + /api/upload/execute bodies (stageId, title,
 *    description, visibility, tags, thumbnailUrl, isShort);
 *  - the XHR-with-real-progress path: the sketched XMLHttpRequest staging
 *    drive fires REAL progress events → the header percent + the Progress
 *    bar, then the staged id feeds the execute call (the fetch fallback is
 *    covered by the payload test — bun's test global has no XMLHttpRequest);
 *  - the preview's duration is READ FROM THE FILE (loadedmetadata), never
 *    fabricated;
 *  - the discard path: confirm → clear → back to the drop target.
 *
 * NOTE on import order: the happy-dom globals MUST exist BEFORE the view's
 * module graph is imported — Radix's use-layout-effect shim decides
 * `useLayoutEffect = document ? real : noop` at MODULE-EVAL time, and a
 * noop would silently keep every portal/portalled surface unmounted.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/* ---- happy-dom globals (set BEFORE the component imports — see NOTE) ---- */
const win = new Window();
for (const p of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
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
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const) {
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

/* ---- the component graph imported AFTER the globals exist ---- */
const { default: UploadPage } = await import("@/app/upload/view");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { createElement } = await import("react");
type Root = ReturnType<typeof createRoot>;

/* ------------------------------------------------------------------ */
/* the fetch stub — every wizard API call answers from here            */
/* ------------------------------------------------------------------ */

const UPLOAD_CONTEXT = {
  session: true,
  channel: { name: "WebFlix Operator", handle: "@webflix-op", avatarUrl: "https://example.com/a.png" },
  uploadUrl: "https://www.youtube.com/upload",
  studioRoot: "https://studio.youtube.com",
};

interface Captured {
  stage: { body: FormData }[];
  execute: { body: Record<string, unknown> }[];
}

let captured: Captured = { stage: [], execute: [] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Install the per-test fetch stub (the context GET + stage + execute). */
function installFetch(opts?: { stageStatus?: number; executeBody?: unknown }) {
  captured = { stage: [], execute: [] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String((input as Request)?.url ?? input);
    if (url.includes("/api/upload/stage")) {
      captured.stage.push({ body: init?.body as FormData });
      return json(
        opts?.stageStatus === 400
          ? { error: "not a video file — the drive only attaches real video inputs" }
          : { ok: true, stageId: "stage-uuid-1", fileName: "clip.mp4", sizeBytes: 4096 }
      );
    }
    if (url.includes("/api/upload/execute")) {
      captured.execute.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return json(
        opts?.executeBody ?? {
          outcome: "published",
          stage: "published",
          verified: true,
          videoId: "dQw4w9WgXcQ",
          watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }
      );
    }
    if (url.includes("/api/upload")) return json(UPLOAD_CONTEXT);
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as Record<string, unknown>).XMLHttpRequest;
});

afterAll(() => {
  win.happyDOM?.close?.();
});

/* ------------------------------------------------------------------ */
/* render + event helpers                                              */
/* ------------------------------------------------------------------ */

let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  host?.remove();
  host = null;
});

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderWizard(): Promise<void> {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root?.render(createElement(UploadPage));
  });
}

/** A FileList-shaped carrier for the picked file (the input's change event). */
function fileList(file: File): FileList {
  return { 0: file, length: 1, item: () => file } as unknown as FileList;
}

const MP4 = new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], "clip.mp4", {
  type: "video/mp4",
});

/** Pick a file through the hidden click-to-browse input (step 0 → Details). */
async function pickFile(file: File = MP4): Promise<void> {
  const input = q('[data-testid="upload-file-input"]') as unknown as HTMLInputElement;
  Object.defineProperty(input, "files", { value: fileList(file), configurable: true });
  await act(async () => {
    input.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  });
}

/** Type into a labeled input the way a user would — the repo-verified
 * sequence (search-suggest's typeText): the PROTOTYPE's native value setter
 * (React's value tracker would swallow a plain .value assignment) + the
 * input/keyup events. */
async function typeInto(sel: string, value: string): Promise<void> {
  const el = q(sel) as unknown as HTMLInputElement;
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  await act(async () => {
    desc?.set?.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    el.dispatchEvent(new win.Event("keyup", { bubbles: true }) as unknown as Event);
  });
}

async function click(sel: string): Promise<void> {
  const el = q(sel);
  expect(el, `click target ${sel} must exist`).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });
}

/** Details → Video elements → Checks → (auto-advance) → Visibility. */
async function walkToVisibility(title = "My wizard walkthrough"): Promise<void> {
  await pickFile();
  await typeInto('[data-testid="upload-title-input"]', title);
  await click('[data-testid="upload-next"]'); // 1 → 2
  await click('[data-testid="upload-next"]'); // 2 → 3 (checks running)
  await act(async () => {
    await sleep(1700); // CHECKS_RUN_MS (1400) + margin → the auto-advance
  });
}

/* ------------------------------------------------------------------ */
/* 1. Step 0 — the drop target + the honest pick guard                 */
/* ------------------------------------------------------------------ */

describe("step 0 — the drag-and-drop target", () => {
  test("renders the target + click-to-browse affordance, no dialog yet", async () => {
    installFetch();
    await renderWizard();
    expect(q('[data-testid="upload-drop-target"]')).not.toBeNull();
    expect(q('[data-testid="upload-select-files"]')).not.toBeNull();
    expect(q('[data-testid="upload-file-input"]')).not.toBeNull();
    expect(q('[data-testid="upload-dialog"]')).toBeNull();
    // the studio context line renders the operator channel (real data)
    expect(host!.textContent).toContain("WebFlix Operator");
  });

  test("a NON-video pick is refused honestly — the dialog never opens", async () => {
    installFetch();
    await renderWizard();
    await pickFile(new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }));
    expect(q('[data-testid="upload-dialog"]')).toBeNull();
    expect(q('[data-testid="upload-drop-target"]')).not.toBeNull();
  });

  test("the drag-and-drop path opens the dialog too (dataTransfer.files)", async () => {
    installFetch();
    await renderWizard();
    const target = q('[data-testid="upload-drop-target"]')!;
    await act(async () => {
      const drop = new win.Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: fileList(MP4) } });
      target.dispatchEvent(drop as unknown as Event);
    });
    expect(q('[data-testid="upload-dialog"]')).not.toBeNull();
    expect(q('[data-testid="upload-title-input"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2. The step-gate law (Next disabled until a title exists)           */
/* ------------------------------------------------------------------ */

describe("Details — the step-gate law", () => {
  test("a video pick opens the dialog at Details with the REAL file facts", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    expect(q('[data-testid="upload-dialog"]')).not.toBeNull();
    expect(q('[data-testid="upload-details-step"]')).not.toBeNull();
    // the header carries the real file name; the preview the real size
    expect(q('[data-testid="upload-progress-label"]')!.textContent).toContain("1 KB");
    expect(host!.textContent).toContain("clip.mp4");
  });

  test("Next is disabled until the title is non-blank; counters render", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    const next = q('[data-testid="upload-next"]') as unknown as HTMLButtonElement;
    expect(next.disabled).toBe(true); // the gate: no title yet
    expect(q('[data-testid="upload-title-counter"]')!.textContent).toContain("0/100");
    await typeInto('[data-testid="upload-title-input"]', "   "); // blank stays gated
    expect(next.disabled).toBe(true);
    await typeInto('[data-testid="upload-title-input"]', "My wizard title");
    expect(next.disabled).toBe(false);
    expect(q('[data-testid="upload-title-counter"]')!.textContent).toContain("15/100");
    expect(q('[data-testid="upload-description-counter"]')!.textContent).toContain("0/5000");
  });
});

/* ------------------------------------------------------------------ */
/* 3. The chip row — backward-only navigation + Checks re-entry        */
/* ------------------------------------------------------------------ */

describe("the header chips + the Checks state machine", () => {
  test("on Details only chip 1 is active; forward chips are disabled (backward-only law)", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    const chip = (id: number) =>
      q(`[data-testid="step-chip-${id}"]`) as unknown as HTMLButtonElement;
    expect(chip(1).disabled).toBe(true); // current step — not a backward target
    expect(chip(2).disabled).toBe(true); // forward — needs each step's Next
    expect(chip(3).disabled).toBe(true);
    expect(chip(4).disabled).toBe(true);
  });

  test("Checks spins, then the honest auto-advance lands on Visibility; chips jump backward; a re-entry re-runs", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    await typeInto('[data-testid="upload-title-input"]', "Chips walkthrough");
    await click('[data-testid="upload-next"]'); // → Video elements
    expect(q('[data-testid="upload-elements-step"]')).not.toBeNull();
    await click('[data-testid="upload-next"]'); // → Checks (running)
    expect(q('[data-testid="upload-checks-running"]')).not.toBeNull();
    // the honest copy: WebFlix's LOCAL checks — never YouTube's copyright checks
    expect(host!.textContent).toContain("WebFlix's own checks");
    await act(async () => {
      await sleep(1700);
    });
    // the auto-advance landed on Visibility
    expect(q('[data-testid="upload-visibility-step"]')).not.toBeNull();
    expect(q('[data-testid="upload-checks-running"]')).toBeNull();

    // chips 1–3 are now backward-reachable; chip 4 (current) is not
    const chip = (id: number) =>
      q(`[data-testid="step-chip-${id}"]`) as unknown as HTMLButtonElement;
    expect(chip(1).disabled).toBe(false);
    expect(chip(2).disabled).toBe(false);
    expect(chip(3).disabled).toBe(false);
    expect(chip(4).disabled).toBe(true);

    // jump back to Video elements
    await click('[data-testid="step-chip-2"]');
    expect(q('[data-testid="upload-elements-step"]')).not.toBeNull();
    // re-entering Checks re-runs the animation (it does not skip ahead)
    await click('[data-testid="upload-next"]');
    expect(q('[data-testid="upload-checks-running"]')).not.toBeNull();
    await act(async () => {
      await sleep(1700);
    });
    expect(q('[data-testid="upload-visibility-step"]')).not.toBeNull();
  });

  test("Back walks down the ladder (Visibility → Checks keeps its passed copy)", async () => {
    installFetch();
    await renderWizard();
    await walkToVisibility("Back walkthrough");
    await click('[data-testid="upload-back"]'); // 4 → 3
    expect(q('[data-testid="upload-checks-complete"]')).not.toBeNull();
    await click('[data-testid="upload-back"]'); // 3 → 2
    expect(q('[data-testid="upload-elements-step"]')).not.toBeNull();
    await click('[data-testid="upload-back"]'); // 2 → 1
    expect(q('[data-testid="upload-details-step"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. The Visibility save payload (the fetch-fallback staging path)    */
/* ------------------------------------------------------------------ */

describe("Visibility — the save payload rides the real APIs", () => {
  test("the picked card + the form drive /api/upload/stage → /api/upload/execute exactly", async () => {
    installFetch();
    await renderWizard();
    await walkToVisibility("The payload title");

    // the radiogroup: all three of YouTube's levels, private default-checked
    const cards = ["private", "unlisted", "public"];
    for (const id of cards) {
      expect(q(`[data-testid="visibility-${id}"]`), `card ${id}`).not.toBeNull();
    }
    const privateCard = q('[data-testid="visibility-private"]')!;
    expect(privateCard.getAttribute("aria-checked")).toBe("true"); // the safe default

    // select PUBLIC (not the default — proves the selection rides the payload)
    await click('[data-testid="visibility-public"]');
    expect(q('[data-testid="visibility-public"]')!.getAttribute("aria-checked")).toBe("true");

    await click('[data-testid="upload-save"]');
    await act(async () => {
      await sleep(60); // stage → execute → settle
    });

    // the staged bytes carried the REAL picked file
    expect(captured.stage).toHaveLength(1);
    expect((captured.stage[0].body.get("file") as File).name).toBe("clip.mp4");

    // the execute payload: exactly the wizard's honest contract
    expect(captured.execute).toHaveLength(1);
    expect(captured.execute[0].body).toEqual({
      stageId: "stage-uuid-1",
      title: "The payload title",
      description: "",
      visibility: "public",
      tags: [],
      thumbnailUrl: null,
      isShort: false,
    });

    // the honest published card + the Done rung
    expect(q('[data-testid="upload-published-card"]')).not.toBeNull();
    expect(q('[data-testid="upload-done"]')).not.toBeNull();
  });

  test("a staging refusal renders the honest stage error (never a fake success)", async () => {
    installFetch({ stageStatus: 400 });
    await renderWizard();
    await walkToVisibility("Refused staging");
    await click('[data-testid="upload-save"]');
    await act(async () => {
      await sleep(60);
    });
    expect(q('[data-testid="upload-stage-error-card"]')).not.toBeNull();
    expect(q('[data-testid="upload-published-card"]')).toBeNull();
    expect(captured.execute).toHaveLength(0); // the drive never started
  });
});

/* ------------------------------------------------------------------ */
/* 5. The XHR-with-real-progress staging path (the sketched drive)     */
/* ------------------------------------------------------------------ */

describe("the XHR staging path — REAL progress events only", () => {
  test("upload.onprogress drives the header percent + the Progress bar, then the staged id feeds execute", async () => {
    installFetch();
    await renderWizard();

    // a controllable XMLHttpRequest — the browser path (bun's test global
    // has none; the view's code picks XHR the moment it exists)
    class FakeXHR {
      static instances: InstanceType<typeof FakeXHR>[] = [];
      openMethod = "";
      openUrl = "";
      responseType = "";
      status = 0;
      response: unknown = null;
      sent: FormData | null = null;
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
        onprogress: null,
      };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open(method: string, url: string) {
        this.openMethod = method;
        this.openUrl = url;
      }
      send(body: FormData) {
        this.sent = body;
        FakeXHR.instances.push(this);
      }
    }
    (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR;

    await walkToVisibility("The XHR drive");
    await click('[data-testid="upload-save"]');

    // the staging drive went out through XHR with the REAL file attached
    await act(async () => {
      await sleep(30);
    });
    expect(FakeXHR.instances).toHaveLength(1);
    const xhr = FakeXHR.instances[0];
    expect(xhr.openMethod).toBe("POST");
    expect(xhr.openUrl).toBe("/api/upload/stage");
    expect((xhr.sent!.get("file") as File).name).toBe("clip.mp4");

    // a REAL progress event → the header percent + the determinate bar
    await act(async () => {
      xhr.upload.onprogress!({ lengthComputable: true, loaded: 42, total: 100 });
    });
    expect(q('[data-testid="upload-progress-label"]')!.textContent).toContain("Uploading 42%");
    const bar = q('[data-testid="upload-progress-bar"]')!;
    expect(bar.querySelector('[data-slot="progress"]')).not.toBeNull(); // the shadcn Progress
    // before completion the publish has NOT started
    expect(captured.execute).toHaveLength(0);

    // the staged response resolves the drive → execute → published
    await act(async () => {
      xhr.status = 200;
      xhr.response = { ok: true, stageId: "xhr-stage-9", fileName: "clip.mp4", sizeBytes: 4096 };
      xhr.onload!();
    });
    await act(async () => {
      await sleep(60);
    });
    expect(captured.execute).toHaveLength(1);
    expect(captured.execute[0].body.stageId).toBe("xhr-stage-9");
    expect(q('[data-testid="upload-published-card"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 6. The preview's duration — read from the file, never fabricated    */
/* ------------------------------------------------------------------ */

describe("the preview panel — the duration is read from the file", () => {
  test("loadedmetadata surfaces the REAL duration; absent before it fires", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    const video = q('[data-testid="upload-preview-video"]') as unknown as HTMLVideoElement;
    // before the browser decodes the file the display stays honestly absent
    expect(host!.textContent).not.toContain("2:06");
    await act(async () => {
      Object.defineProperty(video, "duration", { value: 125.7, configurable: true });
      video.dispatchEvent(new win.Event("loadedmetadata", { bubbles: false }) as unknown as Event);
    });
    expect(host!.textContent).toContain("2:06"); // 125.7s → 126 → 2:06 (m:ss)
    expect(host!.textContent).toContain("clip.mp4");
  });
});

/* ------------------------------------------------------------------ */
/* 7. The discard path — confirm, then back to the drop target         */
/* ------------------------------------------------------------------ */

describe("the discard path", () => {
  test("Discard asks first; Cancel keeps the dialog; Discard clears to step 0", async () => {
    installFetch();
    await renderWizard();
    await pickFile();
    await click('[data-testid="upload-discard"]');
    expect(q('[data-testid="discard-confirm"]')).not.toBeNull();
    await click('[data-testid="discard-cancel"]');
    expect(q('[data-testid="discard-confirm"]')).toBeNull();
    expect(q('[data-testid="upload-dialog"]')).not.toBeNull(); // still editing

    await click('[data-testid="upload-discard"]');
    await click('[data-testid="discard-confirm-button"]');
    expect(q('[data-testid="upload-dialog"]')).toBeNull();
    expect(q('[data-testid="upload-drop-target"]')).not.toBeNull();
  });
});
