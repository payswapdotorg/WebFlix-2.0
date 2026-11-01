"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P71-2 — the HOST console's room-announcement
 * manager (the TikTok-parity layer, ADR-0012): set (1..ANNOUNCEMENT_BODY_MAX
 * = 280 chars) or CLEAR the room's announcement. The server persists on the
 * room row and republishes the `room` envelope — this component renders the
 * honest result, never an optimistic fake (the mirror below only survives
 * when the server confirms).
 */
import { useState } from "react";
import type { JSX } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { liveFetch, toastLiveFailure } from "@/components/live/use-live-stream";
import type { LiveRoomDto } from "@/lib/live/types";

const ANNOUNCEMENT_BODY_MAX = 280; // mirrors permissions.ts ANNOUNCEMENT_BODY_MAX

export function LiveAnnouncementManager({
  roomId,
  initial,
}: {
  roomId: string;
  /** The room DTO's current announcement (null when none is set). */
  initial: { body: string | null; updatedAt: string | null };
}): JSX.Element {
  const [draft, setDraft] = useState(initial.body ?? "");
  const [current, setCurrent] = useState<string | null>(initial.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const saveDisabled = busy || trimmed.length < 1 || trimmed.length > ANNOUNCEMENT_BODY_MAX;

  async function save(): Promise<void> {
    setBusy(true);
    const res = await liveFetch<{ room: LiveRoomDto }>(`/api/live-rooms/${roomId}/announcement`, {
      body: { body: trimmed },
    });
    setBusy(false);
    if (res.ok) {
      setCurrent(res.data.room.announcementBody ?? null);
      setError(null);
    } else {
      toastLiveFailure(res.failure, "The announcement didn't save.");
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    const res = await liveFetch<{ room: LiveRoomDto }>(
      `/api/live-rooms/${roomId}/announcement`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (res.ok) {
      setCurrent(null);
      setDraft("");
      setError(null);
    } else {
      toastLiveFailure(res.failure, "The announcement didn't clear.");
    }
  }

  return (
    <Card data-testid="live-announcement-manager" className="min-w-0 gap-4">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-muted-foreground" aria-hidden />
          Announcement
        </CardTitle>
        <CardDescription>
          A notice pinned above the chat for everyone in this room — schedule changes, rules,
          shout-outs. Viewers see it with the honest updated time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {current !== null && (
          <div
            data-testid="announcement-current"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Showing now
            </p>
            <p className="break-words text-sm text-foreground/90">{current}</p>
          </div>
        )}
        <Textarea
          data-testid="announcement-draft"
          aria-label="Announcement text"
          placeholder="Write the room announcement…"
          value={draft}
          maxLength={ANNOUNCEMENT_BODY_MAX}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-16"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="announcement-save"
            size="sm"
            disabled={saveDisabled}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {current === null ? "Post announcement" : "Update announcement"}
          </Button>
          {current !== null && (
            <Button
              data-testid="announcement-clear"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void clear()}
            >
              Remove
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {trimmed.length}/{ANNOUNCEMENT_BODY_MAX}
          </span>
        </div>
        {error && (
          <p role="alert" data-testid="announcement-error" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
