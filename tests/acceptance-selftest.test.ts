/// <reference types="bun-types" />
/**
 * WFX2-C-W — the acceptance harness dry-run: `--selftest` spins the in-process
 * mock server (loopback, ephemeral port) and must run every check green, while
 * an unreachable target must fail honestly with exit 1. These are the only
 * tests that execute scripts/acceptance.mjs — and they stay hermetic (the
 * failure leg points at loopback port 9, which refuses instantly).
 */
import { describe, expect, test } from "bun:test";

const TIMEOUT = 120_000;

describe("scripts/acceptance.mjs --selftest", () => {
  test(
    "runs the full 38-check suite against the mock server and exits 0",
    async () => {
      const proc = Bun.spawn(["bun", "scripts/acceptance.mjs", "--selftest"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(out).toContain("SELFTEST");
      expect(out).toContain("38/38 checks passed");
      // the three suites all reported
      expect(out).toContain("PAGES — shell + title");
      expect(out).toContain("API — live data");
      expect(out).toContain("HONEST DEGRADATION");
    },
    TIMEOUT,
  );

  test(
    "an unreachable target fails the harness with exit 1 and a failure table",
    async () => {
      const proc = Bun.spawn(["bun", "scripts/acceptance.mjs"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ACCEPT_URL: "http://127.0.0.1:9" },
      });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(out).toContain("0/38 checks passed");
      expect(out).toContain("FAILURES:");
    },
    TIMEOUT,
  );
});
