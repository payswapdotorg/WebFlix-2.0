/**
 * WFX2-W demo identity resolution.
 *
 * The watch API is user-aware: it resolves the viewer from
 *   1. the `x-wfx2-user` header (a user id or handle), or
 *   2. the `wfx2_uid` cookie (a user id — established by GET /api/watch/session)
 * and falls back to the seeded demo user (@demo) so the clone works
 * logged-out, exactly like youtube.com's anonymous watch page.
 *
 * WFX2-P6-CR — TOTAL, NEVER-THROWING: when the DB is unreachable or the
 * fallback users are missing, resolveViewer degrades to the honest
 * ANONYMOUS viewer instead of throwing (the watch session route must never
 * 500 — comments render for logged-out viewers too, YouTube parity).
 */
import { db } from "@/lib/db";
import type { ViewerDto } from "./types";

const DEMO_HANDLES = ["demo", "you"]; // seed-watch's @demo, boot-seed's @you — one canonical fallback chain
export const VIEWER_COOKIE = "wfx2_uid";
export const VIEWER_HEADER = "x-wfx2-user";

/**
 * The honest anonymous viewer — youtube.com's logged-out watch page. An
 * empty id means "no identity"; callers must not persist it (the session
 * route skips the wfx2_uid cookie for it).
 */
export const ANON_VIEWER: ViewerDto = { id: "", handle: "@guest", name: "", avatarUrl: "" };

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

/** Resolve the viewer from request headers; null means "fall back to demo".
 * WFX2-P6-CR: a DB failure resolves to null (anonymous) — never throws. */
export async function resolveViewerFromHeaders(
  headers: Headers
): Promise<ViewerDto | null> {
  const raw = headers.get(VIEWER_HEADER) ?? null;
  const cookies = parseCookies(headers.get("cookie"));
  const cookieId = cookies[VIEWER_COOKIE] ?? null;

  try {
    for (const candidate of [raw, cookieId]) {
      if (!candidate) continue;
      const user = await db.user.findFirst({
        where: { OR: [{ id: candidate }, { handle: candidate.toLowerCase() }] },
      });
      if (user) return toViewerDto(user);
    }
  } catch {
    return null; // DB unreachable → the anonymous degrade downstream
  }
  return null;
}

/**
 * Resolve the viewer with the demo fallback (the route-handler entry
 * point). WFX2-P6-CR: TOTAL — when the DB is unreachable or every fallback
 * user is missing, degrades to the honest anonymous viewer instead of
 * throwing (the callers' UIs already carry guest states downstream).
 */
export async function resolveViewer(headers: Headers): Promise<ViewerDto> {
  try {
    const resolved = await resolveViewerFromHeaders(headers);
    if (resolved) return resolved;
    for (const handle of DEMO_HANDLES) {
      const demo = await db.user.findUnique({ where: { handle } });
      if (demo) return toViewerDto(demo);
    }
  } catch {
    // DB unreachable → anonymous (never a 500 up the stack)
  }
  return ANON_VIEWER;
}

export function toViewerDto(u: {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
}): ViewerDto {
  return { id: u.id, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl };
}
