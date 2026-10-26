/**
 * yt-session-identity.ts — whose youtube.com session is live in YT_COOKIES?
 *
 * The rotation protocol (docs/ops/vercel-env.md, YT_COOKIES row) needs a
 * one-command answer to "is the operator session the RIGHT account and is
 * it still alive?" — answered against YouTube's own InnerTube
 * account/accounts_list with the cookie set + the classic SAPISIDHASH
 * header (the same auth youtube-direct.ts uses for writes).
 *
 * Secrets: reads the cookie string from YT_COOKIES (env) or --file <path>.
 * NEVER prints cookie values — only HTTP status + identity fields (names,
 * emails) YouTube itself returns for the picker.
 *
 * Usage:
 *   YT_COOKIES="k=v; ..." bun scripts/ops/yt-session-identity.ts
 *   bun scripts/ops/yt-session-identity.ts --file /home/z/.secrets/ytcookies.txt
 *   # inside the webflix repo (INNERTUBE_API_KEY optional override):
 *   bun scripts/ops/yt-session-identity.ts            # env or .env.local
 */

import { createHash } from "node:crypto";

const ORIGIN = "https://www.youtube.com";
const DEFAULT_WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CLIENT_VERSION = "2.20250929.00.00";

function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function readCookieArg(): Promise<string | null> {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf("--file");
  if (fileIdx >= 0 && argv[fileIdx + 1]) {
    return (await Bun.file(argv[fileIdx + 1]).text()).trim();
  }
  return process.env.YT_COOKIES?.trim() ?? null;
}

async function main(): Promise<void> {
  const raw = await readCookieArg();
  if (!raw) {
    console.error("no cookie source: set YT_COOKIES or pass --file <path>");
    process.exit(2);
  }
  const jar = parseCookies(raw);
  const names = Object.keys(jar);
  const hasSession = names.includes("SID") && names.includes("SAPISID");
  console.log(`cookie set: ${names.length} names | session-shaped: ${hasSession ? "yes" : "NO (missing SID/SAPISID)"}`);

  const key = process.env.INNERTUBE_API_KEY?.trim() || DEFAULT_WEB_KEY;
  const now = Math.floor(Date.now() / 1000);
  const sapisid = jar["SAPISID"];
  const auth =
    typeof sapisid === "string" && sapisid
      ? `SAPISIDHASH ${now}_${createHash("sha1").update(`${now} ${sapisid} ${ORIGIN}`).digest("hex")}`
      : undefined;

  const res = await fetch(`${ORIGIN}/youtubei/v1/account/accounts_list?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: raw,
      "X-Origin": ORIGIN,
      "X-Goog-AuthUser": "0",
      ...(auth ? { Authorization: auth } : {}),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: CLIENT_VERSION, hl: "en", gl: "US" } },
    }),
  });
  console.log("accounts_list HTTP", res.status);

  const j = (await res.json()) as unknown;
  const s = JSON.stringify(j);
  // identity fields only — names/emails YouTube itself returns; never cookies
  const emails = [...new Set(s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [])];
  const namesFound: string[] = [];
  const walk = (o: unknown, depth: number): void => {
    if (depth > 9 || o == null || typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    const rec = o as Record<string, unknown>;
    const nm = (rec.accountName ?? rec.accountByline) as { simpleText?: string; runs?: { text?: string }[] } | undefined;
    const text = nm?.simpleText ?? nm?.runs?.[0]?.text;
    if (typeof text === "string" && text && !namesFound.includes(text)) namesFound.push(text);
    for (const v of Object.values(rec)) walk(v, depth + 1);
  };
  walk(j, 0);

  if (res.status === 200 && (emails.length || namesFound.length)) {
    console.log("LIVE session identity:");
    for (const e of emails) console.log("  email:", e);
    for (const n of namesFound.slice(0, 5)) console.log("  name:", n);
  } else if (res.status === 200) {
    // picker shape (selectText/actions) with no identity entries harvested:
    // cookies reach the authed endpoint but YouTube answered the chooser
    console.log("LIVE but unresolved: YouTube answered the account PICKER (multi-session chooser).");
    console.log("  The session is authenticated but the active account is not resolved by this probe.");
  } else {
    console.log(`NOT ALIVE as a session: HTTP ${res.status} — rotate the cookie set (docs/ops/vercel-env.md, YT_COOKIES row).`);
  }
}

await main();
