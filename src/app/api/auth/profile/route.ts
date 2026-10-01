import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { updateProfile } from "@/lib/auth/users";
import { UserStoreUnavailableError } from "@/lib/auth/user-store";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/auth/profile { displayName?, avatarSeed? }
 *
 * Updates the signed-in WebFlix identity (the account page's identity
 * card). The email is the immutable identity key. Guests get the uniform
 * 401 (the gate — the store is never touched for them).
 * Responses:
 *   200 { user } | 400 { error, code } | 401 { error: "unauthenticated" }
 */
export async function PATCH(req: NextRequest) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return authRequiredResponse();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const result = await updateProfile(sessionUser.email, {
      displayName: body.displayName,
      avatarSeed: body.avatarSeed,
    });
    if (result.ok) {
      return NextResponse.json({ user: result.user });
    }
    if (result.code === "not-found") {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 404 });
    }
    return NextResponse.json({ error: result.message, code: result.code }, { status: 400 });
  } catch (err) {
    if (err instanceof UserStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("PATCH /api/auth/profile failed", err);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
