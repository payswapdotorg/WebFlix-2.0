import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionJWT } from "@/lib/jwt";
import { isPublicPath } from "@/lib/auth-gate";
import { env } from "@/lib/env";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionJWT(token, env.AUTH_SECRET) : null;
  if (session) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
