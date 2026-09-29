"use client";

/**
 * WFX2-W report dialog — flag reasons, POST /api/videos/[id]/report
 * (review queue; the video stays visible, matching youtube.com).
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

const REASONS = [
  "Sexual content",
  "Violent or repulsive content",
  "Hateful or abusive content",
  "Harassment or bullying",
  "Harmful or dangerous acts",
  "Misinformation",
  "Spam or misleading",
  "Copyright infringement",
];

export function ReportDialog({
  open,
  onOpenChange,
  videoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videoId: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await post(`/api/videos/${videoId}/report`, { reason });
      toast.success("Thanks for reporting. We'll review the video.");
      onOpenChange(false);
      setReason(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to report");
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
            Report video
          </DialogTitle>
          <DialogDescription>
            Tell us why you&apos;re reporting this video. Reports go to our review queue.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Report reason" className="max-h-72 overflow-y-auto">
          {REASONS.map((r) => (
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
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
