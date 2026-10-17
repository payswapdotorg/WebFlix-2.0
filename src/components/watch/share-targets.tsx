"use client";

/**
 * WFX2-P23-A — the shared share-target row (youtube.com's unified share
 * panel's own content, measured 2026-10-17: the social target chips row +
 * the link box + Copy + the "Start at" checkbox family lives in the Share
 * dialog; this row is the subset the clip surfaces reuse — the Clip tab's
 * post-create share sheet and the clip page's share row).
 */
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const SOCIALS = [
  {
    label: "X",
    href: (u: string, t: string) =>
      `https://x.com/intent/tweet?text=${encodeURIComponent(`Check out "${t}"`)}&url=${encodeURIComponent(u)}`,
  },
  {
    label: "WhatsApp",
    href: (u: string) => `https://wa.me/?text=${encodeURIComponent(u)}`,
  },
  {
    label: "Facebook",
    href: (u: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`,
  },
  {
    label: "Email",
    href: (u: string, t: string) =>
      `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(u)}`,
  },
];

export function ShareTargetRow({
  url,
  title,
  copied,
  onCopy,
}: {
  url: string;
  title: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-3" data-testid="share-target-row">
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
      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3">
          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-sm text-foreground/90" data-testid="share-url">
            {url}
          </span>
        </div>
        <Button onClick={onCopy} variant="default" className="h-10 shrink-0 gap-1.5 rounded-full">
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
