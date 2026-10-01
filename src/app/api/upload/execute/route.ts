import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { BrokerError } from "@/lib/broker";
import { driveUploadExecute } from "@/lib/upload/drive";
import { getStagedUpload } from "@/lib/upload/stage";
import {
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_TITLE_MAX,
  buildUploadHandoff,
} from "@/lib/youtube/studio";
import type { UploadExecuteResponseDTO } from "@/lib/upload/flow";

export const dynamic = "force-dynamic";

/**
 * WFX2-P3-UP — POST /api/upload/execute: drive the REAL upload through the
 * Tier-2 session broker (the staged youtube.com/upload drive) with the
 * staged file, then map the result onto the honest ladder — never a fake
 * success:
 *
 *   {outcome:'published', stage, verified, videoId, watchUrl} — the drive
 *     published (verified only when the confirmation was observed in the
 *     operator tab; 'processing' = publish clicked, unconfirmed)
 *   {outcome:'fallback', reason:'broker-offline'|'broker-unauthorized',
 *     message, handoff} — the broker is OFFLINE/refused the secret: the
 *     CURRENT hand-off rung (the metadata bundle + YouTube's upload page)
 *     carries the user instead
 *   {outcome:'error', message, handoff} — the drive RAN and refused/failed
 *     honestly (stage-accurate broker error); the hand-off rung is offered
 *
 * Flow outcomes answer 200 — the outcome field is the truth; only request
 * errors (validation, unknown/expired stage) are 4xx. The broker hold can
 * run ~5 minutes (upload+processing); the route's fetch budget is the
 * helper's UPLOAD_EXECUTE_TIMEOUT_MS.
 *
 * Env: UPLOAD_STAGE_PUBLIC_ORIGIN overrides the staging URL's origin (the
 * operator tab must be able to reach it — behind proxies the request origin
 * is not always the public one; default: this request's own origin).
 */

const executeSchema = z.object({
  stageId: z.string({ message: "stageId is required" }).trim().min(1, "stageId is required"),
  title: z
    .string({ message: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(YOUTUBE_TITLE_MAX, `Title is limited to ${YOUTUBE_TITLE_MAX} characters on YouTube`),
  description: z.string().trim().max(YOUTUBE_DESCRIPTION_MAX).default(""),
  visibility: z.enum(["public", "unlisted", "private"]).default("public"),
  // carried for the honest hand-off rung (tags/thumbnail/isShort are
  // hand-off fields — the broker drive fills title/description/visibility)
  tags: z
    .array(z.string().trim().min(1))
    .max(30, "At most 30 tags")
    .default([])
    .transform((tags) => [...new Set(tags)].slice(0, 30)),
  thumbnailUrl: z
    .string()
    .trim()
    .url("Thumbnail must be an https URL")
    .refine((u) => u.startsWith("https://"), "Thumbnail must be an https URL")
    .nullable()
    .default(null),
  isShort: z.boolean().default(false),
});

/** Pull the staged-drive's stage out of a BrokerError detail (the broker's
 * 502 body nests detail.stage; the client carries it as `detail`). */
function stageFromBrokerError(err: BrokerError): string | undefined {
  const d = err.detail as { detail?: { stage?: string } } | undefined;
  return d?.detail?.stage;
}

export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (
      !(await rateLimit(`upload-execute:${req.headers.get("x-forwarded-for") ?? "local"}`, {
        limit: 20,
        windowMs: 10 * 60_000,
      }))
    ) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const parsed = executeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload metadata" },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const staged = getStagedUpload(d.stageId);
    if (!staged) {
      return NextResponse.json(
        { error: "staged file not found or expired — pick the file again" },
        { status: 400 }
      );
    }

    const origin = (
      process.env.UPLOAD_STAGE_PUBLIC_ORIGIN?.trim() || req.nextUrl.origin
    ).replace(/\/+$/, "");
    const fileUrl = `${origin}/api/upload/stage?id=${encodeURIComponent(staged.id)}`;

    const handoff = buildUploadHandoff({
      title: d.title,
      description: d.description,
      tags: d.tags,
      visibility: d.visibility,
      thumbnailUrl: d.thumbnailUrl,
      isShort: d.isShort,
    });

    const result = await driveUploadExecute({
      fileUrl,
      fileName: staged.fileName,
      title: d.title,
      description: d.description,
      visibility: d.visibility,
    });

    const noStore = { "Cache-Control": "no-store" };

    if (result instanceof BrokerError) {
      // OFFLINE / unauthorized → the CURRENT hand-off rung (honest fallback)
      if (result.kind === "offline" || result.kind === "unauthorized") {
        const dto: UploadExecuteResponseDTO = {
          outcome: "fallback",
          reason: result.kind === "offline" ? "broker-offline" : "broker-unauthorized",
          message:
            result.kind === "offline"
              ? "the session broker is offline — the hand-off below remains the honest path (YouTube owns the upload)"
              : "the broker rejected the shared secret — the hand-off below remains the honest path",
          handoff,
        };
        return NextResponse.json(dto, { headers: noStore });
      }
      // REFUSED / failed honestly (bad-request | action-failed)
      const stage = stageFromBrokerError(result);
      const dto: UploadExecuteResponseDTO = {
        outcome: "error",
        reason: result.kind,
        message: result.message,
        ...(stage ? { stage } : {}),
        handoff,
      };
      return NextResponse.json(dto, { headers: noStore });
    }

    const detail = (result.detail ?? {}) as { stage?: string; videoId?: string; watchUrl?: string; note?: string };
    if (typeof detail.videoId === "string" && typeof detail.watchUrl === "string") {
      // the script rides the UNVERIFIED note TOP-LEVEL on the wire — accept
      // it there first, detail.note as the defensive second read
      const note = typeof result.note === "string" ? result.note : detail.note;
      const dto: UploadExecuteResponseDTO = {
        outcome: "published",
        stage: detail.stage === "processing" ? "processing" : "published",
        verified: result.verified === true,
        videoId: detail.videoId,
        watchUrl: detail.watchUrl,
        ...(typeof note === "string" ? { note } : {}),
      };
      return NextResponse.json(dto, { headers: noStore });
    }

    // ok:true without a video id — claim nothing (never a fake success)
    const dto: UploadExecuteResponseDTO = {
      outcome: "error",
      reason: "unconfirmed",
      message:
        "the broker reported success without a video id — nothing is claimed; the hand-off below remains available",
      handoff,
    };
    return NextResponse.json(dto, { headers: noStore });
  } catch (err) {
    console.error("POST /upload/execute failed", err);
    return NextResponse.json({ error: "Failed to execute the upload" }, { status: 500 });
  }
}
