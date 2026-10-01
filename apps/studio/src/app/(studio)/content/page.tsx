"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, MessageSquare, MoreVertical, Smartphone, Trash2, Video } from "lucide-react";
import { apiGet } from "@/lib/studio-client";
import { DATE_PRESETS, filterByDatePreset, filterByTab, fmtNumber, pageCount, paginate, shareableLink, timeAgo, visibilityBadge, type ContentTab, type DatePresetKey } from "@/lib/table";
import type { NormalizedPost, NormalizedVideo } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { EmptyState, HonestBanner } from "@/components/degraded";
import { showToast } from "@/components/toaster";
import { useMainAppUrl } from "@/components/studio-shell";

const TABS: { key: ContentTab; label: string }[] = [
  { key: "videos", label: "Videos" },
  { key: "shorts", label: "Shorts" },
  { key: "live", label: "Live" },
  { key: "posts", label: "Posts" },
];

function KindIcon({ kind }: { kind: NormalizedVideo["kind"] }) {
  if (kind === "short") return <Smartphone className="h-4 w-4 text-muted-foreground" />;
  if (kind === "live") return <Video className="h-4 w-4 text-red-600" />;
  return <Video className="h-4 w-4 text-muted-foreground" />;
}

export default function ContentPage() {
  const main = useMainAppUrl();
  const router = useRouter();
  const [tab, setTab] = useState<ContentTab>("videos");
  const [videos, setVideos] = useState<NormalizedVideo[] | null>(null);
  const [posts, setPosts] = useState<NormalizedPost[] | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePresetKey>("all");
  const [visibility, setVisibility] = useState<"all" | NormalizedVideo["visibility"]>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setDegraded(null);
    setPage(1);
    setSelected(new Set());
    if (tab === "posts") {
      const r = await apiGet<{ posts: NormalizedPost[]; degraded: boolean; reason: string | null }>("/api/studio/community");
      if (r.ok) { setPosts(r.data.posts); setDegraded(r.data.reason); } else { setPosts([]); setDegraded(r.reason); }
      return;
    }
    const r = await apiGet<{ videos: NormalizedVideo[] }>(`/api/studio/videos?tab=${tab}&limit=200`);
    if (r.ok) { setVideos(r.data.videos); } else { setVideos([]); setDegraded(r.reason); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (tab === "posts") return [];
    const t = filterByTab(videos ?? [], tab);
    const d = filterByDatePreset(t, datePreset);
    const v = visibility === "all" ? d : d.filter((x) => x.visibility === visibility);
    return [...v].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  }, [videos, tab, datePreset, visibility]);

  const pageRows = paginate(rows, page, 25);
  const pages = pageCount(rows.length, 25);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  function rowActions(v: NormalizedVideo) {
    return (
      <Dropdown renderTrigger={() => (
        <button type="button" aria-label={`Actions for ${v.title}`} className="rounded p-1.5 hover:bg-muted"><MoreVertical className="h-4 w-4" /></button>
      )}>
        {(close) => (
          <div>
            <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" onClick={() => { close(); window.open(`${main}/watch?v=${v.id}`, "_blank"); }}>
              <ExternalLink className="h-4 w-4" /> Edit on main app
            </button>
            <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" onClick={() => { close(); router.push("/community"); }}>
              <MessageSquare className="h-4 w-4" /> Comments
            </button>
            <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted" onClick={() => {
              close();
              const link = shareableLink(main, v.id);
              if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => showToast("Shareable link copied")).catch(() => showToast(link));
              else showToast(link);
            }}>
              <Copy className="h-4 w-4" /> Get shareable link
            </button>
            <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground" onClick={() => { close(); showToast("Download isn't available in WebFlix Studio yet (honest degrade).", "warn"); }}>
              <Download className="h-4 w-4" /> Download
            </button>
            <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground" onClick={() => { close(); showToast("Delete needs broker write support — manage deletes on the main app (honest degrade).", "warn"); }}>
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        )}
      </Dropdown>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">Channel content</h1>
      {degraded && <HonestBanner reason={degraded} />}

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "posts" ? (
        !posts ? <p className="text-sm text-muted-foreground">Loading…</p>
          : posts.length === 0 ? <EmptyState text="No community posts yet — posts authored in the main app will appear here." />
            : <div className="space-y-2">{posts.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4">
                <p className="text-sm">{p.text || "(empty post body)"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{timeAgo(p.publishedAt)}</p>
              </div>
            ))}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-lg border bg-white px-3 py-1.5 text-sm" value={datePreset} onChange={(e) => { setDatePreset(e.target.value as DatePresetKey); setPage(1); }}>
              {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select className="rounded-lg border bg-white px-3 py-1.5 text-sm" value={visibility} onChange={(e) => { setVisibility(e.target.value as typeof visibility); setPage(1); }}>
              <option value="all">All visibility</option>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
            <span className="ml-auto text-xs text-muted-foreground">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
          </div>

          {!videos ? <p className="text-sm text-muted-foreground">Loading…</p>
            : rows.length === 0 ? <EmptyState text="No items match this tab and filter combination." />
              : (
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-10 p-3">
                          <input type="checkbox" aria-label="Select all on page" checked={allOnPageSelected}
                            onChange={(e) => {
                              const next = new Set(selected);
                              for (const r of pageRows) { if (e.target.checked) next.add(r.id); else next.delete(r.id); }
                              setSelected(next);
                            }} />
                        </th>
                        <th className="p-3">Video</th>
                        <th className="p-3">Visibility</th>
                        <th className="p-3">Restrictions</th>
                        <th className="p-3">Date</th>
                        <th className="p-3 text-right">Views</th>
                        <th className="p-3 text-right">Comments</th>
                        <th className="p-3 text-right">Likes</th>
                        <th className="w-12 p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((v) => {
                        const badge = visibilityBadge(v.visibility);
                        return (
                          <tr key={v.id} className="group border-b last:border-0 hover:bg-muted/50">
                            <td className="p-3">
                              <input type="checkbox" aria-label={`Select ${v.title}`} checked={selected.has(v.id)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(v.id); else next.delete(v.id);
                                  setSelected(next);
                                }} />
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                                  {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="flex items-center gap-1.5 truncate font-medium"><KindIcon kind={v.kind} /> {v.title}</p>
                                  <p className="text-xs text-muted-foreground">{v.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-3"><Badge className={badge.className}>{badge.label}</Badge></td>
                            <td className="p-3 text-muted-foreground">—</td>
                            <td className="p-3 text-muted-foreground">{timeAgo(v.publishedAt)}</td>
                            <td className="p-3 text-right">{fmtNumber(v.views)}</td>
                            <td className="p-3 text-right">{fmtNumber(v.comments)}</td>
                            <td className="p-3 text-right">{fmtNumber(v.likes)}</td>
                            <td className="p-3 text-right">{rowActions(v)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
