/**
 * WFX2 P34 — WIRE-CAPTURE — the captured-wire promotion tool.
 *
 * Reads the broker's captures.jsonl, selects a captured youtubei action
 * wire, READS its params protobuf byte-by-byte (a generic walk — reading,
 * never guessing), and emits the fixture scaffolding for review: the hex
 * layout, the detected id/timestamp slots, the proposed `_TPL` constant
 * and — when the layout matches the like family (one 11-char id run, one
 * 5-byte unix-sec varint) — a proposed buildXxxParams following the
 * P33 like law (fixed-offset id swap + refreshed timestamp varint).
 *
 * The tool NEVER edits source files: the emitted scaffolding goes through
 * a reviewed lane before it joins src/lib/youtube-direct.ts (the house
 * law — a direct action ships only with a captured, reviewed wire).
 *
 * Usage (from mini-services/youtube-broker):
 *   bun run promote-captured-wire.ts [--file <captures.jsonl>]
 *                                    [--endpoint like]   # substring filter
 *                                    [--index -1]        # -1 = latest match
 *                                    [--json]            # machine-readable
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CaptureEntry } from "./captures";

// ---------------------------------------------------------------------------
// capture selection
// ---------------------------------------------------------------------------

export function parseCaptures(text: string): CaptureEntry[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as CaptureEntry];
      } catch {
        return []; // a torn tail line (crash mid-append) is skipped, not fatal
      }
    });
}

export function selectCapture(
  entries: CaptureEntry[],
  opts: { endpoint?: string; index?: number } = {}
): CaptureEntry | null {
  const filtered =
    opts.endpoint && opts.endpoint.length > 0
      ? entries.filter((e) => e.endpoint.includes(opts.endpoint!))
      : entries;
  if (filtered.length === 0) return null;
  const idx = opts.index ?? -1;
  const i = idx < 0 ? filtered.length + idx : idx;
  if (i < 0 || i >= filtered.length) return null;
  return filtered[i];
}

/** The action-bearing fields of the captured request body. */
export function extractActionFields(postData: string | null): {
  params?: string;
  actions?: unknown[];
} | null {
  if (postData === null) return null;
  try {
    const body = JSON.parse(postData) as Record<string, unknown>;
    const out: { params?: string; actions?: unknown[] } = {};
    if (typeof body.params === "string") out.params = body.params;
    if (Array.isArray(body.actions)) out.actions = body.actions;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// the generic protobuf walk (READ the wire, never guess it)
// ---------------------------------------------------------------------------

export interface WalkNode {
  /** the protobuf field number */
  field: number;
  /** the wire type (0 varint, 1 64-bit, 2 len-delim, 5 32-bit) */
  wireType: number;
  /** absolute byte offset of the TAG */
  offset: number;
  /** for varints: absolute offset of the VALUE bytes (tag + tag-len in) —
   * the bytes a like-law builder actually rewrites */
  valueOffset?: number;
  /** for varints: the value */
  varint?: bigint;
  /** for varints: the byte length the wire used (may exceed minimal) */
  varintBytes?: number;
  /** for len-delim: the payload bytes */
  bytes?: Buffer;
  /** for len-delim: the payload length */
  len?: number;
  /** nested walk when the payload itself parses as a clean protobuf */
  children?: WalkNode[];
}

function readVarint(buf: Buffer, from: number): { value: bigint; len: number } | null {
  let value = 0n;
  for (let i = 0; i < 10 && from + i < buf.length; i++) {
    const b = buf[from + i];
    value |= BigInt(b & 0x7f) << BigInt(7 * i);
    if ((b & 0x80) === 0) return { value, len: i + 1 };
  }
  return null;
}

/** Walk a buffer as protobuf; returns null when it doesn't parse cleanly
 * (consumed to the end with valid tags throughout). */
export function walkProtobuf(buf: Buffer, base = 0): WalkNode[] | null {
  const nodes: WalkNode[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (!tag) return null;
    const field = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (field === 0) return null;
    const offset = base + pos;
    pos += tag.len;
    if (wireType === 0) {
      const v = readVarint(buf, pos);
      if (!v) return null;
      const valueOffset = base + pos;
      pos += v.len;
      nodes.push({ field, wireType, offset, valueOffset, varint: v.value, varintBytes: v.len });
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) return null;
      pos += 8;
      nodes.push({ field, wireType, offset });
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) return null;
      pos += 4;
      nodes.push({ field, wireType, offset });
    } else if (wireType === 2) {
      const lenV = readVarint(buf, pos);
      if (!lenV) return null;
      pos += lenV.len;
      const len = Number(lenV.value);
      if (pos + len > buf.length) return null;
      const payload = buf.subarray(pos, pos + len);
      pos += len;
      // nest only when the payload is itself a clean protobuf (the like
      // family's {1:{1:id,...},6:{1:ts,2:hash}} shape)
      const children = payload.length > 1 ? walkProtobuf(payload, base + pos - len) : undefined;
      nodes.push({ field, wireType, offset, bytes: Buffer.from(payload), len, children: children ?? undefined });
    } else {
      return null; // wire types 3/4 (groups) — not in modern youtubei params
    }
  }
  return nodes.length > 0 ? nodes : null;
}

// ---------------------------------------------------------------------------
// layout detection
// ---------------------------------------------------------------------------

export interface IdRun {
  text: string;
  offset: number;
  len: number;
}

export interface TsSlot {
  offset: number;
  len: number;
  value: bigint;
  /** the walk path to the slot (field numbers, outermost first) */
  path: number[];
}

const ID_RUN_RE = /[A-Za-z0-9_-]{8,}/g;

export function detectIdRuns(buf: Buffer): IdRun[] {
  const runs: IdRun[] = [];
  const text = buf.toString("latin1");
  for (const m of text.matchAll(ID_RUN_RE)) {
    runs.push({ text: m[0], offset: m.index ?? 0, len: m[0].length });
  }
  // a printable run the whole buffer would be (e.g. a raw string payload,
  // not an embedded id) — keep it but flag by length; consumers filter
  return runs.filter((r) => r.len < buf.length || buf.length > 64);
}

export function detectTsSlots(nodes: WalkNode[], path: number[] = []): TsSlot[] {
  const out: TsSlot[] = [];
  for (const n of nodes) {
    if (n.wireType === 0 && n.varint !== undefined) {
      const v = n.varint;
      if (v >= 1600000000n && v <= 2300000000n) {
        // unix-seconds 2020-09 .. 2042-11 — the timestamp family.
        // offset = the VALUE bytes (what a like-law builder rewrites).
        out.push({
          offset: n.valueOffset ?? n.offset,
          len: n.varintBytes ?? varintLen(v),
          value: v,
          path: [...path, n.field],
        });
      }
    }
    if (n.children) {
      out.push(...detectTsSlots(n.children, [...path, n.field]));
    }
  }
  return out;
}

function varintLen(v: bigint): number {
  let len = 1;
  let x = v;
  while (x >= 128n) {
    x >>= 7n;
    len++;
  }
  return len;
}

// ---------------------------------------------------------------------------
// the analysis
// ---------------------------------------------------------------------------

export interface Analysis {
  capture: {
    ts: string;
    kind: string;
    target: CaptureEntry["target"];
    endpoint: string;
    url: string;
    status: number | null;
    truncated: boolean;
  };
  paramsB64: string | null;
  actions: unknown[] | null;
  hex: string | null;
  walk: WalkNode[] | null;
  idRuns: IdRun[];
  tsSlots: TsSlot[];
  /** the like-family verdict + the emitted scaffolding */
  likeFamily: boolean;
  tplConstant: string | null;
  proposedBuilder: string | null;
  notes: string[];
}

const TPL_NAME = (endpoint: string): string => {
  const segs = endpoint.split(/[^A-Za-z0-9]+/).filter(Boolean).map((s) => s.toUpperCase());
  return segs.join("_") + "_TPL";
};

export function analyzeCapture(entry: CaptureEntry): Analysis {
  const notes: string[] = [];
  const fields = extractActionFields(entry.postData);
  let paramsB64 = fields?.params ?? null;
  const actions = fields?.actions ?? null;
  if (paramsB64 && /%3D/i.test(paramsB64)) {
    // the wire form URL-encodes base64 padding — normalize for decode AND
    // for the fixture constant (the youtube-direct.ts templates are padded)
    paramsB64 = paramsB64.replace(/%3D/gi, "=");
    notes.push("the captured wire URL-encodes its base64 padding (%3D) — normalized to padded base64 for the fixture (the P33 template form)");
  }
  if (!paramsB64 && !actions) {
    notes.push(
      entry.postData === null
        ? "the capture carries NO body (Network.getRequestPostData failed at capture time) — re-run the action to capture a complete wire"
        : "the capture body carries neither params nor actions — not an action wire (re-check the endpoint filter)"
    );
  }
  let buf: Buffer | null = null;
  let walk: WalkNode[] | null = null;
  let hex: string | null = null;
  let idRuns: IdRun[] = [];
  let tsSlots: TsSlot[] = [];
  if (paramsB64) {
    try {
      buf = Buffer.from(paramsB64, "base64");
    } catch {
      notes.push("params did not decode as base64 — unexpected wire form");
    }
  }
  if (buf) {
    hex = buf.toString("hex").replace(/(..)/g, "$1 ").trim();
    walk = walkProtobuf(buf);
    if (!walk) notes.push("params did not parse as a clean protobuf — manual byte review required");
    idRuns = detectIdRuns(buf);
    tsSlots = walk ? detectTsSlots(walk) : [];
    if (idRuns.length === 0) notes.push("no embedded id run detected — the wire may key on context fields instead");
  }

  // the like-family verdict: exactly one 11-char id run + at least one
  // 5-byte unix-sec varint slot (the captured like wire's exact shape)
  const eleven = idRuns.filter((r) => r.len === 11);
  const fiveByteTs = tsSlots.filter((t) => t.len === 5);
  const likeFamily = eleven.length === 1 && fiveByteTs.length >= 1 && buf !== null;

  let tplConstant: string | null = null;
  let proposedBuilder: string | null = null;
  if (paramsB64) {
    const name = TPL_NAME(entry.endpoint);
    tplConstant = `const ${name} = Buffer.from("${paramsB64}", "base64");`;
    if (likeFamily) {
      const id = eleven[0];
      const ts = fiveByteTs[0];
      const hexComment = hex
        ? `// hex: ${hex.replace(new RegExp(id.text, "g"), `<11-char id>`)}`
        : "";
      proposedBuilder = [
        `${hexComment}`,
        `// protobuf walk: field tree below; id slot at byte ${id.offset} (len 11),`,
        `// unix-sec varint at byte ${ts.offset} (len 5, path ${ts.path.join(".")})`,
        `function build${name.replace("_TPL", "")}Params(videoId: string, now?: number): string | null {`,
        `  if (videoId.length !== 11) return null;`,
        `  const buf = Buffer.from(${name});`,
        `  buf.write(videoId, ${id.offset}, "latin1");`,
        `  const ts = Math.floor((now ?? Date.now()) / 1000);`,
        ...Array.from({ length: 5 }, (_, i) =>
          `  buf[${ts.offset + i}] = ${i < 4 ? `((ts >>> ${7 * i}) & 0x7f) | 0x80` : `(ts >>> ${7 * 4}) & 0x7f`};`
        ),
        `  return buf.toString("base64").replace(/=/g, "%3D");`,
        `}`,
      ].join("\n");
    } else {
      notes.push(
        "layout is NOT the like family (needs exactly one 11-char id run + one 5-byte unix-sec varint) — the TPL constant above plus this walk is the review input; the builder is authored by hand"
      );
    }
  }
  notes.push(
    "verification plan before any direct lane ships: (1) the deterministic-401 probe from the real egress (wire validity — a 401 'You must be signed in' answer, the P33 law), then (2) ONE authenticated round-trip observed live (semantics — the action's effect re-read). Never ship on the 401 alone."
  );

  return {
    capture: {
      ts: entry.ts,
      kind: entry.kind,
      target: entry.target,
      endpoint: entry.endpoint,
      url: entry.url,
      status: entry.status,
      truncated: entry.truncated,
    },
    paramsB64,
    actions,
    hex,
    walk,
    idRuns,
    tsSlots,
    likeFamily,
    tplConstant,
    proposedBuilder,
    notes,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function renderWalk(nodes: WalkNode[], indent = ""): string {
  return nodes
    .map((n) => {
      const head = `${indent}field ${n.field} (wire ${n.wireType}) @${n.offset}`;
      if (n.wireType === 0) return `${head}: varint ${n.varint}`;
      if (n.wireType === 2) {
        const printable = n.bytes ? n.bytes.toString("latin1").replace(/[^\x20-\x7e]/g, ".") : "";
        const nested = n.children ? `\n${renderWalk(n.children, indent + "  ")}` : "";
        return `${head}: len ${n.len} [${printable}]${nested}`;
      }
      return head;
    })
    .join("\n");
}

export function renderAnalysis(a: Analysis): string {
  const lines: string[] = [];
  lines.push(`captured wire — ${a.capture.endpoint} (${a.capture.kind}) @ ${a.capture.ts}`);
  lines.push(`  target: ${JSON.stringify(a.capture.target)}  status: ${a.capture.status}`);
  if (a.capture.truncated) lines.push(`  ⚠ capture body was truncated at capture time`);
  if (a.paramsB64) lines.push(`  params: ${a.paramsB64}`);
  if (a.actions) lines.push(`  actions: ${JSON.stringify(a.actions)}`);
  if (a.hex) lines.push(`  hex: ${a.hex}`);
  if (a.walk) lines.push(renderWalk(a.walk, "  "));
  if (a.idRuns.length)
    lines.push(
      `  id runs: ${a.idRuns.map((r) => `"${r.text}" @${r.offset} (len ${r.len})`).join(", ")}`
    );
  if (a.tsSlots.length)
    lines.push(
      `  unix-sec varints: ${a.tsSlots.map((t) => `${t.value} @${t.offset} (len ${t.len}, path ${t.path.join(".")})`).join(", ")}`
    );
  lines.push(`  like-family layout: ${a.likeFamily ? "YES" : "no"}`);
  if (a.tplConstant) lines.push(`\n  ${a.tplConstant}`);
  if (a.proposedBuilder) lines.push(a.proposedBuilder.replace(/^/gm, "  "));
  for (const n of a.notes) lines.push(`\n  · ${n}`);
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const flag = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) return "";
    return v;
  };
  const file = flag("file") ?? resolve(import.meta.dir, "captures.jsonl");
  const endpoint = flag("endpoint") || undefined;
  const indexRaw = flag("index");
  const index = indexRaw === null || indexRaw === "" ? -1 : parseInt(indexRaw, 10);
  const asJson = args.includes("--json");

  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    process.stderr.write(`no captures journal at ${file} — run a broker action first\n`);
    return 1;
  }
  const entries = parseCaptures(text);
  const entry = selectCapture(entries, { endpoint, index });
  if (!entry) {
    const endpoints = [...new Set(entries.map((e) => e.endpoint))];
    process.stderr.write(
      `no capture matched (endpoint=${endpoint ?? "*"}, index=${index}). ` +
        (endpoints.length ? `journal holds: ${endpoints.join(", ")}` : "the journal is empty") + "\n"
    );
    return 1;
  }
  const analysis = analyzeCapture(entry);
  if (asJson) {
    process.stdout.write(JSON.stringify(analysis, null, 2) + "\n");
  } else {
    process.stdout.write(renderAnalysis(analysis) + "\n");
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv));
}
