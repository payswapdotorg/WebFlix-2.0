"use client";

import Link from "next/link";
import { Download, Wifi, Info } from "lucide-react";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

/**
 * P22-B — the Downloads view (the honest no-tier state).
 *
 * youtube.com's Downloads page (a Premium feature) lists the videos saved
 * for offline watching with storage controls. WebFlix has no offline tier:
 * every video streams from YouTube itself. The honest page says exactly
 * that — what youtube.com carries here, what WebFlix offers instead, and
 * nothing fabricated (no rows, no storage numbers, no download buttons).
 */
export default function DownloadsView() {
  return (
    <PersonalSurfaceGate surface="downloads">
      <div className="pb-10">
        <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
          <Download className="size-7 text-yt-red" aria-hidden="true" /> Downloads
        </h1>

        <section
          aria-label="The honest downloads state"
          className="mx-4 rounded-2xl border border-border bg-card p-6 sm:mx-6 sm:p-10"
          data-testid="downloads-empty"
        >
          <div className="mx-auto max-w-xl text-center">
            <span
              className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-secondary"
              aria-hidden="true"
            >
              <Wifi className="size-8 text-muted-foreground" />
            </span>
            <p className="text-lg font-medium" data-testid="downloads-headline">
              No downloads — WebFlix streams online only
            </p>
            <p className="mt-2 text-sm text-muted-foreground" data-testid="downloads-body">
              On youtube.com this page lists videos saved for offline watching — a YouTube
              Premium feature. WebFlix has no offline tier: every video plays straight from
              YouTube, so nothing is ever downloaded to your device and there is nothing to
              manage here.
            </p>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" aria-hidden="true" />
              Honest absence — this is WebFlix&apos;s real capability, not a degraded state.
            </p>
          </div>
        </section>

        <p className="mt-4 px-4 text-sm text-muted-foreground sm:px-6">
          Want something to watch now?{" "}
          <Link
            href="/"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Browse the home feed
          </Link>{" "}
          — it streams the moment you press play.
        </p>
      </div>
    </PersonalSurfaceGate>
  );
}
