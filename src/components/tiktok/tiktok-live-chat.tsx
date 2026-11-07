"use client";

/**
 * P100-TIKTOK-LIVE — the watch-party chat panel: the INTERACT closure for a
 * TikTok live on WebFlix. Durable, WebFlix-native, cursor-polled (the
 * serverless-safe transport), signed-in to send with the INLINE guest gate
 * (the P96 law — never a hard /signin eject), idempotent sends with an
 * optimistic echo, tombstoned rows render "message removed".
 *
 * THE FOOTNOTE IS THE LAW: this chat is WebFlix-native. TikTok's own live
 * chat is NOT mirrored here yet (operator-gated relay, P100 report §6) and
 * no TikTok write is claimed or performed — the TikTok-side actions live on
 * the page as outbound links.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizonal, Trash2 } from "lucide-react";

import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { tiktokLiveHref } from "@/lib/tiktok/urls";
import { shadowUserId } from "@/lib/watch/identity";
import type { TikTokLiveChatMessageDto } from "@/lib/tiktok/live-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type ChatPage = { items: TikTokLiveChatMessageDto[]; nextCursor: string | null };

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function TikTokLiveChatPanel({
  roomKey,
  chatPollMs = 4_000,
}: {
  roomKey: string;
  chatPollMs?: number;
}) {
  const session = useWebFlixSession();
  const [items, setItems] = useState<TikTokLiveChatMessageDto[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cursorRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const applyPage = useCallback((page: ChatPage, replace: boolean) => {
    setItems((prev) => {
      const base = replace ? [] : (prev ?? []);
      const merged = [...base];
      for (const row of page.items) {
        // replace optimistic echoes / duplicates by id
        const idx = merged.findIndex((m) => m.id === row.id);
        if (idx >= 0) merged[idx] = row;
        else merged.push(row);
      }
      return merged;
    });
    if (page.nextCursor) cursorRef.current = page.nextCursor;
  }, []);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;

    const poll = async () => {
      try {
        const suffix = first ? "" : cursorRef.current ? `?after=${encodeURIComponent(cursorRef.current)}` : "";
        const res = await fetch(`/api/tiktok/live/chat/${encodeURIComponent(roomKey)}${suffix}`);
        if (!res.ok) return; // a failed poll keeps the last honest transcript
        const page = (await res.json()) as ChatPage;
        if (dead) return;
        applyPage(page, first);
        first = false;
        timer = setTimeout(poll, chatPollMs);
      } catch {
        /* network hiccup — the next tick retries */
        if (!dead) timer = setTimeout(poll, chatPollMs);
      }
    };

    void poll();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomKey, chatPollMs, applyPage]);

  // keep the newest row visible (the live-chat scroll law)
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // DOM truth first (the ref survives any missed change event), state second
    const body = (inputRef.current?.value ?? draft).trim();
    if (!body) return;
    const clientMessageId = newClientMessageId();
    setDraft("");
    if (inputRef.current) inputRef.current.value = "";
    setSendError(null);
    // the optimistic echo — replaced by the authoritative row when it lands
    setItems((prev) => [
      ...(prev ?? []),
      {
        id: `optimistic-${clientMessageId}`,
        roomKey,
        body,
        deleted: false,
        createdAt: new Date().toISOString(),
        sender: session.user
          ? { id: shadowUserId(session.user.id), handle: "you", name: session.user.displayName || "You", avatarUrl: "" }
          : null,
      },
    ]);
    try {
      const res = await fetch(`/api/tiktok/live/chat/${encodeURIComponent(roomKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, body }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { message?: TikTokLiveChatMessageDto; error?: string }
        | null;
      if (!res.ok || !payload?.message) {
        setSendError(payload?.error ?? "The message could not be sent.");
        // drop the optimistic echo — it never happened
        setItems((prev) => (prev ?? []).filter((m) => m.id !== `optimistic-${clientMessageId}`));
        return;
      }
      setItems((prev) => {
        const withoutEcho = (prev ?? []).filter((m) => m.id !== `optimistic-${clientMessageId}`);
        if (withoutEcho.some((m) => m.id === payload.message!.id)) return withoutEcho;
        return [...withoutEcho, payload.message!];
      });
      cursorRef.current = payload.message.id;
    } catch {
      setSendError("The message could not be sent.");
      setItems((prev) => (prev ?? []).filter((m) => m.id !== `optimistic-${clientMessageId}`));
    }
  };

  const removeMessage = async (id: string) => {
    setSendError(null);
    try {
      const res = await fetch(
        `/api/tiktok/live/chat/${encodeURIComponent(roomKey)}?messageId=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        setSendError("The message could not be removed.");
        return;
      }
      // the tombstone law: the row stays, the body leaves — the next poll reconciles
      setItems((prev) => (prev ?? []).map((m) => (m.id === id ? { ...m, deleted: true } : m)));
    } catch {
      setSendError("The message could not be removed.");
    }
  };

  return (
    <section
      data-testid="tiktok-live-chat-panel"
      className="flex h-[420px] flex-col overflow-hidden rounded-lg border bg-card"
      aria-label="Watch party chat"
    >
      <header className="border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Watch party</h2>
        <p className="text-[11px] leading-snug text-muted-foreground">
          WebFlix-native chat — TikTok&apos;s own live chat isn&apos;t mirrored here yet, and no
          TikTok write is claimed or performed.
        </p>
      </header>

      <div ref={listRef} className="live-chat-scroll flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {items === null ? (
          <>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet — say something to start the watch party.
          </p>
        ) : (
          items.map((m) => {
            const own =
              session.status === "authenticated" &&
              m.sender?.id != null &&
              m.sender.id === shadowUserId(session.user?.id ?? "");
            return m.deleted ? (
              <p key={m.id} className="text-sm italic text-muted-foreground/70">
                message removed
              </p>
            ) : (
              <div key={m.id} className="flex items-start gap-1.5">
                <p className="min-w-0 flex-1 text-sm leading-snug break-words">
                  <span className="font-medium">{m.sender?.name ?? "Viewer"}</span>
                  <span className="text-muted-foreground">: </span>
                  {m.body}
                </p>
                {own ? (
                  <button
                    type="button"
                    data-testid="tiktok-live-chat-delete"
                    data-message-id={m.id}
                    aria-label="Delete message"
                    title="Delete message"
                    onClick={() => void removeMessage(m.id)}
                    className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <footer className="border-t px-4 py-3">
        {session.status === "authenticated" ? (
          <form data-testid="tiktok-live-chat-form" onSubmit={submit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              data-testid="tiktok-live-chat-input"
              defaultValue=""
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Join the watch party…"
              maxLength={500}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Chat message"
            />
            <Button type="submit" size="sm" className="gap-1.5" disabled={!draft.trim()}>
              <SendHorizonal className="size-4" aria-hidden="true" />
              Send
            </Button>
          </form>
        ) : session.status === "loading" ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div data-testid="tiktok-live-chat-signin" className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Sign in to join the watch party.</p>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/signin?next=${encodeURIComponent(tiktokLiveHref(roomKey))}`}>Sign in</Link>
            </Button>
          </div>
        )}
        {sendError ? (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {sendError}
          </p>
        ) : null}
      </footer>
    </section>
  );
}
