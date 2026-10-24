/**
 * P43 — viewer release: marks the session active-window so the idle teardown
 * clock stays honest (called when the watch view unmounts).
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";

const BROKER = netflixBrokerEndpoint;

export async function POST() {
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
