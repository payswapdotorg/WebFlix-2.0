import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { RATE_LIMITS } from "@/lib/live/permissions";
import { deriveOpsOverview, opsRateLimit } from "@/lib/live/ops";
import { OPS_ADMIN_ENV, resolveOpsAdmin } from "@/lib/live/ops-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/ops/overview?windowMs= — the §4H operations dashboard feed
 * (ADR-0009, frozen contracts §3).
 *
 * The ops-gate law resolves FIRST and fails closed: 401 signed out →
 * 503 not-configured (the explainer names the env) → 403 not on the
 * allowlist → 200. The overview itself is derived in ONE place from
 * durable rows only; windowMs is clamped to 1h..30d (default 24h);
 * rate-limited via the capture path.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    const gate = await resolveOpsAdmin(sessionUser);
    switch (gate.status) {
      case "unauthenticated":
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      case "not-configured":
        return NextResponse.json(
          {
            error: "ops-admin-not-configured",
            message: `Operations are locked until the deployment declares ${OPS_ADMIN_ENV}.`,
          },
          { status: 503 },
        );
      case "forbidden":
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      case "admin":
        break;
    }

    const limited = await opsRateLimit(
      "opsOverview",
      `wf:live:ops-overview:${gate.admin.id}`,
      RATE_LIMITS.opsOverview,
    );
    if (!limited) {
      return NextResponse.json({ error: "rate-limited" }, { status: 429 });
    }

    const url = new URL(req.url);
    const overview = await deriveOpsOverview(url.searchParams.get("windowMs"));
    return NextResponse.json(overview);
  } catch (err) {
    console.error("GET /api/live/ops/overview failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
