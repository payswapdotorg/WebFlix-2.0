"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Compass,
  MonitorPlay,
  Search,
  Shield,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WFX2-P20 — the Help surface at the YouTube Help Center's structural
 * depth:
 *
 *   1. Hero search bar — "How can we help you?" over a search input +
 *      popular-topic chips (YouTube's help-center hero layout).
 *   2. Topic card grid — the real help topics (Getting started, Watching
 *      videos, Managing your account, Privacy & safety, Troubleshooting),
 *      each card expanding its topic section on this page.
 *   3. Client-side search — the query filters the topic cards by title +
 *      body match; the empty state matches YouTube's search empty state.
 *   4. Contact flow — YouTube's "Contact us" pathway wording with
 *      WebFlix's honest-absence disclosure (no support team; the local
 *      feedback store is the only real channel).
 *
 * The honest doctrine is unchanged: every answer below describes
 * something that really exists in WebFlix, and where a question is really
 * about YouTube itself, we point at YouTube's own help center instead of
 * making something up.
 */

type HelpTopic = {
  slug: string;
  name: string;
  icon: typeof Compass;
  blurb: string;
  /** plain-text body used for the client-side search (title + body match) */
  searchText: string;
  body: React.ReactNode;
};

const TOPICS: HelpTopic[] = [
  {
    slug: "getting-started",
    name: "Getting started",
    icon: Compass,
    blurb: "Learn the basics — what WebFlix is, and how to search it.",
    searchText:
      "WebFlix is an interface over the operator's YouTube session. Searches run YouTube search through the operator session, so you get YouTube's results rendered in WebFlix. Suggestions appear as you type.",
    body: (
      <>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          WebFlix is an interface over the operator's YouTube session — you use WebFlix, and
          the videos, results, and account actions behind it are YouTube's, read and written
          through that one session. Read the full disclosure on{" "}
          <Link href="/account" className="text-yt-red hover:underline">
            /account
          </Link>
          .
        </p>
        <h3 className="mt-4 text-sm font-semibold">Searching</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Type in the search bar to search. Searches run YouTube search through the operator
          session, so you get YouTube's results rendered in WebFlix. Suggestions appear as you
          type.
        </p>
      </>
    ),
  },
  {
    slug: "watching-videos",
    name: "Watching videos",
    icon: MonitorPlay,
    blurb: "Playback, autoplay, and the queue on the watch page.",
    searchText:
      "Open any result to watch it. The watch page has the player, video details, and related videos. Likes, subscriptions, comments, and other account actions run through the operator's YouTube session. Autoplay and the queue: when a video ends, WebFlix can start the next one automatically — a 5-second countdown shows first, and you can cancel it. The switch lives in Settings → Playback and performance. The queue holds what you've lined up to play next — Add to queue on the watch page.",
    body: (
      <>
        <h3 className="mt-2 text-sm font-semibold">Watching</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Open any result to watch it. The watch page has the player, video details, and
          related videos. Likes, subscriptions, comments, and other account actions run
          through the operator's YouTube session — the same session behind all of WebFlix.
        </p>
        <h3 className="mt-4 text-sm font-semibold">Autoplay and the queue</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          When a video ends, WebFlix can start the next one automatically — a 5-second
          countdown shows first, and you can cancel it (or click the next video to skip the
          wait). The switch lives in{" "}
          <Link href="/settings#playback" className="text-yt-red hover:underline">
            Settings → Playback and performance
          </Link>{" "}
          and is saved per browser. The queue holds what you've lined up to play next — add
          videos with Add to queue on the watch page; the player follows the queue while it
          has items.
        </p>
      </>
    ),
  },
  {
    slug: "managing-your-account",
    name: "Managing your account",
    icon: UserRound,
    blurb: "Playlists, Creator Studio, settings, and the operator session.",
    searchText:
      "Playlists let you save and order videos, including Watch Later. Creator Studio: uploads and channel-side work. Settings holds WebFlix's local preferences — autoplay, theme, language — and points at the account-level settings on youtube.com. Your WebFlix account fronts the operator's YouTube session.",
    body: (
      <>
        <h3 className="mt-2 text-sm font-semibold">Playlists</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Playlists let you save and order videos, including Watch Later. Create and edit them
          from your playlists; playlist actions run through the operator session like
          everything else in WebFlix.
        </p>
        <h3 className="mt-4 text-sm font-semibold">Creator Studio</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Uploads and other channel-side work live in{" "}
          <Link href="/studio" className="text-yt-red hover:underline">
            Creator Studio
          </Link>
          .
        </p>
        <h3 className="mt-4 text-sm font-semibold">Settings</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          <Link href="/settings" className="text-yt-red hover:underline">
            Settings
          </Link>{" "}
          holds WebFlix's local preferences — autoplay, theme, language — and points at the
          account-level settings that live on youtube.com. Every section is labeled LOCAL
          (this browser) or MANAGED ON YOUTUBE.COM (the operator account).
        </p>
        <h3 className="mt-4 text-sm font-semibold">Account and the operator session</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Your WebFlix account fronts the operator's YouTube session — comment writes, likes,
          reports, and creator tools act on the operator's real YouTube account. Read the full
          disclosure on{" "}
          <Link href="/account" className="text-yt-red hover:underline">
            /account
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    slug: "privacy-safety",
    name: "Privacy & safety",
    icon: Shield,
    blurb: "Reporting content, your report history, and safety-filter honesty.",
    searchText:
      "Reporting a video sends it to WebFlix's moderation review queue and records a local row — your report history lists them. Reporting a comment submits through the operator's YouTube session and leaves no local record. Safety filters like Restricted Mode are YouTube account settings, not available in WebFlix yet.",
    body: (
      <>
        <h3 className="mt-2 text-sm font-semibold">Reporting content</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Reporting a video from its menu sends it to WebFlix's moderation review queue (the
          video stays visible, matching youtube.com) and records a local row —{" "}
          <Link href="/report-history" className="text-yt-red hover:underline">
            your report history
          </Link>{" "}
          lists them. Reporting a comment from its ⋮ menu submits the report through the
          operator's YouTube session — the same session behind every account action in
          WebFlix — and leaves no local record.
        </p>
        <h3 className="mt-4 text-sm font-semibold">Safety filters</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Safety filters like Restricted Mode are YouTube account settings — they live on
          youtube.com and aren't available in WebFlix yet. See{" "}
          <Link href="/settings#privacy" className="text-yt-red hover:underline">
            Settings → Privacy
          </Link>{" "}
          for the honest status of every safety surface.
        </p>
      </>
    ),
  },
  {
    slug: "troubleshooting",
    name: "Troubleshooting",
    icon: Wrench,
    blurb: "Something wrong? The honest paths: feedback, connection, YouTube.",
    searchText:
      "Something wrong inside WebFlix? Send feedback and it goes to the WebFlix operator, stored locally on this server. It does not post to YouTube, and it isn't a support channel. For YouTube account, billing, playback, and feature questions, use YouTube's help center.",
    body: (
      <>
        <h3 className="mt-2 text-sm font-semibold">Something wrong inside WebFlix?</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Send feedback and it goes to the WebFlix operator, stored locally on this server. It
          does not post to YouTube, and it isn't a support channel.
        </p>
        <Link
          href="/feedback"
          className="mt-2 inline-flex items-center text-sm font-medium text-yt-red hover:underline"
        >
          Send feedback
        </Link>
      </>
    ),
  },
];

/** Popular-topic chips — the help-center hero's quick paths. */
const POPULAR_CHIPS = [
  "Autoplay",
  "Queue",
  "Playlists",
  "Report a video",
  "Settings",
  "Sign in",
] as const;

const CONTACT_FEEDBACK_LINK = "https://support.google.com/youtube";

export function HelpView() {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const normalized = query.trim().toLowerCase();
  const visibleTopics = useMemo(
    () =>
      normalized
        ? TOPICS.filter((topic) =>
            `${topic.name} ${topic.blurb} ${topic.searchText}`.toLowerCase().includes(normalized),
          )
        : TOPICS,
    [normalized],
  );
  const searching = normalized.length > 0;
  const noResults = searching && visibleTopics.length === 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Help</h1>

      {/* 1 — the hero search bar (YouTube Help Center's hero layout) */}
      <section data-help-search className="mt-4" aria-label="Search help">
        <h2 className="text-lg font-semibold">How can we help you?</h2>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-4 py-2">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Describe your issue"
            aria-label="Search help topics"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Popular topics:</span>
          {POPULAR_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setQuery(chip)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
        Straight answers about what WebFlix does. WebFlix is an interface over the operator's
        YouTube session — where a question is really about YouTube itself, we point you there
        instead of making something up.
      </p>

      {/* 2 — the topic card grid (the real help topics, expandable below) */}
      {noResults ? (
        <section data-help-empty className="mt-8" aria-live="polite">
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <h2 className="text-base font-semibold">No results found</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing in WebFlix's help matches "{query.trim()}" — try different keywords, or
              browse the topics below. For YouTube account, billing, and feature questions, use{" "}
              <a
                href={CONTACT_FEEDBACK_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="text-yt-red hover:underline"
              >
                YouTube's help center
              </a>
              .
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
            >
              Clear search
            </button>
          </div>
        </section>
      ) : (
        <>
          <section data-help-topics className="mt-8" aria-label="Help topics">
            <ul className="grid gap-4 sm:grid-cols-2">
              {visibleTopics.map((topic) => {
                const TopicIcon = topic.icon;
                const isCollapsed = collapsed[topic.slug] === true;
                return (
                  <li key={topic.slug}>
                    <button
                      type="button"
                      data-help-topic-card={topic.slug}
                      aria-expanded={!isCollapsed}
                      aria-controls={`help-topic-section-${topic.slug}`}
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [topic.slug]: !isCollapsed }))
                      }
                      className="flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border p-5 text-left transition hover:border-foreground/40"
                    >
                      <TopicIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                      <span className="text-base font-semibold">{topic.name}</span>
                      <span className="text-sm text-muted-foreground">{topic.blurb}</span>
                      <span
                        className={cn(
                          "mt-1 text-xs text-muted-foreground",
                          isCollapsed ? "" : "hidden",
                        )}
                      >
                        Expand to read this topic's answers
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* the expandable topic sections (one per topic card) */}
          <div className="mt-4 flex flex-col gap-4">
            {visibleTopics.map((topic) => {
              const isCollapsed = collapsed[topic.slug] === true;
              return (
                <section
                  key={topic.slug}
                  data-help-topic={topic.slug}
                  id={`help-topic-section-${topic.slug}`}
                  hidden={isCollapsed}
                  className="rounded-xl border border-border p-5"
                  aria-label={topic.name}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{topic.name}</h2>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [topic.slug]: !isCollapsed }))
                      }
                      aria-expanded={!isCollapsed}
                      aria-controls={`help-topic-section-${topic.slug}`}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                    >
                      {isCollapsed ? "Expand" : "Collapse"}
                    </button>
                  </div>
                  {topic.body}
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* YouTube's own help center — the honest handoff (unchanged copy) */}
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

      {/* 4 — the contact flow (YouTube's "Contact us" pathway, honest) */}
      <section data-help-contact className="mt-4 rounded-xl border border-border p-5">
        <h2 className="text-base font-semibold">Still need help? Contact us</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          YouTube's Help Center routes "Contact us" through its own support options — YouTube
          account, billing, and product support happen there. WebFlix has no support team: the
          only real channel is the feedback store. Send feedback and it goes to the WebFlix
          operator, stored locally on this server. It does not post to YouTube, and it isn't a
          support channel.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <Link href="/feedback" className="text-yt-red hover:underline">
            Send feedback
          </Link>
          <a
            href={CONTACT_FEEDBACK_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-yt-red hover:underline"
          >
            Contact YouTube support (support.google.com) ↗
          </a>
        </div>
      </section>
    </main>
  );
}

export default HelpView;
