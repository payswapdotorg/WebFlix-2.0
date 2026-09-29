import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/notifications/read — mark every notification as read. */
export async function POST() {
  try {
    const user = await getDemoUser();
    const result = await db.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ marked: result.count });
  } catch (err) {
    console.error("POST /api/notifications/read failed", err);
    return NextResponse.json({ error: "Failed to mark notifications read" }, { status: 500 });
  }
}
