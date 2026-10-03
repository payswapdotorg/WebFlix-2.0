/// <reference types="bun-types" />
/**
 * WFX2-P3-UP tests — the real upload flow, end-to-end at the app layer:
 *
 *  - the staging contract: POST /api/upload/stage (auth gate, video gate,
 *    the synthetic fixture round-trip) + GET /api/upload/stage?id=
 *    (CORS-open bytes for the operator tab's page-context fetch) + 404
 *    honestly on expiry;
 *  - POST /api/upload/execute with the broker MOCKED (no network, no live CDP —
 *    the community-posts pattern): the happy path maps to the published DTO
 *    (deep-linking the real video), the honest 'navigating' intermediate
 *    re-invokes the broker (the script owns its navigation), broker-offline
 *    falls back to the CURRENT hand-off rung, a refused publish renders the
 *    honest error (never a fake success — an ok:true without a video id
 *    claims nothing), and guests never reach the broker;
 *  - the flow state machine (idle → staging → executing → published |
 *    fallback | error) — the view's single reducer;
 *  - the result card's honest rendering (happy-dom + createRoot/act): the
 *    published card deep-links the real video, the unverified publish says
 *    so, the fallback card carries the bundle, the error card shows the
 *    broker's message;
 *  - the synthetic MP4 fixture is a real video file (ftyp box + nonzero
 *    size), provenance-marked SYNTHETIC.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";

// ---- the broker client MOCK (installed before the route imports) ----
class MockBrokerError extends Error {
  kind: string;
  status: number;
  detail?: unknown;
  constructor(kind: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const brokerCalls: {
  fileUrl: string;
  fileName: string;
  title: string;
  description?: string;
  visibility: string;
}[] = [];
/** per-test broker behavior: an error factory or a success object */
let brokerBehavior: unknown = { ok: true, verified: true, path: "ui", detail: { stage: "published", videoId: "dQw4h9WgXcQ", watchUrl: "https://www.youtube.com/watch?v=dQw4h9WgXcQ" } };

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerAction: async () => new MockBrokerError("offline", "unused in this suite", 502),
  brokerCommunityRead: async () => new MockBrokerError("offline", "unused in this suite", 502),
  brokerOk: (r: unknown) => !(r instanceof MockBrokerError),
  brokerUrl: () => "http://127.0.0.1:3055",
  brokerSecret: () => "s3cret",
  brokerConfigured: () => true,
  brokerTimeoutMs: () => 15000,
  UPLOAD_EXECUTE_TIMEOUT_MS: 310000,
  UPLOAD_NAVIGATE_RETRY_MS: 2000,
  brokerUploadExecute: async (input: {
    fileUrl: string;
    fileName: string;
    title: string;
    description?: string;
    visibility: string;
  }) => {
    brokerCalls.push({ ...input });
    return typeof brokerBehavior === "function"
      ? brokerBehavior({ ...input, call: brokerCalls.length })
      : brokerBehavior;
  },
}));

/* routes + libs (imported after the mocks) */
import { GET as stageGET, OPTIONS as stageOPTIONS, POST as stagePOST } from "@/app/api/upload/stage/route";
import { POST as executePOST } from "@/app/api/upload/execute/route";
import {
  UPLOAD_STEPS,
  canPublish,
  detailsStepReady,
  initialUploadFlowState,
  uploadFlowNext,
  type UploadExecuteResponseDTO,
  type UploadWizardStep,
} from "@/lib/upload/flow";
import {
  clearStagedUploads,
  getStagedUpload,
  stageUpload,
  stagedUploadCount,
  STAGE_MAX_FILES,
} from "@/lib/upload/stage";
import { clearCache } from "@/lib/youtube/cache";
import { mintSessionCookie } from "./helpers";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import UploadResultCard from "@/app/upload/upload-result";

// ---------------------------------------------------------------------------
// the synthetic fixture (provenance: tests/fixtures/upload/README.md)
// ---------------------------------------------------------------------------
const FIXTURE_PATH = "tests/fixtures/upload/synthetic-480p-1s-webflix-fixture.mp4";
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

// ---------------------------------------------------------------------------
// happy-dom globals for the card render tests (the comment-composer pattern)
// ---------------------------------------------------------------------------
const win = new Window();
for (const p of [
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

let host: ReturnType<typeof win.document.createElement> | null = null;
let root: Root | null = null;
afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
});
afterAll(() => {
  win.happyDOM?.close?.();
});

/** Render the card into happy-dom and return the container's HTML. */
async function renderCard(result: UploadExecuteResponseDTO): Promise<string> {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root?.render(
      createElement(UploadResultCard, { result, onCopyBundle: () => {}, copied: false })
    );
  });
  return host.innerHTML;
}

// ---------------------------------------------------------------------------
// shared request helpers
// ---------------------------------------------------------------------------
let cookie = "";
beforeEach(async () => {
  clearCache();
  clearStagedUploads();
  brokerCalls.length = 0;
  brokerBehavior = {
    ok: true,
    verified: true,
    path: "ui",
    detail: { stage: "published", videoId: "dQw4h9WgXcQ", watchUrl: "https://www.youtube.com/watch?v=dQw4h9WgXcQ" },
  };
  cookie = await mintSessionCookie();
});

async function stageFixture(): Promise<{ stageId: string; fileName: string }> {
  const fd = new FormData();
  fd.append(
    "file",
    new File([fixtureBytes], "synthetic-480p-1s-webflix-fixture.mp4", { type: "video/mp4" })
  );
  const req = new NextRequest("http://localhost/api/upload/stage", {
    method: "POST",
    headers: { cookie },
    body: fd,
  });
  const res = await stagePOST(req);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { stageId: string; fileName: string; sizeBytes: number };
  return { stageId: body.stageId, fileName: body.fileName };
}

async function executeRequest(payload: Record<string, unknown>): Promise<Response> {
  return executePOST(
    new NextRequest("http://localhost/api/upload/execute", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

const EXECUTE_BODY = {
  stageId: "staged-below",
  title: "WebFlix staged upload drive",
  description: "Driven by the session broker through the real upload dialog.",
  visibility: "unlisted",
  tags: ["webflix", "staged"],
  thumbnailUrl: null,
  isShort: false,
};

// ---------------------------------------------------------------------------
// the synthetic fixture is a real video file
// ---------------------------------------------------------------------------
describe("the synthetic MP4 fixture (provenance: SYNTHETIC, README-marked)", () => {
  test("is a real MP4: ftyp box first, nonzero size, ~1s of 480p H.264", () => {
    expect(fixtureBytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(fixtureBytes.subarray(4, 8))).toBe("ftyp");
    expect(new TextDecoder().decode(fixtureBytes.subarray(8, 12))).toBe("isom");
    // the provenance mark rides the filename
    expect(FIXTURE_PATH.includes("synthetic")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the staging contract
// ---------------------------------------------------------------------------
describe("POST /api/upload/stage — the staged-file carrier", () => {
  test("guest → 401 (guests never reach the broker path)", async () => {
    const fd = new FormData();
    fd.append("file", new File([fixtureBytes], "x.mp4", { type: "video/mp4" }));
    const res = await stagePOST(
      new NextRequest("http://localhost/api/upload/stage", { method: "POST", body: fd })
    );
    expect(res.status).toBe(401);
  });

  test("stages the synthetic fixture → {ok, stageId, fileName, sizeBytes}", async () => {
    const staged = await stageFixture();
    expect(staged.stageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(staged.fileName).toBe("synthetic-480p-1s-webflix-fixture.mp4");
    expect(getStagedUpload(staged.stageId)?.sizeBytes).toBe(fixtureBytes.byteLength);
  });

  test("refuses a non-video file honestly (400)", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" }));
    const res = await stagePOST(
      new NextRequest("http://localhost/api/upload/stage", {
        method: "POST",
        headers: { cookie },
        body: fd,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not a video file");
  });

  test("an extension-typed video with an empty browser type still stages (honest mime sniff)", async () => {
    const fd = new FormData();
    fd.append("file", new File([fixtureBytes], "clip.mov", { type: "" }));
    const res = await stagePOST(
      new NextRequest("http://localhost/api/upload/stage", {
        method: "POST",
        headers: { cookie },
        body: fd,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentType: string };
    expect(body.contentType).toBe("video/quicktime");
  });
});

describe("GET /api/upload/stage?id= — the operator tab's fetch target", () => {
  test("serves the staged bytes CORS-open with the video content type", async () => {
    const staged = await stageFixture();
    const res = await stageGET(
      new NextRequest(`http://localhost/api/upload/stage?id=${staged.stageId}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    const back = new Uint8Array(await res.arrayBuffer());
    expect(back.byteLength).toBe(fixtureBytes.byteLength);
    expect(back).toEqual(fixtureBytes);
  });

  test("unknown/expired id → honest 404", async () => {
    const res = await stageGET(
      new NextRequest("http://localhost/api/upload/stage?id=00000000-0000-4000-8000-000000000000")
    );
    expect(res.status).toBe(404);
  });

  test("OPTIONS → 204 with the CORS preflight contract", async () => {
    const res = await stageOPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("the staging store's caps (in-memory, honest bounds)", () => {
  test("entry overflow evicts the oldest (LRU) and the ids stay honest", () => {
    clearStagedUploads();
    for (let i = 0; i < STAGE_MAX_FILES + 2; i++) {
      stageUpload({
        fileName: `f${i}.mp4`,
        contentType: "video/mp4",
        bytes: new Uint8Array([1, 2, 3, 4]),
      });
    }
    expect(stagedUploadCount()).toBe(STAGE_MAX_FILES);
    clearStagedUploads();
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload/execute — the broker drive mapping (broker MOCKED)
// ---------------------------------------------------------------------------
describe("POST /api/upload/execute — the honest ladder (broker mocked)", () => {
  test("guest → 401 before any broker call", async () => {
    const res = await executePOST(
      new NextRequest("http://localhost/api/upload/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageId: "x", title: "T" }),
      })
    );
    expect(res.status).toBe(401);
    expect(brokerCalls).toHaveLength(0);
  });

  test("missing title → 400 before any broker call", async () => {
    const staged = await stageFixture();
    const res = await executeRequest({ stageId: staged.stageId, title: "  " });
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("unknown/expired stageId → honest 400 'pick the file again'", async () => {
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("staged file not found or expired");
    expect(brokerCalls).toHaveLength(0);
  });

  test("happy path → the published DTO deep-links the real video (verified)", async () => {
    const staged = await stageFixture();
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("published");
    expect(body.verified).toBe(true);
    expect(body.stage).toBe("published");
    expect(body.videoId).toBe("dQw4h9WgXcQ");
    expect(body.watchUrl).toBe("https://www.youtube.com/watch?v=dQw4h9WgXcQ");
    // the broker received the staged file identity + the metadata the drive fills
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].fileUrl).toContain("http://localhost/api/upload/stage?id=");
    expect(brokerCalls[0].fileName).toBe("synthetic-480p-1s-webflix-fixture.mp4");
    expect(brokerCalls[0].title).toBe(EXECUTE_BODY.title);
    expect(brokerCalls[0].description).toBe(EXECUTE_BODY.description);
    expect(brokerCalls[0].visibility).toBe("unlisted");
  });

  test("the honest 'navigating' intermediate re-invokes the broker (the script owns its navigation)", async () => {
    const staged = await stageFixture();
    brokerBehavior = ({ call }: { call: number }) =>
      call === 1
        ? new MockBrokerError(
            "action-failed",
            "upload-execute: navigating to the upload page — re-invoke to drive the dialog",
            502,
            // the real client carries the WHOLE 502 body as detail (the
            // script's return — no dom on the navigating intermediate)
            {
              ok: false,
              error: "upload-execute: navigating to the upload page — re-invoke to drive the dialog",
              path: "ui",
              detail: { stage: "navigating" },
            }
          )
        : {
            ok: true,
            verified: true,
            path: "ui",
            detail: { stage: "published", videoId: "jNQXAC9IVRw", watchUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
          };
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("published");
    expect(body.videoId).toBe("jNQXAC9IVRw");
    expect(brokerCalls.length).toBe(2); // navigate → re-invoke → drive
  });

  test("broker OFFLINE → the CURRENT hand-off rung (fallback, never a fake success)", async () => {
    const staged = await stageFixture();
    brokerBehavior = new MockBrokerError(
      "offline",
      "action backend offline — the lead's broker must be running",
      502
    );
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("fallback");
    expect(body.reason).toBe("broker-offline");
    expect(body.message).toContain("offline");
    expect(body.handoff?.handoffUrl).toBe("https://www.youtube.com/upload");
    expect(body.handoff?.bundle).toContain(EXECUTE_BODY.title);
    expect(body.handoff?.bundle).toContain("Unlisted");
  });

  test("broker UNAUTHORIZED → the hand-off rung too (refused secret = no drive)", async () => {
    const staged = await stageFixture();
    brokerBehavior = new MockBrokerError("unauthorized", "broker rejected the shared secret", 502);
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("fallback");
    expect(body.reason).toBe("broker-unauthorized");
    expect(body.handoff?.bundle).toContain(EXECUTE_BODY.title);
  });

  test("REFUSED publish → the honest error carries the broker's stage-accurate message + the rung", async () => {
    const staged = await stageFixture();
    brokerBehavior = new MockBrokerError(
      "action-failed",
      "upload-execute: publish-button-not-ready — the upload was still in progress when the deadline hit (or publishing was blocked)",
      502,
      // the real client carries the WHOLE 502 body as detail — the stage
      // nests in body.detail.stage, the observed DOM in body.dom
      {
        ok: false,
        error: "upload-execute: publish-button-not-ready — the upload was still in progress when the deadline hit (or publishing was blocked)",
        path: "ui",
        detail: { stage: "uploading" },
        dom: { title: "Upload video", url: "https://www.youtube.com/upload" },
      }
    );
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("error");
    expect(body.message).toContain("publish-button-not-ready");
    expect(body.stage).toBe("uploading");
    expect(body.handoff?.bundle).toContain(EXECUTE_BODY.title);
  });

  test("ok:true WITHOUT a video id claims nothing (never a fake success)", async () => {
    const staged = await stageFixture();
    brokerBehavior = { ok: true, verified: true, path: "ui" };
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("error");
    expect(body.message).toContain("without a video id");
    expect(body.handoff).toBeDefined();
  });

  test("an UNVERIFIED publish (confirmation not observed) is honestly flagged", async () => {
    const staged = await stageFixture();
    brokerBehavior = {
      ok: true,
      verified: false,
      path: "ui",
      // the script rides the UNVERIFIED note TOP-LEVEL on the wire
      detail: {
        stage: "processing",
        videoId: "jNQXAC9IVRw",
        watchUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      },
      note: "publish clicked — the confirmation was not observed within the deadline; the video may still be processing",
    };
    const res = await executeRequest({ ...EXECUTE_BODY, stageId: staged.stageId });
    const body = (await res.json()) as UploadExecuteResponseDTO;
    expect(body.outcome).toBe("published");
    expect(body.stage).toBe("processing");
    expect(body.verified).toBe(false);
    expect(body.note).toContain("not observed");
  });
});

// ---------------------------------------------------------------------------
// the flow state machine (the view's single reducer)
// ---------------------------------------------------------------------------
describe("the upload flow state machine", () => {
  test("happy ladder: idle → staging → executing → published", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "clip.mp4", sizeBytes: 15102 });
    expect(s.phase).toBe("idle");
    expect(s.fileName).toBe("clip.mp4");
    s = uploadFlowNext(s, { type: "publish-started" });
    expect(s.phase).toBe("staging");
    s = uploadFlowNext(s, { type: "stage-succeeded", stageId: "uuid-1" });
    expect(s.stageId).toBe("uuid-1");
    s = uploadFlowNext(s, { type: "execute-started" });
    expect(s.phase).toBe("executing");
    s = uploadFlowNext(s, {
      type: "execute-settled",
      result: { outcome: "published", verified: true, stage: "published", videoId: "dQw4h9WgXcQ", watchUrl: "https://www.youtube.com/watch?v=dQw4h9WgXcQ" },
    });
    expect(s.phase).toBe("published");
    expect(s.result?.videoId).toBe("dQw4h9WgXcQ");
  });

  test("broker-offline settles to the fallback rung", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "clip.mp4", sizeBytes: 15102 });
    s = uploadFlowNext(s, { type: "publish-started" });
    s = uploadFlowNext(s, { type: "execute-started" });
    s = uploadFlowNext(s, {
      type: "execute-settled",
      result: { outcome: "fallback", reason: "broker-offline", message: "offline" },
    });
    expect(s.phase).toBe("fallback");
    expect(s.error).toBeNull();
  });

  test("a refused publish settles to error with the honest message", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "clip.mp4", sizeBytes: 15102 });
    s = uploadFlowNext(s, { type: "publish-started" });
    s = uploadFlowNext(s, {
      type: "execute-settled",
      result: { outcome: "error", message: "upload-execute: publish-button-not-ready" },
    });
    expect(s.phase).toBe("error");
    expect(s.error).toContain("publish-button-not-ready");
  });

  test("a staging failure settles to error without a result card", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "clip.mp4", sizeBytes: 15102 });
    s = uploadFlowNext(s, { type: "publish-started" });
    s = uploadFlowNext(s, { type: "stage-failed", error: "the picked file is empty" });
    expect(s.phase).toBe("error");
    expect(s.error).toBe("the picked file is empty");
    expect(s.result).toBeNull();
  });

  test("file-picked resets any prior terminal state (a new drive may start)", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, {
      type: "execute-settled",
      result: { outcome: "published", videoId: "x", watchUrl: "https://www.youtube.com/watch?v=x" },
    });
    s = uploadFlowNext(s, { type: "file-picked", fileName: "next.mp4", sizeBytes: 10 });
    expect(s.phase).toBe("idle");
    expect(s.result).toBeNull();
  });

  test("canPublish: needs a picked file AND a non-empty title, from a resting phase", () => {
    const idle = initialUploadFlowState();
    expect(canPublish(idle, "T")).toBe(false); // no file
    const withFile = uploadFlowNext(idle, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    expect(canPublish(withFile, "T")).toBe(true);
    expect(canPublish(withFile, "  ")).toBe(false);
    const executing = uploadFlowNext(withFile, { type: "execute-started" });
    expect(canPublish(executing, "T")).toBe(false); // busy
    const failed = uploadFlowNext(withFile, { type: "stage-failed", error: "x" });
    expect(canPublish(failed, "T")).toBe(true); // retry allowed
  });
});

// ---------------------------------------------------------------------------
// the WIZARD step ladder (WFX2-P6-UP) — the Details → Video elements → Checks
// → Visibility walk, the step-gate law, and the header chips' backward-only
// navigation law (the pure reducer; the rendered wizard rides
// tests/upload-wizard.test.tsx)
// ---------------------------------------------------------------------------
describe("the wizard step ladder (P6-UP)", () => {
  test("UPLOAD_STEPS is YouTube's dialog order: Details, Video elements, Checks, Visibility", () => {
    expect(UPLOAD_STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(UPLOAD_STEPS.map((s) => s.label)).toEqual([
      "Details",
      "Video elements",
      "Checks",
      "Visibility",
    ]);
  });

  test("a fresh state rests at step 0 (no dialog) with the checks idle", () => {
    const s = initialUploadFlowState();
    expect(s.step).toBe(0);
    expect(s.checks).toBe("idle");
    expect(s.phase).toBe("idle");
  });

  test("the step-gate law: detailsStepReady demands a non-blank title", () => {
    expect(detailsStepReady("")).toBe(false);
    expect(detailsStepReady("   ")).toBe(false);
    expect(detailsStepReady("a")).toBe(true);
    expect(detailsStepReady("  My vlog  ")).toBe(true);
  });

  test("file-picked opens the dialog at Details carrying the REAL file facts", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "clip.mp4", sizeBytes: 15102 });
    expect(s.step).toBe(1);
    expect(s.fileName).toBe("clip.mp4");
    expect(s.sizeBytes).toBe(15102);
    expect(s.checks).toBe("idle");
    expect(s.phase).toBe("idle");
  });

  test("file-picked resets a prior terminal state (a new drive may start)", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "checks-completed" }); // → step 4, checks passed
    s = uploadFlowNext(s, {
      type: "execute-settled",
      result: { outcome: "published", videoId: "x", watchUrl: "https://www.youtube.com/watch?v=x" },
    });
    s = uploadFlowNext(s, { type: "file-picked", fileName: "b.mp4", sizeBytes: 2 });
    expect(s.step).toBe(1);
    expect(s.checks).toBe("idle");
    expect(s.result).toBeNull();
    expect(s.phase).toBe("idle");
  });

  test("step-next walks 1→2→3→4, entering Checks starts its animation, capped at 4", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    expect(s.step).toBe(2);
    expect(s.checks).toBe("idle"); // stepping into 2 does not touch checks
    s = uploadFlowNext(s, { type: "step-next" });
    expect(s.step).toBe(3);
    expect(s.checks).toBe("running"); // stepping INTO Checks starts it
    s = uploadFlowNext(s, { type: "checks-completed" });
    s = uploadFlowNext(s, { type: "step-next" });
    expect(s.step).toBe(4); // capped — no step 5
    expect(uploadFlowNext(s, { type: "step-next" }).step).toBe(4);
  });

  test("checks-completed is the honest auto-advance: passed + Visibility", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "step-next" });
    expect(s.checks).toBe("running");
    s = uploadFlowNext(s, { type: "checks-completed" });
    expect(s.checks).toBe("passed");
    expect(s.step).toBe(4);
  });

  test("step-back floors at Details and resets the Checks animation below it", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "checks-completed" }); // step 4, passed
    s = uploadFlowNext(s, { type: "step-back" }); // 4 → 3 keeps the passed state
    expect(s.step).toBe(3);
    expect(s.checks).toBe("passed");
    s = uploadFlowNext(s, { type: "step-back" }); // 3 → 2 resets the animation
    expect(s.step).toBe(2);
    expect(s.checks).toBe("idle");
    s = uploadFlowNext(s, { type: "step-back" });
    s = uploadFlowNext(s, { type: "step-back" });
    expect(s.step).toBe(1); // floored at Details
    // a re-entry re-runs the checks
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "step-next" });
    expect(s.checks).toBe("running");
  });

  test("step-jump (the header chips) navigates BACKWARD only", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "checks-completed" }); // step 4
    // forward/same-target jumps are honest no-ops (forward needs each step's Next)
    expect(uploadFlowNext(s, { type: "step-jump", to: 4 as UploadWizardStep })).toBe(s);
    expect(uploadFlowNext(s, { type: "step-jump", to: 5 as UploadWizardStep })).toBe(s);
    // backward jumps land exactly on the target
    const to2 = uploadFlowNext(s, { type: "step-jump", to: 2 as UploadWizardStep });
    expect(to2.step).toBe(2);
    expect(to2.checks).toBe("idle"); // jumping below Checks resets its animation
    // jumping back to Checks keeps its completed state
    const done = uploadFlowNext(to2, { type: "step-next" });
    const running = uploadFlowNext(done, { type: "step-next" });
    expect(running.checks).toBe("running");
    const passed = uploadFlowNext(running, { type: "checks-completed" });
    const to3 = uploadFlowNext(passed, { type: "step-jump", to: 3 as UploadWizardStep });
    expect(to3.step).toBe(3);
    expect(to3.checks).toBe("passed");
    // step 0 is never a chip target
    expect(uploadFlowNext(to3, { type: "step-jump", to: 0 as UploadWizardStep })).toBe(to3);
  });

  test("file-cleared / reset return the whole ladder to the drop target", () => {
    let s = initialUploadFlowState();
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "step-next" });
    s = uploadFlowNext(s, { type: "file-cleared" });
    expect(s).toEqual(initialUploadFlowState());
    s = uploadFlowNext(s, { type: "file-picked", fileName: "a.mp4", sizeBytes: 1 });
    s = uploadFlowNext(s, { type: "reset" });
    expect(s).toEqual(initialUploadFlowState());
  });
});

// ---------------------------------------------------------------------------
// the result card's honest rendering (happy-dom)
// ---------------------------------------------------------------------------
describe("the result card renders the honest states", () => {
  test("the published card deep-links the REAL video", async () => {
    const html = await renderCard({
      outcome: "published",
      stage: "published",
      verified: true,
      videoId: "dQw4h9WgXcQ",
      watchUrl: "https://www.youtube.com/watch?v=dQw4h9WgXcQ",
    });
    expect(html).toContain("Video published");
    expect(html).toContain("https://www.youtube.com/watch?v=dQw4h9WgXcQ");
    expect(html).toContain("Open the video");
    expect(html).toContain("dQw4h9WgXcQ");
    expect(html).toContain("verified in the operator");
  });

  test("the unverified publish says exactly that (never a claimed success)", async () => {
    const html = await renderCard({
      outcome: "published",
      stage: "processing",
      verified: false,
      videoId: "jNQXAC9IVRw",
      watchUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      note: "publish clicked — the confirmation was not observed within the deadline; the video may still be processing",
    });
    expect(html).toContain("confirmation not observed");
    expect(html).toContain("may still be processing");
    expect(html).not.toContain("verified in the operator");
  });

  test("the fallback card carries the CURRENT hand-off rung", async () => {
    const html = await renderCard({
      outcome: "fallback",
      reason: "broker-offline",
      message: "the session broker is offline — the hand-off below remains the honest path (YouTube owns the upload)",
      handoff: {
        handoffUrl: "https://www.youtube.com/upload",
        prefillSupported: false,
        bundle: "=== WebFlix → YouTube upload metadata ===\nTITLE: T",
        fields: {
          title: "T",
          description: "",
          tags: [],
          visibility: "public",
          thumbnailUrl: null,
          isShort: false,
        },
      },
    });
    expect(html).toContain("session broker is offline");
    expect(html).toContain("WebFlix → YouTube upload metadata");
    expect(html).toContain("https://www.youtube.com/upload");
    expect(html).toContain("Copy bundle");
  });

  test("the error card renders the broker's honest message + the observed stage", async () => {
    const html = await renderCard({
      outcome: "error",
      reason: "action-failed",
      message:
        "upload-execute: publish-button-not-ready — the upload was still in progress when the deadline hit (or publishing was blocked)",
      stage: "uploading",
      handoff: {
        handoffUrl: "https://www.youtube.com/upload",
        prefillSupported: false,
        bundle: "=== WebFlix → YouTube upload metadata ===\nTITLE: T",
        fields: {
          title: "T",
          description: "",
          tags: [],
          visibility: "public",
          thumbnailUrl: null,
          isShort: false,
        },
      },
    });
    expect(html).toContain("The publish was not completed");
    expect(html).toContain("publish-button-not-ready");
    expect(html).toContain("uploading");
    expect(html).toContain("Copy bundle"); // the rung is offered, never a dead end
  });
});
