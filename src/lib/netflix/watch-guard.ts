/**
 * P51-AUDIT (report §3.2 B3) — the watch-lane route guard.
 *
 * The seven /api/netflix/watch/* routes used to be the ONLY unthrottled,
 * un-gated API surface in the app: every other /api/netflix/* route runs the
 * shared rateLimit adapter, while the watch routes could drive Sandbox
 * create/kill cycles (direct E2B spend) from an anonymous loop. This guard
 * gives every watch route the same two lanes:
 *
 *  1. RATE LIMIT — the house fixed-window adapter (stand-down in tests via
 *     the youtube test-upstream idiom).
 *
 *  2. SAME-ORIGIN — browsers always attach Origin to cross-site POSTs, so a
 *     cross-site Origin (or Sec-Fetch-Site: cross-site) is rejected. Absent
 *     headers (tests, curl, same-origin GETs) pass. `ingest` additionally
 *     allows `chrome-extension:` origins — the WebFlix Bridge's service
 *     worker posts from the operator's own browser, not the site.
 */
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";

export type WatchGateFailure = NextResponse;

export async function watchGate(
  req: Request,
  bucket: string,
  opts: { limit?: number; windowMs?: number; allowExtension?: boolean } = {},
): Promise<WatchGateFailure | null> {
  const { limit = 30, windowMs = 60_000, allowExtension = false } = opts;

  if (
    !(await rateLimit(`netflix:watch:${bucket}:${req.headers.get("x-forwarded-for") ?? "local"}`, {
      limit,
      windowMs,
    }))
  ) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const origin = req.headers.get("origin");
  if (origin) {
    if (allowExtension && origin.startsWith("chrome-extension://")) return null;
    try {
      const originHost = new URL(origin).host;
      const siteHost =
        req.headers.get("x-forwarded-host") ?? new URL(req.url).host;
      if (originHost === siteHost) return null;
    } catch {
      /* malformed origin → cross-site */
    }
    return NextResponse.json(
      { error: "Cross-site requests are not accepted here." },
      { status: 403 },
    );
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site requests are not accepted here." },
      { status: 403 },
    );
  }
  return null;
}

/**
 * P51-AUDIT (B1) — defensive strip: the broker stopped disclosing
 * `sandboxId`, but an OLDER broker build on the host would still send it.
 * The app proxy must never forward the id that addresses the sandbox's CDP
 * relay to the public web.
 */
export function stripSandboxId<T extends object>(body: T): T {
  if (body && "sandboxId" in body) {
    const { sandboxId: _drop, ...rest } = body as T & { sandboxId?: unknown };
    return rest as T;
  }
  return body;
}
