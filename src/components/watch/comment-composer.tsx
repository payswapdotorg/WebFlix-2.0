"use client";

/**
 * WFX2-W comment composer — avatar + autogrowing textarea + emoji picker
 * (real insert at the caret) + Cancel/Comment buttons disabled-on-empty;
 * optimistic submit with server persistence (moderation default approved).
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmojiPicker } from "./emoji-picker";
import { cn } from "@/lib/utils";
import { post } from "@/lib/watch/client";
import type { CommentDto, ViewerDto } from "@/lib/watch/types";

export function CommentComposer({
  videoId,
  parentId,
  viewer,
  placeholder = "Add a comment...",
  submitLabel = "Comment",
  autoFocus,
  compact,
  onSubmitted,
  onCancel,
}: {
  videoId: string;
  parentId?: string;
  viewer: ViewerDto;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onSubmitted: (c: CommentDto) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
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
      const created = await post<CommentDto>(`/api/videos/${videoId}/comments`, {
        body: trimmed,
        parentId,
      });
      onSubmitted(created);
      setBody("");
      if (taRef.current) taRef.current.style.height = "auto";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  };

  const empty = body.trim().length === 0;

  return (
    <div className="flex w-full gap-3">
      <Avatar className={cn(compact ? "size-6" : "size-9 sm:size-10")}>
        <AvatarImage src={viewer.avatarUrl} alt="" />
        <AvatarFallback>{viewer.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center border-b border-border pb-1.5 transition focus-within:border-foreground">
          <textarea
            ref={taRef}
            value={body}
            autoFocus={autoFocus}
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
            maxLength={5000}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1">
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
  );
}
