"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/studio-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, HonestBanner } from "@/components/degraded";
import { showToast } from "@/components/toaster";
import type { ChannelInfo } from "@/lib/types";

export default function CustomizationPage() {
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ channel: ChannelInfo | null }>("/api/studio/channel").then((r) => {
      if (r.ok && r.data.channel) {
        setChannel(r.data.channel);
        setTitle(r.data.channel.title);
        setDescription(r.data.channel.description ?? "");
      } else setDegraded(r.ok ? "No operator channel resolved." : r.reason);
    });
  }, []);

  async function save() {
    if (!channel) return;
    setBusy(true);
    const r = await apiPost("/api/studio/customization", { handle: channel.handle, title, description });
    setBusy(false);
    if (!r.ok) {
      const reason = r.json && typeof r.json === "object" && "reason" in r.json ? String((r.json as { reason: unknown }).reason) : "Save unavailable.";
      showToast(reason, "warn");
    } else {
      showToast("Saved via the main-app broker.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Channel customization</h1>
      {degraded && <HonestBanner reason={degraded} />}
      {!channel ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-foreground">Basic info</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Name</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><label className="text-xs text-muted-foreground">Handle</label><Input value={channel.handle} readOnly className="bg-muted" /></div>
              <div><label className="text-xs text-muted-foreground">Description</label><textarea className="min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <p className="text-xs text-muted-foreground">Saves attempt the main-app broker write kind; when it isn&apos;t available you get an honest degrade instead of a fake success.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-foreground">Branding</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-6">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Avatar (read)</p>
                <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
                  {channel.avatarUrl && <img src={channel.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />}
                </div>
              </div>
              <div className="flex-1">
                <p className="mb-1 text-xs text-muted-foreground">Banner (read)</p>
                <div className="h-16 w-full max-w-md overflow-hidden rounded-lg bg-muted">
                  {channel.bannerUrl && <img src={channel.bannerUrl} alt="Banner" className="h-full w-full object-cover" />}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-foreground">Layout</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Layout channel-home sections are managed on the main app — WebFlix Studio shows them read-only until a broker write kind exists.</p>
              {channel.videoCount != null && <p>Videos on channel: <span className="font-medium text-foreground">{channel.videoCount}</span></p>}
              {!channel.avatarUrl && !channel.bannerUrl && <EmptyState text="No branding assets published by the main app yet." />}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
