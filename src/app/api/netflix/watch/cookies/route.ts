/**
 * P43 — operator-assisted Netflix auth: paste session cookies from the
 * operator's own logged-in browser (the guaranteed path when Netflix's
 * anti-bot wall blocks cloud sign-ins). Accepts a raw Cookie header string
 * or a JSON cookie array; the mini-service validates against the live
 * session and caches it.
 */
import { NextResponse } from "next/server";
import { netflixBrokerEndpoint } from "@/lib/netflix/broker";

const BROKER = netflixBrokerEndpoint;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cookies?: unknown };
    if (!body?.cookies || (typeof body.cookies !== "string" && !Array.isArray(body.cookies))) {
      return NextResponse.json({ ok: false, message: "Provide `cookies` (raw Cookie header string or JSON array)." }, { status: 400 });
    }
    const res = await fetch(BROKER("/cookies"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cookies: body.cookies }),
      signal: AbortSignal.timeout(60_000),
    });
    const out = await res.json();
    return NextResponse.json(out, { status: res.status });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 502 });
  }
}
