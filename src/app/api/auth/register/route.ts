import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth/users";
import { UserStoreUnavailableError } from "@/lib/auth/user-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register { email, password, displayName? }
 *
 * Creates a WEBFLIX identity (never a YouTube account — the architecture
 * law). Validation: email shape + password ≥ 8 chars + email uniqueness.
 * Responses:
 *   201 { user: { id, email, displayName, avatarSeed } }
 *   400 { error, code: "invalid-email" | "weak-password" | "invalid-display-name" }
 *   409 { error, code: "duplicate-email" }
 *   503 { error } — the durable user store is unreachable (honest failure)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const result = await registerUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
    if (result.ok) {
      return NextResponse.json({ user: result.user }, { status: 201 });
    }
    const status = result.code === "duplicate-email" ? 409 : 400;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  } catch (err) {
    if (err instanceof UserStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("POST /api/auth/register failed", err);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
