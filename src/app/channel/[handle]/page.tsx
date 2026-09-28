"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers, formatCount, formatRelativeDate } from "@/lib/format";
import type { ChannelPageDTO } from "@/lib/types";

/** Channel page — banner, tabs (Videos / Shorts / Playlists / About), subscribe. */
export default function ChannelPage() {
  const { handle } = useParams<{ handle: string }>();
  const { data, loading, error, reload } = useApi<ChannelPageDTO>(
    handle ? `/api/channel/${encodeURIComponent(handle)}` : null
  );
  const [subscribing, setSubscribing] = useState(false);

  async function toggleSubscribe() {
    if (!data) return;
    setSubscribing(true);
    try {
      const res = await postJson<{ subscribed: boolean }>("/api/subscribe", {
        channelId: data.channel.id,
      });
      toast.success(res.subscribed ? "Subscribed" : "Unsubscribed");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subscription");
    } finally {
      setSubscribing(false);
    }
  }

  if (error) {
    return (
      <div className="px-4 py-16 text-center sm:px-6" role="alert">
        <p className="text-lg font-medium">Channel not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {loading && (
        <div className="space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}
      {data && (
        <>
          {/* banner */}
          <div className="h-28 w-full overflow-hidden bg-secondary sm:h-36 lg:h-44">
            {data.channel.bannerUrl && (
              <img
                src={data.channel.bannerUrl}
                alt={`${data.channel.name} banner`}
                className="h-full w-full object-cover"
              />
            )}
          </div>

          {/* header */}
          <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
            <img
              src={data.channel.avatarUrl}
              alt={data.channel.name}
              className="size-20 rounded-full object-cover sm:size-24"
            />
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-xl font-bold sm:text-3xl">
                <span className="truncate">{data.channel.name}</span>
                {data.channel.verified && <VerifiedBadge className="size-5" />}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                @/{data.channel.handle} ·{" "}
                <span className="font-medium text-foreground">
                  {formatSubscribers(data.channel.subscriberCount)}
                </span>{" "}
                · {formatCount(data.channel.videoCount)} videos
              </p>
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                {data.channel.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {data.channel.isOwner ? (
                <Button asChild variant="secondary" className="rounded-full">
                  <Link href="/studio">Your channel — open Studio</Link>
                </Button>
              ) : (
                <Button
                  onClick={toggleSubscribe}
                  disabled={subscribing}
                  className={`rounded-full ${
                    data.channel.isSubscribed
                      ? "bg-secondary text-foreground hover:bg-accent"
                      : "bg-foreground text-background hover:bg-foreground/90"
                  }`}
                >
                  {data.channel.isSubscribed ? (
                    <>
                      <Bell className="mr-2 size-4" /> Subscribed
                    </>
                  ) : (
                    "Subscribe"
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* tabs */}
          <Tabs defaultValue="videos" className="px-4 sm:px-6">
            <TabsList className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 no-scrollbar">
              <TabsTrigger
                value="videos"
                className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-2 text-sm font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                Videos
              </TabsTrigger>
              <TabsTrigger
                value="shorts"
                className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-2 text-sm font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                Shorts
              </TabsTrigger>
              <TabsTrigger
                value="playlists"
                className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-2 text-sm font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                Playlists
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-2 text-sm font-medium data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground"
              >
                About
              </TabsTrigger>
            </TabsList>

            <TabsContent value="videos" className="mt-6">
              {data.videos.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  This channel hasn't uploaded any videos yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {data.videos.map((video) => (
                    <VideoCard key={video.id} video={video} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="shorts" className="mt-6">
              {data.shorts.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No Shorts from this channel yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {data.shorts.map((short) => (
                    <Link
                      key={short.id}
                      href="/shorts"
                      className="group flex flex-col gap-2"
                      aria-label={short.title}
                    >
                      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
                        <img
                          src={short.thumbnailUrl}
                          alt={short.title}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </div>
                      <p className="line-clamp-2 text-sm font-medium leading-snug">{short.title}</p>
                      <p className="-mt-1 text-xs text-muted-foreground">
                        {formatCount(short.views)} views
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="playlists" className="mt-6">
              <p className="py-10 text-center text-sm text-muted-foreground">
                No public playlists from this channel yet.
              </p>
            </TabsContent>

            <TabsContent value="about" className="mt-6">
              <div className="max-w-2xl space-y-4">
                <div>
                  <h2 className="text-base font-semibold">Description</h2>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                    {data.channel.description ?? "No description."}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Subscribers</dt>
                    <dd className="font-medium">{formatCount(data.channel.subscriberCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Videos</dt>
                    <dd className="font-medium">{formatCount(data.channel.videoCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Joined</dt>
                    <dd className="font-medium">
                      {new Date(data.channel.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                </dl>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
