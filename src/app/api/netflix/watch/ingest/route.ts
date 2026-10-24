/**
 * P46 — the WebFlix Bridge ingest proxy (automatic sign-in).
 *
 * The operator's own signed-in browser (via the WebFlix Bridge extension)
 * pushes its Netflix session cookies here; the mini-service validates the
 * pairing token, applies the session to a live sandbox immediately, or queues
 * it as a strictly-validated candidate for the next play.
 */
import { NextResponse } from "next/server";

const BROKER = process.env.NETFLIX_DESKTOP_URL ?? "http://127.0.0.1:3030";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: unknown; cookies?: unknown; device?: unknown };
    if (!body || typeof body.token !== "string" || !body.cookies) {
      return NextResponse.json(
        { ok: false, applied: false, message: "Provide `token` and `cookies`." },
        { status: 400 },
      );
    }
    // 90s: the live-apply path boots nothing but does validate against Netflix
    const res = await fetch(`${BROKER}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: body.token, cookies: body.cookies, device: body.device }),
      signal: AbortSignal.timeout(90_000),
    });
    const out = await res.json();
    return NextResponse.json(out, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, applied: false, message: `playback service unreachable: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
