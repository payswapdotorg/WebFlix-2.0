/**
 * P43 — the Netflix in-app playback session API (WebFlix Netflix Desktop).
 *
 * POST : { videoId? } — kick provisioning + navigate to the watch deep link
 *        (non-blocking; poll GET for phase). Proxies the netflix-desktop
 *        mini-service (cloud desktop with a signed-in Netflix session).
 * GET  : current session status (phase, streamUrl).
 *
 * P51-AUDIT (report §3.2 B3/B1): rate-limited + same-origin like every other
 * netflix route, and the proxied status NEVER carries `sandboxId` — the id
 * addresses the sandbox's public CDP relay.
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";
import { watchGate, stripSandboxId } from "@/lib/netflix/watch-guard";

const BROKER = netflixBrokerEndpoint;

export async function GET(request: Request) {
  const gate = await watchGate(request, "session:get", { limit: 120 });
  if (gate) return gate;
  try {
    const res = await fetch(BROKER("/healthz"), { signal: AbortSignal.timeout(5_000) });
    const body = (await res.json()) as object;
    return NextResponse.json(stripSandboxId(body), { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { phase: "unreachable", message: `netflix-desktop service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await watchGate(request, "session:post", { limit: 20 });
  if (gate) return gate;
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
    const res = await fetch(BROKER("/session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(path ? { path } : videoId ? { videoId } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as object;
    return NextResponse.json(stripSandboxId(body), { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { phase: "unreachable", message: `netflix-desktop service unreachable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}
