import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { FEEDBACK_CATEGORIES, MAX_FEEDBACK_LENGTH } from "@/app/feedback/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WFX2-P5-SS — the local feedback capture endpoint.
 *
 * POST /api/feedback {category, message} appends one JSON line to the
 * server's local store, for the WebFlix operator to read directly off the
 * disk. There is no delivery to YouTube or Google — the /feedback page
 * discloses exactly this — and there is no read-back over HTTP: GET is
 * refused (405) on purpose so the store can't be scraped through the app.
 *
 * Store location: $WEBFLIX_FEEDBACK_LOG if set, else .data/feedback.log
 * under the process working directory. The .log extension is deliberate:
 * the repo's existing `*.log` gitignore rule keeps user feedback out of
 * git without touching .gitignore (outside this lane's file ownership).
 */
function feedbackLogPath(): string {
  return process.env.WEBFLIX_FEEDBACK_LOG ?? ".data/feedback.log";
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const { category, message } = (body ?? {}) as { category?: unknown; message?: unknown };

  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ ok: false, error: "A message is required." }, { status: 400 });
  }
  if (message.length > MAX_FEEDBACK_LENGTH) {
    return Response.json(
      { ok: false, error: `Message must be at most ${MAX_FEEDBACK_LENGTH} characters.` },
      { status: 400 },
    );
  }
  const resolvedCategory =
    typeof category === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(category)
      ? category
      : null;
  if (resolvedCategory === null) {
    return Response.json(
      { ok: false, error: `Category must be one of: ${FEEDBACK_CATEGORIES.join(", ")}.` },
      { status: 400 },
    );
  }

  const record = {
    id: randomUUID(),
    at: new Date().toISOString(),
    category: resolvedCategory,
    message: message.trim(),
  };

  try {
    const file = feedbackLogPath();
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    return Response.json(
      { ok: false, error: "Could not write the local feedback store on this server." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, id: record.id }, { status: 201 });
}

export async function GET(): Promise<Response> {
  // Honest by construction: the store is for the operator, not an API surface.
  return Response.json(
    {
      ok: false,
      error: "Feedback is stored locally for the WebFlix operator and is not exposed over HTTP.",
    },
    { status: 405, headers: { allow: "POST" } },
  );
}
