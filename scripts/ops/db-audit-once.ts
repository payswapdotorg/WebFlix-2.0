/**
 * One-shot DB seam audit (WFX2 window work): the station truth in one read.
 * Pins webflix2.db EXPLICITLY (the seam law — never trust ambient .env).
 * Run: bun scripts/ops/db-audit-once.ts
 */
process.env.DATABASE_URL = "file:../db/webflix2.db";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [users, channels, videos] = [
    await db.user.count(),
    await db.channel.count(),
    await db.video.count(),
  ];
  console.log("USERS:", users, "CHANNELS:", channels, "VIDEOS:", videos);

  const you = await db.user.findUnique({ where: { handle: "you" } });
  console.log("@you exists:", Boolean(you));

  const all = await db.channel.findMany({
    select: { id: true, name: true, handle: true, _count: { select: { videos: true } } },
  });
  const empty = all.filter((c) => !c.handle.trim());
  console.log("HANDLE-LESS CHANNELS:", empty.length, "of", all.length);
  for (const c of empty.slice(0, 12)) {
    console.log("  -", JSON.stringify({ name: c.name, handle: JSON.stringify(c.handle), videos: c._count.videos }));
  }
}

main()
  .catch((e) => {
    console.error("AUDIT FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
