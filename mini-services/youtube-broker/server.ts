/**
 * WFX2-A-W Session Broker — HTTP server.
 *
 * GET  /healthz        → {ok, tabFound, tabUrl, lastActionAt} (no auth — health contract)
 * POST /broker/action  → header `x-broker-secret`; body {kind, target, payload?}
 *
 * Shared-secret auth on every /broker/* route (constant-time compare).
 * Fail-closed: when BROKER_SECRET is not configured, actions are refused.
 */
import { createBrokerOptions, type BrokerOptions } from "./options";
import { secretMatches } from "./auth";
import { CdpConnection, ensureYoutubeTab, listPages } from "./cdp";
import { executeAction } from "./executor";
import { Journal } from "./journal";
import { ACTION_KINDS, type BrokerActionRequest, type HealthResponse } from "./types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-broker-secret",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Validate the action request → error string or normalized request. */
export function validateActionRequest(body: unknown): { error: string } | { req: BrokerActionRequest } {
  if (typeof body !== "object" || body === null) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const kind = b.kind;
  if (typeof kind !== "string" || !(ACTION_KINDS as readonly string[]).includes(kind)) {
    return { error: `unknown kind (expected one of ${ACTION_KINDS.join(", ")})` };
  }
  // WFX2-4A — the READ transport: no target, the PATH drives everything. The
  // wire contract is {kind:"fetch", path:"/…"} (payload.path tolerated as the
  // alias). Path-law: must start with "/" AND resolve inside www.youtube.com
  // — absolute URLs, protocol-relative ("//host/…") and any form that escapes
  // the origin are refused (the broker is a youtube.com reader, never a
  // generic proxy).
  if (kind === "fetch") {
    const rawPath = b.path ?? (b.payload as { path?: unknown } | undefined)?.path;
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      return { error: `fetch requires path (a www.youtube.com path starting with "/")` };
    }
    if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
      return { error: `fetch path must start with "/" (a youtube.com path — absolute URLs are refused): ${rawPath.slice(0, 80)}` };
    }
    let resolved: URL;
    try {
      resolved = new URL(rawPath, "https://www.youtube.com");
    } catch {
      return { error: `fetch path is not a valid www.youtube.com path: ${rawPath.slice(0, 80)}` };
    }
    if (resolved.origin !== "https://www.youtube.com") {
      return { error: `fetch path must stay on www.youtube.com (resolved to ${resolved.origin})` };
    }
    return {
      req: {
        kind: "fetch",
        target: {},
        payload: { path: rawPath },
      },
    };
  }
  const targetRaw = b.target;
  if (typeof targetRaw !== "object" || targetRaw === null) {
    return { error: "target is required" };
  }
  const target: Record<string, string> = {};
  for (const [k, v] of Object.entries(targetRaw as Record<string, unknown>)) {
    if (v !== undefined && v !== null) {
      if (typeof v !== "string" || v.length === 0) return { error: `target.${k} must be a non-empty string` };
      target[k] = v;
    }
  }
  const payloadRaw = b.payload;
  let payload: Record<string, unknown> | undefined;
  if (payloadRaw !== undefined && payloadRaw !== null) {
    if (typeof payloadRaw !== "object") return { error: "payload must be an object" };
    payload = payloadRaw as Record<string, unknown>;
  }

  const req: BrokerActionRequest = {
    kind: kind as BrokerActionRequest["kind"],
    target: {
      videoId: target.videoId,
      channelId: target.channelId,
      commentId: target.commentId,
      playlistId: target.playlistId,
      postId: target.postId,
    },
    payload: payload as BrokerActionRequest["payload"],
  };

  // per-kind requirements
  const need = (field: keyof typeof req.target, label: string): string | null =>
    req.target[field] ? null : `${kind} requires target.${label}`;
  const videoKinds: readonly string[] = [
    "like",
    "dislike",
    "remove-rating",
    "comment-create",
    "watch-later",
    "not-interested",
  ];
  const commentMenuKinds: readonly string[] = [
    "comment-edit",
    "comment-delete",
    "comment-heart",
    "comment-pin",
    "comment-report",
  ];
  const errs = [
    videoKinds.includes(kind) ? need("videoId", "videoId") : null,
    kind === "subscribe" || kind === "unsubscribe" || kind === "bell"
      ? need("channelId", "channelId")
      : null,
    kind === "comment-reply" || kind === "comment-like" ? need("commentId", "commentId") : null,
    commentMenuKinds.includes(kind) ? need("commentId", "commentId") : null,
    commentMenuKinds.includes(kind) && !(req.target.videoId || req.payload?.videoId)
      ? `${kind} requires target.videoId or payload.videoId (the watch page for the DOM path)`
      : null,
    kind === "playlist-add" ? need("playlistId", "playlistId") : null,
  ].filter(Boolean);
  if (errs.length) return { error: errs[0] as string };

  if (kind === "comment-create" && !req.payload?.text) {
    return { error: "comment-create requires payload.text" };
  }
  if (kind === "comment-reply" && !req.payload?.text) {
    return { error: "comment-reply requires payload.text" };
  }
  if (kind === "comment-edit" && !req.payload?.text) {
    return { error: "comment-edit requires payload.text (the new body)" };
  }
  if (kind === "bell") {
    const pref = (req.payload?.pref ?? "").toLowerCase();
    if (!["all", "personalized", "none", "off"].includes(pref)) {
      return { error: "bell requires payload.pref: all|personalized|none|off" };
    }
  }
  if (req.kind === "playlist-add" && !(req.payload?.videoId ?? req.target.videoId)) {
    return { error: "playlist-add requires target.videoId or payload.videoId" };
  }
  // WFX2-P2-SO (community posts)
  if (kind === "community-read" && !(typeof req.payload?.handle === "string" && req.payload.handle.trim())) {
    return { error: "community-read requires payload.handle (the @handle whose community tab the browser reads)" };
  }
  if (kind === "post-like") {
    if (!req.target.postId) return { error: "post-like requires target.postId" };
    const action = String(req.payload?.action ?? "like").toLowerCase();
    if (!["like", "dislike", "remove"].includes(action)) {
      return { error: "post-like requires payload.action: like|dislike|remove" };
    }
  }
  if (kind === "post-comment-create") {
    if (!req.target.postId) return { error: "post-comment-create requires target.postId" };
    if (!req.payload?.text) return { error: "post-comment-create requires payload.text" };
  }
  if (kind === "post-comment-like" && !req.target.commentId) {
    return { error: "post-comment-like requires target.commentId" };
  }
  if (kind === "post-comment-like" && !req.target.postId) {
    return { error: "post-comment-like requires target.postId" };
  }
  if (kind === "post-create") {
    if (!(typeof req.payload?.handle === "string" && req.payload.handle.trim())) {
      return { error: "post-create requires payload.handle (the OWN channel's community tab hosts the composer)" };
    }
    const text = typeof req.payload?.text === "string" ? req.payload.text.trim() : "";
    const hasImage = typeof req.payload?.imageUrl === "string" && /^https?:\/\//.test(req.payload.imageUrl);
    const poll = Array.isArray(req.payload?.pollOptions)
      ? (req.payload!.pollOptions as unknown[]).filter(
          (o): o is string => typeof o === "string" && o.trim().length > 0
        )
      : [];
    if (!text && !hasImage && poll.length === 0) {
      return { error: "post-create requires payload.text, imageUrl, or pollOptions (an empty post is refused)" };
    }
    if (req.payload?.pollOptions !== undefined && (poll.length < 2 || poll.length > 5)) {
      return { error: "post-create pollOptions must carry 2-5 non-empty options" };
    }
  }
  return { req };
}

/** Build the broker server (exported for tests; index.ts starts it). */
export function createBrokerServer(opts: BrokerOptions): Bun.Server {
  const journal = new Journal(opts.journalPath);

  const fetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/healthz") {
      let tabFound = false;
      let tabUrl: string | null = null;
      let error: string | null = null;
      try {
        const pages = await listPages(opts.cdpHttp);
        const tab = pages.find((t) => t.url.includes("youtube.com"));
        tabFound = !!tab;
        tabUrl = tab?.url ?? null;
      } catch (e) {
        error = e instanceof Error ? e.message : "cdp-unreachable";
      }
      const health: HealthResponse & { cdp?: string | null } = {
        ok: true,
        tabFound,
        tabUrl,
        lastActionAt: journal.last()?.ts ?? null,
        ...(error ? { cdp: error } : {}),
      };
      return json(health);
    }

    if (url.pathname === "/") {
      return json({
        service: "webflix-youtube-broker",
        endpoints: { health: "GET /healthz", action: "POST /broker/action (x-broker-secret)" },
      });
    }

    if (url.pathname === "/broker/action") {
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!opts.secret) {
        return json({ error: "broker is not configured (BROKER_SECRET missing) — refusing actions" }, 503);
      }
      const provided = req.headers.get("x-broker-secret");
      if (!secretMatches(provided, opts.secret)) {
        return json({ error: "unauthorized" }, 401);
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "body must be valid JSON" }, 400);
      }
      const validated = validateActionRequest(body);
      if ("error" in validated) return json({ error: validated.error }, 400);

      const actionReq = validated.req;
      let result: { ok: boolean; verified?: boolean; already?: boolean; path?: string; error?: string };
      try {
        const tab = await ensureYoutubeTab(opts.cdpHttp);
        const conn = await CdpConnection.connect(tab.target.webSocketDebuggerUrl);
        try {
          if (tab.created) await new Promise((r) => setTimeout(r, 2500)); // cold tab load
          const response = await executeAction(conn, actionReq);
          result = response;
        } finally {
          conn.close();
        }
      } catch (e) {
        result = {
          ok: false,
          error: `cdp-execution-failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      journal.append({
        ts: new Date().toISOString(),
        kind: actionReq.kind,
        target: actionReq.target,
        result: {
          ok: result.ok,
          verified: result.verified,
          already: result.already,
          path: result.path,
          error: result.error,
        },
      });
      return json(result, result.ok ? 200 : 502);
    }

    return json({ error: "not found" }, 404);
  };

  return Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    fetch: (req) => fetchHandler(req).catch((e) => json({ error: `broker-error: ${String(e)}` }, 500)),
  });
}

export { createBrokerOptions };
export type { BrokerOptions };
