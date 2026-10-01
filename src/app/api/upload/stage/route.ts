import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  STAGE_MAX_BYTES_PER_FILE,
  getStagedUpload,
  stageUpload,
} from "@/lib/upload/stage";

export const dynamic = "force-dynamic";

/**
 * WFX2-P3-UP — the staged-file carrier for the real upload drive.
 *
 * POST /api/upload/stage (auth-gated, multipart "file"): the picked video's
 * bytes enter the in-memory staging store behind an unguessable UUID →
 * {ok, stageId, fileName, sizeBytes}. No upload is claimed here — the
 * publish itself happens through the broker drive (/api/upload/execute).
 *
 * GET /api/upload/stage?id=… : the staged bytes back out, CORS-open. The
 * consumer is the OPERATOR TAB's page context (a cross-origin fetch from
 * youtube.com, exactly the post-create image pattern) — it carries no
 * WebFlix cookies, so the gate is the unguessable id + the short TTL +
 * the size/entry caps instead of a session. Nothing is persisted; expiry
 * is honest (404).
 */

const VIDEO_EXTENSIONS: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".ts": "video/mp2t",
};

function contentTypeOf(file: File): string | null {
  if (file.type && /^video\//i.test(file.type)) return file.type;
  const name = (file.name || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot > -1 && dot < name.length - 1) {
    const mime = VIDEO_EXTENSIONS[name.slice(dot)];
    if (mime) return mime;
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (
      !(await rateLimit(`upload-stage:${req.headers.get("x-forwarded-for") ?? "local"}`, {
        limit: 30,
      }))
    ) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "body must be multipart/form-data with a file field" },
        { status: 400 }
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "the picked file is empty" }, { status: 400 });
    }
    if (file.size > STAGE_MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        {
          error: `the file exceeds the ${Math.floor(
            STAGE_MAX_BYTES_PER_FILE / (1024 * 1024)
          )}MB staging cap — use the hand-off flow for very large uploads`,
        },
        { status: 400 }
      );
    }
    const contentType = contentTypeOf(file);
    if (!contentType) {
      return NextResponse.json(
        { error: "not a video file — the drive only attaches real video inputs" },
        { status: 400 }
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const staged = stageUpload({
      fileName: file.name || "upload.mp4",
      contentType,
      bytes,
    });
    return NextResponse.json(
      {
        ok: true,
        stageId: staged.id,
        fileName: staged.fileName,
        sizeBytes: staged.sizeBytes,
        contentType: staged.contentType,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not stage the file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const staged = getStagedUpload(id);
  if (!staged) {
    return NextResponse.json(
      { error: "staged file not found or expired" },
      {
        status: 404,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      }
    );
  }
  // Blob-wrapped: TS 5.9's Uint8Array<ArrayBufferLike> is not a BodyInit,
  // and the Blob boundary keeps the byte copy explicit
  const body = new Blob([staged.bytes], { type: staged.contentType });
  return new NextResponse(body, {
    status: 200,
    headers: {
      // CORS-open for the operator tab's cross-origin page-context fetch
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": staged.contentType,
      "Content-Length": String(staged.sizeBytes),
      "Content-Disposition": `inline; filename="${staged.fileName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
