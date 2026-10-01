import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, normalizeEmail } from "@/lib/auth-store";
import { verifyPassword } from "@/lib/scrypt";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSessionJWT } from "@/lib/jwt";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().min(3).email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = rateLimit(`studio:sign-in:${ip}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter a valid email and password." }, { status: 400 });

  const email = normalizeEmail(parsed.data.email);
  const user = await getAuthUser(email);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
  }

  const token = await signSessionJWT(
    { sub: user.id, email: user.email, name: user.displayName, seed: user.avatarSeed },
    env.AUTH_SECRET
  );
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SEC,
  });
  return res;
}
