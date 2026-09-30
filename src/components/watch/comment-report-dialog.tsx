"use client";

/**
 * WFX2-B-S comment report dialog — YouTube's ⋮ → Report flow parity: the
 * reasons list (the comment report-dialog family), single select, then
 * POST /api/comments/[id]/report {reason, videoId, commentText} (the broker's
 * ⋮ → Report → dialog DOM path on youtube.com). commentText is the comment's
 * current text — the DOM locator.
 */
import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/watch/client";

export const COMMENT_REPORT_REASONS = [
  "Spam or misleading",
  "Harassment or bullying",
  "Hate speech or graphic violence",
  "Promotes terrorism",
  "Impersonation",
] as const;

export function CommentReportDialog({
  open,
  onOpenChange,
  commentId,
  videoId,
  commentText,
  onReported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  commentId: string;
  videoId: string;
  /** the comment's CURRENT text — the broker's DOM locator */
  commentText?: string;
  onReported?: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await post(`/api/comments/${commentId}/report`, {
        videoId,
        reason,
        ...(commentText ? { commentText } : {}),
      });
      toast.success("Thanks for reporting. We'll review the comment.");
      onOpenChange(false);
      setReason(null);
      onReported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to report comment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setReason(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-5" aria-hidden="true" />
            Report comment
          </DialogTitle>
          <DialogDescription>
            Tell us why you&apos;re reporting this comment.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Report comment reason" className="max-h-72 overflow-y-auto">
          {COMMENT_REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition hover:bg-accent"
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full border ${
                  reason === r ? "border-[#f03]" : "border-muted-foreground/60"
                }`}
                aria-hidden="true"
              >
                {reason === r && <span className="size-2 rounded-full bg-[#f03]" />}
              </span>
              {r}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={!reason || busy}
            onClick={submit}
          >
            {busy ? "Reporting…" : "Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
