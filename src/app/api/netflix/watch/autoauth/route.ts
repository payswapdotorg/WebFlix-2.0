/**
 * P46 — the automatic sign-in pairing surface for the watch lane.
 *
 * GET   : the ingest pairing token + bridge status (what the auto sign-in
 *         panel renders and the WebFlix Bridge is configured with).
 * POST  : { action: "rotate" } — mint a new pairing token (compromise
 *         recovery); old bridges stop being accepted until re-paired.
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";
import { watchGate } from "@/lib/netflix/watch-guard";

const BROKER = netflixBrokerEndpoint;

export async function GET(request: Request) {
  // P51-AUDIT (B3): the pairing surface is the operator's tool — readable
  // (the watch lane renders it) but no longer unthrottled
  const gate = await watchGate(request, "autoauth:get", { limit: 60 });
  if (gate) return gate;
  try {
    const res = await fetch(BROKER("/ingest/token"), { signal: AbortSignal.timeout(5_000) });
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
  // P51-AUDIT (B3): token rotation is privileged — same-origin + throttled
  const gate = await watchGate(request, "autoauth:rotate", { limit: 10 });
  if (gate) return gate;
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
    const res = await fetch(BROKER("/ingest/token/rotate"), {
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
