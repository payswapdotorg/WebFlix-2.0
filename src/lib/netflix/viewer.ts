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
 *  2. THE WATCH-LANE HEADER/COOKIE LANES: the `wfx2_uid` cookie and the
 *     `x-wfx2-user` header (dev/test + the logged-out clone's explicit
 *     identity) — a REAL user row must resolve, never a fallback.
 *
 * P51-AUDIT (report §3.3 F2): the demo fallback ENDS at the Netflix seam.
 * The old law fell through to `resolveViewer`, whose @demo/@you fallback
 * resolves on production too (seed-prod seeds them) — every signed-out
 * visitor then shared one read+write identity on every personal Netflix
 * surface. Anonymous is honest-empty reads / 401 writes, exactly as the
 * routes' contracts always claimed.
 *
 * Returns "" when nobody is home — callers answer honest-empty reads / the
 * 401 writes exactly as before.
 */
import { getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { resolveViewerFromHeaders } from "@/lib/watch/session";

export async function netflixViewerId(req: Request): Promise<string> {
  try {
    const sessionUser = await getSessionUser(req);
    if (sessionUser) {
      const shadow = await ensureShadowUser(sessionUser);
      return shadow.id;
    }
  } catch {
    // auth/DB trouble below → fall through to the header lanes
  }
  try {
    const viewer = await resolveViewerFromHeaders(req.headers);
    return viewer?.id ?? "";
  } catch {
    return "";
  }
}
