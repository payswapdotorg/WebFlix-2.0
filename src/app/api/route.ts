import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, app: "webflix-2.0", lane: "wfx2/boot-shell" });
}
