/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — the caller-scoped room policy DTO builder.
 *
 * TL-owned integration helper (the frozen contracts doc lists the DTO in
 * types.ts; THIS file is the only place that assembles it). Reads policy
 * columns + the caller's role/sanctions and answers the ONE question the
 * renderer may ask: "may I interact right now, and if not, why not?" —
 * computed server-side, never claimed by the client (work order §3.4).
 */
import type { LiveSanctions, LiveActor, LiveRoomPolicy } from "./permissions";
import { canModerate } from "./permissions";
import type { LiveRoomPolicyDto } from "./types";

export interface PolicyInputs {
  room: LiveRoomPolicy;
  actor: LiveActor;
  sanctions: LiveSanctions;
  /** Whether the room currently has a live (non-ended) session. */
  sessionLive: boolean;
}

export function buildPolicyDto({ room, actor, sanctions, sessionLive }: PolicyInputs): LiveRoomPolicyDto {
  const staff = canModerate(actor.role);
  let chatBlockedReason: LiveRoomPolicyDto["chatBlockedReason"] = null;
  let canChat = true;

  if (!sessionLive) {
    canChat = false;
    chatBlockedReason = "session-ended";
  } else if (sanctions.banned) {
    canChat = false;
    chatBlockedReason = "banned";
  } else if (sanctions.mutedUntil !== null) {
    canChat = false;
    chatBlockedReason = "muted";
  } else if (!room.chatEnabled && !staff) {
    canChat = false;
    chatBlockedReason = "chat-disabled";
  }

  return {
    chatEnabled: room.chatEnabled,
    reactionsEnabled: room.reactionsEnabled,
    slowModeSeconds: room.slowModeSeconds,
    guestsEnabled: room.guestsEnabled,
    giftsEnabled: room.giftsEnabled,
    actorRole: actor.role,
    canChat,
    chatBlockedReason,
  };
}
