/**
 * P43 — viewer release: marks the session active-window so the idle teardown
 * clock stays honest (called when the watch view unmounts).
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";
import { watchGate } from "@/lib/netflix/watch-guard";

const BROKER = netflixBrokerEndpoint;

export async function POST(request: Request) {
  // P51-AUDIT (B3): the watch lane is no longer the unthrottled surface
  const gate = await watchGate(request, "release", { limit: 30 });
  if (gate) return gate;
  try {
    await fetch(BROKER("/session/release"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* best effort */
  }
  return NextResponse.json({ ok: true });
}
