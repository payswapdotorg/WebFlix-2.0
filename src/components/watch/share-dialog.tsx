"use client";

/**
 * WFX2-W share dialog — copy link with the ?t= timestamp checkbox
 * (the copied link seeks on load), social share targets, Embed link.
 *
 * WFX2-P23-A — the dialog gains youtube.com's "Clip" tab (the dispatch
 * spec): a tab row [Share | Clip] where the Clip tab is the measured
 * yt-clip-creation-renderer family (the live bundle's own template,
 * measured 2026-10-17):
 *   - the title row (the viewer's avatar + display name + "Public")
 *   - the name field (char-counter textarea, required, maxlength)
 *   - the scrubber: #text-inputs (editable start/end timestamps with
 *     warning icons + the "–" spacer) + the trimmer (the video timeline
 *     with draggable left/right handles, the playhead, the duration
 *     readout) — the 15s min / 60s max law enforced on every input
 *   - the footer: Cancel + Create Clip (the #share submit rung)
 *   - post-create: the share sheet (the clip's /clip/<id> link + Copy +
 *     the social targets) + the honest upstream note (a WebFlix-local
 *     clip — youtube.com's own web create seam is gone, measured).
 * Guests: the create routes to /signin (the AU signed-out law).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Copy, Link2, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDuration } from "@/lib/watch/format";
import { formatTimestampParam } from "@/lib/watch/share";
import { ShareTargetRow } from "./share-targets";
import {
  CLIP_MIN_SEC,
  CLIP_MAX_SEC,
  clampClipHandle,
  defaultClipWindow,
  formatTimeInput,
  parseTimeInput,
} from "@/lib/clip/trimmer";
import { CLIP_TITLE_MAX, CLIP_CREATE_NOTE } from "@/lib/clip/clip-service";
import { signInHref } from "@/lib/auth/client";

const SOCIALS = [
  { label: "X", href: (u: string, t: string) => `https://x.com/intent/tweet?text=${encodeURIComponent(`Check out "${t}"`)}&url=${encodeURIComponent(u)}` },
  { label: "WhatsApp", href: (u: string) => `https://wa.me/?text=${encodeURIComponent(u)}` },
  { label: "Facebook", href: (u: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { label: "Email", href: (u: string, t: string) => `mailto:?subject=${encodeURIComponent(t)}&body=${encodeURIComponent(u)}` },
];

export interface ShareDialogViewer {
  name: string | null;
  avatarUrl: string | null;
}

export function ShareDialog({
  open,
  onOpenChange,
  videoId,
  title,
  currentTime,
  durationSec,
  viewer,
  guest,
  signInPath,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videoId: string;
  title: string;
  currentTime: number;
  /** the source video's duration (the trimmer's timeline bound) */
  durationSec: number;
  /** the signed-in viewer (the Clip tab's title row) — null in public mode */
  viewer: ShareDialogViewer | null;
  guest: boolean;
  /** where the guest gate sends the viewer (the AU law) */
  signInPath: string;
}) {
  const [tab, setTab] = useState<"share" | "clip">("share");
  const [startAt, setStartAt] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const base = `${window.location.origin}/watch/${videoId}`;
    return startAt && currentTime > 0
      ? `${base}?t=${formatTimestampParam(Math.floor(currentTime))}`
      : base;
  }, [videoId, startAt, currentTime]);

  const embedUrl = `${window.location.origin}/watch/${videoId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the link text instead");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription className="sr-only">
            Share this video via a link with an optional start time, or clip a segment
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "share" | "clip")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="share">Share</TabsTrigger>
            <TabsTrigger value="clip">Clip</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "share" ? (
          <div data-testid="share-tab">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="Share targets">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href(url, title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition hover:bg-secondary/70"
                >
                  {s.label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3">
                <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm text-foreground/90">{url}</span>
              </div>
              <Button onClick={copy} variant="default" className="h-10 shrink-0 gap-1.5 rounded-full">
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={startAt}
                onCheckedChange={(v) => setStartAt(v === true)}
                aria-label={`Start at ${formatDuration(currentTime)}`}
              />
              Start at {formatDuration(currentTime)}
            </label>

            <DialogFooter className="mt-1">
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(`<iframe width="560" height="315" src="${embedUrl}" title="${title}" frameborder="0" allowfullscreen></iframe>`)
                    .then(() => toast.success("Embed code copied"))
                    .catch(() => toast.error("Could not copy embed code"));
                }}
              >
                Embed code
              </button>
            </DialogFooter>
          </div>
        ) : (
          <ClipTab
            videoId={videoId}
            videoTitle={title}
            currentTime={currentTime}
            durationSec={durationSec}
            viewer={viewer}
            guest={guest}
            signInPath={signInPath}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* the Clip tab — the measured clip-creation family                    */
/* ------------------------------------------------------------------ */

interface CreatedClip {
  clipId: string;
  url: string;
  note: string;
}

function ClipTab({
  videoId,
  videoTitle,
  currentTime,
  durationSec,
  viewer,
  guest,
  signInPath,
  onClose,
}: {
  videoId: string;
  videoTitle: string;
  currentTime: number;
  durationSec: number;
  viewer: ShareDialogViewer | null;
  guest: boolean;
  signInPath: string;
  onClose: () => void;
}) {
  const initial = useMemo(() => defaultClipWindow(currentTime, durationSec), [currentTime, durationSec]);
  const [name, setName] = useState("");
  const [window_, setWindow] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedClip | null>(null);
  const [copied, setCopied] = useState(false);
  const [startText, setStartText] = useState(formatTimeInput(initial.startSec));
  const [endText, setEndText] = useState(formatTimeInput(initial.endSec));
  const [timeWarning, setTimeWarning] = useState<"start" | "end" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // the drag flag rides STATE (the house seek-bar idiom — refs are never
  // written during render)
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  const duration = Math.max(0, durationSec || 0);
  const length = window_.endSec - window_.startSec;
  const tooShort = length < CLIP_MIN_SEC;
  const canCreate = !creating && !!name.trim() && !tooShort && length <= CLIP_MAX_SEC && !created;

  /* ---- the trimmer's drag machinery (pointer events) ---- */

  const secFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return ratio * duration;
    },
    [duration]
  );

  const onHandlePointerDown = (which: "start" | "end") => (e: React.PointerEvent) => {
    if (created) return;
    e.preventDefault();
    setDragging(which);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (dragging === null || created) return;
    const proposed = secFromClientX(e.clientX);
    const anchor = dragging === "start" ? window_.endSec : window_.startSec;
    const clamped = clampClipHandle(dragging, proposed, anchor, duration);
    const next =
      dragging === "start"
        ? { startSec: clamped, endSec: window_.endSec }
        : { startSec: window_.startSec, endSec: clamped };
    setStartText(formatTimeInput(next.startSec));
    setEndText(formatTimeInput(next.endSec));
    setWindow(next);
  };

  const onHandlePointerUp = () => {
    setDragging(null);
  };

  /* ---- the editable timestamp inputs (the measured #text-inputs row) ---- */

  const commitTime = (which: "start" | "end", text: string) => {
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setTimeWarning(which);
      return;
    }
    setTimeWarning(null);
    const anchor = which === "start" ? window_.endSec : window_.startSec;
    const clamped = clampClipHandle(which, parsed, anchor, duration);
    const next =
      which === "start"
        ? { startSec: clamped, endSec: window_.endSec }
        : { startSec: window_.startSec, endSec: clamped };
    setStartText(formatTimeInput(next.startSec));
    setEndText(formatTimeInput(next.endSec));
    setWindow(next);
  };

  /* ---- create ---- */

  const create = async () => {
    if (guest) {
      window.location.assign(signInHref(signInPath));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          title: name.trim(),
          startSec: Math.floor(window_.startSec),
          endSec: Math.ceil(window_.endSec),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        clipId?: string;
        url?: string;
        note?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.url) {
        setError(body.error ?? "The clip could not be created");
        return;
      }
      setCreated({ clipId: body.clipId ?? "", url: body.url, note: body.note ?? CLIP_CREATE_NOTE });
      toast.success("Clip created");
    } catch {
      setError("The clip could not be created — check your connection and try again");
    } finally {
      setCreating(false);
    }
  };

  /* ---- the post-create share sheet ---- */

  if (created) {
    const clipUrl = `${window.location.origin}${created.url}`;
    return (
      <div data-testid="clip-created-sheet" className="pt-1">
        <p className="text-sm font-medium">Your clip is ready to share</p>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="clip-created-title">
          “{name.trim()}” · {formatTimeInput(window_.startSec)} – {formatTimeInput(window_.endSec)} from “{videoTitle}”
        </p>
        <ShareTargetRow
          url={clipUrl}
          title={name.trim()}
          copied={copied}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(clipUrl);
              setCopied(true);
              toast.success("Clip link copied to clipboard");
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Could not copy — select the link text instead");
            }
          }}
        />
        <p className="mt-3 rounded-lg bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground" data-testid="clip-honest-note">
          {created.note}
        </p>
        <DialogFooter className="mt-2 gap-2">
          <Button variant="outline" className="rounded-full" asChild>
            <a href={created.url} data-testid="clip-open-link">
              Open clip
            </a>
          </Button>
          <Button variant="default" className="rounded-full" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  /* ---- the creation form (the measured template) ---- */

  const startPct = duration > 0 ? (window_.startSec / duration) * 100 : 0;
  const endPct = duration > 0 ? (window_.endSec / duration) * 100 : 100;
  const playheadPct = duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0;

  return (
    <div className="pt-1" data-testid="clip-tab">
      {/* the title row: avatar · display name · Public (the measured #title) */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={viewer?.avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{(viewer?.name ?? "G").slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-medium">
            {viewer?.name ?? "Signed out"}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">Public</span>
      </div>

      {/* the name field (the measured title-input: char-counter, required) */}
      <label className="block">
        <span className="sr-only">Name your clip</span>
        <textarea
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, CLIP_TITLE_MAX))}
          placeholder="Name your clip"
          rows={1}
          maxLength={CLIP_TITLE_MAX}
          required
          aria-label="Name your clip"
          data-testid="clip-name-input"
          className="w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      <div className="-mt-1 flex justify-end" aria-hidden="true">
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {name.length}/{CLIP_TITLE_MAX}
        </span>
      </div>

      {/* #text-inputs: the editable start – end timestamps (measured) */}
      <div className="flex items-center gap-2 py-1">
        {timeWarning === "start" && (
          <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-label="Invalid start time" />
        )}
        <input
          value={startText}
          onChange={(e) => setStartText(e.target.value)}
          onBlur={() => commitTime("start", startText)}
          inputMode="numeric"
          aria-label="Clip start time"
          data-testid="clip-start-input"
          className="h-8 w-20 rounded-md border border-border bg-transparent px-2 text-center text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span aria-hidden="true" className="text-muted-foreground">–</span>
        {timeWarning === "end" && (
          <TriangleAlert className="size-4 shrink-0 text-amber-500" aria-label="Invalid end time" />
        )}
        <input
          value={endText}
          onChange={(e) => setEndText(e.target.value)}
          onBlur={() => commitTime("end", endText)}
          inputMode="numeric"
          aria-label="Clip end time"
          data-testid="clip-end-input"
          className="h-8 w-20 rounded-md border border-border bg-transparent px-2 text-center text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* the trimmer: the timeline track + the draggable window + the playhead */}
      <div
        ref={trackRef}
        className="relative h-12 w-full select-none rounded-lg bg-secondary/60"
        data-testid="clip-trimmer"
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        role="slider"
        aria-label="Clip range"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(window_.startSec)}
        aria-valuetext={`${formatTimeInput(window_.startSec)} to ${formatTimeInput(window_.endSec)}`}
      >
        {/* ruler ticks */}
        <div className="pointer-events-none absolute inset-x-1 bottom-1.5 h-2" aria-hidden="true">
          {Array.from({ length: 21 }).map((_, i) => (
            <span
              key={i}
              className={i % 5 === 0 ? "h-2 w-px bg-muted-foreground/60" : "h-1 w-px bg-muted-foreground/30"}
              style={{ position: "absolute", left: `${i * 5}%`, bottom: 0 }}
            />
          ))}
        </div>
        {/* the selected window */}
        <div
          className="absolute inset-y-2 rounded-md bg-primary/25 ring-1 ring-primary/50"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
          data-testid="clip-window"
        />
        {/* the left handle */}
        <button
          type="button"
          aria-label="Clip start handle"
          data-testid="clip-handle-start"
          onPointerDown={onHandlePointerDown("start")}
          className="absolute inset-y-1.5 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-primary shadow"
          style={{ left: `${startPct}%` }}
        />
        {/* the right handle */}
        <button
          type="button"
          aria-label="Clip end handle"
          data-testid="clip-handle-end"
          onPointerDown={onHandlePointerDown("end")}
          className="absolute inset-y-1.5 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-primary shadow"
          style={{ left: `${endPct}%` }}
        />
        {/* the playhead (the latched position where Share was opened) */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground/70"
          style={{ left: `${playheadPct}%` }}
          data-testid="clip-playhead"
          aria-hidden="true"
        />
      </div>

      {/* #duration — the duration readout (the measured durationLabel row) */}
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="clip-duration-label">
          {Math.round(length)}s · {formatTimeInput(window_.startSec)} – {formatTimeInput(window_.endSec)}
        </span>
        <span>
          {CLIP_MIN_SEC}s min · {CLIP_MAX_SEC}s max
        </span>
      </div>

      {tooShort && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400" data-testid="clip-too-short" role="status">
          Clips must be at least {CLIP_MIN_SEC} seconds long
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-destructive" data-testid="clip-error" role="alert">
          {error}
        </p>
      )}

      {/* the footer: Cancel + Create Clip (the measured #cancel + #share) */}
      <DialogFooter className="mt-2 gap-2">
        <Button variant="outline" className="rounded-full" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          className="gap-1.5 rounded-full"
          disabled={!canCreate}
          onClick={() => void create()}
          data-testid="clip-create-button"
        >
          {creating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Create Clip
        </Button>
      </DialogFooter>
    </div>
  );
}
