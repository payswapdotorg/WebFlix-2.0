import { NextRequest } from "next/server";
import { json } from "@/lib/watch/api";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { brokerConfigured, brokerEndpoint, brokerSecret } from "@/lib/broker";
import { directAuthConfigured } from "@/lib/youtube-direct";
import { innertube } from "@/lib/youtube/innertube";
import { extractOperatorChannelFromAccountMenu } from "@/lib/youtube/operator";
import { getCookieHeader } from "@/lib/youtube/session";

export const dynamic = "force-dynamic";

/** The status probe must feel instant — healthz answers in well under a
 * second when the broker is alive; anything slower is offline for status
 * purposes (the action path keeps the full BROKER_TIMEOUT_MS). */
const HEALTH_TIMEOUT_MS = 5000;

/**
 * WFX2 Task 4-b → P33-DIRECT-ACTIONS — GET /api/connection/youtube: the
 * YouTube connection status for the settings surface.
 *
 * P33 (the operator's 2026-10-21 directive: "my youtube sessions are read
 * only which means I can't perform any action … if we aim to become the
 * main interface for youtube.com, we can't require users to go back to
 * youtube.com before they can like, comment, etc.") — the connection truth
 * is now DIRECT-FIRST:
 *
 *   mode "direct"  — the app's own server-side YouTube session (YT_COOKIES
 *                    with SAPISID) performs like / subscribe / comment /
 *                    watch-later writes server-side. `sessionServed` is the
 *                    LIVE verdict of an account/account_menu probe (a 200
 *                    that answers the signed-in menu — the same served-
 *                    detection the P22-B operator ladder verified live);
 *                    a configured session that YouTube won't serve is the
 *                    honest "needs attention" state, never "connected".
 *   mode "broker"  — no direct session, but the optional connected browser
 *                    (the operator-tab broker) holds a youtube.com tab —
 *                    the Task 4-b truth, now the FALLBACK tier.
 *   mode "none"    — neither tier answers; actions are unavailable.
 *
 * The secondary `broker` field (present when a broker is configured) lets
 * the card state honestly which few actions (dislike, bell preferences)
 * still ride the connected browser and whether it's reachable.
 *
 * NEVER a 5xx: every failure shape degrades to the same honest envelope
 * with 200, because "offline" is the truth that matters to the UI.
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();

  const checkedAt = new Date().toISOString();

  // the secondary broker reachability probe (the card's honest note about
  // the few broker-tier actions left) — parallel-cheap, non-blocking truth
  const brokerProbe = brokerConfigured()
    ? await probeBroker().catch(() => ({ connected: false, tabFound: false }))
    : null;

  if (directAuthConfigured()) {
    const cookies = getCookieHeader() ?? "";
    let sessionServed = false;
    try {
      const menu = await innertube("account/account_menu", {}, {
        cookies,
        timeoutMs: HEALTH_TIMEOUT_MS,
        extraRetries: 0,
        // a caller-owned abort caps the WHOLE probe (initial + the helper's
        // single built-in retry) at one 5s status budget
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      // the served-detection law (operator.ts rung 1, verified live
      // 2026-10-11): the PUBLIC variant of the menu carries zero account
      // rows — a served session answers the operator's own channel ref.
      sessionServed = extractOperatorChannelFromAccountMenu(menu) !== null;
    } catch {
      sessionServed = false;
    }
    return json({
      connected: sessionServed,
      mode: "direct" as const,
      sessionServed,
      ...(brokerProbe
        ? { broker: { connected: brokerProbe.connected, tabFound: brokerProbe.tabFound } }
        : {}),
      checkedAt,
    });
  }

  if (brokerProbe?.connected) {
    // the old Task 4-b truth, now the fallback tier — the fields the broker
    // card renders (tab context + last action)
    const detail = brokerProbe as {
      connected: boolean;
      tabFound: boolean;
      tabUrl: string | null;
      lastActionAt: string | number | null;
    };
    return json({
      connected: true,
      mode: "broker" as const,
      tabFound: detail.tabFound,
      tabUrl: detail.tabUrl,
      lastActionAt: detail.lastActionAt,
      checkedAt,
    });
  }

  return json({
    connected: false,
    mode: "none" as const,
    tabFound: false,
    tabUrl: null,
    lastActionAt: null,
    ...(brokerProbe
      ? { broker: { connected: brokerProbe.connected, tabFound: brokerProbe.tabFound } }
      : {}),
    checkedAt,
  });
}

/** The broker healthz probe (the Task 4-b body, verbatim semantics). */
async function probeBroker(): Promise<{
  connected: boolean;
  tabFound: boolean;
  tabUrl: string | null;
  lastActionAt: string | number | null;
}> {
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
  if (!res.ok) {
    return { connected: false, tabFound: false, tabUrl: null, lastActionAt: null };
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: unknown;
    tabFound?: unknown;
    tabUrl?: unknown;
    lastActionAt?: unknown;
  } | null;
  if (!body || body.ok !== true) {
    return { connected: false, tabFound: false, tabUrl: null, lastActionAt: null };
  }
  const tabFound = body.tabFound === true;
  const tabUrl = typeof body.tabUrl === "string" && body.tabUrl ? body.tabUrl : null;
  const lastActionAt =
    typeof body.lastActionAt === "number" && Number.isFinite(body.lastActionAt)
      ? body.lastActionAt
      : typeof body.lastActionAt === "string" && body.lastActionAt
        ? body.lastActionAt
        : null;
  return { connected: tabFound, tabFound, tabUrl, lastActionAt };
}
