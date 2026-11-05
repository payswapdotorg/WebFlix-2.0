import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  getTikTokConnection,
  putTikTokConnection,
} from "@/lib/auth/tiktok-connection-store";
import { parseTikTokProfileUrl } from "@/lib/tiktok/urls";

export const dynamic = "force-dynamic";

/**
 * P94-b — POST /api/connection/tiktok/link: the INTERIM connect lane (the
 * gap report's G2) — works TODAY without a TikTok developer app. The
 * signed-in user pastes their own TikTok profile URL; the URL law parses
 * the handle and WebFlix stores the UNVERIFIED binding
 * (`mode: "profile_link"`, `status: "linked"`).
 *
 * HONESTY LAW: a profile link is NOT a TikTok authorization. It names the
 * creator identity the user manages locally (their channel page's
 * "Is this you?" affordances); it claims no provider-side capability and
 * every provider-side action stays "unsupported" (ADR 0004). A later Login
 * Kit connect (mode "oauth") upgrades the same record.
 *
 * Body: `{ profileUrl: string }` — accepts the tiktok.com profile shapes
 * (`www.tiktok.com/@handle`, `m.tiktok.com/@handle`, a bare `@handle`, or a
 * bare handle — the URL law's own parser).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return authRequiredResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).profileUrl
      : undefined;
  if (typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json(
      { error: "Missing profileUrl — paste your TikTok profile link" },
      { status: 400 },
    );
  }

  const parsed = parseTikTokProfileUrl(raw);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "That is not a TikTok profile link — paste tiktok.com/@yourhandle (a post link is not a profile)",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  // An existing binding's createdAt is preserved on re-link (the same
  // identity re-affirmed); a fresh binding starts its clock now.
  const existing = await getTikTokConnection(user.id).catch(() => null);
  const record = {
    userId: user.id,
    mode: "profile_link" as const,
    handle: parsed.handle,
    nickname: null,
    avatarUrl: null,
    openId: null,
    unionId: null,
    scope: "",
    accessTokenEnc: null,
    refreshTokenEnc: null,
    accessExpiresAt: 0,
    status: "linked" as const,
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
  };
  try {
    await putTikTokConnection(record);
  } catch {
    return NextResponse.json(
      { error: "The connection store is unreachable — try again in a moment" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    linked: { handle: record.handle, connectedAt: record.connectedAt },
  });
}
