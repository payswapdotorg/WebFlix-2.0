/**
 * WFX2-P3-UP — the upload-execution kind module (THIS FILE IS THE P3-UP
 * LANE'S EXCLUSIVE TERRITORY; the shared registry — types.ts kinds array +
 * executor.ts routing — was pre-seeded by the lead on main so the lane
 * never edits a shared file).
 *
 * The staged drive (the lane implements): navigate the logged-in tab to
 * https://www.youtube.com/upload, drive the file input, fill metadata,
 * advance the dialog (Next ×3), set visibility, publish — returning honest
 * intermediate states (uploading → processing → published) with the video
 * id + watch URL in `detail`.
 */

import type { BrokerPayload } from "../types";

const RUNNER = `const R=(s)=>s&&(s.__exception?{__exception:s.__exception}:s);
try{`;

const script = (body: string): string => `(async()=>{${RUNNER}${body}}catch(e){return{__exception:String(e)}}})()`;

const j = (value: unknown): string => JSON.stringify(value);

export interface UploadStagePayload {
  /** the local file name the flow presents in its progress UI */
  fileName?: string;
  title?: string;
  description?: string;
  /** "public" | "unlisted" | "private" (default "public" per youtube.com) */
  visibility?: string;
}

/**
 * STUB (pre-seeded by the lead on main — the P3-UP lane replaces this body).
 * Honest staged-kind response until the lane lands.
 */
export function uploadExecuteScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p: UploadStagePayload = {
    fileName: typeof payload?.fileName === "string" ? payload.fileName : undefined,
    title: typeof payload?.title === "string" ? payload.title : undefined,
  };
  return {
    script: script(`
return R({ok:false,
  error:'upload-execute: staged kind — executor pending the P3-UP lane',
  path:'none',
  detail:${j({ staged: true, ...p })}});
`),
    timeoutMs: 5000,
  };
}
