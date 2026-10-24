/**
 * P43 — demand a fresh automatic Netflix session harvest (Apify residential
 * lane). Non-blocking; poll the session status for the outcome.
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";

const BROKER = netflixBrokerEndpoint;

export async function POST() {
  try {
    const res = await fetch(BROKER("/auth/retry"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 503 });
  }
}
