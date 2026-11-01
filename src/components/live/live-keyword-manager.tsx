"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Parity P73-1 — the HOST console's room keyword
 * filter manager (the TikTok-parity layer, ADR-0012): the blocked-pattern
 * CRUD (1..60 chars, cap 50 per room — the SERVER's law, the 409 renders
 * honestly) and the link-blocking toggle. Every mutation is audited
 * server-side (the keyword-add/keyword-remove ledger kinds).
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { liveFetch, toastLiveFailure } from "@/components/live/use-live-stream";
import type { LiveRoomKeywordDto, LiveRoomKeywordsDto } from "@/lib/live/types";

const KEYWORD_MAX = 60; // mirrors permissions.ts KEYWORD_MAX

export function LiveKeywordManager({ roomId }: { roomId: string }): JSX.Element {
  const [blockLinks, setBlockLinks] = useState(false);
  const [keywords, setKeywords] = useState<LiveRoomKeywordDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await liveFetch<LiveRoomKeywordsDto>(`/api/live-rooms/${roomId}/keywords`, {
      method: "GET",
    });
    if (res.ok) {
      setBlockLinks(res.data.blockLinks);
      setKeywords(res.data.keywords);
      setError(null);
    }
    setLoaded(true);
  }, [roomId]);

  useEffect(() => {
    // Deferred to a timer callback (external-system subscription shape —
    // the fetch's setState must not land in the effect body).
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  const add = useCallback(async () => {
    const pattern = draft.trim();
    if (pattern.length < 1) return;
    setBusy(true);
    const res = await liveFetch<{ keyword: LiveRoomKeywordDto }>(
      `/api/live-rooms/${roomId}/keywords`,
      { body: { pattern } },
    );
    setBusy(false);
    if (res.ok) {
      setKeywords((prev) => [res.data.keyword, ...prev.filter((k) => k.id !== res.data.keyword.id)]);
      setDraft("");
      setError(null);
    } else if (res.failure.code === "conflict") {
      setError("This room already has 50 blocked keywords — remove one first.");
    } else if (res.failure.code === "invalid") {
      setError(`Patterns are 1..${KEYWORD_MAX} characters.`);
    } else {
      toastLiveFailure(res.failure, "The keyword didn't save.");
    }
  }, [draft, roomId]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      const res = await liveFetch<{ removed: boolean }>(
        `/api/live-rooms/${roomId}/keywords?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setBusy(false);
      if (res.ok) {
        setKeywords((prev) => prev.filter((k) => k.id !== id));
        setError(null);
      } else {
        toastLiveFailure(res.failure, "The keyword didn't remove.");
      }
    },
    [roomId],
  );

  const toggleLinks = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      const res = await liveFetch<{ blockLinks: boolean }>(
        `/api/live-rooms/${roomId}/keywords`,
        { method: "PATCH", body: { blockLinks: enabled } },
      );
      setBusy(false);
      if (res.ok) {
        setBlockLinks(res.data.blockLinks);
        setError(null);
      } else {
        toastLiveFailure(res.failure, "The link policy didn't change.");
      }
    },
    [roomId],
  );

  return (
    <Card data-testid="live-keyword-manager" className="min-w-0 gap-4">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
          Chat filters
        </CardTitle>
        <CardDescription>
          Blocked words refuse a send with an honest notice — nothing is ever silently rewritten.
          Links can be blocked for the whole room.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div>
            <Label htmlFor="keyword-block-links" className="text-sm font-medium">
              Block links
            </Label>
            <p className="text-xs text-muted-foreground">
              Refuse any http/https/www link in chat while on.
            </p>
          </div>
          <Switch
            id="keyword-block-links"
            data-testid="keyword-block-links"
            checked={blockLinks}
            disabled={busy}
            onCheckedChange={(v) => void toggleLinks(v)}
          />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            data-testid="keyword-draft"
            aria-label="Blocked word or phrase"
            placeholder="Add a blocked word or phrase…"
            value={draft}
            maxLength={KEYWORD_MAX}
            onChange={(e) => setDraft(e.target.value)}
            className="h-9"
          />
          <Button type="submit" size="sm" data-testid="keyword-add" disabled={busy || draft.trim().length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add
          </Button>
        </form>
        {error && (
          <p role="alert" data-testid="keyword-error" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="max-h-40 space-y-1 overflow-y-auto pr-1" data-testid="keyword-list">
          {loaded && keywords.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
              No blocked words yet — the room accepts all chat.
            </p>
          ) : (
            keywords.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-sm text-foreground">{k.pattern}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  disabled={busy}
                  onClick={() => void remove(k.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
