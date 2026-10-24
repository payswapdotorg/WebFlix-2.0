/**
 * P46 — the automatic sign-in pairing surface for the watch lane.
 *
 * GET   : the ingest pairing token + bridge status (what the auto sign-in
 *         panel renders and the WebFlix Bridge is configured with).
 * POST  : { action: "rotate" } — mint a new pairing token (compromise
 *         recovery); old bridges stop being accepted until re-paired.
 */
import { NextResponse } from "next/server";

const BROKER = process.env.NETFLIX_DESKTOP_URL ?? "http://127.0.0.1:3030";

export async function GET() {
  try {
    const res = await fetch(`${BROKER}/ingest/token`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json();
    return NextResponse.json(body, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { token: null, bridge: null, message: `playback service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let action: string | null = null;
  try {
    const body = (await request.json()) as { action?: string };
    action = typeof body?.action === "string" ? body.action : null;
  } catch {
    /* treated as missing */
  }
  if (action !== "rotate") {
    return NextResponse.json({ ok: false, message: "Unknown action — use { action: \"rotate\" }." }, { status: 400 });
  }
  try {
    const res = await fetch(`${BROKER}/ingest/token/rotate`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, token: null, message: `playback service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}
