/**
 * WFX2-P6-DATA — the PRODUCTION seed (Neon Postgres).
 *
 * The production deployment serves REAL YouTube data live (InnerTube/SSR);
 * the database holds only the WebFlix-local domain state. This seed is
 * deliberately MINIMAL and IDEMPOTENT (upserts, never deletes):
 *
 *   - the demo viewer users (@demo, @you) that the watch domain's
 *     resolveViewer() falls back to for every anonymous visitor — without
 *     them /api/watch/session 500s and the comments section never renders
 *     (the exact production wound this lane closes).
 *
 * Everything else (playlists, comments, view events, notifications) starts
 * EMPTY in production — every surface already carries its own honest
 * zero-state copy (the honesty law: never fabricate data).
 *
 * Run: DATABASE_URL=<neon> bunx prisma db seed --schema prisma/schema.postgres.prisma
 * (or via scripts/seed-prod.mjs from CI) — safe to re-run any time.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEMO_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="#0f0f0f"/><circle cx="44" cy="34" r="14" fill="#aaaaaa"/><path d="M18 74c4-15 14-22 26-22s22 7 26 22" fill="#aaaaaa"/></svg>`
  );

const USERS = [
  {
    handle: "demo",
    name: "Demo Viewer",
    avatarUrl: DEMO_AVATAR,
    description: "The WebFlix demo viewer — the fallback identity for anonymous sessions.",
  },
  {
    handle: "you",
    name: "Demo Viewer",
    avatarUrl: DEMO_AVATAR,
    description: "The WebFlix demo viewer — the fallback identity for anonymous sessions.",
  },
];

async function main() {
  for (const u of USERS) {
    await db.user.upsert({
      where: { handle: u.handle },
      update: { name: u.name, avatarUrl: u.avatarUrl, description: u.description },
      create: u,
    });
    console.log(`[seed-prod] user @${u.handle} ensured`);
  }
  const count = await db.user.count();
  console.log(`[seed-prod] done — ${count} user(s) in the production DB`);
}

main()
  .catch((e) => {
    console.error("[seed-prod] failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
