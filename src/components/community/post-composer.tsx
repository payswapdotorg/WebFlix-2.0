"use client";

/**
 * WFX2-P2-SO — the creator post composer (the OWN channel's Community tab):
 * text / image URL / poll with 2-5 options → POST /api/posts → broker
 * post-create (youtube.com's real backstage create flow). Deep-linkable via
 * ?compose=1 on the channel community tab.
 *
 * The UI state machine (fixture-tested):
 *   idle → composing (text | image | poll, validated) → submitting →
 *   success (toast + the caller reloads the tab) | error (inline + retry).
 * Poll options: add up to 5, remove down to 2; each non-empty and distinct
 * in spirit (YouTube's own composer refuses empties).
 */
import { useState } from "react";
import { BarChart3, Image as ImageIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { postJson } from "@/hooks/use-api";
import type { ChannelTabDTO } from "@/lib/types";

export const MAX_POST_TEXT_LENGTH = 15_000;
export const MAX_POLL_OPTIONS = 5;
export const MIN_POLL_OPTIONS = 2;

interface PostCreateResponse {
  ok: true;
  effect: string;
  verified?: boolean;
  path?: string;
  note?: string;
}

/** The composer's gating rule — exported for the state-machine tests. */
export function canSubmitPost(input: {
  text: string;
  imageUrl: string;
  pollOn: boolean;
  pollOptions: string[];
}): boolean {
  const hasBody = input.text.trim().length > 0 || /^https?:\/\//.test(input.imageUrl.trim());
  if (!input.pollOn) return hasBody;
  return (
    input.pollOptions.length >= MIN_POLL_OPTIONS &&
    input.pollOptions.every((o) => o.trim().length > 0)
  );
}

export function PostComposer({
  handle,
  onCreated,
  onClose,
}: {
  /** the OWN channel's handle (the broker navigates its community tab) */
  handle: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageOn, setImageOn] = useState(false);
  const [pollOn, setPollOn] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submittable = canSubmitPost({ text, imageUrl, pollOn, pollOptions });

  function setOption(i: number, value: string) {
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? value : o)));
  }
  function addOption() {
    setPollOptions((opts) => (opts.length >= MAX_POLL_OPTIONS ? opts : [...opts, ""]));
  }
  function removeOption(i: number) {
    setPollOptions((opts) =>
      opts.length <= MIN_POLL_OPTIONS ? opts : opts.filter((_, idx) => idx !== i)
    );
  }

  async function submit() {
    if (!submittable || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postJson<PostCreateResponse>("/api/posts", {
        handle,
        text: text.trim(),
        ...(imageOn && imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(pollOn ? { pollOptions: pollOptions.map((o) => o.trim()) } : {}),
      });
      toast.success(
        res.verified === false && res.note
          ? "Post submitted — confirming on the next refresh"
          : "Post created"
      );
      onCreated();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create the post";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-border bg-background p-4 sm:p-5"
      aria-label="Create a community post"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Create a post</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the post composer"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_POST_TEXT_LENGTH))}
        placeholder="Share something with your community…"
        aria-label="Post text"
        rows={4}
        maxLength={MAX_POST_TEXT_LENGTH}
        className="mt-3 w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <p className="mt-1 text-right text-[11px] text-muted-foreground" aria-live="polite">
        {text.length}/{MAX_POST_TEXT_LENGTH}
      </p>

      <div className="flex items-center gap-2" role="group" aria-label="Attachment type">
        <button
          type="button"
          onClick={() => {
            setImageOn((v) => !v);
            if (!imageOn) setPollOn(false);
          }}
          aria-pressed={imageOn}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
            imageOn ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <ImageIcon className="size-3.5" aria-hidden="true" /> Image
        </button>
        <button
          type="button"
          onClick={() => {
            setPollOn((v) => !v);
            if (!pollOn) setImageOn(false);
          }}
          aria-pressed={pollOn}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
            pollOn ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <BarChart3 className="size-3.5" aria-hidden="true" /> Poll
        </button>
      </div>

      {imageOn && (
        <div className="mt-3">
          <Input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            aria-label="Image URL"
            type="url"
            className="h-9"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            The image is uploaded through YouTube&apos;s own composer pipeline.
          </p>
        </div>
      )}

      {pollOn && (
        <div className="mt-3 space-y-2" aria-label="Poll options">
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                aria-label={`Poll option ${i + 1}`}
                className="h-9"
                maxLength={120}
              />
              {pollOptions.length > MIN_POLL_OPTIONS && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label={`Remove poll option ${i + 1}`}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < MAX_POLL_OPTIONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addOption}
              className="rounded-full"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Add option
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="rounded-full">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={!submittable || submitting}
          className="rounded-full"
        >
          {submitting ? "Posting…" : "Post"}
        </Button>
      </div>
    </section>
  );
}

/** The composer affordance on the own channel's Community tab. */
export function CreatePostButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} className="rounded-full" aria-label="Create a community post">
      <Plus className="size-4" aria-hidden="true" /> Create post
    </Button>
  );
}
