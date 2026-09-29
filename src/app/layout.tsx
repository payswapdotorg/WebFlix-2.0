import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: {
    default: "ZTube — Watch & Share Videos",
    template: "%s · ZTube",
  },
  description:
    "ZTube — a complete video platform: home feed, shorts, trending, subscriptions, watch, upload and creator studio. WebFlix 2.0.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="bg-background text-foreground font-sans antialiased">
        <AppShell>{children}</AppShell>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
