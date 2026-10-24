/**
 * P44 — the watch-view restart lane: tear down the current cloud-desktop
 * session so the next kick provisions a fresh one. Best-effort — always 200
 * (the view re-kicks provisioning right after; the broker degrades honestly
 * through its own phase machine if the teardown fails).
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";

const BROKER = netflixBrokerEndpoint;

export async function POST() {
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
