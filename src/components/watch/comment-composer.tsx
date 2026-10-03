"use client";

/**
 * WFX2 comment composer — YouTube parity (WFX2-B-S):
 * avatar row + autogrowing textarea ("Comment..." placeholder), char counter
 * "N/10000" (YouTube's limit), Cancel/Comment buttons disabled until
 * non-empty, emoji picker; posts via the canonical `/api/comments` route
 * (direct-first, broker fallback — the server tier owns the routing).
 *
 * Signed-out states, two honest layers (WFX2-P2-AU):
 *  - WebFlix GUEST (no account session) → youtube.com's watch-page
 *    "Sign in to comment" box — the red Sign in affordance links /signin
 *    with the redirect back to this watch page;
 *  - public mode (operator session not configured) → the "Comment..."
 *    affordance → "Sign in to continue to comment" dialog.
 * Never a fake write, either way.
 *
 * WFX2-P6-CR: `viewer` is nullable (anonymous viewers still read); the
 * submit forwards the parent's live replyParams + the watch payload's
 * video snapshot (the direct + local rungs' parameters); a local:true
 * response (the honest WebFlix store — never claims a YouTube write) gets
 * the disclosed "posted on WebFlix" success toast.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmojiPicker } from "./emoji-picker";
import { cn } from "@/lib/utils";
import { post } from "@/lib/watch/client";
import { signInHref } from "@/lib/auth/client";
import type { CommentDto, CommentVideoSnapshotDto, ViewerDto } from "@/lib/watch/types";

/** YouTube's comment-length limit. */
export const COMMENT_MAX_LENGTH = 10_000;

export function CommentComposer({
  videoId,
  parentId,
  parentText,
  replyParams,
  viewer,
  operatorSession = true,
  guest = false,
  video,
  placeholder = "Comment...",
  submitLabel = "Comment",
  autoFocus,
  compact,
  onSubmitted,
  onCancel,
}: {
  videoId: string;
  parentId?: string;
  /** the parent comment's text — lets the broker locate it in the YouTube
   * DOM for the reply's UI path (WFX2-A-W) */
  parentText?: string;
  /** WFX2-P6-CR: the parent's live replyParams — the direct reply rung's
   * wire parameter (null when YouTube served the sign-in modal) */
  replyParams?: string | null;
  /** WFX2-P6-CR: nullable — anonymous viewers get the gate states below */
  viewer: ViewerDto | null;
  /** false in public mode → the signed-out affordance (YouTube parity) */
  operatorSession?: boolean;
  /** WFX2-P2-AU: no WebFlix account session → the "Sign in to comment" box */
  guest?: boolean;
  /** WFX2-P6-CR: the watch payload's snapshot (the local rung's shadow rows) */
  video?: CommentVideoSnapshotDto;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onSubmitted: (c: CommentDto) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const autogrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
  };

  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    if (!ta) {
      setBody((b) => b + emoji);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + emoji.length;
      autogrow();
    });
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await post<CommentDto & { local?: boolean }>(`/api/comments`, {
        videoId,
        body: trimmed,
        parentId,
        parentText,
        ...(replyParams ? { replyParams } : {}),
        ...(video ? { video } : {}),
      });
      onSubmitted(created);
      setBody("");
      if (taRef.current) taRef.current.style.height = "auto";
      // WFX2-P6-CR: disclose the local store's origin honestly; YouTube-path
      // writes keep their existing (silent) success behavior
      if (created.local) {
        toast.success(parentId ? "Reply posted on WebFlix" : "Comment posted on WebFlix");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  };

  const empty = body.trim().length === 0;
  const showCounter = operatorSession && (focused || body.length > 0);

  // ---- WebFlix guest: youtube.com's exact "Sign in to comment" box ----
  if (guest) {
    return (
      <div className="flex w-full gap-3">
        <Avatar className={cn(compact ? "size-6" : "size-9 sm:size-10")}>
          <AvatarFallback aria-hidden="true">
            <span className="text-xs text-muted-foreground">?</span>
          </AvatarFallback>
        </Avatar>
        <div className="flex h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-border px-4">
          <span className="truncate text-sm text-muted-foreground">Sign in to comment</span>
          <Link
            href={signInHref(`/watch/${videoId}`)}
            className="shrink-0 text-sm font-medium text-yt-red hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  // ---- signed-out (public mode): YouTube's signed-out comment box ----
  if (!operatorSession) {
    return (
      <>
        <div className="flex w-full gap-3">
          <Avatar className={cn(compact ? "size-6" : "size-9 sm:size-10")}>
            <AvatarFallback aria-hidden="true">
              <span className="text-xs text-muted-foreground">?</span>
            </AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={() => setSignInOpen(true)}
            className="min-w-0 flex-1 border-b border-border pb-1.5 pt-2 text-left text-sm text-muted-foreground transition hover:border-foreground"
            aria-label="Comment — sign in to comment"
          >
            Comment...
          </button>
        </div>
        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Sign in to continue to comment</DialogTitle>
              <DialogDescription>
                WebFlix comments act on the operator&apos;s YouTube session (single-tenant live
                mode). No session is configured right now — public reads work, writes need the
                session.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSignInOpen(false)} className="rounded-full">
                Cancel
              </Button>
              <Button asChild className="rounded-full">
                <a href="/account">Sign in</a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="flex w-full gap-3">
      <Avatar className={cn(compact ? "size-6" : "size-9 sm:size-10")}>
        <AvatarImage src={viewer?.avatarUrl ?? ""} alt="" />
        <AvatarFallback>{(viewer?.name ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center border-b border-border pb-1.5 transition focus-within:border-foreground">
          <textarea
            ref={taRef}
            value={body}
            autoFocus={autoFocus}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setBody(e.target.value);
              autogrow();
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !empty) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape" && onCancel) onCancel();
            }}
            rows={1}
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={COMMENT_MAX_LENGTH}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-1">
          {showCounter && (
            <span
              className="text-xs tabular-nums text-muted-foreground"
              aria-label={`${body.length} of ${COMMENT_MAX_LENGTH} characters`}
            >
              {body.length}/{COMMENT_MAX_LENGTH}
            </span>
          )}
          <div className="flex items-center justify-end gap-1">
            <EmojiPicker onPick={insertEmoji} />
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 rounded-full px-4"
                onClick={onCancel}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-full px-4"
              disabled={empty || busy}
              onClick={submit}
            >
              {busy ? "Posting…" : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
