import { NextRequest, NextResponse } from "next/server";
import { brokerAction, brokerOk, BrokerError } from "@/lib/broker";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/read — mark the operator's notifications as read
 * on the REAL account (Tier-2). The mark-read write is broker-tier: the
 * executor opens the bell menu in the logged-in tab (the real client marks
 * seen on open) and re-reads the unseen count. No direct InnerTube replay
 * path is verified for mark-read (record_web_notifications_seen 404s —
 * probed live from this sandbox) — the broker is the honest mechanism.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const result = await brokerAction("notifications-mark-read", {});
    if (!brokerOk(result)) {
      const err = result as BrokerError;
      if (err.kind === "bad-request") {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const r = result as {
      ok: true;
      verified?: boolean;
      path?: string;
      detail?: Record<string, unknown>;
    };
    return NextResponse.json({
      ok: true,
      effect: "marked-read",
      verified: r.verified ?? false,
      path: r.path ?? null,
      detail: r.detail ?? null,
    });
  } catch (err) {
    console.error("POST /api/notifications/read failed", err);
    return NextResponse.json({ error: "Failed to mark notifications read" }, { status: 500 });
  }
}
