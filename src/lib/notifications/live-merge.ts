/**
 * WFX2-LIVE-PLATFORM-1 Parity P73-3 — the notification CENTER's local-live
 * merge reader (ADR-0012). The orphaned Notification model's first READER:
 * the caller's unread `live` rows (kind "live" — the go-live fan-out)
 * prepend the YouTube broker feed, bounded (LOCAL_LIVE_BOUND = 10), with
 * the room deep link riding the additive liveRoomId. THE HONEST FALLBACK:
 * any DB trouble answers ZERO local rows — the broker feed still flows
 * (never a fake empty inbox, never a fake merge).
 */
import { db } from "@/lib/db";
import type { NotificationDTO } from "@/lib/types";

/** How many local unread live rows prepend the broker feed. */
export const LOCAL_LIVE_BOUND = 10;

/** The additive deep link — NotificationDTO grows liveRoomId (optional). */
export type MergedNotification = NotificationDTO & { liveRoomId?: string | null };

/**
 * The caller's unread local live rows, mapped into the bell/center item
 * shape. The host identity resolves at read time (the no-FK law on the
 * room side); a missing room (deleted mid-flight) drops the row honestly.
 */
export async function localLiveNotifications(userId: string): Promise<MergedNotification[]> {
  try {
    const rows = await db.notification.findMany({
      where: { userId, kind: "live", read: false, liveRoomId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: LOCAL_LIVE_BOUND,
    });
    if (rows.length === 0) return [];
    const roomIds = [...new Set(rows.map((r) => r.liveRoomId).filter(Boolean))] as string[];
    const rooms = await db.liveRoom.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, hostId: true },
    });
    const hostIds = [...new Set(rooms.map((r) => r.hostId))];
    const hosts = await db.user.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, handle: true, name: true },
    });
    const roomHost = new Map(rooms.map((r) => [r.id, r.hostId]));
    const hostById = new Map(hosts.map((h) => [h.id, h]));
    return rows
      .filter((r) => r.liveRoomId && roomHost.has(r.liveRoomId))
      .map((r) => {
        const roomId = r.liveRoomId as string;
        const host = hostById.get(roomHost.get(roomId) ?? "");
        return {
          id: r.id,
          kind: "live" as const,
          title: r.title,
          body: r.body,
          read: r.read,
          createdAt: r.createdAt.toISOString(),
          videoId: null,
          videoThumbnailUrl: null,
          liveRoomId: roomId,
          channel: {
            id: `live-${roomId}`,
            handle: host?.handle ?? "unknown",
            name: host?.name ?? "Unknown",
            avatarUrl: "",
            verified: false,
            // The go-live rows are not channel facts — the subscriber block
            // answers the honest zero (never a fabricated count).
            subscriberCount: 0,
            subscriberCountText: null,
          },
        };
      });
  } catch (err) {
    // DB trouble → the honest fallback: zero local rows, broker feed only.
    console.error("local live notification read failed", err);
    return [];
  }
}
