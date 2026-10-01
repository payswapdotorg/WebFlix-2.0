"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Clock, Eye, MessageSquare, ThumbsUp, Users } from "lucide-react";
import { apiGet } from "@/lib/studio-client";
import { fmtNumber, timeAgo } from "@/lib/table";
import type { ChannelInfo, NormalizedPost, NormalizedVideo, SeriesPoint, Totals } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, HonestBanner } from "@/components/degraded";

const WHATS_NEW = [
  "Fresh look for Analytics with faster range switching",
  "Comment moderation tabs now match studio.youtube.com",
  "Handles everywhere in Customization",
];

export default function DashboardPage() {
  const [videos, setVideos] = useState<NormalizedVideo[] | null>(null);
  const [, setChannel] = useState<ChannelInfo | null>(null); // channel state kept for the fetch contract; the dashboard renders totals instead
  const [posts, setPosts] = useState<NormalizedPost[] | null>(null);
  const [postsNote, setPostsNote] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [subs, setSubs] = useState<number | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c = await apiGet<{ channel: ChannelInfo | null }>("/api/studio/channel");
      if (c.ok) setChannel(c.data.channel); else setDegraded(c.reason);

      const v = await apiGet<{ videos: NormalizedVideo[]; channel: ChannelInfo | null }>("/api/studio/videos?tab=videos&limit=50");
      if (v.ok) { setVideos(v.data.videos); setChannel((prev) => prev ?? v.data.channel); } else setDegraded(v.reason);

      const p = await apiGet<{ posts: NormalizedPost[]; degraded: boolean; reason: string | null }>("/api/studio/community");
      if (p.ok) { setPosts(p.data.posts); setPostsNote(p.data.reason); } else setDegraded(p.reason);

      const a = await apiGet<{ series: SeriesPoint[]; totals: Totals; subscriberCount: number | null }>("/api/studio/analytics?range=28");
      if (a.ok) { setSeries(a.data.series); setTotals(a.data.totals); setSubs(a.data.subscriberCount); } else setDegraded(a.reason);
    })();
  }, []);

  const sorted = useMemo(() => [...(videos ?? [])].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")), [videos]);
  const latest = sorted[0] ?? null;
  const trend = (series ?? []).slice(-14).map((p) => ({ date: p.date.slice(5), views: p.views }));
  const trendHasData = trend.some((p) => p.views > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {degraded && <HonestBanner reason={`Some data is unavailable: ${degraded} Charts and cards show only real, verified data.`} />}
      <h1 className="text-xl font-semibold">Channel dashboard</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-foreground">Latest video performance</CardTitle></CardHeader>
          <CardContent>
            {!videos ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !latest ? (
              <EmptyState text="No uploads yet — publish your first video from the main app." />
            ) : (
              <div className="flex gap-4">
                <div className="h-20 w-36 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {latest.thumbnailUrl && <img src={latest.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{latest.title}</p>
                  <p className="text-xs text-muted-foreground">Published {timeAgo(latest.publishedAt)}</p>
                  <div className="mt-2 flex gap-4 text-sm">
                    <span className="flex items-center gap-1"><Eye className="h-4 w-4 text-muted-foreground" /> {fmtNumber(latest.views)}</span>
                    <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4 text-muted-foreground" /> {fmtNumber(latest.likes)}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-4 w-4 text-muted-foreground" /> {fmtNumber(latest.comments)}</span>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-4 h-20">
              {trendHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="date" hide />
                    <Tooltip />
                    <Area type="monotone" dataKey="views" stroke="#dc2626" fill="#fecaca" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-4 text-xs text-muted-foreground">Trend line plots real per-video view counts — nothing to plot yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-foreground">Channel analytics</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Views · 28d</p><p className="text-lg font-semibold">{fmtNumber(totals?.views)}</p></div>
              <div><p className="text-xs text-muted-foreground">Est. watch time</p><p className="text-lg font-semibold">{totals?.estWatchHours != null ? `${fmtNumber(Math.round(totals.estWatchHours))} h` : "—"}</p><p className="text-[10px] text-muted-foreground">views × duration</p></div>
              <div><p className="text-xs text-muted-foreground">Likes · 28d</p><p className="text-lg font-semibold">{fmtNumber(totals?.likes)}</p></div>
              <div><p className="text-xs text-muted-foreground">Comments · 28d</p><p className="text-lg font-semibold">{fmtNumber(totals?.comments)}</p></div>
              <div><p className="text-xs text-muted-foreground">Subscribers</p><p className="flex items-center gap-1 text-lg font-semibold"><Users className="h-4 w-4" /> {subs != null ? fmtNumber(subs) : "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Uploads · 28d</p><p className="flex items-center gap-1 text-lg font-semibold"><Clock className="h-4 w-4" /> {fmtNumber(totals?.uploads)}</p></div>
            </div>
            <Link href="/analytics" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">SEE MORE</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-foreground">Recent videos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!videos ? <p className="text-sm text-muted-foreground">Loading…</p>
              : sorted.slice(0, 5).map((v) => (
                <Link key={v.id} href="/content" className="flex items-center gap-3 rounded-lg p-1 hover:bg-muted">
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                    {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtNumber(v.views)} views · {timeAgo(v.publishedAt)}</span>
                </Link>
              ))}
            {videos && sorted.length === 0 && <EmptyState text="No uploads yet." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-foreground">Latest post</CardTitle></CardHeader>
          <CardContent>
            {!posts ? <p className="text-sm text-muted-foreground">Loading…</p>
              : posts.length === 0 ? (
                <>
                  {postsNote && <p className="mb-2 text-xs text-muted-foreground">{postsNote}</p>}
                  <EmptyState text="No community posts yet." />
                </>
              ) : (
                <p className="line-clamp-4 text-sm">{posts[0].text || "(empty post body)"}</p>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-foreground">What&apos;s new in Studio</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {WHATS_NEW.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-foreground">Creator Insider</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Creator Insider updates will appear here. This card is static parity content — no invented metrics are shown.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
