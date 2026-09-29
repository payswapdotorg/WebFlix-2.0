"use client";

import { Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { Topbar } from "./topbar";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./footer";
import { useSidebar } from "@/lib/sidebar-store";
import { VideoHoverPreviewLayer } from "@/components/video/video-hover-preview";

/**
 * ZTube app shell: fixed topbar, collapsible sidebar, scrollable main column.
 * The site footer sticks to the bottom of the main scroll container — it sits
 * at the viewport bottom on short pages and is pushed down naturally on long
 * ones (the sticky-footer law).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebar((s) => s.collapsed);
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
      <VideoHoverPreviewLayer />
    </ThemeProvider>
  );
}
