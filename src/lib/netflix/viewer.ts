/**
 * P49 — the identity law for the Netflix PERSONAL surfaces (My List,
 * Continue Watching, the title page's list state).
 *
 * Two identity rungs, in order:
 *  1. THE SIGNED-IN WEBFLIX IDENTITY (P2-AU): the NextAuth session resolves
 *     through the same `getSessionUser` decode every gated route uses, then
 *     bridges to its shadow prisma User via `ensureShadowUser` — the exact
 *     bridge the local comment rung rides. Netflix rows belong to the
 *     account, not to whoever the demo fallback happens to be.
 *  2. THE WATCH-LANE FALLBACK: `resolveViewer` (the wfx2_uid cookie /
 *     x-wfx2-user header lanes and the seeded demo user) — the pre-P49
 *     behavior, preserved for dev/test and the logged-out clone.
 *
 * Returns "" when nobody is home (the honest anonymous viewer) — callers
 * answer honest-empty reads / the 401 writes exactly as before.
 */
import { getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { resolveViewer } from "@/lib/watch/session";

export async function netflixViewerId(req: Request): Promise<string> {
  try {
    const sessionUser = await getSessionUser(req);
    if (sessionUser) {
      const shadow = await ensureShadowUser(sessionUser);
      return shadow.id;
    }
  } catch {
    // auth/DB trouble below → fall through to the legacy lanes
  }
  const viewer = await resolveViewer(req.headers);
  return viewer.id;
}
