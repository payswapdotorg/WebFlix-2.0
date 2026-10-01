import "./globals.css";

export const metadata = { title: "WebFlix Studio", description: "Standalone Creator Studio for WebFlix" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
