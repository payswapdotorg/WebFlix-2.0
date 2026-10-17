"use client";

/**
 * REA-2 (G20) — the live POLL card, display-only.
 *
 * The honest-absence ledger for this surface (the shorts-engagement-rail
 * pattern):
 * - The card renders ONLY what the MEASURED pollRenderer payload carries
 *   (the 2026-10-17 probe captures — sanitized into
 *   tests/fixtures/yt/livechat_poll_*.json): the question, the avatar, the
 *   meta line ("@author • 3h ago • 1,078 votes"), the choices with
 *   voteRatio-backed bars and the served percentText ("64%").
 * - NO vote affordance exists: the vote WRITE is an authenticated youtube.com
 *   action whose poll-card DOM was unreachable this run (the bot wall — the
 *   P23-A precedent), so no broker vote kind was added and the choices render
 *   as state rows, never buttons — never a fake vote success. The disclosure
 *   line says exactly that.
 * - Where the carrying action had no tally yet (the panel form), the rows
 *   render bare — no bar, no percent — the honest pre-tally state; nothing
 *   is invented to fill the gap.
 * - The poll card sits in the chat stream inline (the position the action
 *   delivered it at); later updateLiveChatPollAction frames refresh the SAME
 *   card in place (the hook's replace-on-collision) — the percentages and
 *   the vote count tick live, exactly as the capture showed (606→607 votes).
 */
import { cn } from "@/lib/utils";
import { BarChart3, Check } from "lucide-react";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

export function LiveChatPollCard({ message }: { message: LiveChatMessageDTO }) {
  const poll = message.poll;
  if (!poll) return null; // a poll row without a payload renders nothing
  return (
    <section
      aria-label={`Live poll: ${poll.question}`}
      data-testid="live-chat-poll"
      data-poll-id={poll.pollId}
      data-poll-type={poll.pollType ?? undefined}
      className="my-1.5 overflow-hidden rounded-lg border border-border bg-secondary/40"
    >
      {/* the header: avatar + question + the served meta line */}
      <div className="flex items-start gap-2 px-2 pt-2">
        {poll.avatarUrl ? (
          <img
            src={poll.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="mt-0.5 size-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
          >
            <BarChart3 className="size-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug">
            {poll.question}
          </p>
          {poll.metaText && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {poll.metaText}
            </p>
          )}
        </div>
      </div>

      {/* the choices: state rows (display-only — no buttons, no vote write) */}
      <ul className="mt-2 flex flex-col gap-1 px-2 pb-2" data-testid="poll-choices">
        {poll.choices.map((c, i) => {
          const pctWidth =
            c.ratio !== null ? Math.round(Math.min(1, Math.max(0, c.ratio)) * 100) : null;
          return (
            <li
              key={`${poll.pollId}-${i}`}
              aria-label={
                c.percentText ? `${c.text}, ${c.percentText}` : c.text
              }
              data-testid="poll-choice"
              data-percent={c.percentText ?? undefined}
              className={cn(
                "relative overflow-hidden rounded-md border px-2 py-1.5 text-sm leading-snug",
                c.selected === true
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background/40",
              )}
            >
              {pctWidth !== null && (
                <span
                  aria-hidden="true"
                  data-testid="poll-choice-bar"
                  className="absolute inset-y-0 left-0 bg-primary/15"
                  style={{ width: `${pctWidth}%` }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {c.selected === true && (
                  <Check
                    className="size-3.5 shrink-0 text-primary"
                    aria-label="Your vote"
                  />
                )}
                <span className="min-w-0 flex-1 break-words">{c.text}</span>
                {c.percentText && (
                  <span className="ml-auto shrink-0 pl-2 text-xs font-semibold tabular-nums text-foreground/90">
                    {c.percentText}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* the honest disclosure (the premiere-reminder pattern) */}
      <p className="border-t border-border/60 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground/80">
        Poll voting is youtube.com&apos;s — WebFlix displays the live results.
      </p>
    </section>
  );
}

export default LiveChatPollCard;
