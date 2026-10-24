"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { netflixTitleUrl, netflixWatchUrl } from "@/lib/netflix/deeplink";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P42 — the play hand-off (ADR 0002 §1 is this component, made UI).
 *
 * The playback policy: Netflix titles play through Netflix's own official
 * deep link, never through a faked player. The dialog says so honestly —
 * what WebFlix can't do (DRM-licensed playback outside Netflix's apps), what
 * it does instead (hand the viewer to Netflix's own player), and the exact
 * destination URL. No dark patterns: the deep link is a plain outbound anchor.
 */
export function PlayHandoffDialog({
  title,
  open,
  onOpenChange,
}: {
  title: NetflixTitleDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [artBroken, setArtBroken] = useState(false);
  const watchUrl = netflixWatchUrl(title.netflixId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border-white/10 bg-[#141418] p-0 text-white sm:max-w-lg">
        <div className="relative h-36 w-full bg-gradient-to-br from-[#1b1b22] to-[#101014] sm:h-44">
          {title.backdropUrl && !artBroken && (
            <img
              src={title.backdropUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-80"
              onError={() => setArtBroken(true)}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141418] via-[#141418]/40 to-transparent" />
          <div className="absolute bottom-3 left-5 right-5">
            {title.logoUrl && !artBroken ? (
              <img src={title.logoUrl} alt={title.title} className="max-h-10 w-auto max-w-[60%] object-contain" />
            ) : (
              <h2 className="truncate text-xl font-bold">{title.title}</h2>
            )}
          </div>
        </div>

        <DialogHeader className="gap-2 px-5 pb-1 pt-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="rounded bg-[#e50914] px-1.5 py-0.5 text-xs font-black uppercase tracking-wide">
              Netflix
            </span>
            Ready to play on Netflix
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/60">
            Netflix protects its streams with DRM and licenses them for playback inside
            its own apps only — so WebFlix hands you to Netflix&apos;s own player instead
            of faking one. Your browsing, search, and lists stay here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5">
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="netflix-handoff-link"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#e50914] text-sm font-semibold text-white transition-colors hover:bg-[#c4080f]"
          >
            Play “{title.title}” on Netflix
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
          <a
            href={netflixTitleUrl(title.netflixId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 text-sm text-white/80 transition-colors hover:bg-white/5"
          >
            Open the title page on netflix.com
          </a>
        </div>

        <p className="flex items-start gap-2 px-5 py-4 text-xs leading-relaxed text-white/40">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Destination: <span className="break-all text-white/60">{watchUrl}</span> — the
          official per-title deep link. WebFlix never touches Netflix&apos;s video
          stream.
        </p>
      </DialogContent>
    </Dialog>
  );
}
