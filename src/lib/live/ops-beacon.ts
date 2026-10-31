/**
 * WFX2-LIVE-PLATFORM-1 Phase 4-OPS — the client beacon (ADR-0009, frozen
 * contracts §6).
 *
 * Fire-and-forget, silent-on-purpose: an observation that fails to send is
 * DROPPED (never queued, never retried — the next observation supersedes a
 * dropped sample; a queue would turn telemetry into its own reliability
 * problem). Never blocks media, never surfaces an error, never logs. The
 * server validates, clamps, identity-stamps and rate-limits everything —
 * the client observes, it does not claim.
 */

export interface OpsBeaconInput {
  kind: "ttff" | "reconnect" | "join_error" | "media_error" | "chat_latency";
  roomId: string;
  sessionId?: string | null;
  code?: string | null;
  valueMs?: number | null;
}

export function beaconOps(input: OpsBeaconInput): void {
  try {
    const payload = JSON.stringify({
      kind: input.kind,
      roomId: input.roomId,
      sessionId: input.sessionId ?? undefined,
      code: input.code ?? undefined,
      valueMs:
        typeof input.valueMs === "number" && Number.isFinite(input.valueMs)
          ? Math.max(0, Math.round(input.valueMs))
          : undefined,
    });
    void fetch("/api/live/ops/beacon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {
      /* silent by law */
    });
  } catch {
    /* silent by law */
  }
}
