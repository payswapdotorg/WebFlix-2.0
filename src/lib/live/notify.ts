/**
 * WFX2-LIVE-PLATFORM-1 Parity P73-3 — go-live notifications (the TikTok-
 * parity layer, docs/research/2026-10-31-webflix-live-tiktok-parity-audit.md
 * §3 P73, ADR-0012): the orphaned `Notification` model's FIRST writers.
 *
 * THE FAN-OUT LAW: a successful startSession fans out ONE Notification row
 * (kind "live" — the model's additive value; every other column's semantics
 * untouched) to the host's fan-club members, OLDEST-FIRST, capped at
 * LIVE_NOTIFY_FANOUT_MAX (200). The honest dedupe is the additive
 * (userId, liveRoomId) unique — a re-go-live on the same room never
 * duplicates rows; a member added later still hears the NEXT broadcast.
 * The fan-out is BEST-EFFORT: a failure NEVER fails the go-live it rides
 * (dynamic import keeps the rooms→notify edge acyclic; the caller awaits
 * inside a try/catch so the durable flip lands before the response).
 */
import { db } from "@/lib/db";
import { LIVE_NOTIFY_FANOUT_MAX } from "./permissions";

export async function fanOutGoLive(roomId: string, hostId: string): Promise<number> {
  const club = await db.liveFanClub.findUnique({
    where: { hostId },
    select: { id: true },
  });
  if (!club) return 0; // no club → no community to notify (the honest zero)
  const [members, host, room] = await Promise.all([
    db.liveFanClubMember.findMany({
      where: { clubId: club.id, userId: { not: hostId } },
      orderBy: { joinedAt: "asc" },
      take: LIVE_NOTIFY_FANOUT_MAX,
      select: { userId: true },
    }),
    db.user.findUnique({ where: { id: hostId }, select: { name: true } }),
    db.liveRoom.findUnique({ where: { id: roomId }, select: { title: true } }),
  ]);
  if (members.length === 0 || !room) return 0;
  // THE HONEST DEDUPE (pre-read form — SQLite createMany has no
  // skipDuplicates): members who already hold a row for THIS room are
  // excluded, so a re-go-live never duplicates. (Same-room concurrency is
  // impossible by the one-active-session-per-room law.)
  const have = await db.notification.findMany({
    where: { liveRoomId: roomId, userId: { in: members.map((m) => m.userId) } },
    select: { userId: true },
  });
  const haveIds = new Set(have.map((h) => h.userId));
  const fresh = members.filter((m) => !haveIds.has(m.userId));
  if (fresh.length === 0) return 0;
  const hostName = host?.name ?? "A creator you follow";
  const created = await db.notification.createMany({
    data: fresh.map((m) => ({
      userId: m.userId,
      kind: "live",
      title: `${hostName} is live`,
      body: room.title,
      liveRoomId: roomId,
      read: false,
    })),
  });
  return created.count;
}
