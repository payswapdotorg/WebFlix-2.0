"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarPlus, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { formatRelativeDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LiveEventDto } from "@/lib/live/types";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — scheduled WebFlix LIVE events on the
 * discovery surface (work order §4H). Server-derived registration counts,
 * honest empty/loading/error states, and a compact create form for
 * signed-in users (any account may schedule — the routes rate-limit).
 */

function localDatetimeValue(date: Date): string {
  // datetime-local needs a local ISO without the Z suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function LiveEventsCard({ signedIn }: { signedIn: boolean }) {
  const { data, error, reload } = useApi<{ events: LiveEventDto[] }>("/api/live-events");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState(() => localDatetimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [pendingId, setPendingId] = useState<string | null>(null);

  const events = data?.events ?? null;

  const register = useCallback(
    async (eventId: string, registered: boolean | null) => {
      setPendingId(eventId);
      try {
        const res = await fetch(`/api/live-events/${eventId}/register`, {
          method: registered ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (res.status === 401) {
          toast.error("Sign in to register for events.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error("Registration change failed", {
            description: body.message ?? `Server answered ${res.status}.`,
          });
          return;
        }
        toast.success(registered ? "Registration removed." : "You're registered — see you there.");
        reload();
      } finally {
        setPendingId(null);
      }
    },
    [reload],
  );

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/live-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description: description.trim() === "" ? undefined : description,
          scheduledFor: new Date(when).toISOString(),
        }),
      });
      if (res.status === 401) {
        toast.error("Sign in to schedule events.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error("Couldn't schedule the event", {
          description: body.message ?? `Server answered ${res.status}.`,
        });
        return;
      }
      toast.success("Event scheduled.");
      setTitle("");
      setDescription("");
      setShowForm(false);
      reload();
    } finally {
      setCreating(false);
    }
  }, [title, description, when, reload]);

  return (
    <Card data-testid="live-events-card">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-yt-red" aria-hidden />
            Upcoming LIVE events
          </CardTitle>
          <CardDescription>
            Scheduled WebFlix broadcasts — register to get the room link when it goes live.
          </CardDescription>
        </div>
        {signedIn && (
          <Button
            size="sm"
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((v) => !v)}
            aria-expanded={showForm}
          >
            <CalendarPlus className="size-4" aria-hidden />
            {showForm ? "Cancel" : "Schedule"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showForm && (
          <form
            className="grid gap-3 rounded-lg border bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="live-event-title">Title</Label>
              <Input
                id="live-event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={140}
                placeholder="What are you broadcasting?"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="live-event-when">Starts at (your local time)</Label>
              <Input
                id="live-event-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="live-event-desc">Description (optional)</Label>
              <Textarea
                id="live-event-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={2}
              />
            </div>
            <Button type="submit" size="sm" disabled={creating || title.trim().length === 0}>
              {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Schedule event
            </Button>
          </form>
        )}

        {error ? (
          <p className="text-sm text-muted-foreground" data-testid="live-events-error">
            Couldn&apos;t load events right now —{" "}
            <button className="underline" onClick={reload}>
              retry
            </button>
            .
          </p>
        ) : events === null ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-12 animate-pulse rounded-md bg-muted" />
            <div className="h-12 animate-pulse rounded-md bg-muted" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="live-events-empty">
            No scheduled events yet.{signedIn ? " Schedule the first one." : ""}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="live-events-list">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ev.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{ev.creatorHandle} · {formatRelativeDate(ev.scheduledFor)} ·{" "}
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" aria-hidden />
                      {ev.registrationCount} registered
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={ev.registered ? "outline" : "default"}
                  disabled={pendingId === ev.id}
                  onClick={() => void register(ev.id, ev.registered)}
                >
                  {pendingId === ev.id && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {ev.registered ? "Unregister" : ev.registered === null ? "Register" : "Register"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!signedIn && events !== null && events.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <Link href="/signin" className="underline">
              Sign in
            </Link>{" "}
            to register for events.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
