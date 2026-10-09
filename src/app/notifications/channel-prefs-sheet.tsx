"use client";

import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChannelLite, NotificationDTO } from "@/lib/types";
import {
  channelKeyOf,
  useChannelPrefs,
  type ChannelNotifPref,
} from "./channel-prefs-store";

/** YouTube's exact three-way per-channel wording (the level names verbatim). */
const LEVELS: { value: ChannelNotifPref; label: string }[] = [
  { value: "all", label: "All" },
  { value: "personalized", label: "Personalized" },
  { value: "none", label: "None" },
];

/**
 * P18-SUBS-NOTIFS — the distinct channels currently present in the feed,
 * first-seen order (the sheet's row set — every channel the feed carries,
 * including channels set to "None", so their level can be switched back).
 */
export function feedChannels(items: NotificationDTO[]): ChannelLite[] {
  const out: ChannelLite[] = [];
  const seen = new Set<string>();
  for (const n of items) {
    const key = channelKeyOf(n.channel);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.channel);
  }
  return out;
}

/**
 * The YouTube bell-menu "gear" flow — the per-channel notifications sheet:
 * every channel in the current feed with YouTube's exact three-way segmented
 * control (All / Personalized / None).
 *
 * HONEST SCOPE: the levels are WebFlix-side view prefs saved in this browser
 * (channel-prefs-store). The All-vs-Personalized distinction is YouTube's
 * server-side logic — both pass rows through to the list; only None filters.
 * A channel with no saved level shows NO active segment (the honest-absence
 * doctrine: never guess YouTube's own per-channel state). The real levels
 * are managed on youtube.com — the sheet says so.
 */
export function ChannelPrefsSheet({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NotificationDTO[];
}) {
  const prefs = useChannelPrefs((s) => s.prefs);
  const setPref = useChannelPrefs((s) => s.setPref);
  const channels = feedChannels(items);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="channel-prefs-sheet"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border pr-10">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
            Channel notifications
          </SheetTitle>
          <SheetDescription>
            Choose how each channel notifies you — All, Personalized, or None.
          </SheetDescription>
        </SheetHeader>

        <p
          data-testid="channel-prefs-disclosure"
          className="border-b border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground"
        >
          Saved in this browser (a WebFlix-side view filter). The All / Personalized
          distinction is YouTube&apos;s own server-side logic — both pass notifications
          through to this list; None hides them here. The real per-channel levels are
          managed on youtube.com.
        </p>

        <div data-testid="channel-prefs-rows" className="flex flex-col divide-y divide-border">
          {channels.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No channels in the current feed — channels appear here as their
              notifications arrive.
            </p>
          )}
          {channels.map((ch) => {
            const key = channelKeyOf(ch);
            const current = prefs[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar className="size-10 shrink-0">
                  {ch.avatarUrl ? <AvatarImage src={ch.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{ch.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={ch.name}>
                    {ch.name}
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label={`Notifications from ${ch.name}`}
                  data-testid={`channel-pref-control-${key}`}
                  className="inline-flex shrink-0 overflow-hidden rounded-full border border-border"
                >
                  {LEVELS.map((level) => {
                    const active = current === level.value;
                    return (
                      <button
                        key={level.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        data-level={level.value}
                        data-active={active ? "true" : undefined}
                        onClick={() => setPref(key, level.value)}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors",
                          active
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                        )}
                      >
                        {level.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* YouTube's gear → settings flow: the settings surface carries the
            general notification rows (the managed-on-youtube.com scope). */}
        <Link
          href="/settings"
          data-testid="notification-settings-link"
          onClick={() => onOpenChange(false)}
          className="flex items-center gap-3 border-t border-border px-4 py-3 text-sm text-foreground transition-colors hover:bg-accent/50"
        >
          <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1">Notification settings</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </SheetContent>
    </Sheet>
  );
}
