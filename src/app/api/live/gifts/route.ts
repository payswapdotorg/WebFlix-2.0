import { NextResponse } from "next/server";
import { giftCatalog } from "@/lib/live/gifts";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/gifts — the ACTIVE gift catalogue (public, no session
 * required). The v1 catalogue self-seeds idempotently on first read (the
 * frozen sandbox law: original WebFlix names, integer DEV credits with
 * zero cash value). 200 `{ gifts: GiftCatalogItemDto[] }` sorted by
 * sortOrder.
 */
export async function GET() {
  try {
    const gifts = await giftCatalog();
    return NextResponse.json({ gifts });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live/gifts failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
