/**
 * WebFlix Netflix Desktop — HTTP + WebSocket entry point.
 *
 * HTTP  : session lifecycle + status + operator cookie connect
 *         (proxied by the Next.js /api/netflix/watch routes)
 * WS    : socket.io fan-out of the Opus/WebM audio stream (room "audio")
 *
 * Run: E2B_API_KEY=… bun run dev   (port from NETFLIX_DESKTOP_PORT, default 3030)
 * Health: curl http://127.0.0.1:3030/healthz
 */
import { createServer } from "http";
import { Server } from "socket.io";
import { sessionManager, parseCookieHeader } from "./session";
import {
  ingestBridgeCookies,
  getIngestToken,
  rotateIngestToken,
  getBridgeStatus,
} from "./ingest";

const PORT = Number(process.env.NETFLIX_DESKTOP_PORT ?? 3030);

const livePhase = () => {
  const p = sessionManager.getStatus().phase;
  return p === "ready" || p === "auth-required";
};

const withAutoAuth = () => ({
  ...sessionManager.getStatus(),
  autoAuth: { bridge: getBridgeStatus(), ingestTokenConfigured: getIngestToken().length > 0 },
});

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const readBody = (cb: (body: string) => void) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => cb(body));
  };

  if (url.pathname === "/healthz") {
    // P51-AUDIT (report §3.1 A1): a live status poll IS playback activity —
    // without this heartbeat the idle clock killed the desktop ~25 min into
    // any long title. heartbeat() is internally bounded (live phase + 4h
    // lifetime cap), so an abandoned open tab can't hold the sandbox forever.
    if (livePhase()) sessionManager.heartbeat();
    return json(200, { ok: true, service: "netflix-desktop", ...withAutoAuth() });
  }

  if (url.pathname === "/session" && req.method === "GET") {
    return json(200, withAutoAuth());
  }

  // non-blocking: kicks provisioning/navigation in the background; poll /healthz
  if (url.pathname === "/session" && req.method === "POST") {
    return readBody((body) => {
      try {
        const { videoId, path } = body ? (JSON.parse(body) as { videoId?: number; path?: string }) : {};
        if (typeof path === "string" && path) {
          // Netflix Live: navigate the streamed chrome to a netflix.com path
          void sessionManager.openPath(path).catch((e) =>
            console.log("[http] openPath failed:", (e as Error).message.slice(0, 200)),
          );
        } else if (videoId) {
          void sessionManager.watch(Number(videoId)).catch((e) =>
            console.log("[http] watch failed:", (e as Error).message.slice(0, 200)),
          );
        } else {
          void sessionManager.ensure().catch((e) =>
            console.log("[http] ensure failed:", (e as Error).message.slice(0, 200)),
          );
        }
        return json(202, sessionManager.getStatus());
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }
    });
  }

  if (url.pathname === "/session/release" && req.method === "POST") {
    sessionManager.markActivity();
    return json(200, { ok: true });
  }

  if (url.pathname === "/session/restart" && req.method === "POST") {
    void sessionManager.destroy();
    return json(202, { ok: true, phase: "restarting" });
  }

  // operator cookie connect (raw Cookie header string or JSON cookie array)
  if (url.pathname === "/cookies" && req.method === "POST") {
    return readBody(async (body) => {
      try {
        const parsed = body ? (JSON.parse(body) as { cookies?: string | unknown[] }) : {};
        const payload = parsed.cookies ?? body;
        const result =
          typeof payload === "string"
            ? await sessionManager.applyExternalCookies(parseCookieHeader(payload))
            : await sessionManager.applyExternalCookies(payload as never);
        return json(result.ok ? 200 : 422, result);
      } catch (e) {
        return json(400, { ok: false, message: (e as Error).message });
      }
    });
  }

  // demand a fresh automatic harvest attempt (Apify residential)
  if (url.pathname === "/auth/retry" && req.method === "POST") {
    return readBody(async () => {
      void sessionManager
        .reharvest()
        .catch((e) => console.log("[http] reharvest failed:", (e as Error).message.slice(0, 200)));
      return json(202, { ok: true, phase: "harvesting" });
    });
  }

  // P46 — the WebFlix Bridge push (automatic sign-in): the operator's own
  // signed-in browser ships its session cookies here on rotation.
  if (url.pathname === "/ingest" && req.method === "POST") {
    return readBody(async (body) => {
      try {
        const input = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        const result = await ingestBridgeCookies(input, {
          isSessionLive: livePhase,
          applyLive: (cookies) => sessionManager.applyExternalCookies(cookies),
        });
        return json(result.code, result);
      } catch (e) {
        return json(400, { ok: false, applied: false, message: (e as Error).message });
      }
    });
  }

  // the pairing token (surfaced in the app's auto sign-in panel) + bridge status
  if (url.pathname === "/ingest/token" && req.method === "GET") {
    return json(200, { token: getIngestToken(), bridge: getBridgeStatus() });
  }

  if (url.pathname === "/ingest/token/rotate" && req.method === "POST") {
    return json(200, { ok: true, token: rotateIngestToken() });
  }

  return json(404, { error: "not found" });
});

const io = new Server(httpServer, {
  path: "/nfsocket.io",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 1e7,
});

io.on("connection", (socket) => {
  const room = String(socket.handshake.query.room ?? "state");
  socket.join(room);
  console.log(`[ws] client ${socket.id} joined room=${room}`);

  if (room === "audio") {
    // one audio tap per service; each new listener (re)starts the tap
    sessionManager.onAudioChunk = (chunk: Buffer) => {
      io.to("audio").emit("chunk", chunk);
    };
    void sessionManager.startAudio();
  }

  socket.on("resync", () => {
    // client asked for a fresh tap (e.g. after a video seek)
    if (room === "audio") {
      void sessionManager.stopAudio().then(() => {
        sessionManager.onAudioChunk = (chunk: Buffer) => io.to("audio").emit("chunk", chunk);
        void sessionManager.startAudio();
      });
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[netflix-desktop] listening on http://0.0.0.0:${PORT}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
