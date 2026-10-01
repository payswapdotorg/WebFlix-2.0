"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/studio-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ChannelInfo } from "@/lib/types";

interface SessionInfo { session: { email: string; name: string } | null }

export default function SettingsPage() {
  const [session, setSession] = useState<SessionInfo["session"]>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);

  useEffect(() => {
    apiGet<SessionInfo>("/api/auth/session").then((r) => { if (r.ok) setSession(r.data.session); });
    apiGet<{ channel: ChannelInfo | null }>("/api/studio/channel").then((r) => { if (r.ok) setChannel(r.data.channel); });
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-foreground">Account</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Signed in as <span className="font-medium">{session?.email ?? "…"}</span></p>
          <p className="text-muted-foreground">WebFlix Studio uses the same <code className="text-xs">wf:auth:user:&lt;email&gt;</code> user store as the main app (scrypt-verified credentials). Sessions are per-domain, like youtube.com and studio.youtube.com.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-foreground">Channel</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{channel ? `${channel.title} (${channel.handle})` : "Operator channel unresolved — the main app /api/studio response is unavailable or empty."}</p>
          <p className="text-muted-foreground">Channel data is read through server-side proxies of the main app&apos;s public APIs and cached in Upstash (in-memory fallback for dev/tests).</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-foreground">Session</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={async () => { await apiPost("/api/auth/sign-out", {}); window.location.href = "/sign-in"; }}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
