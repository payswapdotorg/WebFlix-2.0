import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Help" };

/**
 * WFX2-P5-SS — the honest help page. Every answer below describes something
 * that really exists in WebFlix (search, watch + autoplay countdown, the
 * session queue, playlists, Creator Studio, settings, the operator session).
 * Where a question is really about YouTube itself, we point at YouTube's own
 * help center instead of fabricating articles.
 */

const TOPICS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Searching",
    body: "Type in the search bar to search. Searches run YouTube search through the operator session, so you get YouTube's results rendered in WebFlix. Suggestions appear as you type.",
  },
  {
    title: "Watching",
    body: "Open any result to watch it. The watch page has the player, video details, and related videos. Likes, subscriptions, comments, and other account actions run through the operator's YouTube session — the same session behind all of WebFlix.",
  },
  {
    title: "Autoplay and the queue",
    body: (
      <>
        When a video ends, WebFlix can start the next one automatically — a 5-second countdown
        shows first, and you can cancel it (or click the next video to skip the wait). The switch
        lives in{" "}
        <Link href="/settings#playback" className="text-yt-red hover:underline">
          Settings → Playback and performance
        </Link>{" "}
        and is saved per browser. The queue holds what you've lined up to play next — add videos
        with Add to queue on the watch page; the player follows the queue while it has items.
      </>
    ),
  },
  {
    title: "Playlists",
    body: "Playlists let you save and order videos, including Watch Later. Create and edit them from your playlists; playlist actions run through the operator session like everything else in WebFlix.",
  },
  {
    title: "Creator Studio",
    body: (
      <>
        Uploads and other channel-side work live in{" "}
        <Link href="/studio" className="text-yt-red hover:underline">
          Creator Studio
        </Link>
        .
      </>
    ),
  },
  {
    title: "Settings",
    body: (
      <>
        <Link href="/settings" className="text-yt-red hover:underline">
          Settings
        </Link>{" "}
        holds WebFlix's local preferences — autoplay, theme, language — and points at the
        account-level settings that live on youtube.com. Every section is labeled LOCAL (this
        browser) or MANAGED ON YOUTUBE.COM (the operator account).
      </>
    ),
  },
  {
    title: "Account and the operator session",
    body: (
      <>
        Your WebFlix account fronts the operator's YouTube session — comment writes, likes,
        reports, and creator tools act on the operator's real YouTube account. Read the full
        disclosure on{" "}
        <Link href="/account" className="text-yt-red hover:underline">
          /account
        </Link>
        .
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Help</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Straight answers about what WebFlix does. WebFlix is an interface over the operator's
        YouTube session — where a question is really about YouTube itself, we point you there
        instead of making something up.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {TOPICS.map((topic) => (
          <section
            key={topic.title}
            className="rounded-xl border border-border p-5"
            data-help-topic={topic.title.toLowerCase().replace(/[^a-z]+/g, "-")}
          >
            <h2 className="text-base font-semibold">{topic.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{topic.body}</p>
          </section>
        ))}
      </div>

      <section className="mt-10 rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold">YouTube's own help center</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          For YouTube account, billing, playback, and feature questions, use YouTube's help
          center — that's where YouTube documents YouTube:
        </p>
        <a
          href="https://support.google.com/youtube"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-yt-red hover:underline"
        >
          Open YouTube's help center (support.google.com) ↗
        </a>
      </section>

      <section className="mt-4 rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold">Something wrong inside WebFlix?</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Send feedback and it goes to the WebFlix operator, stored locally on this server. It
          does not post to YouTube, and it isn't a support channel.
        </p>
        <Link
          href="/feedback"
          className="mt-3 inline-flex items-center text-sm font-medium text-yt-red hover:underline"
        >
          Send feedback
        </Link>
      </section>
    </main>
  );
}
