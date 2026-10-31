/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 (lane 2-a) — presence heartbeats.
 *
 * A heartbeat upserts the caller's LiveParticipant row on the ACTIVE session
 * (state "connected", lastSeenAt now). The update branch preserves the
 * existing role (a host row stays host — minted by the session start path —
 * and therefore never counts as a viewer); a fresh row is created as
 * "viewer" (guests land with the Phase 3 invite path).
 *
 * Viewer counts are APPROXIMATE by law: only rows with role "viewer",
 * state "connected" and lastSeenAt inside PRESENCE_WINDOW_MS count.
 */
import { db } from "@/lib/db";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { rateLimit } from "@/lib/youtube/cache";
import {
  activeSessionFor,
  liveActorFor,
  PRESENCE_WINDOW_MS,
  RATE_LIMITS,
  roomPolicyFor,
} from "./permissions";
import { publishLiveEvent } from "./hub";
import { LiveDomainError } from "./rooms";
import type { LivePresenceDto } from "./types";

/**
 * Connected viewers on a session: role "viewer" + state "connected" +
 * lastSeenAt inside the presence window. Host/guest rows never count; a
 * viewer whose heartbeats went stale (past PRESENCE_WINDOW_MS) drops out.
 */
export async function connectedViewerCount(sessionId: string): Promise<number> {
  return db.liveParticipant.count({
    where: {
      sessionId,
      role: "viewer",
      state: "connected",
      lastSeenAt: { gt: new Date(Date.now() - PRESENCE_WINDOW_MS) },
    },
  });
}

/**
 * Presence heartbeat. Gates: unauthenticated → not-found → not-live →
 * rate-limited → upsert → server-computed snapshot.
 */
export async function heartbeat(
  roomId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<LivePresenceDto> {
  if (!sessionUser) throw new LiveDomainError("unauthenticated");

  const room = await roomPolicyFor(roomId);
  if (!room) throw new LiveDomainError("not-found");

  const session = await activeSessionFor(roomId);
  if (!session) throw new LiveDomainError("forbidden", "not-live");

  const actor = await liveActorFor(roomId, sessionUser);

  if (!(await rateLimit(`wf:live:presence:${roomId}:${actor.id}`, RATE_LIMITS.presence))) {
    throw new LiveDomainError("rate-limited");
  }

  const now = new Date();
  await db.liveParticipant.upsert({
    where: { sessionId_userId: { sessionId: session.id, userId: actor.id } },
    create: {
      sessionId: session.id,
      userId: actor.id,
      // Host identity keeps the host rung (never a viewer row); everyone
      // else joins as "viewer". The update branch below preserves roles.
      role: actor.role === "host" ? "host" : "viewer",
      state: "connected",
      lastSeenAt: now,
    },
    update: { state: "connected", lastSeenAt: now },
  });

  const presence: LivePresenceDto = {
    sessionId: session.id,
    viewerCount: await connectedViewerCount(session.id),
  };
  // Publish law: presence changes flush to same-instance streams instantly.
  publishLiveEvent(roomId, {
    kind: "presence",
    eventId: crypto.randomUUID(),
    at: now.toISOString(),
    presence,
  });
  return presence;
}
