"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { Topbar } from "./topbar";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./footer";
import { useSidebar } from "@/lib/sidebar-store";
import { loadYouTubeIframeApi } from "@/components/watch/youtube-player";
import { VideoHoverPreviewLayer } from "@/components/video/video-hover-preview";
import { PlayerHostLayer } from "@/components/player/player-host-layer";
import { KeyboardShortcutsMount } from "./keyboard-shortcuts";
import { QueueDrawer } from "@/components/player/queue-drawer";

/**
 * WebFlix app shell: fixed topbar, collapsible sidebar, scrollable main column.
 * The site footer sticks to the bottom of the main scroll container — it sits
 * at the viewport bottom on short pages and is pushed down naturally on long
 * ones (the sticky-footer law).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebar((s) => s.collapsed);
  const pathname = usePathname();
  // WFX2-P2-AU: the account pages render standalone — Google-account
  // sign-in parity (accounts.google.com carries no YouTube chrome)
  const bare = pathname === "/signin" || pathname === "/signup";
  // 2026-10-16 operator pass: the shorts surface is full-bleed — youtube.com's
  // shorts page carries no footer and the vertical player fills the viewport
  // height under the topbar (aspect parity: the taller the 9:16 box, the
  // closer to youtube.com's own player geometry).
  const isShorts = pathname === "/shorts" || pathname.startsWith("/shorts/");
  // P43: the Netflix watch surface is a cinema lane — netflix.com's own player
  // fills the room; the sidebar and topbar stay out of the way.
  const isNetflixWatch = pathname.startsWith("/netflix/watch/");

  // 2026-10-16 operator pass (hover speed): warm the YouTube IFrame API at
  // shell mount instead of on first hover — youtube.com's previews feel
  // instant because their player plumbing is already hot; loading the API
  // script eagerly removes the biggest first-hover latency term (the script
  // fetch) so a dwell only pays the iframe boot.
  useEffect(() => {
    void loadYouTubeIframeApi().catch(() => {
      /* a failed warm-up costs nothing — the hover lane retries on demand */
    });
  }, []);

  if (bare) {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        {isNetflixWatch ? null : (
          <Suspense fallback={<div className="h-14 shrink-0" />}>
            <Topbar />
          </Suspense>
        )}
        <div className="flex min-h-0 flex-1">
          {isNetflixWatch ? null : <Sidebar collapsed={collapsed} />}
          <main
            id="content"
            className="min-w-0 flex-1 overflow-y-auto slim-scrollbar"
            tabIndex={-1}
            aria-label="Main content"
          >
            <div className="flex min-h-full flex-col">
              <div className="flex-1">{children}</div>
              {/* youtube.com's shorts page is full-bleed (no footer) — hiding it
                  here lets the 9:16 player column take the whole viewport height */}
              {isShorts || isNetflixWatch ? null : <SiteFooter />}
            </div>
          </main>
        </div>
      </div>
      {/* WFX2-C-S: the persistent player host — ABOVE the route tree so the
          player (and its miniplayer) survives every navigation. */}
      <PlayerHostLayer />
      {/* WFX2-P5-MQ: the miniplayer-attached queue drawer — the global mount
          (next to the player host layer), so the queue chrome works on EVERY
          page while the miniplayer is alive with a queue. Additive only. */}
      <QueueDrawer />
      <VideoHoverPreviewLayer />
      <KeyboardShortcutsMount />
    </ThemeProvider>
  );
}
