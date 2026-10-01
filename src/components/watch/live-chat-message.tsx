"use client";

/**
 * WFX2-A-S — one live-chat row: plain text, super chat (tinted with the
 * purchase color, hex + alpha suffix via inline style), super sticker,
 * member milestone / gift, pinned banner, and system notes. Author names
 * are colored YouTube-style by badge (owner gold, moderator green, member
 * accent); avatars are plain <img> (external hosts, referrerPolicy
 * "no-referrer" — the codebase pattern for YouTube-hosted images).
 *
 * WFX2-P3-LC (additive) — the report affordance: authored rows gain a
 * right-click context menu with "Report" (youtube.com's chat affordance
 * family), which opens the report dialog (the comment-report-dialog idiom —
 * reason rows + Report button). The submit routes through the new report
 * action (@/lib/livechat/report) and shows its HONEST outcome: the
 * platform's chat report DOM is not drivable through the current broker
 * registry, so the dialog says so — never a fake "reported" state.
 * System notes and banners carry no author → no affordance.
 */
import { useState } from "react";
import { Award, BadgeCheck, Flag, Pin } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import {
  reportLiveChatMessage,
  type LiveChatReportResult,
} from "@/lib/livechat/report";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

/** 15–20% alpha over the super chat color (#rrggbb → #rrggbb2b). */
const SUPERCHAT_ALPHA = "2b";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** YouTube's chat report-dialog reason labels (the comment family). */
export const CHAT_REPORT_REASONS = [
  "Spam or misleading",
  "Harassment or bullying",
  "Hate speech or graphic violence",
  "Promotes terrorism",
  "Impersonation",
] as const;

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

/**
 * WFX2-P3-LC — the chat report dialog (the comment-report-dialog idiom:
 * the reasons radiogroup, single select, Report button). The submit routes
 * through the new report action and renders its HONEST outcome inline —
 * the degradation copy when the platform's chat report DOM is unavailable
 * (the current state), the success copy only when a report really filed.
 */
export function LiveChatReportDialog({
  open,
  onOpenChange,
  message,
  videoId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  message: LiveChatMessageDTO;
  videoId: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LiveChatReportResult | null>(null);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const result = await reportLiveChatMessage({
        videoId,
        messageId: message.id,
        body: message.body,
        reason,
      });
      setOutcome(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setReason(null);
          setOutcome(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-5" aria-hidden="true" />
            Report message
          </DialogTitle>
          <DialogDescription>
            Tell us why you&apos;re reporting this chat message.
          </DialogDescription>
        </DialogHeader>
        {outcome ? (
          <div
            role="status"
            data-testid="chat-report-outcome"
            className={cn(
              "rounded-lg px-3 py-2.5 text-sm leading-snug",
              outcome.ok ? "bg-secondary/70" : "bg-secondary/70 text-muted-foreground",
            )}
          >
            {outcome.message}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Report message reason" className="max-h-72 overflow-y-auto">
            {CHAT_REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition hover:bg-accent"
              >
                <span
                  className={`flex size-4 items-center justify-center rounded-full border ${
                    reason === r ? "border-[#f03]" : "border-muted-foreground/60"
                  }`}
                  aria-hidden="true"
                >
                  {reason === r && <span className="size-2 rounded-full bg-[#f03]" />}
                </span>
                {r}
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          {outcome ? (
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                disabled={!reason || busy}
                onClick={submit}
              >
                {busy ? "Reporting…" : "Report"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WFX2-P3-LC — the report affordance wrapper: the authored row + its
 * right-click context menu (youtube.com's chat affordance). Rendered only
 * when the parent supplies the watch surface's videoId (the panel does);
 * otherwise rows render exactly as before (additive, opt-in).
 */
function ReportableRow({
  message,
  videoId,
  children,
}: {
  message: LiveChatMessageDTO;
  videoId?: string;
  children: React.ReactNode;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  if (!videoId) return <>{children}</>;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setReportOpen(true)}>
            <Flag aria-hidden="true" />
            Report
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <LiveChatReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        message={message}
        videoId={videoId}
      />
    </>
  );
}

export function LiveChatMessage({
  message,
  showTimestamps,
  videoId,
}: {
  message: LiveChatMessageDTO;
  showTimestamps: boolean;
  /** WFX2-P3-LC: the watch surface's video id — enables the report affordance */
  videoId?: string;
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
      <ReportableRow message={message} videoId={videoId}>
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
      </ReportableRow>
    );
  }

  // --- member milestone / gift: subtle highlighted row --------------------
  if (message.kind === "member-milestone" || message.kind === "membership-gift") {
    const chipText =
      message.kind === "member-milestone"
        ? message.memberMilestoneText || body
        : body || "Member welcome";
    return (
      <ReportableRow message={message} videoId={videoId}>
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
      </ReportableRow>
    );
  }

  // --- plain text ---------------------------------------------------------
  return (
    <ReportableRow message={message} videoId={videoId}>
      <div className="flex items-start gap-2 px-1 py-1">
        <AuthorAvatar message={message} />
        <div className="min-w-0 flex-1">
          <NameRow message={message} showTimestamps={showTimestamps} />
          {body && <p className="mt-0.5 break-words text-sm leading-snug">{message.body}</p>}
        </div>
      </div>
    </ReportableRow>
  );
}

export default LiveChatMessage;
