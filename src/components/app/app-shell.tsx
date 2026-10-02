"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { Topbar } from "./topbar";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./footer";
import { useSidebar } from "@/lib/sidebar-store";
import { VideoHoverPreviewLayer } from "@/components/video/video-hover-preview";
import { PlayerHostLayer } from "@/components/player/player-host-layer";
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
        <Suspense fallback={<div className="h-14 shrink-0" />}>
          <Topbar />
        </Suspense>
        <div className="flex min-h-0 flex-1">
          <Sidebar collapsed={collapsed} />
          <main
            id="content"
            className="min-w-0 flex-1 overflow-y-auto slim-scrollbar"
            tabIndex={-1}
            aria-label="Main content"
          >
            <div className="flex min-h-full flex-col">
              <div className="flex-1">{children}</div>
              <SiteFooter />
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
    </ThemeProvider>
  );
}
