"use client";

/**
 * WFX2-A-S — one live-chat row: plain text, super chat (tinted with the
 * purchase color, hex + alpha suffix via inline style), super sticker,
 * member milestone / gift, pinned banner, and system notes. Author names
 * are colored YouTube-style by badge (owner gold, moderator green, member
 * accent); avatars are plain <img> (external hosts, referrerPolicy
 * "no-referrer" — the codebase pattern for YouTube-hosted images).
 */
import { Award, BadgeCheck, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

/** 15–20% alpha over the super chat color (#rrggbb → #rrggbb2b). */
const SUPERCHAT_ALPHA = "2b";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function superChatTint(color: string | null | undefined): string | null {
  return color && HEX_COLOR_RE.test(color) ? color : null;
}

/** Owner gold → moderator green → member accent → verified default → muted. */
function authorNameClass(message: LiveChatMessageDTO): string {
  const badges = message.author.badges;
  if (badges.includes("owner")) return "text-amber-400";
  if (badges.includes("moderator")) return "text-green-500";
  if (badges.includes("member")) return "text-primary";
  if (badges.includes("verified")) return "text-foreground";
  return "text-muted-foreground";
}

/**
 * Timestamp for the right edge: replay messages show their video offset
 * as mm:ss; live messages show the wall-clock time from timestampUsec.
 */
function formatTimestamp(message: LiveChatMessageDTO): string {
  if (message.offsetMsec !== null && message.offsetMsec !== undefined) {
    return formatDuration(message.offsetMsec / 1000);
  }
  const usec = Number(message.timestampUsec);
  if (!Number.isFinite(usec) || usec <= 0) return "";
  return new Date(usec / 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AuthorAvatar({ message, className }: { message: LiveChatMessageDTO; className?: string }) {
  const { author } = message;
  if (author.avatarUrl) {
    return (
      <img
        src={author.avatarUrl}
        alt={author.name}
        referrerPolicy="no-referrer"
        loading="lazy"
        className={cn("size-6 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground",
        className,
      )}
    >
      {author.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Member chip: small inline pill (member icon + memberSinceText). */
function MemberChip({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-28 shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-medium text-primary">
      <Award className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function VerifiedMark() {
  return <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" aria-label="Verified" />;
}

/** Name row shared by all rich kinds (name + badges + timestamp). */
function NameRow({
  message,
  showTimestamps,
  className,
}: {
  message: LiveChatMessageDTO;
  showTimestamps: boolean;
  className?: string;
}) {
  const ts = showTimestamps ? formatTimestamp(message) : "";
  return (
    <div className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className={cn("truncate text-xs font-medium", authorNameClass(message))}>
        {message.author.name}
      </span>
      {message.author.badges.includes("verified") && <VerifiedMark />}
      {message.author.badges.includes("member") && message.author.memberSinceText && (
        <MemberChip text={message.author.memberSinceText} />
      )}
      {ts && (
        <span className="ml-auto shrink-0 pl-1 text-[10px] tabular-nums text-muted-foreground">
          {ts}
        </span>
      )}
    </div>
  );
}

export function LiveChatMessage({
  message,
  showTimestamps,
}: {
  message: LiveChatMessageDTO;
  showTimestamps: boolean;
}) {
  const body = message.body?.trim() ?? "";

  // --- system: muted italic note, no avatar ------------------------------
  if (message.kind === "system") {
    return (
      <p className="px-1 py-1 text-xs italic leading-snug text-muted-foreground">{message.body}</p>
    );
  }

  // --- banner: pinned notice --------------------------------------------
  if (message.kind === "banner") {
    return (
      <div className="my-1 rounded-lg border border-border bg-secondary/40 px-2 py-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Pin className="size-3" aria-hidden="true" />
          Pinned
        </span>
        {body && <p className="mt-0.5 break-words text-sm leading-snug">{message.body}</p>}
      </div>
    );
  }

  // --- super chat / super sticker: purchase-tinted row -------------------
  if (message.kind === "superchat" || message.kind === "supersticker") {
    const sc = message.superChat;
    const tint = superChatTint(sc?.color);
    const amount = sc?.amountText;
    // stickers render their label as the body line; keep a sane fallback
    const label =
      message.kind === "supersticker"
        ? body || (amount ? `${amount} sticker` : "Super Sticker")
        : body;

    return (
      <div
        className={cn(
          "my-1 rounded-lg p-2",
          !tint && "border-l-[3px] border-l-primary bg-primary/10",
        )}
        style={
          tint
            ? {
                backgroundColor: `${tint}${SUPERCHAT_ALPHA}`,
                borderLeft: `3px solid ${tint}`,
              }
            : undefined
        }
      >
        <div className="flex items-start gap-2">
          <AuthorAvatar message={message} />
          <div className="min-w-0 flex-1">
            <NameRow message={message} showTimestamps={showTimestamps} />
            {amount && <p className="mt-0.5 text-sm font-bold leading-tight">{amount}</p>}
            {label && <p className="mt-0.5 break-words text-sm leading-snug">{label}</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- member milestone / gift: subtle highlighted row --------------------
  if (message.kind === "member-milestone" || message.kind === "membership-gift") {
    const chipText =
      message.kind === "member-milestone"
        ? message.memberMilestoneText || body
        : body || "Member welcome";
    return (
      <div className="my-1 rounded-lg bg-secondary/60 px-2 py-1.5 dark:bg-secondary/40">
        <div className="flex items-start gap-2">
          <AuthorAvatar message={message} />
          <div className="min-w-0 flex-1">
            <NameRow message={message} showTimestamps={showTimestamps} />
            {chipText && (
              <div className="mt-0.5">
                <MemberChip text={chipText} />
              </div>
            )}
            {body && body !== chipText && (
              <p className="mt-0.5 break-words text-sm leading-snug">{body}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- plain text ---------------------------------------------------------
  return (
    <div className="flex items-start gap-2 px-1 py-1">
      <AuthorAvatar message={message} />
      <div className="min-w-0 flex-1">
        <NameRow message={message} showTimestamps={showTimestamps} />
        {body && <p className="mt-0.5 break-words text-sm leading-snug">{message.body}</p>}
      </div>
    </div>
  );
}

export default LiveChatMessage;
