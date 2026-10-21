/**
 * WFX2 P34 — WIRE-CAPTURE — the captured-wire journal (JSONL).
 *
 * One line per captured youtubei ACTION POST observed inside the logged-in
 * tab during a broker action window. This is the evidence store the house
 * law requires before any broker-tier action (dislike, bell preferences,
 * comment-like, the feedback family) can join the direct family in
 * src/lib/youtube-direct.ts — a captured wire template, never a guessed
 * protobuf (the P33 doctrine).
 *
 * The journal is append-only and durable (default ./captures.jsonl next to
 * the action journal; BROKER_CAPTURES relocates it). The companion tool
 * promote-captured-wire.ts walks a captured params blob and emits the
 * fixture scaffolding for review.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { BrokerTarget } from "./types";

export interface CaptureEntry {
  ts: string;
  /** the broker action kind in flight when the wire fired (context) */
  kind: string;
  /** the action's target (context — which video/channel/comment) */
  target: BrokerTarget;
  /** the youtubei endpoint path after /youtubei/v1/ (e.g. "like/like") */
  endpoint: string;
  /** the full request URL as sent */
  url: string;
  /** the HTTP method ("POST" — the recorder only ever captures POSTs) */
  method: string;
  /** raw request body (the JSON text the page sent); null when unobtainable */
  postData: string | null;
  /** true when postData hit the capture cap and was truncated */
  truncated: boolean;
  /** response status when observed (null: loading failed or not seen) */
  status: number | null;
  /** the CDP requestId (stable within one action window) */
  requestId: string;
}

export class CaptureJournal {
  constructor(private file: string) {}

  append(entry: CaptureEntry): void {
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** Tail of the journal, newest last; optional endpoint substring filter. */
  tail(n: number, endpointFilter?: string): CaptureEntry[] {
    try {
      if (!existsSync(this.file)) return [];
      const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
      const entries = lines.map((l) => JSON.parse(l) as CaptureEntry);
      const filtered =
        endpointFilter && endpointFilter.length > 0
          ? entries.filter((e) => e.endpoint.includes(endpointFilter))
          : entries;
      return filtered.slice(-n);
    } catch {
      return [];
    }
  }

  /** Total entries on disk (unfiltered) — 0 when the journal doesn't exist. */
  count(): number {
    try {
      if (!existsSync(this.file)) return 0;
      return readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }
}
