/**
 * P44 — the watch-view restart lane: tear down the current cloud-desktop
 * session so the next kick provisions a fresh one. Best-effort — always 200
 * (the view re-kicks provisioning right after; the broker degrades honestly
 * through its own phase machine if the teardown fails).
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";
import { watchGate } from "@/lib/netflix/watch-guard";

const BROKER = netflixBrokerEndpoint;

export async function POST(request: Request) {
  // P51-AUDIT (B3/M7): restart drives Sandbox kill+create — direct E2B spend
  const gate = await watchGate(request, "restart", { limit: 10 });
  if (gate) return gate;
  try {
    await fetch(BROKER("/session/restart"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* best effort — the re-kick surfaces the real state */
  }
  return NextResponse.json({ ok: true });
}
