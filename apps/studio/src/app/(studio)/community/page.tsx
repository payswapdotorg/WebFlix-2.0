"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Heart, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/studio-client";
import { groupByState } from "@/lib/comments";
import { timeAgo } from "@/lib/table";
import type { CommentState, NormalizedComment } from "@/lib/types";
import { EmptyState, HonestBanner } from "@/components/degraded";
import { showToast } from "@/components/toaster";

const TABS: { key: CommentState; label: string }[] = [
  { key: "published", label: "Published" },
  { key: "heldForReview", label: "Held for review" },
  { key: "likelySpam", label: "Likely spam" },
];

export default function CommunityPage() {
  const [tab, setTab] = useState<CommentState>("published");
  const [comments, setComments] = useState<NormalizedComment[] | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDegraded(null);
    const r = await apiGet<{ comments: NormalizedComment[]; degraded: boolean; reason: string | null }>("/api/studio/comments");
    if (r.ok) { setComments(r.data.comments); setDegraded(r.data.reason); }
    else { setComments([]); setDegraded(r.reason); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(commentId: string, action: "approve" | "delete" | "heart") {
    const r = await apiPost("/api/studio/comments", { commentId, action });
    if (!r.ok) {
      showToast("Comment actions are unavailable right now: broker offline (honest degrade — nothing was changed).", "warn");
      return;
    }
    showToast(`Comment ${action === "heart" ? "hearted" : action === "approve" ? "approved" : "deleted"}.`);
    load();
  }

  const counts = comments ? groupByState(comments) : { published: 0, heldForReview: 0, likelySpam: 0 };
  const rows = (comments ?? []).filter((c) => c.state === tab);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Comments</h1>
      {degraded && <HonestBanner reason={degraded} />}

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {!comments ? <p className="text-sm text-muted-foreground">Loading…</p>
        : rows.length === 0 ? <EmptyState text="No comments in this queue. Comments arrive from the main app once videos receive activity." />
          : (
            <div className="space-y-2">
              {rows.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {c.authorName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.authorName}{c.hearted && <Heart className="ml-1 inline h-3.5 w-3.5 fill-red-600 text-red-600" />}</p>
                    <p className="text-sm">{c.text || "(empty comment)"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{timeAgo(c.publishedAt)} · {c.videoTitle ? `on “${c.videoTitle}”` : "on a video"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button aria-label="Heart comment" className="rounded p-2 hover:bg-muted" onClick={() => act(c.id, "heart")}><Heart className="h-4 w-4" /></button>
                    <button aria-label="Approve comment" className="rounded p-2 hover:bg-muted" onClick={() => act(c.id, "approve")}><Check className="h-4 w-4" /></button>
                    <button aria-label="Delete comment" className="rounded p-2 hover:bg-muted" onClick={() => act(c.id, "delete")}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
