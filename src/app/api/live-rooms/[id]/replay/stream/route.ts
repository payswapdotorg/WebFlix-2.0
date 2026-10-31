import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getReplayFor, replayStorageKeyFor } from "@/lib/live/replays";
import { readReplayObject } from "@/lib/live/replay-storage";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/**
 * GET /api/live-rooms/[id]/replay/stream — the issued playback URL (the
 * room id IS the capability; no key is minted). Same visibility law as
 * GET /replay; additionally 404 for any non-`ready` status and for a
 * missing object (the honest broken-object law: the row says ready but
 * the bytes are gone). Supports HTTP Range (`206` + `Content-Range`,
 * `Accept-Ranges: bytes`); Content-Type comes from the asset;
 * `X-Content-Type-Options: nosniff`; responses are uncacheable.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const found = await getReplayFor(id, sessionUser);
    if (!found) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    if (found.asset.status !== "ready") {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }

    // The key is re-derived from DTO-safe fields — no storageKey ever
    // traveled to the client and none ever will.
    const data = await readReplayObject(
      replayStorageKeyFor(found.asset.id, found.asset.mimeType),
    );
    if (!data) {
      // honest broken-object law: a ready row without bytes is a 404,
      // never a fake stream
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }

    const total = data.byteLength;
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Type": found.asset.mimeType ?? "video/webm",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0, no-store",
    };

    const range = req.headers.get("range");
    if (range) {
      const m = RANGE_RE.exec(range.trim());
      if (m && (m[1] !== "" || m[2] !== "")) {
        let start: number;
        let end: number;
        if (m[1] === "") {
          // suffix range: the last N bytes
          const suffix = Number(m[2]);
          start = Math.max(0, total - suffix);
          end = total - 1;
        } else {
          start = Number(m[1]);
          if (start >= total) {
            return new NextResponse(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${total}` },
            });
          }
          const requestedEnd = m[2] === "" ? null : Number(m[2]);
          end = requestedEnd === null || requestedEnd >= total - 1 ? total - 1 : requestedEnd;
        }
        const slice = data.slice(start, end + 1);
        return new NextResponse(slice, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": String(slice.byteLength),
          },
        });
      }
    }

    return new NextResponse(data, {
      status: 200,
      headers: { ...headers, "Content-Length": String(total) },
    });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/replay/stream failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
