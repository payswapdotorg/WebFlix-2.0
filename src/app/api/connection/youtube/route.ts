import { NextRequest } from "next/server";
import { json } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { brokerConfigured, brokerEndpoint, brokerSecret } from "@/lib/broker";

export const dynamic = "force-dynamic";

/** The status probe must feel instant — healthz answers in well under a
 * second when the broker is alive; anything slower is offline for status
 * purposes (the action path keeps the full BROKER_TIMEOUT_MS). */
const HEALTH_TIMEOUT_MS = 5000;

/**
 * WFX2 Task 4-b — GET /api/connection/youtube: the YouTube connection
 * status for the settings surface.
 *
 * WebFlix performs YouTube write actions (like, subscribe, comment) through
 * ONE shared logged-in session — the broker's operator tab. This route asks
 * the broker's own /healthz SERVER-SIDE (the broker URL and shared secret
 * never reach the browser) and answers the honest state:
 *   { connected, tabFound, tabUrl, lastActionAt, checkedAt }
 *
 * connected = the broker answered ok AND holds the YouTube tab — the exact
 * precondition for write actions to work. NEVER a 5xx: unreachable broker,
 * missing tab, bad payload, secret mismatch — every failure shape degrades
 * to the same honest { connected: false, … } envelope with 200, because
 * "offline" is the truth that matters to the UI.
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();

  const checkedAt = new Date().toISOString();
  const disconnected = () =>
    json({ connected: false, tabFound: false, tabUrl: null, lastActionAt: null, checkedAt });

  if (!brokerConfigured()) return disconnected();

  try {
    const res = await fetch(brokerEndpoint("/healthz"), {
      headers: {
        // the brokerAction header set (src/lib/broker.ts): the shared secret
        // + the gateway's session-affinity id — harmless on a direct broker
        "x-broker-secret": brokerSecret(),
        "x-session-id": "webflix-producer",
      },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return disconnected();
    const body = (await res.json().catch(() => null)) as {
      ok?: unknown;
      tabFound?: unknown;
      tabUrl?: unknown;
      lastActionAt?: unknown;
    } | null;
    if (!body || body.ok !== true) return disconnected();
    const tabFound = body.tabFound === true;
    const tabUrl = typeof body.tabUrl === "string" && body.tabUrl ? body.tabUrl : null;
    const lastActionAt =
      typeof body.lastActionAt === "number" && Number.isFinite(body.lastActionAt)
        ? body.lastActionAt
        : typeof body.lastActionAt === "string" && body.lastActionAt
          ? body.lastActionAt
          : null;
    return json({ connected: tabFound, tabFound, tabUrl, lastActionAt, checkedAt });
  } catch {
    return disconnected();
  }
}
