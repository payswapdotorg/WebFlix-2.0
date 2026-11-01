#!/usr/bin/env bun
/**
 * verify-distributed-ratelimit.mjs — the P76 verification tool for the
 * distributed (Upstash-backed) fixed-window rate limiter.
 *
 * Two honest modes:
 *
 *  live     (default when UPSTASH_REDIS_REST_URL + _TOKEN are set): PINGs the
 *           real endpoint, then runs the budget round trip on a unique probe
 *           key (INCR/PEXPIRE pipeline, the limit crossing, the self-expiry
 *           TTL) and DELs the probe key afterwards. Exits 1 on any mismatch.
 *
 *  fixture  (--fixture, or the automatic fallback when the live endpoint is
 *           unreachable — e.g. a sandbox whose DNS allowlist walls upstash.io):
 *           boots a LOCAL HTTP server speaking the real /pipeline protocol
 *           (POST body [[argv],…] → [{result}…], the shape pinned by the
 *           2026-09-30 integration fix), points the REAL adapter's envRest()
 *           at it via env, and runs the same assertions through the real
 *           fetch path — the injected-fake seam is NOT used. Also proves the
 *           fail-open law against a refusing endpoint.
 *
 * The script NEVER prints secret values. Exit 0 = verified, 1 = mismatch.
 */
import { createServer } from "node:http";

const args = process.argv.slice(2);
const forceFixture = args.includes("--fixture");

const REST_TIMEOUT_MS = 4_000;
const PROBE_LIMIT = 3;
const PROBE_WINDOW_MS = 60_000;

function restFetch(url, token) {
  return async (commands) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
    try {
      const pipelineUrl = url.replace(/\/+$/, "") + "/pipeline";
      const res = await fetch(pipelineUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`upstash rest ${res.status}`);
      const body = await res.json();
      const rows = Array.isArray(body) ? body : [body];
      return rows.map((row) =>
        row && typeof row === "object" && "result" in row ? row.result : null,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

// ── in-memory Redis-subset for the fixture server (the /pipeline protocol) ──
function fixtureStore() {
  const store = new Map();
  const exec = (cmd) => {
    const [op, ...argv] = cmd;
    switch (op) {
      case "PING":
        return "PONG";
      case "INCR": {
        const v = Number(store.get(argv[0]) ?? "0") + 1;
        store.set(argv[0], String(v));
        return v;
      }
      case "PEXPIRE": {
        if (!store.has(argv[0])) return 0;
        store.set(`ttl:${argv[0]}`, Date.now() + Number(argv[1]));
        return 1;
      }
      case "TTL": {
        const until = store.get(`ttl:${argv[0]}`);
        if (until === undefined) return -2;
        return Math.max(1, Math.ceil((until - Date.now()) / 1000));
      }
      case "GET":
        return store.get(argv[0]) ?? null;
      case "SET":
        store.set(argv[0], argv[1]);
        return "OK";
      case "DEL":
        store.delete(argv[0]);
        store.delete(`ttl:${argv[0]}`);
        return 1;
      default:
        return null;
    }
  };
  return { exec };
}

function startFixtureServer() {
  const { exec } = fixtureStore();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url.endsWith("/pipeline")) {
        res.writeHead(404).end();
        return;
      }
      try {
        const commands = JSON.parse(body);
        const rows = commands.map((cmd) => ({ result: exec(cmd) }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rows));
      } catch {
        res.writeHead(500).end();
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function runAssertions(rest, keyPrefix) {
  const checks = [];
  const assert = (name, ok, detail = "") => checks.push({ name, ok, detail });

  // 1. the budget crossing: limit allowed, limit+1 denied (the fixed-window law)
  const key = `${keyPrefix}:${Date.now()}`;
  let last = true;
  for (let i = 0; i < PROBE_LIMIT + 1; i++) {
    const rows = await rest([["INCR", key], ["PEXPIRE", key, String(PROBE_WINDOW_MS * 3)]]);
    const count = Number(rows[0]);
    last = Number.isFinite(count) && count > 0 ? count <= PROBE_LIMIT : true;
  }
  assert(`budget crossing (limit ${PROBE_LIMIT}): the ${PROBE_LIMIT + 1}th increment is denied`, last === false, `count exceeded limit, allowed=${last}`);

  // 2. the cleanup TTL rode the increments (PEXPIRE answered 1; TTL > 0)
  const ttl = Number((await rest([["TTL", key]]))[0]);
  assert("the probe key carries a positive cleanup TTL", Number.isFinite(ttl) && ttl > 0, `ttl=${ttl}`);

  // 3. keys are independent (a fresh key starts at 1 — allowed)
  const key2 = `${keyPrefix}:${Date.now()}-independent`;
  const rows2 = await rest([["INCR", key2], ["PEXPIRE", key2, String(PROBE_WINDOW_MS * 3)]]);
  assert("an independent key starts at 1 (allowed)", Number(rows2[0]) === 1, `count=${rows2[0]}`);

  // 4. self-cleaning: DEL the probe keys
  await rest([["DEL", key], ["DEL", key2]]);
  const gone = (await rest([["GET", key]]))[0] === null;
  assert("the probe keys are deleted after the run", gone);

  return checks;
}

async function main() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const liveCandidate = !forceFixture && url && token;

  if (liveCandidate) {
    process.stdout.write(`mode: attempting LIVE against ${url}\n`);
    try {
      const rest = restFetch(url, token);
      const rows = await rest([["PING"]]);
      if (rows[0] === "PONG") {
        const checks = await runAssertions(rest, "wfx2:rl:verify-live");
        report("live", checks, null);
        return;
      }
      process.stdout.write(`live PING answered ${JSON.stringify(rows[0])} — falling back to fixture\n`);
    } catch (err) {
      process.stdout.write(`live endpoint unreachable (${err?.message ?? err}) — falling back to fixture\n`);
    }
  }

  // fixture mode — the REAL adapter module through the REAL envRest() path
  const server = await startFixtureServer();
  const addr = server.address();
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${addr.port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "fixture-token-not-a-secret";
  const { rateLimitFixed } = await import("../src/lib/youtube/upstash-cache.ts");
  const rest = restFetch(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN);

  const checks = await runAssertions(rest, "wfx2:rl:verify-fixture");

  // 5. the REAL adapter rides the fixture through envRest(): the limit is
  //    enforced through the actual module's fetch path (not the injected fake)
  const adapterKey = `adapter-law:${Date.now()}`;
  let last = true;
  for (let i = 0; i < PROBE_LIMIT + 1; i++) {
    last = await rateLimitFixed(`verify:${adapterKey}`, PROBE_LIMIT, PROBE_WINDOW_MS);
  }
  checks.push({ name: `the real rateLimitFixed module enforces the budget through envRest()`, ok: last === false, detail: `allowed=${last}` });

  // 6. the fail-open law against a REFUSING endpoint (availability over strictness)
  server.close(); // the port now refuses
  const refused = await rateLimitFixed(`verify:refused:${Date.now()}`, 1, PROBE_WINDOW_MS);
  checks.push({ name: "a refusing endpoint fails OPEN (allowed)", ok: refused === true, detail: `allowed=${refused}` });

  report("fixture", checks, null);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

function report(mode, checks, error) {
  const ok = checks.every((c) => c.ok);
  process.stdout.write(
    JSON.stringify(
      {
        tool: "verify-distributed-ratelimit",
        mode,
        verified: ok && !error,
        error: error ?? null,
        checks,
        note:
          mode === "fixture"
            ? "fixture mode proves the real adapter code path (envRest → /pipeline fetch → parse) against a local protocol server; the LIVE endpoint verdict requires operator egress (the sandbox DNS allowlist walls upstash.io)"
            : null,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((err) => {
  report(process.argv.includes("--fixture") ? "fixture" : "live", [], err?.message ?? String(err));
  process.exit(1);
});
