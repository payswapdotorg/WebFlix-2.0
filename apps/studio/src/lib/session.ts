import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionJWT } from "./jwt";
import { env } from "./env";

export interface StudioSession { userId: string; email: string; name: string; seed: string }

export async function getSession(): Promise<StudioSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionJWT(token, env.AUTH_SECRET);
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email, name: payload.name, seed: payload.seed };
}
