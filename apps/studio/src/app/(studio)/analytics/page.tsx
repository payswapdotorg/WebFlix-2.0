"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/studio-client";
import { RANGES, type RangeKey } from "@/lib/analytics";
import { fmtNumber, timeAgo } from "@/lib/table";
import type { NormalizedVideo, SeriesPoint, Totals } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, HonestBanner } from "@/components/degraded";

type Tab = "overview" | "content" | "audience" | "revenue";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "audience", label: "Audience" },
  { key: "revenue", label: "Revenue" },
];

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<RangeKey>("28");
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [top, setTop] = useState<NormalizedVideo[]>([]);
  const [subs, setSubs] = useState<number | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);

  const load = useCallback(async (r: RangeKey) => {
    setDegraded(null);
    const res = await apiGet<{ series: SeriesPoint[]; totals: Totals; topVideos: NormalizedVideo[]; subscriberCount: number | null; reason?: string; degraded?: boolean }>(`/api/studio/analytics?range=${r}`);
    if (res.ok) {
      setSeries(res.data.series); setTotals(res.data.totals); setTop(res.data.topVideos); setSubs(res.data.subscriberCount);
      setDegraded(res.data.degraded ? res.data.reason ?? "analytics degraded" : null);
    } else {
      setDegraded(res.reason); setSeries([]); setTotals(null); setTop([]);
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  const hasSeries = (series ?? []).some((p) => p.views > 0 || p.likes > 0 || p.comments > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">Channel analytics</h1>
      {degraded && <HonestBanner reason={`Analytics are partially unavailable: ${degraded} Charts plot only real aggregated per-video data.`} />}

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`rounded-full border px-3 py-1 text-xs ${range === r.key ? "border-foreground bg-foreground text-white" : "hover:bg-muted"}`}>
            {r.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card><CardContent><p className="text-xs text-muted-foreground">Views</p><p className="text-2xl font-semibold">{fmtNumber(totals?.views)}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-muted-foreground">Est. watch time (views × duration)</p><p className="text-2xl font-semibold">{totals?.estWatchHours != null ? `${fmtNumber(Math.round(totals.estWatchHours))} h` : "—"}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-muted-foreground">Likes</p><p className="text-2xl font-semibold">{fmtNumber(totals?.likes)}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-muted-foreground">Comments</p><p className="text-2xl font-semibold">{fmtNumber(totals?.comments)}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-foreground">Views over time (aggregated from real per-video counts, bucketed by publish date)</CardTitle></CardHeader>
            <CardContent className="h-72">
              {hasSeries ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" minTickGap={28} fontSize={11} />
                    <YAxis width={48} fontSize={11} />
                    <Tooltip />
                    <Area type="monotone" dataKey="views" stroke="#dc2626" fill="#fecaca" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No data in this range yet — charts plot only real per-video counts, never synthetic series." />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === "content" && (
        <Card>
          <CardHeader><CardTitle className="text-foreground">Top content in range</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? <EmptyState text="No content data in this range." /> : (
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="p-2">Video</th><th className="p-2">Published</th><th className="p-2 text-right">Views</th><th className="p-2 text-right">Likes</th><th className="p-2 text-right">Comments</th></tr></thead>
                <tbody>
                  {top.map((v) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="max-w-64 truncate p-2 font-medium">{v.title}</td>
                      <td className="p-2 text-muted-foreground">{timeAgo(v.publishedAt)}</td>
                      <td className="p-2 text-right">{fmtNumber(v.views)}</td>
                      <td className="p-2 text-right">{fmtNumber(v.likes)}</td>
                      <td className="p-2 text-right">{fmtNumber(v.comments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "audience" && (
        <Card>
          <CardHeader><CardTitle className="text-foreground">Audience</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Subscribers: <span className="font-medium text-foreground">{subs != null ? fmtNumber(subs) : "—"}</span></p>
            <p>Demographics and returning-viewer breakdowns are not exposed by the main-app API yet — this tab degrades honestly instead of estimating.</p>
          </CardContent>
        </Card>
      )}

      {tab === "revenue" && (
        <Card className="mx-auto max-w-xl text-center">
          <CardContent className="p-8">
            <p className="text-lg font-medium">Join the YouTube Partner Program</p>
            <p className="mt-2 text-sm text-muted-foreground">Revenue analytics require partner features that WebFlix Studio doesn&apos;t have yet. No revenue numbers are shown because none exist — we never fake analytics.</p>
            <Button variant="outline" className="mt-4" disabled>Learn more</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
