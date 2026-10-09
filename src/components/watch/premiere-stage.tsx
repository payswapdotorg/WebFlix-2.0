"use client";

/**
 * P21-LIVE-PREMIERES — the watch page's scheduled-premiere state, laid over
 * the player area exactly while the premiere hasn't started (youtube.com's
 * premiere stage: the thumbnail backdrop, the scheduled date, the live
 * countdown, and the "Set reminder" bell).
 *
 *  - COUNTDOWN: "Premieres in 3 days" (D days) / "Premieres in 04:12:33"
 *    (HH:MM:SS under a day) — YouTube's two countdown forms, live-ticking
 *    once per second. SSR-safe initial render: the first frame carries only
 *    the stable scheduled-date line; the ticking line mounts after the
 *    effect (no server/client time mismatch, ever).
 *  - WALL CLOCK: ticks read Date.now() each second (the autoplay-countdown
 *    idiom — deadline math survives background-tab throttling).
 *  - SET REMINDER: a WebFlix-owned UI pref in localStorage
 *    (wf-premiere-reminders — lib/watch/premiere). The honest split: the
 *    actual reminder notification is youtube.com's; WebFlix only remembers
 *    this choice on this device (disclosed beside the bell).
 *  - START: when the countdown reaches zero the overlay lifts (onStarted)
 *    so the player beneath takes over — the engagement row and chat panel
 *    return to their live behavior on the same flip.
 */
import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { toast } from "sonner";
import {
  premiereCountdownLine,
  premiereRemainingMs,
  premiereScheduledDate,
  readPremiereReminders,
  togglePremiereReminder,
} from "@/lib/watch/premiere";

export function PremiereStage({
  videoId,
  startsAt,
  title,
  thumbnailUrl,
  onStarted,
}: {
  videoId: string;
  /** the scheduled start (ISO) — always in the future while this renders */
  startsAt: string;
  title: string;
  thumbnailUrl: string;
  /** the countdown hit zero — the parent flips its premiere state off */
  onStarted: () => void;
}) {
  // null = the SSR/prerender frame (the stable date line renders alone)
  const [now, setNow] = useState<number | null>(null);
  const [reminder, setReminder] = useState(false);

  // the ticking wall clock (1s; deadline math — throttled-tab safe). The
  // seed call is sync-in-effect by design: Date.now() is the external
  // system, and waiting a full interval would delay the first countdown
  // frame (the SSR-safe stable frame has already rendered by then).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-clock seed (the watch page's persisted-pref hydration idiom)
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // persisted reminder hydration (the watch page's AUTOPLAY_KEY idiom)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of a persisted pref (SSR renders the default)
      setReminder(readPremiereReminders(window.localStorage).includes(videoId));
    } catch {
      /* private mode */
    }
  }, [videoId]);

  const remaining = now === null ? null : premiereRemainingMs(startsAt, now);

  // zero crossing → the parent flips out of the premiere state (the embed
  // beneath takes over; the engagement row + chat return to live behavior)
  const started = useCallback(() => onStarted(), [onStarted]);
  useEffect(() => {
    if (now !== null && premiereRemainingMs(startsAt, now) === 0) started();
  }, [now, startsAt, started]);

  const toggleReminder = useCallback(() => {
    let next = false;
    try {
      next = togglePremiereReminder(window.localStorage, videoId);
    } catch {
      /* private mode — the pref simply doesn't persist */
    }
    setReminder(next);
    if (next) toast.success("Reminder saved — the notification is youtube.com’s");
    else toast.info("Reminder removed");
  }, [videoId]);

  // the countdown is over: lift the overlay (the player beneath takes over)
  if (remaining === 0) return null;

  return (
    <div
      data-premiere-stage
      role="region"
      aria-label={`Scheduled premiere — ${title}`}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-black px-4 text-center"
    >
      {/* the real thumbnail, dimmed — the stage backdrop */}
      <img
        src={thumbnailUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover opacity-40"
      />
      <div className="relative flex max-w-2xl flex-col items-center gap-4">
        <p data-premiere-scheduled className="text-sm font-medium text-white/90 sm:text-base">
          Scheduled for {premiereScheduledDate(startsAt)}
        </p>
        {remaining !== null && (
          <p
            data-premiere-countdown
            aria-live="off"
            className="text-2xl font-bold tabular-nums text-white sm:text-3xl"
          >
            {premiereCountdownLine(remaining)}
          </p>
        )}
        <button
          type="button"
          onClick={toggleReminder}
          data-premiere-reminder={reminder ? "set" : "unset"}
          aria-pressed={reminder}
          className="flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-neutral-900 transition hover:bg-white/90 active:scale-[0.97]"
        >
          {reminder ? (
            <BellRing className="size-5" aria-hidden="true" />
          ) : (
            <Bell className="size-5" aria-hidden="true" />
          )}
          {reminder ? "Reminder set" : "Set reminder"}
        </button>
        <p data-premiere-note className="max-w-md text-xs leading-relaxed text-white/60">
          The reminder notification is YouTube’s — it plays on youtube.com.
          WebFlix saves this choice locally on this device.
        </p>
      </div>
    </div>
  );
}
