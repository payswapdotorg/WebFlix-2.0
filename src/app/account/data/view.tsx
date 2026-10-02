"use client";

/**
 * WFX2-P5-YA — Your data in YouTube: the honest inventory. Lists only the
 * surfaces that really exist, states where each kind of data actually lives
 * (the architecture law: WebFlix keeps only the identity locally; history,
 * playlists and likes live on the YouTube account this session rides), and
 * says plainly that a full export/deletion tool isn't available yet.
 */
import Link from "next/link";
import { ArrowLeft, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

const DATA_SURFACES: { href: string; title: string; description: string }[] = [
  {
    href: "/history",
    title: "Watch history",
    description: "Videos you have watched — recorded by the YouTube account itself.",
  },
  {
    href: "/playlists",
    title: "Playlists",
    description: "Playlists you have created, including Watch later.",
  },
  {
    href: "/liked",
    title: "Liked videos",
    description: "Videos you have liked — YouTube's own Liked list.",
  },
  {
    href: "/account",
    title: "Your WebFlix identity",
    description: "Display name, email and avatar color — the only data WebFlix stores locally.",
  },
];

export default function YourDataView() {
  return (
    <PersonalSurfaceGate surface="account" redirect="/account/data">
      <YourDataContent />
    </PersonalSurfaceGate>
  );
}

function YourDataContent() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" className="w-fit gap-2 rounded-full px-4">
        <Link href="/you">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Database className="size-7 text-yt-red" aria-hidden="true" /> Your data in YouTube
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        The data tied to your account lives in these places:
      </p>

      <ul
        aria-label="Your data surfaces"
        className="divide-y divide-border rounded-xl border border-border"
      >
        {DATA_SURFACES.map((surface) => (
          <li key={surface.href}>
            <Link
              href={surface.href}
              data-testid="you-data-surface"
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{surface.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {surface.description}
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>

      <section
        aria-label="Honest limits"
        className="rounded-xl border border-border p-4 text-sm text-muted-foreground sm:p-6"
        data-testid="your-data-honest-limits"
      >
        <p>
          WebFlix keeps only your WebFlix identity locally (name, email, avatar color).
          Watch history, playlists and likes live on the YouTube account this session
          rides — WebFlix reads them live and never copies or fabricates them.
        </p>
        <p className="mt-2">
          A full export or deletion tool isn&apos;t available on WebFlix yet. When it
          ships, it will live on this page.
        </p>
      </section>
    </main>
  );
}
