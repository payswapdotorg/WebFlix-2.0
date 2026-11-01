"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P72-1 — the SCREEN-SHARE program source (the
 * TikTok-parity layer, ADR-0012).
 *
 * THE SOURCE-REPLACE LAW: "Share your screen instead" swaps the program
 * video source IN PLACE — `getDisplayMedia({ video: true, audio: false })`
 * publishes the display track under Track.Source.Camera (the mic audio
 * track is untouched; the audience sees exactly what the consent dialog
 * showed). Restore unpublishes the display track and re-enables the
 * camera. The browser's OWN denial is the honest state: "denied" renders
 * the browser's refusal reason verbatim (never a fake share, never a fake
 * failure).
 *
 * The display track rides the EXISTING publisher rung — no new token
 * surface, no schema change (the report's own law). The ended event (the
 * browser's Stop-sharing bar) restores the camera automatically.
 *
 * Rendered INSIDE the LiveKitRoom (needs the room context to touch the
 * local participant's tracks).
 */
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { MonitorUp, MonitorX } from "lucide-react";
import { Track } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScreenShareState =
  | { mode: "idle" }
  | { mode: "requesting" }
  | { mode: "sharing" }
  | { mode: "denied"; reason: string }
  | { mode: "failed"; reason: string };

export function ScreenShareControls({ className }: { className?: string }): JSX.Element {
  const room = useRoomContext();
  const [state, setState] = useState<ScreenShareState>({ mode: "idle" });
  // The live display track while sharing (restored on unmount best-effort).
  const [displayTrack, setDisplayTrack] = useState<MediaStreamTrack | null>(null);

  const restoreCamera = useCallback(
    async (track: MediaStreamTrack | null) => {
      if (track) {
        try {
          await room.localParticipant.unpublishTrack(track);
        } catch {
          /* the track may already be gone — the camera restore below stands */
        }
        track.stop();
      }
      setDisplayTrack(null);
      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch {
        /* the camera may be busy — the Camera toggle stays the honest control */
      }
    },
    [room],
  );

  const share = useCallback(async () => {
    setState({ mode: "requesting" });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false, // the mic track is the room's audio — the report's law
      });
    } catch (err) {
      // The browser's denial is the HONEST state — its reason renders.
      const reason = err instanceof Error ? err.message : "the browser refused the request";
      setState({ mode: "denied", reason });
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      setState({ mode: "failed", reason: "the browser returned no display track" });
      return;
    }
    try {
      // Swap the program source: camera off, display track published under
      // the Camera source so every viewer's program tile follows.
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
      setDisplayTrack(track);
      setState({ mode: "sharing" });
      // The browser's own Stop-sharing control ends the share → restore.
      track.addEventListener("ended", () => {
        void restoreCamera(track);
        setState({ mode: "idle" });
      });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      try {
        await room.localParticipant.setCameraEnabled(true);
      } catch {
        /* the camera toggle stays available */
      }
      setState({
        mode: "failed",
        reason: err instanceof Error ? err.message : "the share could not publish",
      });
    }
  }, [restoreCamera, room]);

  const stop = useCallback(async () => {
    await restoreCamera(displayTrack);
    setState({ mode: "idle" });
  }, [displayTrack, restoreCamera]);

  return (
    <div className={cn("space-y-2", className)} data-testid="screen-share-controls">
      {state.mode === "sharing" ? (
        <Button
          data-testid="screen-share-stop"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => void stop()}
        >
          <MonitorX aria-hidden /> Stop sharing — restore camera
        </Button>
      ) : (
        <Button
          data-testid="screen-share-button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={state.mode === "requesting"}
          onClick={() => void share()}
        >
          <MonitorUp aria-hidden />
          {state.mode === "requesting" ? "Waiting for the browser…" : "Share your screen instead"}
        </Button>
      )}
      {state.mode === "denied" && (
        <p
          role="note"
          data-testid="screen-share-denied"
          className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
        >
          Screen share didn&apos;t start — {state.reason}. Your camera keeps broadcasting.
        </p>
      )}
      {state.mode === "failed" && (
        <p
          role="alert"
          data-testid="screen-share-failed"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          Screen share failed — {state.reason}. Your camera keeps broadcasting.
        </p>
      )}
      {state.mode === "sharing" && (
        <p data-testid="screen-share-active" className="text-xs text-muted-foreground">
          Your screen is the program — viewers see your display; your mic stays on.
        </p>
      )}
    </div>
  );
}
