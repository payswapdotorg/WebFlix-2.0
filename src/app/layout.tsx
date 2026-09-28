import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// TEMP-INTEGRATION (wfx2/watch-vertical, docs-only base):
// Minimal root layout so /watch renders on this lane. The boot lane
// (wfx2/boot-shell) owns the production shell (topbar/sidebar); when it lands,
// the lead merges its layout over this one — only the <Toaster/> import may
// need reconciling (sonner vs boot's toaster choice). See
// evidence/wfx2w/SCHEMA-MERGE.md.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WebFlix 2.0 — Watch",
  description: "WebFlix 2.0 watch experience (wfx2/watch-vertical lane).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster position="bottom-left" richColors closeButton />
      </body>
    </html>
  );
}
