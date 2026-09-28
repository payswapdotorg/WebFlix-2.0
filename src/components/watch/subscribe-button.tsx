"use client";

/**
 * WFX2-W subscribe button — the full state machine:
 * Subscribe → Subscribed (bell icon) → bell menu (All/Personalized/None),
 * persisted per channel via POST /api/subscriptions. Clicking "Subscribed"
 * opens the unsubscribe confirm; the bell opens preference modes.
 */
import { useState } from "react";
import { Bell, BellOff, BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { post } from "@/lib/watch/client";
import { compactCount } from "@/lib/watch/format";
import type { SubscriptionResultDto } from "@/lib/watch/types";

export function SubscribeButton({
  channelId,
  channelName,
  initialSubscribed,
  initialBell,
  onCountChange,
}: {
  channelId: string;
  channelName: string;
  initialSubscribed: boolean;
  initialBell: "all" | "personalized" | "none" | null;
  onCountChange?: (n: number) => void;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [bell, setBell] = useState(initialBell);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = async (bellValue: "all" | "personalized" | "none" | "off") => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await post<SubscriptionResultDto>("/api/subscriptions", {
        channelId,
        bell: bellValue,
      });
      setSubscribed(result.subscribed);
      setBell(result.bell);
      onCountChange?.(result.subscriberCount);
      if (result.subscribed && bellValue !== "off") {
        toast.success(`Subscribed to ${channelName}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update subscription");
    } finally {
      setBusy(false);
      setMenuOpen(false);
      setConfirmOpen(false);
    }
  };

  if (!subscribed) {
    return (
      <button
        type="button"
        onClick={() => apply("personalized")}
        disabled={busy}
        aria-label={`Subscribe to ${channelName}`}
        className="h-9 rounded-full bg-[#0f0f0f] px-4 text-sm font-medium text-white transition hover:bg-[#272727] active:scale-[0.97] disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-[#d9d9d9] sm:h-10"
      >
        Subscribe
      </button>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        aria-label={`Subscribed to ${channelName}. Click to unsubscribe.`}
        className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/70 active:scale-[0.97] disabled:opacity-50 sm:h-10"
      >
        <Check className="size-4" aria-hidden="true" />
        Subscribed
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={busy}
        aria-label="Notification settings"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition hover:bg-secondary/70 sm:size-10"
      >
        {bell === "none" ? (
          <BellOff className="size-4" aria-hidden="true" />
        ) : bell === "all" ? (
          <BellRing className="size-4" aria-hidden="true" />
        ) : (
          <Bell className="size-4" aria-hidden="true" />
        )}
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            aria-label="Notifications"
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
          >
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Notifications
            </div>
            {(
              [
                ["all", "All", BellRing],
                ["personalized", "Personalized", Bell],
                ["none", "None", BellOff],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={bell === value}
                onClick={() => apply(value)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Icon className={cn("size-4", bell === value ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
                {label}
                {bell === value && <Check className="ml-auto size-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      )}

      {confirmOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setConfirmOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Unsubscribe"
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 rounded-xl border border-border bg-popover p-4 shadow-lg"
          >
            <p className="text-sm text-foreground">
              Unsubscribe from <span className="font-semibold">{channelName}</span>?
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="h-8 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => apply("off")}
                disabled={busy}
                className="h-8 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Unsubscribe
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function subscriberLabel(n: number): string {
  return `${compactCount(n)} subscribers`;
}
