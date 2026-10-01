/**
 * WFX2-P3-UP tests — the upload-execute page script's SHAPE (string-level
 * assertions on the built script: navigation URL present, the staged drive's
 * steps present, honest-error shapes present). NO live CDP, NO network —
 * the script is a string; we assert what it promises to do and how it
 * promises to fail. (The broker.test.ts routing lock covers the
 * executor-side dispatch; the app-side flow tests live in
 * tests/upload-flow.test.ts.)
 */
import { describe, expect, test } from "bun:test";
import {
  UPLOAD_EXECUTE_TIMEOUT_MS,
  uploadExecuteScript,
} from "./upload";
import type { BrokerPayload } from "../types";

const PAYLOAD: BrokerPayload & { fileUrl?: string } = {
  fileUrl: "http://127.0.0.1:3000/upload/stage?id=deadbeef",
  fileName: "synthetic-480p-1s-webflix.mp4",
  title: "WebFlix staged upload drive",
  description: "Driven by the session broker through the real upload dialog.",
  visibility: "unlisted",
};

describe("upload-execute script shape", () => {
  const up = uploadExecuteScript(PAYLOAD);

  test("wraps into a single awaitable async-IIFE expression", () => {
    expect(up.script.startsWith("(async()=>{")).toBe(true);
    expect(up.script.endsWith("})()")).toBe(true);
    // the whole expression compiles as JavaScript (a SyntaxError can never
    // reach the wire unnoticed)
    expect(() => new Function(`return ${up.script}`)).not.toThrow();
  });

  test("timeoutMs is the work order's honest ceiling (300000 max)", () => {
    expect(up.timeoutMs).toBe(UPLOAD_EXECUTE_TIMEOUT_MS);
    expect(up.timeoutMs).toBeLessThanOrEqual(300000);
  });

  test("navigates to the real youtube.com/upload page (the script's own navigation)", () => {
    expect(up.script).toContain("https://www.youtube.com/upload");
    expect(up.script).toContain("location.href=UPLOAD_URL");
  });

  test("drives the real file input with the staged file identity", () => {
    expect(up.script).toContain('q("input[type=file]")');
    expect(up.script).toContain("new File([blob],fileName");
    expect(up.script).toContain("DataTransfer");
    expect(up.script).toContain("fileInput.files=dt.files");
    expect(up.script).toContain("new Event('change',{bubbles:true})");
    // the staged bytes are fetched from the payload's fileUrl in page context
    expect(up.script).toContain("fetch(fileUrl,{mode:'cors'})");
    expect(up.script).toContain(PAYLOAD.fileUrl!);
    expect(up.script).toContain(JSON.stringify(PAYLOAD.fileName));
  });

  test("fills the metadata the payload carries (title + description)", () => {
    expect(up.script).toContain(JSON.stringify(PAYLOAD.title));
    expect(up.script).toContain(JSON.stringify(PAYLOAD.description));
    expect(up.script).toContain("execCommand('insertText'");
  });

  test("advances the dialog (Next ×3) and sets visibility", () => {
    expect(up.script).toContain("q(\"#next-button\")");
    expect(up.script).toContain("step<=3");
    expect(up.script).toContain(JSON.stringify(PAYLOAD.visibility));
    expect(up.script).toContain("#publish-button");
  });

  test("returns the honest published result shape (stage + videoId + watchUrl)", () => {
    expect(up.script).toContain("stage:'published'");
    expect(up.script).toContain("videoId:vid");
    expect(up.script).toContain("watchUrl:'https://www.youtube.com/watch?v='+vid");
    expect(up.script).toContain("verified:true");
    // the unverified publish is honestly flagged, never claimed
    expect(up.script).toContain("verified:false");
    expect(up.script).toContain("stage:'processing'");
  });

  test("carries stage-accurate honest failures with the observed DOM", () => {
    for (const marker of [
      "title-required",
      "file-source-missing",
      "file-input-not-found",
      "staged-file-fetch-failed",
      "staged-file-unreachable",
      "staged-file-empty",
      "details-step-not-reached",
      "title-not-filled",
      "next-button-not-ready",
      "visibility-option-not-found",
      "publish-button-not-ready",
      "publish-confirmation-not-observed",
    ]) {
      expect(up.script).toContain(marker);
    }
    expect(up.script).toContain("dom:DOM()");
    // an in-page exception surfaces as the established __exception envelope
    expect(up.script).toContain("catch(e){return{__exception:String(e)}}");
  });

  test("the honest intermediate 'navigating' state tells the caller to re-invoke", () => {
    expect(up.script).toContain("stage:'navigating'");
    expect(up.script).toContain("re-invoke to drive the dialog");
  });

  test("polls inside the script under a deadline (long waits, no busy spin)", () => {
    expect(up.script).toContain("const until=async(fn,ms=8000,step=250)");
    expect(up.script).toContain("const within=async(fn,capMs)");
    expect(up.script).toContain("LEFT()");
  });
});

describe("upload-execute payload normalization", () => {
  test("missing title never navigates — honest refusal up front", () => {
    const s = uploadExecuteScript({ fileName: "a.mp4", fileUrl: "http://x/y" });
    expect(s.script.indexOf("title-required")).toBeGreaterThan(-1);
    expect(s.script.indexOf("title-required")).toBeLessThan(s.script.indexOf("location.href=UPLOAD_URL"));
  });

  test("a non-http fileUrl is refused as file-source-missing (never a fake upload)", () => {
    const s = uploadExecuteScript({ title: "T", fileUrl: "javascript:alert(1)" });
    expect(s.script).toContain('fileUrl=""');
    expect(s.script).toContain("file-source-missing");
  });

  test("visibility normalizes to public for anything but unlisted/private", () => {
    expect(uploadExecuteScript({ title: "T", visibility: "PUBLIC" }).script).toContain('visibility="public"');
    expect(uploadExecuteScript({ title: "T", visibility: "nonsense" }).script).toContain('visibility="public"');
    expect(uploadExecuteScript({ title: "T", visibility: "private" }).script).toContain('visibility="private"');
    expect(uploadExecuteScript({ title: "T" }).script).toContain('visibility="public"');
  });

  test("fileName defaults to upload.mp4; description defaults empty", () => {
    const s = uploadExecuteScript({ title: "T", fileUrl: "http://x/y" });
    expect(s.script).toContain('"upload.mp4"');
    expect(s.script).toContain('description=""');
  });

  test("undefined payload still builds an honestly-refusing script", () => {
    const s = uploadExecuteScript(undefined);
    expect(s.timeoutMs).toBe(UPLOAD_EXECUTE_TIMEOUT_MS);
    expect(s.script).toContain("title-required");
    expect(() => new Function(`return ${s.script}`)).not.toThrow();
  });
});
