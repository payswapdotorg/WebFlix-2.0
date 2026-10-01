/**
 * WFX2-P4-PE tests — the playlist-edit kinds' page scripts:
 *
 *  - the navigation contract: requiredUrl routes both playlist-update and
 *    playlist-reorder to the playlist's own page
 *    (https://www.youtube.com/playlist?list=<id>); no playlistId → null
 *  - the script SHAPE (string-level assertions, the upload.test.ts idiom):
 *    the kinds-module wrapper (awaitable IIFE + __exception guard), the
 *    real dialog-driving selectors, the field-fill pattern, the save
 *    button, the verification reads (header title for update, list order
 *    for reorder), and every honest-failure marker the work order's
 *    taxonomy enumerates
 *  - payload normalization: missing fields → already:true; visibility
 *    normalizes; fromIndex/toIndex required honestly
 *
 * The behavior-against-fake-DOM suite is intentionally light here (the
 * script's own selectors + the dispatch ladder make a fully routed DOM
 * brittle); the deep behavior coverage lives in the app-side battery
 * (tests/playlist-edit.test.tsx) where the broker is mocked at the seam.
 */
import { describe, expect, test } from "bun:test";
import {
  PLAYLIST_EDIT_TIMEOUT_MS,
  playlistUpdateScript,
  playlistReorderScript,
} from "./playlistedit";
import { requiredUrl, buildScript } from "../executor";
import type { BrokerPayload } from "../types";

/* ------------------------------------------------------------------ */
/* the navigation contract (the registry's requiredUrl)                */
/* ------------------------------------------------------------------ */

describe("playlist-edit — navigation (the registry's requiredUrl)", () => {
  test("playlist-update routes the tab to the playlist's own page", () => {
    expect(
      requiredUrl({
        kind: "playlist-update",
        target: { playlistId: "PLrAaJQXAC9IVRw" },
        payload: { title: "New" },
      })
    ).toBe("https://www.youtube.com/playlist?list=PLrAaJQXAC9IVRw");
  });

  test("playlist-reorder routes the tab to the same playlist page", () => {
    expect(
      requiredUrl({
        kind: "playlist-reorder",
        target: { playlistId: "PLrAaJQXAC9IVRw" },
        payload: { fromIndex: 0, toIndex: 2 },
      })
    ).toBe("https://www.youtube.com/playlist?list=PLrAaJQXAC9IVRw");
  });

  test("no playlistId → null (the executor refuses to guess a surface)", () => {
    expect(requiredUrl({ kind: "playlist-update", target: {}, payload: {} })).toBeNull();
    expect(requiredUrl({ kind: "playlist-reorder", target: {}, payload: {} })).toBeNull();
  });

  test("buildScript routes both kinds to the lane-owned module's scripts", () => {
    const update = buildScript({
      kind: "playlist-update",
      target: { playlistId: "PLx" },
      payload: { title: "T" },
    });
    expect(update && update.script).toBe(playlistUpdateScript({ title: "T" }).script);
    expect(update && update.timeoutMs).toBe(PLAYLIST_EDIT_TIMEOUT_MS);

    const reorder = buildScript({
      kind: "playlist-reorder",
      target: { playlistId: "PLx" },
      payload: { fromIndex: 1, toIndex: 0, videoId: "dQw4w9WgXcQ" },
    });
    expect(reorder && reorder.script).toBe(
      playlistReorderScript({ fromIndex: 1, toIndex: 0, videoId: "dQw4w9WgXcQ" }).script
    );
  });
});

/* ------------------------------------------------------------------ */
/* the script shape — playlist-update                                  */
/* ------------------------------------------------------------------ */

describe("playlist-update — the script shape", () => {
  const built = playlistUpdateScript({
    playlistId: "PL_test",
    title: "Renamed by WebFlix",
    description: "the new description",
    visibility: "unlisted",
  });

  test("kind-module contract: {script, timeoutMs} with the lane's 120s ceiling", () => {
    expect(typeof built.script).toBe("string");
    expect(built.timeoutMs).toBe(PLAYLIST_EDIT_TIMEOUT_MS);
    expect(built.timeoutMs).toBeLessThanOrEqual(120_000);
  });

  test("the kinds-module wrapper: awaitable IIFE with the __exception guard", () => {
    expect(built.script.startsWith("(async()=>{")).toBe(true);
    expect(built.script.endsWith("})()")).toBe(true);
    expect(built.script).toContain("__exception");
    expect(() => new Function(`return (${built.script});`)).not.toThrow();
  });

  test("the playlist header selector (the playlist-not-found guard's anchor)", () => {
    expect(built.script).toContain("ytd-playlist-header-renderer");
  });

  test("the ⋮ menu + edit-pencil open-dialog idioms (the REAL affordances)", () => {
    expect(built.script).toContain("ytd-menu-renderer");
    expect(built.script).toContain("aria-label*='more'");
    expect(built.script).toContain("EDIT_PENCIL_SEL");
    expect(built.script).toContain("#edit-button");
    expect(built.script).toContain("/^edit$/i");
  });

  test("the edit dialog + its field selectors (the REAL edit dialog)", () => {
    expect(built.script).toContain("ytd-edit-playlist-dialog-renderer");
    expect(built.script).toContain("tp-yt-paper-dialog");
    expect(built.script).toContain("tp-yt-paper-input #input");
    expect(built.script).toContain("tp-yt-paper-textarea");
    expect(built.script).toContain("textarea[aria-label*='description'");
    expect(built.script).toContain("yt-select-renderer");
    expect(built.script).toContain("#privacy");
  });

  test("the payload's fields are baked into the script (only the present ones)", () => {
    expect(built.script).toContain('"Renamed by WebFlix"');
    expect(built.script).toContain('"the new description"');
    expect(built.script).toContain('"unlisted"');
  });

  test("the fillText pattern (selectAll + insertText for contenteditable)", () => {
    expect(built.script).toContain("execCommand('selectAll'");
    expect(built.script).toContain("execCommand('insertText'");
    expect(built.script).toContain("el.value=text");
    expect(built.script).toContain("new Event('input',{bubbles:true})");
  });

  test("the Save button (the #save-button / #submit-button family)", () => {
    expect(built.script).toContain("#save-button");
    expect(built.script).toContain("#submit-button");
    expect(built.script).toContain("saveBtn.click()");
  });

  test("verifies the header re-rendered the new title (verified:true only when seen)", () => {
    expect(built.script).toContain("headerTitle");
    expect(built.script).toContain("titleBefore");
    expect(built.script).toContain("titleAfter");
    expect(built.script).toContain("verified:true");
    expect(built.script).toContain("verified:false");
    expect(built.script).toContain("'updated'");
    expect(built.script).toContain("'updated-unverified'");
  });

  test("the honest-failure markers ride the script (the work order's taxonomy)", () => {
    for (const marker of [
      "playlist-not-found",
      "playlist-edit-dialog-not-found",
      "playlist-update-failed",
    ]) {
      expect(built.script).toContain(`'${marker}'`);
    }
    expect(built.script).toContain("dom:DOM");
    expect(built.script).toContain("dom:{...DOM");
    // the stage-accurate sub-failures
    expect(built.script).toContain("'title-not-filled'");
    expect(built.script).toContain("'save-button-not-ready'");
    expect(built.script).toContain("'dialog-still-open'");
    expect(built.script).toContain("'visibility-option-not-found'");
  });
});

/* ------------------------------------------------------------------ */
/* the script shape — playlist-reorder                                 */
/* ------------------------------------------------------------------ */

describe("playlist-reorder — the script shape", () => {
  const built = playlistReorderScript({
    playlistId: "PL_test",
    fromIndex: 0,
    toIndex: 2,
    videoId: "dQw4w9WgXcQ",
  });

  test("kind-module contract: {script, timeoutMs} with the lane's 120s ceiling", () => {
    expect(typeof built.script).toBe("string");
    expect(built.timeoutMs).toBe(PLAYLIST_EDIT_TIMEOUT_MS);
  });

  test("the kinds-module wrapper: awaitable IIFE with the __exception guard", () => {
    expect(built.script.startsWith("(async()=>{")).toBe(true);
    expect(built.script.endsWith("})()")).toBe(true);
    expect(built.script).toContain("__exception");
    expect(() => new Function(`return (${built.script});`)).not.toThrow();
  });

  test("the playlist video list + row selectors (the REAL reorder surface)", () => {
    expect(built.script).toContain("ytd-playlist-video-list-renderer");
    expect(built.script).toContain("ytd-playlist-video-renderer");
  });

  test("the drag handle selectors (the grip / yt-icon-button family)", () => {
    expect(built.script).toContain("#drag-handle");
    expect(built.script).toContain("aria-label*='drag'");
    expect(built.script).toContain("yt-icon-button#button");
  });

  test("the synthetic pointer-event ladder (the stepped drag)", () => {
    expect(built.script).toContain("PointerEvent");
    expect(built.script).toContain("'pointerdown'");
    expect(built.script).toContain("'pointermove'");
    expect(built.script).toContain("'pointerup'");
    expect(built.script).toContain("STEPS=8");
    expect(built.script).toContain("i/STEPS");
    expect(built.script).toContain("elementFromPoint");
  });

  test("the fromIndex / toIndex / videoId are baked into the script", () => {
    // const fromIndex=0; const toIndex=2; const videoId="dQw4w9WgXcQ";
    expect(built.script).toContain("const fromIndex=0;");
    expect(built.script).toContain("const toIndex=2;");
    expect(built.script).toContain('"dQw4w9WgXcQ"');
  });

  test("verifies the moved videoId sits at toIndex in the re-rendered list", () => {
    expect(built.script).toContain("verifyAtTarget");
    expect(built.script).toContain("rows()[toIndex]");
    expect(built.script).toContain("verified:true");
    expect(built.script).toContain("verified:false");
    expect(built.script).toContain("'reordered'");
    expect(built.script).toContain("'reorder-unverified'");
  });

  test("the honest-failure markers ride the script (the work order's taxonomy)", () => {
    expect(built.script).toContain("'playlist-item-not-found'");
    expect(built.script).toContain("'playlist-drag-handle-not-found'");
    // the unverified marker rides inside detail.stage as 'reorder-unverified'
    expect(built.script).toContain("'reorder-unverified'");
    expect(built.script).toContain("dom:DOM");
    expect(built.script).toContain("dom:{...DOM");
  });
});

/* ------------------------------------------------------------------ */
/* payload normalization — playlist-update                             */
/* ------------------------------------------------------------------ */

describe("playlist-update — payload normalization", () => {
  test("no fields → already:true (nothing to change, never a fake drive)", () => {
    const s = playlistUpdateScript({ playlistId: "PLx" });
    expect(s.script).toContain("already:true");
    expect(s.script).toContain("no fields in the update payload");
  });

  test("a non-canonical visibility is dropped (never an invented select option)", () => {
    // visibility is case-insensitively normalized: PUBLIC → public (canonical),
    // but a truly invalid value (e.g. "nonsense") is dropped to null
    expect(playlistUpdateScript({ playlistId: "PLx", visibility: "PUBLIC" }).script).toContain(
      'const wantVisibility="public";'
    );
    expect(playlistUpdateScript({ playlistId: "PLx", visibility: "nonsense" }).script).toContain(
      "const wantVisibility=null;"
    );
    expect(playlistUpdateScript({ playlistId: "PLx", visibility: "friends-only" }).script).toContain(
      "const wantVisibility=null;"
    );
  });

  test("canonical visibility is preserved", () => {
    for (const v of ["public", "unlisted", "private"]) {
      const s = playlistUpdateScript({ playlistId: "PLx", visibility: v });
      expect(s.script).toContain(`const wantVisibility="${v}";`);
    }
  });

  test("undefined payload still builds an honest no-op script", () => {
    const s = playlistUpdateScript(undefined);
    expect(s.timeoutMs).toBe(PLAYLIST_EDIT_TIMEOUT_MS);
    expect(s.script).toContain("already:true");
    expect(() => new Function(`return (${s.script});`)).not.toThrow();
  });

  test("title + description + visibility together — all three ride the script", () => {
    const s = playlistUpdateScript({
      playlistId: "PLx",
      title: "T",
      description: "D",
      visibility: "public",
    });
    expect(s.script).toContain('"T"');
    expect(s.script).toContain('"D"');
    expect(s.script).toContain('"public"');
    // the verified return carries the fields map
    expect(s.script).toContain("title:wantTitle!==null");
    expect(s.script).toContain("description:wantDescription!==null");
    expect(s.script).toContain("visibility:wantVisibility!==null");
  });
});

/* ------------------------------------------------------------------ */
/* payload normalization — playlist-reorder                            */
/* ------------------------------------------------------------------ */

describe("playlist-reorder — payload normalization", () => {
  test("missing fromIndex or toIndex → honest refusal up front", () => {
    const s = playlistReorderScript({ playlistId: "PLx" });
    expect(s.script).toContain("fromIndex and toIndex are required");
  });

  test("negative indices are refused (null, never an invented row)", () => {
    const s = playlistReorderScript({ playlistId: "PLx", fromIndex: -1, toIndex: 2 });
    expect(s.script).toContain("const fromIndex=null;");
  });

  test("videoId verification aid rides the script when present", () => {
    const s = playlistReorderScript({
      playlistId: "PLx",
      fromIndex: 0,
      toIndex: 1,
      videoId: "abc123XYZ",
    });
    expect(s.script).toContain('"abc123XYZ"');
    expect(s.script).toContain("does not match the payload");
  });

  test("undefined payload still builds an honest-refusing script", () => {
    const s = playlistReorderScript(undefined);
    expect(s.timeoutMs).toBe(PLAYLIST_EDIT_TIMEOUT_MS);
    expect(s.script).toContain("fromIndex and toIndex are required");
    expect(() => new Function(`return (${s.script});`)).not.toThrow();
  });
});
