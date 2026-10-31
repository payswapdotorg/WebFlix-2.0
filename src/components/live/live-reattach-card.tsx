"use client";

import { Loader2, PlugZap, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LiveRoomDto } from "@/lib/live/types";

/**
 * WFX2-LIVE-PLATFORM-1 P68 — the honest console re-attach surface.
 *
 * Shown by the studio console when the mount probe (GET /api/studio/live-
 * session) finds the caller's ACTIVE live room: the stream kept running
 * while this console was away, and this card re-takes it through the
 * existing token route (the server derives the host rung from the room's
 * hostId — the caller cannot claim it) instead of letting a fresh Go-live
 * form orphan the running session. Purely presentational: the console owns
 * the probe, the re-attach call and every honest failure copy.
 *
 * The dismiss copy says exactly what happens: dismissing does NOT end the
 * stream — it keeps going until it is ended from a re-attached console,
 * and a new Go Live below creates a DIFFERENT room (the per-room
 * one-active-session law is untouched).
 */

function formatStarted(iso: string | null): string {
  if (!iso) return "an unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown time";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

interface ReattachCardProps {
  room: LiveRoomDto;
  reattaching: boolean;
  onReattach: () => void;
  onDismiss: () => void;
}

export function ReattachCard({ room, reattaching, onReattach, onDismiss }: ReattachCardProps) {
  const startedAt = room.currentSession?.startedAt ?? null;
  const viewers = room.viewerCount;
  return (
    <Card data-testid="reattach-card" className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="size-4 text-yt-red" aria-hidden="true" />
          You have a live session running
        </CardTitle>
        <CardDescription data-testid="reattach-room-line">
          {room.title} · started {formatStarted(startedAt)}
          {typeof viewers === "number"
            ? ` · ${viewers} approximate viewer${viewers === 1 ? "" : "s"}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This console reloaded while the stream kept running. Re-attach to resume
          publishing, the chat, moderation and the end control — the room and its
          viewer URL stay the same, and nothing starts or stops.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={onReattach}
            disabled={reattaching}
            data-testid="reattach-button"
          >
            {reattaching ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Re-attaching…
              </>
            ) : (
              <>
                <PlugZap className="size-4" aria-hidden="true" />
                Re-attach console
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDismiss}
            disabled={reattaching}
            data-testid="reattach-dismiss"
          >
            Dismiss
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Dismissing does not end the stream: it keeps going until it is ended from a
          re-attached console. Starting a new Go Live below creates a different room.
        </p>
      </CardContent>
    </Card>
  );
}
