import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getAuthUser, normalizeEmail, putAuthUser, type WfAuthUser } from "@/lib/auth-store";
import { hashPassword } from "@/lib/scrypt";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSessionJWT } from "@/lib/jwt";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().min(3).email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = rateLimit(`studio:sign-up:${ip}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Enter a valid email and a password of at least 8 characters." }, { status: 400 });

  const email = normalizeEmail(parsed.data.email);
  const existing = await getAuthUser(email);
  if (existing) return NextResponse.json({ ok: false, error: "An account with this email already exists — sign in instead." }, { status: 409 });

  // Same wf:auth:user:<email> schema as the main app (P2-AU) — accounts work on both apps.
  const user: WfAuthUser = {
    id: randomUUID(),
    email,
    displayName: parsed.data.displayName ?? email.split("@")[0],
    passwordHash: hashPassword(parsed.data.password),
    avatarSeed: randomBytes(8).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  await putAuthUser(user);

  const token = await signSessionJWT({ sub: user.id, email: user.email, name: user.displayName, seed: user.avatarSeed }, env.AUTH_SECRET);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SEC,
  });
  return res;
}
