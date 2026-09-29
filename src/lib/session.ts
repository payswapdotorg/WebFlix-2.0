import { db } from "@/lib/db";
import type { User } from "@prisma/client";

/** Boot lane session: a single demo user (auth ships in a later wave). */
export const DEMO_HANDLE = "you";

export async function getDemoUser(): Promise<User> {
  const user = await db.user.findUnique({ where: { handle: DEMO_HANDLE } });
  if (!user) throw new Error(`Demo user @${DEMO_HANDLE} missing — run: bun run db:seed`);
  return user;
}
