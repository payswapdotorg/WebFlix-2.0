/**
 * WFX2-W API helpers — uniform JSON envelopes + error mapping.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const forbidden = (msg = "Not allowed") => new ApiError(403, msg);
export const badRequest = (msg: string) => new ApiError(400, msg);

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
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
