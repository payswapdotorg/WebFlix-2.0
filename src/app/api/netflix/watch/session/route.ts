/**
 * P43 — the Netflix in-app playback session API (WebFlix Netflix Desktop).
 *
 * POST : { videoId? } — kick provisioning + navigate to the watch deep link
 *        (non-blocking; poll GET for phase). Proxies the netflix-desktop
 *        mini-service (cloud desktop with a signed-in Netflix session).
 * GET  : current session status (phase, streamUrl, sandboxId).
 */
import { NextResponse } from "next/server";

const BROKER = process.env.NETFLIX_DESKTOP_URL ?? "http://127.0.0.1:3030";

export async function GET() {
  try {
    const res = await fetch(`${BROKER}/healthz`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json();
    return NextResponse.json(body, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { phase: "unreachable", message: `netflix-desktop service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let videoId: number | null = null;
  let path: string | null = null;
  try {
    const body = (await request.json()) as { videoId?: unknown; path?: unknown };
    const n = Number(body?.videoId);
    if (Number.isInteger(n) && n > 0) videoId = n;
    if (typeof body?.path === "string" && /^\/[A-Za-z0-9/_?=&.~-]*$/.test(body.path)) {
      path = body.path; // Netflix Live lane (whitelisted netflix.com path)
    }
  } catch {
    /* empty body = just ensure the session */
  }
  try {
    const res = await fetch(`${BROKER}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(path ? { path } : videoId ? { videoId } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { phase: "unreachable", message: `netflix-desktop service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}
