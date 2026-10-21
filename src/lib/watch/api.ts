/**
 * WFX2-W API helpers — uniform JSON envelopes + error mapping.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  /** WFX2-P36 — the machine-stable failure taxonomy (e.g. "youtube-not-connected"),
   * surfaced as {error, kind} so the UI can render the connect/re-auth prompts. */
  kind?: string;
  constructor(status: number, message: string, kind?: string) {
    super(message);
    this.status = status;
    if (kind) this.kind = kind;
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const forbidden = (msg = "Not allowed") => new ApiError(403, msg);
export const badRequest = (msg: string) => new ApiError(400, msg);

export function json(data: unknown, init?: ResponseInit | number) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json(
      { error: e.message, ...(e.kind ? { kind: e.kind } : {}) },
      { status: e.status },
    );
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 }
    );
  }
  console.error("[wfx2w:api]", e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
