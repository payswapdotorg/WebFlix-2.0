"use client";

/**
 * WFX2-W share dialog — copy link with the ?t= timestamp checkbox
 * (the copied link seeks on load), social share targets, Embed link.
 */
import { useMemo, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/watch/format";
import { formatTimestampParam } from "@/lib/watch/share";

const SOCIALS = [
  { label: "X", href: (u: string, t: string) => `https://x.com/intent/tweet?text=${encodeURIComponent(`Check out "${t}"`)}&url=${encodeURIComponent(u)}` },
  { label: "WhatsApp", href: (u: string) => `https://wa.me/?text=${encodeURIComponent(u)}` },
  { label: "Facebook", href: (u: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { label: "Email", href: (u: string, t: string) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(u)}` },
];

export function ShareDialog({
  open,
  onOpenChange,
  videoId,
  title,
  currentTime,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videoId: string;
  title: string;
  currentTime: number;
}) {
  const [startAt, setStartAt] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const base = `${window.location.origin}/watch/${videoId}`;
    return startAt && currentTime > 0
      ? `${base}?t=${formatTimestampParam(Math.floor(currentTime))}`
      : base;
  }, [videoId, startAt, currentTime]);

  const embedUrl = `${window.location.origin}/watch/${videoId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the link text instead");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription className="sr-only">
            Share this video via a link with an optional start time
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="Share targets">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href(url, title)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition hover:bg-secondary/70"
            >
              {s.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-sm text-foreground/90">{url}</span>
          </div>
          <Button onClick={copy} variant="default" className="h-10 shrink-0 gap-1.5 rounded-full">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={startAt}
            onCheckedChange={(v) => setStartAt(v === true)}
            aria-label={`Start at ${formatDuration(currentTime)}`}
          />
          Start at {formatDuration(currentTime)}
        </label>

        <DialogFooter className="mt-1">
          <button
            type="button"
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              void navigator.clipboard
                .writeText(`<iframe width="560" height="315" src="${embedUrl}" title="${title}" frameborder="0" allowfullscreen></iframe>`)
                .then(() => toast.success("Embed code copied"))
                .catch(() => toast.error("Could not copy embed code"));
            }}
          >
            Embed code
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
