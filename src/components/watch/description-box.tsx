"use client";

/**
 * WFX2-W description box — collapsed 2-line state with animated
 * expand/collapse; hashtags render as links to /search?q=%23tag; timestamps
 * in the body are clickable and seek; chapters (parsed from timestamps)
 * render as a card list with seek-on-click; exact views + full date when
 * expanded (YouTube convention).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { compactCount, exactCount, fullDate, formatDuration, relativeTime } from "@/lib/watch/format";
import { parseChapters, parseHashtags, tokenizeDescriptionLine } from "@/lib/watch/chapters";

export function DescriptionBox({
  videoId,
  description,
  views,
  viewsText,
  createdAt,
  publishedText,
  durationSec,
  thumbnailUrl,
  onSeek,
}: {
  videoId: string;
  description: string;
  views: number;
  viewsText?: string | null;
  createdAt: string | null;
  publishedText?: string | null;
  durationSec: number | null;
  thumbnailUrl: string;
  onSeek: (sec: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const chapters = useMemo(() => parseChapters(description, durationSec), [description, durationSec]);
  const hashtags = useMemo(() => parseHashtags(description), [description]);
  const lines = useMemo(() => description.split(/\r?\n/), [description]);

  return (
    <div
      className={cn(
        "mt-3 rounded-xl bg-secondary/40 p-3 text-sm transition-colors",
        !expanded && "cursor-pointer hover:bg-secondary/60"
      )}
      onClick={() => {
        if (!expanded) setExpanded(true);
      }}
      aria-expanded={expanded}
    >
      {/* meta row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <span>
          {viewsText
            ? expanded
              ? `${exactCount(views)} views`
              : viewsText
            : expanded
              ? `${exactCount(views)} views`
              : `${compactCount(views)} views`}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          •
        </span>
        <span title={fullDate(createdAt) || undefined}>
          {expanded
            ? fullDate(createdAt) || publishedText || ""
            : publishedText || relativeTime(createdAt)}
        </span>
        {hashtags.slice(0, expanded ? hashtags.length : 3).map((tag) => (
          <Link
            key={tag}
            href={`/search?q=${encodeURIComponent(tag)}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "text-xs font-medium",
              expanded
                ? "text-primary/90 hover:underline"
                : "rounded-full bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/15"
            )}
          >
            {tag}
          </Link>
        ))}
        {!expanded && hashtags.length > 3 && (
          <span className="text-xs text-muted-foreground">+{hashtags.length - 3}</span>
        )}
      </div>

      {/* body: collapsed 2-line clamp / expanded animated full text */}
      {!expanded && <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-foreground/90">{description}</p>}

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          {expanded && (
            <>
              <div className="mt-2 whitespace-pre-line text-foreground/90">
                {lines.map((line, i) => (
                  <span key={i} className="block min-h-[1em]">
                    {tokenizeDescriptionLine(line).map((tok, j) => {
                      if (tok.kind === "hashtag") {
                        return (
                          <Link
                            key={j}
                            href={`/search?q=${encodeURIComponent(tok.tag)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-primary/90 hover:underline"
                          >
                            {tok.tag}
                          </Link>
                        );
                      }
                      if (tok.kind === "timestamp") {
                        return (
                          <button
                            key={j}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSeek(tok.sec);
                            }}
                            className="font-medium text-primary/90 hover:underline"
                            aria-label={`Jump to ${tok.label}`}
                          >
                            {tok.label}
                          </button>
                        );
                      }
                      return <span key={j}>{tok.text}</span>;
                    })}
                  </span>
                ))}
              </div>

              {chapters.length > 0 && (
                <section aria-label="Chapters" className="mt-3">
                  <h3 className="mb-2 text-sm font-semibold">Chapters</h3>
                  <div className="flex gap-2 overflow-x-auto pb-1" role="list">
                    {chapters.map((ch) => (
                      <button
                        key={`${ch.startSec}-${ch.title}`}
                        type="button"
                        role="listitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(ch.startSec);
                        }}
                        className="group w-36 shrink-0 overflow-hidden rounded-lg text-left transition hover:bg-secondary/60"
                        aria-label={`Chapter: ${ch.title} at ${formatDuration(ch.startSec)}`}
                      >
                        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-secondary">
                          <img
                            src={thumbnailUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover opacity-90 transition group-hover:opacity-100"
                          />
                          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                            {formatDuration(ch.startSec)}
                          </span>
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight">
                          {ch.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {ch.endSec !== null ? formatDuration(ch.endSec - ch.startSec) : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((x) => !x);
        }}
        aria-expanded={expanded}
        className="mt-1.5 flex items-center gap-1 text-sm font-semibold text-foreground"
      >
        {expanded ? "Show less" : "...more"}
        <ChevronDown
          className={cn("size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <span className="sr-only">
        Description of video {videoId}. {expanded ? "Expanded" : "Collapsed"}.
      </span>
    </div>
  );
}
