/**
 * WFX2-W demo identity resolution.
 *
 * The watch API is user-aware: it resolves the viewer from
 *   1. the `x-wfx2-user` header (a user id or handle), or
 *   2. the `wfx2_uid` cookie (a user id — established by GET /api/watch/session)
 * and falls back to the seeded demo user (@demo) so the clone works
 * logged-out, exactly like youtube.com's anonymous watch page.
 */
import { db } from "@/lib/db";
import type { ViewerDto } from "./types";

const DEMO_HANDLE = "demo";
export const VIEWER_COOKIE = "wfx2_uid";
export const VIEWER_HEADER = "x-wfx2-user";

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      if (key) out[key] = value;
    }
  }
  return out;
}

/** Resolve the viewer from request headers; null means "fall back to demo". */
export async function resolveViewerFromHeaders(
  headers: Headers
): Promise<ViewerDto | null> {
  const raw = headers.get(VIEWER_HEADER) ?? null;
  const cookies = parseCookies(headers.get("cookie"));
  const cookieId = cookies[VIEWER_COOKIE] ?? null;

  for (const candidate of [raw, cookieId]) {
    if (!candidate) continue;
    const user = await db.user.findFirst({
      where: { OR: [{ id: candidate }, { handle: candidate.toLowerCase() }] },
    });
    if (user) return toViewerDto(user);
  }
  return null;
}

/** Resolve the viewer with the demo fallback (the route-handler entry point). */
export async function resolveViewer(headers: Headers): Promise<ViewerDto> {
  const resolved = await resolveViewerFromHeaders(headers);
  if (resolved) return resolved;
  const demo = await db.user.findUnique({ where: { handle: DEMO_HANDLE } });
  if (!demo) {
    throw new Error("Demo user missing — run `bun run db:seed` (prisma/seed-watch.ts)");
  }
  return toViewerDto(demo);
}

export function toViewerDto(u: {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}): ViewerDto {
  return { id: u.id, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl };
}
