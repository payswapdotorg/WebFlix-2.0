#!/usr/bin/env bun
/**
 * P45 — publish the harvester actor v0.1, build it, run ONE careful attempt,
 * poll, and print a masked dataset summary. Usage:
 *   bun scripts/p45-actor-publish.mjs <proxyGroup> <country>
 */
import { readFileSync } from "node:fs";

const TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = process.env.APIFY_ACTOR_ID ?? "QouQAyfuuPWX2QTPc";
const EMAIL = process.env.NETFLIX_EMAIL;
const PASSWORD = process.env.NETFLIX_PASSWORD;
const [proxyGroup = "RESIDENTIAL", country = "GB"] = process.argv.slice(2);

if (!TOKEN || !EMAIL || !PASSWORD) {
  console.error("missing APIFY_TOKEN / NETFLIX_EMAIL / NETFLIX_PASSWORD env");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, init) => fetch(`https://api.apify.com/v2${path}`, init).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// 1) current actor (to preserve package.json/Dockerfile of v0.0)
const cur = await api(`/acts/${ACTOR_ID}?token=${TOKEN}`);
if (cur.status !== 200) { console.error("actor fetch failed", cur.status); process.exit(1); }
const oldVer = (cur.body.data.versions ?? []).find((v) => v.versionNumber === "0.0");
const keep = (name) => oldVer?.sourceFiles?.find((f) => f.name === name)?.content ?? "";

const mainJs = readFileSync(new URL("../research/netflix-auth/actor-v0.1-main.js", import.meta.url), "utf8");

const put = await api(`/acts/${ACTOR_ID}?token=${TOKEN}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: cur.body.data.name,
    title: cur.body.data.title,
    versions: [
      ...(oldVer ? [oldVer] : []),
      {
        versionNumber: "0.1",
        buildTag: "latest",
        sourceType: "SOURCE_FILES",
        sourceFiles: [
          { name: "package.json", format: "TEXT", content: keep("package.json") || '{"dependencies":{"apify":"^3.0.0","apify-shared":"^1.0.0","puppeteer":"^23.0.0","puppeteer-extra":"^3.3.6","puppeteer-extra-plugin-stealth":"^2.11.2"}}' },
          { name: "src/main.js", format: "TEXT", content: mainJs },
          { name: "Dockerfile", format: "TEXT", content: keep("Dockerfile") || "FROM apify/actor-node-chrome:20\nCOPY package.json ./\nRUN npm --quiet set progress=false && npm install --only=prod --no-optional\nCOPY . ./\nCMD npm run start:prod --silent\n" },
        ],
      },
    ],
  }),
});
console.log("publish:", put.status);
if (put.status >= 300) { console.error(JSON.stringify(put.body).slice(0, 400)); process.exit(1); }

// 2) build v0.1
const build = await api(`/acts/${ACTOR_ID}/builds?version=0.1&waitForFinish=180&token=${TOKEN}`, { method: "POST" });
const buildStatus = build.body?.data?.status;
console.log("build:", buildStatus);
if (!["SUCCEEDED", "READY"].includes(buildStatus)) { console.error(JSON.stringify(build.body?.data?.statusMessage ?? build.body).slice(0, 500)); process.exit(1); }

// 3) run ONE attempt
const run = await api(`/acts/${ACTOR_ID}/runs?token=${TOKEN}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, proxyGroup, country, warmup: true }),
});
if (run.status >= 300) { console.error("run start failed", run.status, JSON.stringify(run.body).slice(0, 300)); process.exit(1); }
const runId = run.body.data.id;
const datasetId = run.body.data.defaultDatasetId;
console.log("run:", runId, "dataset:", datasetId, "| proxy:", proxyGroup, country);

// 4) poll up to 10 min
const deadline = Date.now() + 10 * 60_000;
let status = "READY";
while (Date.now() < deadline) {
  await sleep(20_000);
  const st = await api(`/actor-runs/${runId}?token=${TOKEN}`);
  status = st.body?.data?.status ?? "UNKNOWN";
  console.log("  status:", status, new Date().toISOString().slice(11, 19));
  if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
}
if (status !== "SUCCEEDED") { console.error("run ended:", status); }

// 5) dataset summary (cookies masked)
const items = await api(`/datasets/${datasetId}/items?token=${TOKEN}&clean=true`);
for (const it of items.body ?? []) {
  const masked = { ...it };
  if (Array.isArray(masked.cookies)) masked.cookies = masked.cookies.map((c) => ({ name: c.name, len: String(c.value ?? "").length }));
  if (masked.shot) masked.shot = `<${String(masked.shot).length} bytes jpeg>`;
  for (const lr of masked.loginResponses ?? []) lr.body = (lr.body ?? "").slice(0, 120);
  console.log(JSON.stringify(masked, null, 2).slice(0, 2400));
}
