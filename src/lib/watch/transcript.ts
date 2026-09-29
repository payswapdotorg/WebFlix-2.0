import type { TranscriptCueDto } from "./types";

/**
 * WFX2-W transcript helpers — cue lookup as the playhead passes
 * (the YouTube active-cue highlight behavior).
 */

export interface CueRow extends TranscriptCueDto {
  /** row index for scroll-into-view */
  index: number;
}

/**
 * Index of the active cue at time t: the LAST cue whose startSec <= t.
 * In gaps between cues the previous cue stays highlighted (YouTube behavior);
 * before the first cue → -1.
 */
export function activeCueIndex(cues: TranscriptCueDto[], t: number): number {
  if (!cues.length) return -1;
  if (t < cues[0].startSec) return -1;
  let idx = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].startSec <= t) idx = i;
    else break;
  }
  return idx;
}

/** Map a transcript row click → seek target seconds. */
export function cueSeekSec(cue: TranscriptCueDto): number {
  return cue.startSec;
}
