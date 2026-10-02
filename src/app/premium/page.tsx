import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WebFlix Premium",
  description: "WebFlix has no paid tier — everything here is free.",
};

/**
 * WFX2-P5-SS — the WebFlix Premium page: youtube.com's Premium page layout
 * skeleton (hero + benefits grid) with the honest degradation copy. WebFlix
 * has no paid tier, nothing is gated, and every benefits card is labeled
 * ON YOUTUBE.COM — these are YouTube's benefits, not something WebFlix
 * sells. The real product lives at youtube.com/premium.
 */

const BENEFITS = [
  {
    title: "Ad-free videos",
    body: "A YouTube Premium benefit on youtube.com. WebFlix has no paid tier, so there is no ad-free upgrade to buy here — nothing on WebFlix is for sale.",
  },
  {
    title: "Background play",
    body: "A YouTube Premium benefit on youtube.com. Not a WebFlix product — nothing on WebFlix is for sale.",
  },
  {
    title: "Downloads",
    body: "A YouTube Premium benefit on youtube.com for saving videos offline. WebFlix doesn't sell it and doesn't gate anything behind it.",
  },
  {
    title: "YouTube Music",
    body: "Included with YouTube Premium on youtube.com. WebFlix has no music offering.",
  },
];

export default function PremiumPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <header
        data-premium-banner
        className="rounded-2xl border border-border bg-secondary/30 p-8 text-center"
      >
        <h1 className="text-3xl font-bold">WebFlix Premium</h1>
        <p className="mt-3 text-lg font-medium">
          WebFlix has no paid tier — everything here is free.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          There is no subscription to buy and nothing is gated. This page exists because the
          sidebar's WebFlix Premium entry points here, and it mirrors the Premium page layout
          you'd see on youtube.com — with WebFlix's honest version of it.
        </p>
        <span className="mt-5 inline-flex items-center rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
          Nothing to buy — everything on WebFlix is free
        </span>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {BENEFITS.map((benefit) => (
          <section key={benefit.title} className="rounded-xl border border-border p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{benefit.title}</h2>
              <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
                ON YOUTUBE.COM
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{benefit.body}</p>
          </section>
        ))}
      </div>

      <section className="mt-8 rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold">The actual Premium product</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          YouTube Premium itself is YouTube's product. If you want the real thing, read about it
          and subscribe on YouTube:
        </p>
        <a
          href="https://www.youtube.com/premium"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-yt-red hover:underline"
        >
          YouTube Premium on youtube.com/premium ↗
        </a>
      </section>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Questions about what WebFlix actually has?{" "}
        <Link href="/help" className="text-yt-red hover:underline">
          See the Help page
        </Link>
        .
      </p>
    </main>
  );
}
