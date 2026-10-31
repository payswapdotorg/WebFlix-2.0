"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 — Worker 4-c (UI lane): the replay player
 * panel (work order §4H; the read side of the frozen replay law).
 *
 * Honest-state rendering — no fake players, ever:
 * - 404 / asset-null renders NOTHING (the parent decides what an ended room
 *   without a replay looks like);
 * - "recording"/"processing" says the truth: the take is not watchable yet;
 * - "failed" surfaces the asset's OWN error string;
 * - "expired" states the 30-day retention law instead of a dead player;
 * - "ready" renders a native player over the server-minted playback URL
 *   (URLs are minted at read time; no key, path or provider URL is ever
 *   rendered beyond it) plus the honest metadata: the recorder-reported
 *   duration labelled "(approx.)" — durationMs is advisory, never a
 *   billing fact — the size, and the recorded date.
 *
 * `hostView` adds the visibility control (host-only PATCH). The select's
 * value is the SERVER's asset.visibility — a 200 replaces the asset, a
 * failure keeps it and renders the honest result inline.
 */

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Video } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import type { LiveReplayAssetDto } from "@/lib/live/types";

const VISIBILITIES = ["inherit", "public", "unlisted", "hidden"] as const;

type ReplayVisibility = (typeof VISIBILITIES)[number];

/** The frozen rate-limit copy (429 on replayVisibility). */
const VISIBILITY_RATE_LIMIT_COPY = "Slow down — too many visibility changes.";

type ReplayState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; asset: LiveReplayAssetDto; playbackUrl: string };

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 34567 → "33.8 KB", 5_242_880 → "5 MB" — the honest size line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${trimZero((bytes / 1024).toFixed(1))} KB`;
  return `${trimZero((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export interface LiveReplayPanelProps {
  roomId: string;
  /** Host-only extras: the replay visibility control (PATCHes the asset). */
  hostView?: boolean;
  className?: string;
}

export function LiveReplayPanel({
  roomId,
  hostView = false,
  className,
}: LiveReplayPanelProps): JSX.Element | null {
  const [state, setState] = useState<ReplayState>({ kind: "loading" });
  const [patching, setPatching] = useState(false);
  const [patchNote, setPatchNote] = useState<{ text: string; error: boolean } | null>(
    null,
  );

  // A room change resets the fetch state in the RENDER phase (the React
  // documented prop-change adjustment — the use-api pattern; no synchronous
  // setState inside effects).
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  if (roomId !== prevRoomId) {
    setPrevRoomId(roomId);
    setState({ kind: "loading" });
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/live-rooms/${roomId}/replay`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          // No replay on this room — the parent decides what renders.
          setState({ kind: "missing" });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          setState({
            kind: "error",
            message:
              body.message ??
              body.error ??
              `the server answered ${res.status}`,
          });
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          asset?: LiveReplayAssetDto | null;
          playbackUrl?: string;
        } | null;
        if (controller.signal.aborted) return;
        if (!json?.asset) {
          setState({ kind: "missing" });
          return;
        }
        setState({
          kind: "loaded",
          asset: json.asset,
          playbackUrl: json.playbackUrl ?? "",
        });
      } catch {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: "the request failed before an answer arrived",
        });
      }
    })();
    return () => controller.abort();
  }, [roomId]);

  async function patchVisibility(visibility: ReplayVisibility): Promise<void> {
    setPatching(true);
    setPatchNote(null);
    try {
      const res = await fetch(`/api/live-rooms/${roomId}/replay`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          asset?: LiveReplayAssetDto | null;
        } | null;
        const asset = json?.asset;
        if (asset) {
          // The server's asset is the truth — the select follows it.
          setState((prev) => (prev.kind === "loaded" ? { ...prev, asset } : prev));
          setPatchNote({ text: "Visibility updated.", error: false });
        } else {
          setPatchNote({
            text: "The visibility change could not be confirmed.",
            error: true,
          });
        }
        return;
      }
      if (res.status === 429) {
        setPatchNote({ text: VISIBILITY_RATE_LIMIT_COPY, error: true });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      setPatchNote({
        text:
          body.message ??
          `The visibility change failed — the server answered ${res.status}.`,
        error: true,
      });
    } catch {
      setPatchNote({
        text: "The visibility change failed — the request didn't reach the server.",
        error: true,
      });
    } finally {
      setPatching(false);
    }
  }

  if (state.kind === "missing") return null;

  if (state.kind === "error") {
    return (
      <p
        role="alert"
        data-testid="replay-error"
        className={cn("text-sm text-muted-foreground", className)}
      >
        Couldn&apos;t load the replay — {state.message}.
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <Card
        className={cn("min-w-0 gap-4", className)}
        data-testid="replay-loading"
        aria-busy="true"
      >
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Video className="size-4 text-muted-foreground" aria-hidden />
            Replay
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="h-3 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  const { asset, playbackUrl } = state;

  return (
    <Card className={cn("min-w-0 gap-4", className)} data-testid="live-replay-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="size-4 text-muted-foreground" aria-hidden />
          Replay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {asset.status === "recording" || asset.status === "processing" ? (
          <p
            role="status"
            data-testid="replay-status"
            className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
          >
            Replay is being recorded — check back after the stream ends.
          </p>
        ) : asset.status === "failed" ? (
          <p
            role="status"
            data-testid="replay-status"
            className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
          >
            Replay failed: {asset.error ?? "the recorder reported no reason"}
          </p>
        ) : asset.status === "expired" ? (
          <p
            role="status"
            data-testid="replay-status"
            className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
          >
            This replay expired (30-day retention).
          </p>
        ) : (
          <>
            {playbackUrl !== "" ? (
              <video
                controls
                playsInline
                preload="metadata"
                src={playbackUrl}
                data-testid="replay-video"
                className="aspect-video w-full rounded-md bg-black"
              />
            ) : (
              <p
                role="status"
                data-testid="replay-status"
                className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
              >
                The replay is ready but the server issued no playback URL.
              </p>
            )}
            <p data-testid="replay-meta" className="text-xs text-muted-foreground">
              {asset.durationMs !== null
                ? `${formatDuration(asset.durationMs / 1000)} (approx.)`
                : "Duration unknown"}
              {asset.sizeBytes !== null && <> · {formatBytes(asset.sizeBytes)}</>}
              {" · "}
              Recorded {formatRelativeDate(asset.recordingStartedAt)}
            </p>
          </>
        )}

        {hostView && (
          <div className="space-y-1" data-testid="replay-visibility">
            <label
              htmlFor="replay-visibility-select"
              className="block text-xs font-medium text-foreground"
            >
              Replay visibility
            </label>
            <select
              id="replay-visibility-select"
              aria-label="Replay visibility"
              value={asset.visibility}
              disabled={patching}
              onChange={(e) => void patchVisibility(e.target.value as ReplayVisibility)}
              className="h-9 w-full max-w-52 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {patchNote !== null && (
              <p
                role={patchNote.error ? "alert" : "status"}
                data-testid="replay-visibility-note"
                className={cn(
                  "text-xs",
                  patchNote.error
                    ? "font-medium text-red-600 dark:text-red-400"
                    : "text-muted-foreground",
                )}
              >
                {patchNote.text}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
