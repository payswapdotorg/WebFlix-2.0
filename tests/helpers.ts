/**
 * WFX2-W test helpers — isolated test database + per-file fresh seed.
 *
 * The suite refuses to run against the dev database: DATABASE_URL must
 * point at db/watch-test.db (set by `bun run test`).
 */
import { beforeAll } from "bun:test";
import { spawnSync } from "node:child_process";

let schemaReady = false;

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("watch-test")) {
    throw new Error(
      "Refusing to run tests against the dev database — run via `bun run test` (DATABASE_URL=db/watch-test.db)"
    );
  }
  if (!schemaReady) {
    // ensure the schema exists on the test db (no-op when already in sync)
    const probe = await (await import("../src/lib/db")).db.user.count().catch(() => null);
    if (probe === null) {
      const res = spawnSync(
        "bunx",
        ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--accept-data-loss", "--skip-generate"],
        { stdio: "inherit", env: process.env }
      );
      if (res.status !== 0) throw new Error("prisma db push failed for the test database");
    }
    schemaReady = true;
  }
  const { db } = await import("../src/lib/db");
  const { seedWatch } = await import("../prisma/seed-watch");
  await seedWatch(db); // seedWatch wipes first → fresh state per file
}

/** Call at the top of each test file: fresh seeded database (not a React
 * hook — named setup* to avoid tripping rules-of-hooks). */
export function setupTestDb() {
  beforeAll(() => resetDb());
}

/** Look up seeded entities by slug/handle. */
export async function fixtures() {
  const { db } = await import("../src/lib/db");
  const [bbb, sintel, blender, demo, pip, blenderStudioUser, mocapmike, gwenwatches] =
    await Promise.all([
      db.video.findFirstOrThrow({ where: { title: { contains: "Big Buck Bunny" } } }),
      db.video.findFirstOrThrow({ where: { title: { contains: "Sintel" } } }),
      db.channel.findUniqueOrThrow({ where: { handle: "blenderstudio" } }),
      db.user.findUniqueOrThrow({ where: { handle: "demo" } }),
      db.user.findUniqueOrThrow({ where: { handle: "pip" } }),
      db.user.findUniqueOrThrow({ where: { handle: "blenderstudio" } }),
      db.user.findUniqueOrThrow({ where: { handle: "mocapmike" } }),
      db.user.findUniqueOrThrow({ where: { handle: "gwenwatches" } }),
    ]);
  return { bbb, sintel, blender, demo, pip, blenderStudioUser, mocapmike, gwenwatches };
}
