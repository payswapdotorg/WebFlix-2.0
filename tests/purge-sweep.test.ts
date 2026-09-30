/// <reference types="bun-types" />
/**
 * WFX2-C-W — the demo-data purge sweep, enforced as a standing test.
 *
 * Production READ surfaces are 100% live-YouTube; no seeded/demo row may
 * render there. This test greps the production source tree for demo-data
 * markers and asserts the documented allowlist (the write-lane identity
 * machinery) is the ONLY place they appear.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Production source roots (seed files live in prisma/ for dev only). */
const ROOTS = ["src/app", "src/components", "src/hooks", "src/lib"];

/** The write-lane identity machinery — demo-handle fallback chains, kept by design. */
const ALLOWLIST = new Set([
  "src/lib/session.ts", // DEMO_HANDLE @you — the boot-lane viewer identity (write lane)
  "src/lib/watch/session.ts", // DEMO_HANDLES fallback chain for route-handler writes
]);

/** Markers whose presence in a prod file means demo data can render. */
const FORBIDDEN: { marker: RegExp; why: string }[] = [
  { marker: /demo[ -]data/i, why: "demo-data label" },
  { marker: /Demo Viewer/, why: "demo viewer fallback string" },
  { marker: /Demo mode/i, why: "demo-mode toast" },
  { marker: /picsum/i, why: "picsum placeholder thumbnails" },
  { marker: /lorem/i, why: "lorem-ipsum copy" },
  { marker: /bigbuck/i, why: "Big Buck Bunny demo video" },
  { marker: /sample[-_. ]?(mp4|video)/i, why: "sample video assets" },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("WFX2-C-W demo-data purge sweep", () => {
  test("no demo markers render in the production source tree (outside the write-lane allowlist)", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (ALLOWLIST.has(file)) continue;
        const text = readFileSync(file, "utf8");
        for (const { marker, why } of FORBIDDEN) {
          if (marker.test(text)) offenders.push(`${file}: ${why} (${marker.source})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the orphaned DB-backed demo home feed (src/lib/queries.ts) is gone", () => {
    expect(existsSync("src/lib/queries.ts")).toBe(false);
  });

  test("prisma seed scripts exist only for dev (never imported from src/)", () => {
    expect(existsSync("prisma/seed.ts")).toBe(true); // dev tooling stays
    const importers: string[] = [];
    for (const file of walk("src")) {
      const text = readFileSync(file, "utf8");
      if (/from ["'].*prisma\/seed/.test(text)) importers.push(file);
    }
    expect(importers).toEqual([]);
  });

  test("live read routes never touch the local database (no seeded rows can render)", () => {
    const readRoutes = [
      "src/app/api/home/route.ts",
      "src/app/api/videos/route.ts",
      "src/app/api/search/route.ts",
      "src/app/api/search/suggest/route.ts",
      "src/app/api/trending/route.ts",
      "src/app/api/live/route.ts",
      "src/app/api/shorts/route.ts",
      "src/app/api/shorts/[id]/route.ts",
      "src/app/api/videos/[id]/route.ts",
      "src/app/api/videos/[id]/related/route.ts",
      "src/app/api/videos/[id]/live-status/route.ts",
      "src/app/api/videos/[id]/comments/[commentId]/replies/route.ts",
      "src/app/api/channel/[handle]/route.ts",
    ];
    const dbImporters: string[] = [];
    for (const route of readRoutes) {
      const text = readFileSync(route, "utf8");
      if (/from ["']@\/lib\/db["']/.test(text)) dbImporters.push(route);
    }
    expect(dbImporters).toEqual([]);
  });

  test("the DEMO_HANDLE constant is confined to the write-lane identity modules", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (ALLOWLIST.has(file)) continue;
      if (/DEMO_HANDLE/.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
