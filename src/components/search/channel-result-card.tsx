"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { postJson } from "@/hooks/use-api";
import { formatSubscribers } from "@/lib/format";
import type { ChannelLite } from "@/lib/types";

/**
 * Channel result card (search parity): avatar, name + verified, handle,
 * subs + video count, description snippet, Subscribe wired to the existing
 * /api/subscribe route (same contract as the channel page).
 */
export function ChannelResultCard({ channel }: { channel: ChannelLite }) {
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  async function toggleSubscribe() {
    setSubscribing(true);
    try {
      const res = await postJson<{ subscribed: boolean }>("/api/subscribe", {
        channelId: channel.id,
        on: !subscribed,
      });
      setSubscribed(res.subscribed);
      toast.success(res.subscribed ? "Subscribed" : "Unsubscribed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subscription");
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 border-b border-border/40 py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-6">
      <Link
        href={`/channel/${channel.handle}`}
        className="mx-auto shrink-0 sm:mx-0"
        aria-label={`Go to ${channel.name}`}
      >
        <img
          src={channel.avatarUrl}
          alt={`${channel.name} avatar`}
          loading="lazy"
          className="size-24 rounded-full object-cover sm:size-28"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/channel/${channel.handle}`} className="group">
          <h3 className="flex items-center gap-1 text-lg font-medium text-foreground group-hover:text-primary">
            <span className="truncate">{channel.name}</span>
            {channel.verified && <VerifiedBadge />}
          </h3>
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`}
          {channel.subscriberCountText ? ` · ${channel.subscriberCountText}` : ` · ${formatSubscribers(channel.subscriberCount)}`}
          {channel.videoCountText ? ` · ${channel.videoCountText}` : ""}
        </p>
        {channel.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{channel.description}</p>
        )}
      </div>
      <div className="shrink-0">
        <Button
          onClick={toggleSubscribe}
          disabled={subscribing}
          aria-pressed={subscribed}
          className={`rounded-full ${
            subscribed
              ? "bg-secondary text-foreground hover:bg-accent"
              : "bg-foreground text-background hover:bg-foreground/90"
          }`}
        >
          {subscribed ? (
            <>
              <Bell className="mr-2 size-4" aria-hidden /> Subscribed
            </>
          ) : subscribing ? (
            "Subscribing…"
          ) : (
            <>
              <Check className="mr-2 size-4 opacity-0" aria-hidden /> Subscribe
            </>
          )}
        </Button>
      </div>
    </article>
  );
}
