/// <reference types="bun-types" />
/**
 * P51-AUDIT (report §3.3 F1) — the schema-parity drift guard.
 *
 * The vercel build literally copies `prisma/schema.postgres.prisma` over
 * `prisma/schema.prisma` and runs `prisma db push` (vercel.json buildCommand).
 * When the P49 `NetflixWatchEvent` model landed only in the dev schema, prod
 * pushed a schema without it and every `/api/netflix/progress` call 502'd on
 * Neon — silently, because the rail degrades to absence.
 *
 * THE LAW: every `model` declared in the dev schema MUST exist in the
 * postgres schema. New models are additive in both files or the battery
 * goes red here — this class of prod break can never silently recur.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function declaredModels(path: string): Map<string, string> {
  const src = readFileSync(path, "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    out.set(m[1], path);
  }
  return out;
}

describe("prisma schema parity (dev ↔ postgres)", () => {
  const dev = declaredModels("prisma/schema.prisma");
  const pg = declaredModels("prisma/schema.postgres.prisma");

  test("both schema variants exist to compare", () => {
    expect(dev.size).toBeGreaterThan(0);
    expect(pg.size).toBeGreaterThan(0);
  });

  test("every dev model exists in the postgres schema (the build pushes postgres)", () => {
    const missing = [...dev.keys()].filter((m) => !pg.has(m));
    expect(missing).toEqual([]);
  });

  test("the P49 Continue Watching table is real in BOTH schemas (the audited prod break)", () => {
    for (const [name, src] of [
      ["dev", readFileSync("prisma/schema.prisma", "utf8")],
      ["postgres", readFileSync("prisma/schema.postgres.prisma", "utf8")],
    ] as const) {
      const block = src.slice(src.indexOf(`model NetflixWatchEvent {`));
      expect(block.length, `${name}: NetflixWatchEvent model missing`).toBeGreaterThan(0);
      expect(
        block.includes("@@index([userId, lastPlayedAt])"),
        `${name}: the (userId, lastPlayedAt) index the rail queries with must exist`
      ).toBe(true);
    }
  });
});
