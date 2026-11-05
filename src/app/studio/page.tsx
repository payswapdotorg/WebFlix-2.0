import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Settings, UserRound } from "lucide-react";

export const metadata: Metadata = { title: "Studio · WebFlix" };

/**
 * WFX2-P2-ST → P94-c3 (the gap report's G5): /studio used to redirect to the
 * standalone Creator Studio deployment (studio-webflix.vercel.app) — which
 * production walk found PAUSED ("Deployment Paused"), a dead end the sidebar
 * shipped users straight into. The honest fix keeps the row's destination
 * INSIDE the app: this page names the deployment truth and routes every
 * creator errand to the in-app surface that actually works today.
 *
 * STUDIO_APP_URL is no longer consulted for a redirect; when the standalone
 * app returns, this page is where a link back belongs (never a bare 307 to
 * a third party that may be down).
 */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold">Your videos</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        WebFlix&apos;s creator studio lives in a separate deployment that is paused right now —
        this page stays inside your app instead of sending you to a dead end. Everything you can
        actually manage today is right here:
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Link
          href="/shorts?source=tiktok"
          className="group rounded-xl border bg-card p-5 transition-colors hover:bg-accent/40"
          data-testid="studio-tiktok-card"
        >
          <Clapperboard className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">Your TikTok shelf</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add posts, flip their visibility, or remove them — the Shorts feed&apos;s TikTok lane
            carries the manage affordances on every post you own.
          </p>
        </Link>
        <Link
          href="/settings#tiktok-connection"
          className="group rounded-xl border bg-card p-5 transition-colors hover:bg-accent/40"
          data-testid="studio-tiktok-connect-card"
        >
          <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">Link your TikTok channel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Link your profile (works today) or connect through TikTok&apos;s Login Kit — your
            channel page at /tiktok/&lt;handle&gt; then knows it&apos;s you.
          </p>
        </Link>
        <Link
          href="/settings#youtube-connection"
          className="group rounded-xl border bg-card p-5 transition-colors hover:bg-accent/40"
          data-testid="studio-youtube-card"
        >
          <Settings className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">Your YouTube account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your own YouTube account — your likes, subscribes and playlists then act on it
            through the official API.
          </p>
        </Link>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Looking for your watch history, playlists and likes? That&apos;s the{" "}
        <Link href="/you" className="font-medium text-foreground underline underline-offset-2">
          You page
        </Link>
        .
      </p>
    </main>
  );
}
