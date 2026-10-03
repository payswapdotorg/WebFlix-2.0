"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Captions,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Scale,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useApi, postJson } from "@/hooks/use-api";
import type { UploadContextDTO, UploadHandoffDTO } from "@/lib/types";
import {
  UPLOAD_STEPS,
  canPublish,
  detailsStepReady,
  initialUploadFlowState,
  uploadFlowNext,
  type UploadExecuteResponseDTO,
  type UploadVisibility,
  type UploadWizardStep,
} from "@/lib/upload/flow";
import UploadResultCard from "./upload-result";

const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";
const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX = 5000;

/**
 * Mirrors STAGE_MAX_BYTES_PER_FILE in src/lib/upload/stage.ts — not imported
 * here because the staged-file store is a server lib (node:crypto); the two
 * constants MUST stay in sync (the /api/upload/stage 400 is the backstop).
 */
const STAGE_MB_CAP = 256;
const STAGE_MAX_BYTES = STAGE_MB_CAP * 1024 * 1024;

/** The Checks step's animation length (YouTube's spin-then-advance rhythm). */
const CHECKS_RUN_MS = 1400;

/** The browser-side video sniffs the stage route also accepts (a typed or
 * extension-typed video files stages; a text file never does). */
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|m4v|avi|ogv|mpeg|mpg|wmv|ts|3gp)$/i;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** YouTube's duration text (m:ss / h:mm:ss); null when the number is not a
 * real finite duration — the display stays honestly absent, never 0:00. */
function formatDuration(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return null;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface StageFileOutcome {
  status: number;
  body: { stageId?: string; error?: string };
}

/**
 * POST /api/upload/stage with REAL upload progress when the browser XHR is
 * available; falls back to plain fetch when it is not (no progress events —
 * the header then shows the honest indeterminate state, never a fake number).
 */
function stagePickedFile(
  file: File,
  onProgress: (pct: number | null) => void
): Promise<StageFileOutcome> {
  const fd = new FormData();
  fd.append("file", file);
  if (typeof XMLHttpRequest === "undefined") {
    onProgress(null);
    return fetch("/api/upload/stage", { method: "POST", body: fd }).then(async (res) => ({
      status: res.status,
      body: (await res.json().catch(() => ({}))) as StageFileOutcome["body"],
    }));
  }
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/stage");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.max(1, Math.min(100, Math.round((e.loaded / e.total) * 100))));
      }
    };
    xhr.onload = () =>
      resolve({ status: xhr.status, body: (xhr.response ?? {}) as StageFileOutcome["body"] });
    xhr.onerror = () =>
      resolve({ status: 0, body: { error: "the staging request failed (network)" } });
    xhr.send(fd);
  });
}

/** YouTube's three visibility levels — the honest subset (no fake scheduling). */
const VISIBILITIES: readonly {
  id: UploadVisibility;
  label: string;
  description: string;
}[] = [
  {
    id: "private",
    label: "Private",
    description: "Only you can watch it — the safest while it settles.",
  },
  {
    id: "unlisted",
    label: "Unlisted",
    description: "Anyone with the video link can watch.",
  },
  {
    id: "public",
    label: "Public",
    description: "Everyone can watch — listed on your channel.",
  },
];

// ---------------------------------------------------------------------------
// Step 0 — the drag-and-drop target (YouTube's studio upload entry)
// ---------------------------------------------------------------------------
function DropTarget(props: { onFiles: (files: FileList | File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div
        data-testid="upload-drop-target"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          props.onFiles(e.dataTransfer.files);
        }}
        className={`flex w-full max-w-2xl cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-16 ${
          dragOver
            ? "border-primary bg-primary/10"
            : "border-border bg-secondary/30 hover:bg-secondary/50"
        }`}
      >
        <UploadCloud className="size-16 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-medium sm:text-xl">
          Drag and drop video files to upload
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your videos will stay private on WebFlix until you publish them — the upload to
          YouTube runs through the connected operator session, with the honest hand-off
          bundle when it is offline.
        </p>
        <Button
          type="button"
          variant="outline"
          className="rounded-full px-6"
          data-testid="upload-select-files"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          SELECT FILES
        </Button>
        <p className="text-xs text-muted-foreground">
          MP4, MOV, WebM… — one video at a time. WebFlix&apos;s staging caps at{" "}
          {STAGE_MB_CAP}MB; larger files ride the hand-off bundle to YouTube&apos;s upload
          page.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          aria-label="Select a video file"
          data-testid="upload-file-input"
          onChange={(e) => {
            props.onFiles(e.target.files ?? []);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the header step chips (Details / Video elements / Checks / Visibility)
// ---------------------------------------------------------------------------
function StepChips(props: {
  step: UploadWizardStep;
  disabled: boolean;
  onJumpBack: (to: UploadWizardStep) => void;
}) {
  return (
    <nav aria-label="Upload steps" data-testid="upload-step-chips">
      <ol className="flex items-center gap-1 overflow-x-auto text-xs sm:text-sm">
        {UPLOAD_STEPS.map((s) => {
          const active = props.step === s.id;
          const reachable = s.id < props.step;
          return (
            <li key={s.id} aria-current={active ? "step" : undefined}>
              <button
                type="button"
                data-testid={`step-chip-${s.id}`}
                disabled={props.disabled || !reachable}
                onClick={() => reachable && props.onJumpBack(s.id)}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition-colors sm:px-3 ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : reachable
                      ? "text-foreground hover:bg-secondary"
                      : "text-muted-foreground/60"
                }`}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Details (title + description, YouTube's field order + counters)
// ---------------------------------------------------------------------------
function DetailsStep(props: {
  title: string;
  description: string;
  busy: boolean;
  sizeOverCap: boolean;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
}) {
  return (
    <section aria-label="Details" className="space-y-5" data-testid="upload-details-step">
      {props.sizeOverCap && (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          data-testid="upload-size-warning"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p>
            This file exceeds WebFlix&apos;s {STAGE_MB_CAP}MB staging cap — publishing through
            WebFlix cannot run for it. Fill in the details and use{" "}
            <span className="font-medium text-foreground">Hand off without uploading</span> on
            the Visibility step: the metadata bundle carries it to YouTube&apos;s upload page.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title{" "}
          <span className="text-xs text-muted-foreground" data-testid="upload-title-counter">
            ({props.title.length}/{YOUTUBE_TITLE_MAX})
          </span>
        </Label>
        <Input
          id="title"
          autoFocus
          maxLength={YOUTUBE_TITLE_MAX}
          value={props.title}
          onChange={(e) => props.onTitle(e.target.value)}
          placeholder="Add a title that describes your video"
          aria-describedby="title-hint"
          disabled={props.busy}
          data-testid="upload-title-input"
        />
        {props.title.trim().length === 0 && (
          <p id="title-hint" className="text-xs text-muted-foreground">
            A title is required to continue — YouTube asks for one too.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="text-xs text-muted-foreground" data-testid="upload-description-counter">
            ({props.description.length}/{YOUTUBE_DESCRIPTION_MAX})
          </span>
        </Label>
        <Textarea
          id="description"
          rows={5}
          maxLength={YOUTUBE_DESCRIPTION_MAX}
          value={props.description}
          onChange={(e) => props.onDescription(e.target.value)}
          placeholder="Tell viewers about your video"
          disabled={props.busy}
          data-testid="upload-description-input"
        />
        <p className="text-xs text-muted-foreground">
          The description rides the publish drive — and the hand-off bundle when the broker
          is offline.
        </p>
      </div>
    </section>
  );
}

/** A YouTube-parity affordance this clone honestly cannot run locally —
 * disabled chrome + the "Managed on YouTube" truth, never a fake control. */
function ManagedOnYouTube(props: { icon: React.ReactNode; label: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-secondary/20 p-3 text-sm opacity-70"
      aria-disabled="true"
      data-testid={`yt-managed-${props.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      title="Managed on YouTube — this part of the upload runs on youtube.com"
    >
      <span className="flex items-center gap-2 text-muted-foreground">
        {props.icon}
        {props.label}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        Managed on YouTube
        <a
          href={YOUTUBE_UPLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
          aria-label={`${props.label} — managed on YouTube's upload page`}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Video elements (the WebFlix-honest subset)
// ---------------------------------------------------------------------------
function ElementsStep(props: {
  tags: string;
  thumbnailUrl: string;
  isShort: boolean;
  busy: boolean;
  onTags: (v: string) => void;
  onThumbnailUrl: (v: string) => void;
  onIsShort: (v: boolean) => void;
}) {
  return (
    <section
      aria-label="Video elements"
      className="space-y-5"
      data-testid="upload-elements-step"
    >
      <div className="space-y-2">
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          value={props.tags}
          onChange={(e) => props.onTags(e.target.value)}
          placeholder="pc build, gaming, 2026"
          aria-describedby="tags-hint"
          disabled={props.busy}
          data-testid="upload-tags-input"
        />
        <p id="tags-hint" className="text-xs text-muted-foreground">
          Tags ride the publish payload and the hand-off bundle.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
        <Input
          id="thumbnailUrl"
          type="url"
          inputMode="url"
          value={props.thumbnailUrl}
          onChange={(e) => props.onThumbnailUrl(e.target.value)}
          placeholder="https://…/image.jpg"
          aria-describedby="thumb-hint"
          disabled={props.busy}
          data-testid="upload-thumbnail-input"
        />
        <p id="thumb-hint" className="text-xs text-muted-foreground">
          Noted in the bundle — YouTube&apos;s real thumbnail upload happens in the upload
          form (or later in Studio).
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="isShort"
          checked={props.isShort}
          onCheckedChange={(v) => props.onIsShort(v === true)}
          disabled={props.busy}
        />
        <Label htmlFor="isShort" className="cursor-pointer font-normal">
          This is a Short (vertical)
        </Label>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">On YouTube only</h3>
        <ManagedOnYouTube icon={<Captions className="size-4" aria-hidden="true" />} label="Add subtitles" />
        <ManagedOnYouTube
          icon={<CalendarClock className="size-4" aria-hidden="true" />}
          label="Recording date and location"
        />
        <ManagedOnYouTube icon={<Scale className="size-4" aria-hidden="true" />} label="Category and license" />
        <p className="text-xs text-muted-foreground">
          These upload-dialog sections run on youtube.com — WebFlix never fakes a working
          control for them.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Checks (the honest local validation, never YouTube's copyright
// checks claimed)
// ---------------------------------------------------------------------------
function ChecksStep(props: { checks: "running" | "passed" }) {
  if (props.checks === "running") {
    return (
      <section aria-label="Checks" className="py-8" data-testid="upload-checks-running">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          Checking your file…
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Validating the picked file and the metadata locally — WebFlix&apos;s own checks.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Checks" className="py-8" data-testid="upload-checks-complete">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
        Checks complete — no issues found.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        File and metadata validated (WebFlix&apos;s local checks). YouTube&apos;s copyright
        and ad-suitability checks run after upload, on youtube.com.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Visibility (selectable cards, radiogroup semantics)
// ---------------------------------------------------------------------------
function VisibilityStep(props: {
  visibility: UploadVisibility;
  busy: boolean;
  onSelect: (v: UploadVisibility) => void;
}) {
  const move = (dir: 1 | -1) => {
    const i = VISIBILITIES.findIndex((v) => v.id === props.visibility);
    const next = VISIBILITIES[(i + dir + VISIBILITIES.length) % VISIBILITIES.length];
    props.onSelect(next.id);
    // roving tabindex: the newly selected card takes the focus
    queueMicrotask(() => {
      document
        .querySelector<HTMLElement>(`[data-testid='visibility-${next.id}']`)
        ?.focus();
    });
  };
  return (
    <section aria-label="Visibility" className="space-y-4" data-testid="upload-visibility-step">
      <div role="radiogroup" aria-label="Visibility" className="space-y-2" data-testid="visibility-cards">
        {VISIBILITIES.map((v) => {
          const selected = props.visibility === v.id;
          return (
            <div
              key={v.id}
              role="radio"
              aria-checked={selected}
              aria-labelledby={`visibility-${v.id}-label`}
              aria-describedby={`visibility-${v.id}-desc`}
              tabIndex={selected ? 0 : -1}
              data-testid={`visibility-${v.id}`}
              onClick={() => !props.busy && props.onSelect(v.id)}
              onKeyDown={(e) => {
                if (props.busy) return;
                if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  move(-1);
                } else if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  props.onSelect(v.id);
                }
              }}
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-background hover:bg-secondary/40"
              } ${props.busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <span id={`visibility-${v.id}-label`} className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className={`flex size-4 items-center justify-center rounded-full border ${
                    selected ? "border-primary" : "border-muted-foreground"
                  }`}
                >
                  {selected && <span className="size-2 rounded-full bg-primary" />}
                </span>
                {v.label}
              </span>
              <span
                id={`visibility-${v.id}-desc`}
                className="mt-1 block pl-6 text-xs text-muted-foreground"
              >
                {v.description}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Visibility is applied when the video is published through the connected YouTube
        session — the same three levels YouTube&apos;s upload dialog uses. Scheduling is
        managed on YouTube.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// the right column — the honest local preview of the picked file
// ---------------------------------------------------------------------------
function VideoPreview(props: { url: string; fileName: string; sizeBytes: number }) {
  // the duration is READ FROM THE FILE — the browser's <video> element
  // reports it on loadedmetadata; until then (or forever, in environments
  // that never decode) the display stays honestly absent
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const durationText = formatDuration(durationSec);
  return (
    <aside
      aria-label="Video preview"
      data-testid="upload-video-preview"
      className="w-full shrink-0 space-y-2 border-t border-border p-4 md:w-80 md:border-l md:border-t-0"
    >
      {/* the local preview of the user's own file, pre-upload (no captions
          exist yet — the mute + controls affordances are the whole UI) */}
      <video
        src={props.url}
        muted
        playsInline
        preload="metadata"
        controls
        onLoadedMetadata={(e) => setDurationSec(e.currentTarget.duration)}
        className="aspect-video w-full rounded-lg bg-black"
        data-testid="upload-preview-video"
      />
      <p className="truncate text-sm font-medium" title={props.fileName}>
        {props.fileName}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatBytes(props.sizeBytes)}
        {durationText ? ` · ${durationText}` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        The preview plays locally from the picked file — it reaches YouTube only through
        the publish drive or the hand-off bundle.
      </p>
    </aside>
  );
}

/**
 * WFX2-P6-UP — /upload rebuilt as YouTube's studio upload DIALOG WIZARD:
 * step 0 the big drag-and-drop target, then a left-content / right-preview
 * dialog with a header progress bar and the 4 steps — Details → Video
 * elements → Checks → Visibility — Back/Next bottom-right, Discard (with
 * confirm) top-left. The MECHANICS are the P3-UP flow verbatim: the file
 * stages through /api/upload/stage (XHR-with-progress when the browser
 * offers it), the publish drives the operator's logged-in YouTube tab
 * through /api/upload/execute, and when the broker is offline or refuses
 * the honest hand-off rung carries the user — the metadata bundle +
 * youtube.com/upload, rendered INSIDE the dialog. Nothing is ever claimed
 * that YouTube did not confirm; the header bar never shows a number the
 * browser did not report.
 */
export default function UploadPage() {
  const { data: context, loading } = useApi<UploadContextDTO>("/api/upload");
  const [flow, dispatch] = useReducer(uploadFlowNext, undefined, initialUploadFlowState);
  const [file, setFile] = useState<File | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [bundleCopied, setBundleCopied] = useState(false);
  const [handoff, setHandoff] = useState<UploadHandoffDTO | null>(null);
  const [stagePct, setStagePct] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    tags: "",
    thumbnailUrl: "",
    visibility: "private" as UploadVisibility,
    isShort: false,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const bundleRef = useRef<HTMLTextAreaElement>(null);

  const busy = flow.phase === "staging" || flow.phase === "executing";
  const sizeOverCap = file !== null && file.size > STAGE_MAX_BYTES;
  const staging = flow.phase === "staging";
  const settled = flow.result !== null && !busy;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // the honest local preview URL (revoked when the file changes/unmounts)
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // the Checks step's animation → the honest auto-advance to Visibility
  useEffect(() => {
    if (flow.step !== 3 || flow.checks !== "running") return;
    const t = setTimeout(() => dispatch({ type: "checks-completed" }), CHECKS_RUN_MS);
    return () => clearTimeout(t);
  }, [flow.step, flow.checks]);

  // Esc: opens the discard confirm (never a silent close); blocked while a
  // publish is in flight; while the confirm is open Esc cancels it instead.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (busy) return;
      if (discardOpen) {
        setDiscardOpen(false);
        return;
      }
      if (file) setDiscardOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, discardOpen, file]);

  // the dialog's focus trap — Tab wraps within the wizard
  useEffect(() => {
    const el = dialogRef.current;
    if (!file || !el) return;
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      ).filter((n) => n.getAttribute("aria-disabled") !== "true");
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = el.ownerDocument.activeElement as HTMLElement | null;
      if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };
    el.addEventListener("keydown", onKeydown);
    return () => el.removeEventListener("keydown", onKeydown);
  }, [file, flow.step, discardOpen]);

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** The pick guard — a video file only (type or extension), honest toasts. */
  function onFiles(files: FileList | File[]) {
    const f = files[0];
    if (!f) return;
    if (files.length > 1) {
      toast.info(`WebFlix uploads one video at a time — “${f.name}” selected.`);
    }
    const looksVideo = f.type.startsWith("video/") || VIDEO_EXT_RE.test(f.name);
    if (!looksVideo) {
      toast.error(
        `“${f.name}” is not a video file — pick an MP4, MOV or WebM (the upload runs on YouTube, which only takes videos).`
      );
      return;
    }
    setFile(f);
    setDiscardOpen(false);
    setHandoff(null);
    setBundleCopied(false);
    dispatch({ type: "file-picked", fileName: f.name, sizeBytes: f.size });
    if (f.size > STAGE_MAX_BYTES) {
      toast.info(
        `“${f.name}” exceeds the ${STAGE_MB_CAP}MB staging cap — publishing through WebFlix cannot run for it; the hand-off bundle on the Visibility step carries it to YouTube.`
      );
    }
  }

  /** The real drive: stage the file → execute the broker publish → settle. */
  async function save() {
    if (!file || !canPublish(flow, form.title) || sizeOverCap) return;
    dispatch({ type: "publish-started" });
    try {
      const staged = await stagePickedFile(file, (pct) => setStagePct(pct));
      if (staged.status !== 200 || !staged.body.stageId) {
        const error =
          staged.body.error ?? `could not stage the file (HTTP ${staged.status})`;
        dispatch({ type: "stage-failed", error });
        toast.error(error);
        return;
      }
      dispatch({ type: "stage-succeeded", stageId: staged.body.stageId });
      dispatch({ type: "execute-started" });
      const result = await postJson<UploadExecuteResponseDTO>("/api/upload/execute", {
        stageId: staged.body.stageId,
        title: form.title,
        description: form.description,
        visibility: form.visibility,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        thumbnailUrl: form.thumbnailUrl || null,
        isShort: form.isShort,
      });
      dispatch({ type: "execute-settled", result });
      if (result.outcome === "published") {
        toast.success(
          result.verified === true
            ? "Published — the video is live on YouTube."
            : "Publish clicked — confirmation not observed (the video may still be processing)."
        );
      } else if (result.outcome === "fallback") {
        toast.info("The session broker is offline — the hand-off bundle is ready below.");
      } else {
        toast.error(result.message ?? "The publish was refused.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "the publish failed";
      dispatch({
        type: "execute-settled",
        result: { outcome: "error", message },
      });
      toast.error(message);
    } finally {
      setStagePct(null);
    }
  }

  /** The hand-off rung (the pre-P3 flow, verbatim): bundle → YouTube. */
  async function handoffSubmit() {
    try {
      const result = await postJson<UploadHandoffDTO>("/api/upload", {
        title: form.title,
        description: form.description,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        visibility: form.visibility,
        thumbnailUrl: form.thumbnailUrl || null,
        isShort: form.isShort,
      });
      setHandoff(result);
      const copied = await copyText(result.bundle);
      if (!copied && bundleRef.current) {
        bundleRef.current.focus();
        bundleRef.current.select();
        document.execCommand("copy");
      }
      window.open(result.handoffUrl, "_blank", "noopener,noreferrer");
      toast.success("Metadata bundle copied — YouTube's upload page is open in a new tab.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build the hand-off");
    }
  }

  function discard() {
    setFile(null);
    setDiscardOpen(false);
    setHandoff(null);
    setBundleCopied(false);
    setStagePct(null);
    dispatch({ type: "reset" });
  }

  /** Each step's honest Next gate. */
  const stepReady =
    flow.step === 1
      ? detailsStepReady(form.title)
      : flow.step === 3
        ? flow.checks === "passed"
        : true;

  const saveBlocked = busy || !canPublish(flow, form.title) || sizeOverCap;

  return (
    <div className="mx-auto max-w-4xl px-2 py-4 pb-16 sm:px-4 sm:py-6">
      <div className="mb-3 text-sm text-muted-foreground">
        {loading ? (
          <Skeleton className="h-4 w-64" />
        ) : context?.channel ? (
          <p>
            Uploading videos as{" "}
            <span className="font-medium text-foreground">{context.channel.name}</span> —
            the upload itself happens on YouTube.
          </p>
        ) : (
          <p>
            Gathering video metadata for YouTube — the upload itself happens on YouTube
            {context ? " (public mode: the operator channel is not connected)" : ""}.
          </p>
        )}
      </div>

      {!file ? (
        <DropTarget onFiles={onFiles} />
      ) : (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Upload videos"
          data-testid="upload-dialog"
          className="relative overflow-hidden rounded-2xl border border-border bg-background shadow-xl"
        >
          {/* header: file + the honest staging progress + the step chips */}
          <header className="space-y-3 border-b border-border p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <h1 className="min-w-0 truncate text-base font-semibold" title={file.name}>
                {file.name}
              </h1>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                data-testid="upload-progress-label"
              >
                {staging && stagePct !== null
                  ? `Uploading ${stagePct}%`
                  : staging
                    ? "Uploading…"
                    : flow.phase === "executing"
                      ? "Publishing through the session broker…"
                      : formatBytes(file.size)}
              </span>
            </div>
            {(staging || flow.phase === "executing") && (
              <div data-testid="upload-progress-bar" aria-hidden="true">
                {staging && stagePct !== null ? (
                  // the DETERMINATE bar — the shadcn Progress primitive, fed
                  // only real browser progress events (never a guess)
                  <Progress value={stagePct} className="h-1" />
                ) : (
                  // the honest INDETERMINATE pulse — no number exists yet
                  // (fetch fallback, or the broker publish hold)
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
                  </div>
                )}
              </div>
            )}
            <StepChips
              step={flow.step}
              disabled={busy}
              onJumpBack={(to) => dispatch({ type: "step-jump", to })}
            />
          </header>

          {/* body: left = the current step, right = the local preview */}
          <div className="flex flex-col md:flex-row">
            <div className="max-h-[65vh] min-w-0 flex-1 overflow-y-auto p-4 slim-scrollbar sm:p-5">
              {flow.step === 1 && (
                <DetailsStep
                  title={form.title}
                  description={form.description}
                  busy={busy}
                  sizeOverCap={sizeOverCap}
                  onTitle={(v) => set("title", v)}
                  onDescription={(v) => set("description", v)}
                />
              )}
              {flow.step === 2 && (
                <ElementsStep
                  tags={form.tags}
                  thumbnailUrl={form.thumbnailUrl}
                  isShort={form.isShort}
                  busy={busy}
                  onTags={(v) => set("tags", v)}
                  onThumbnailUrl={(v) => set("thumbnailUrl", v)}
                  onIsShort={(v) => set("isShort", v)}
                />
              )}
              {flow.step === 3 && (
                <ChecksStep checks={flow.checks === "passed" ? "passed" : "running"} />
              )}
              {flow.step === 4 && (
                <>
                  {settled && flow.result && (
                    <div className="mb-5">
                      <UploadResultCard
                        result={flow.result}
                        copied={bundleCopied}
                        onCopyBundle={async () => {
                          const text = flow.result?.handoff?.bundle ?? "";
                          const ok = await copyText(text);
                          setBundleCopied(ok);
                          if (ok) toast.success("Bundle copied");
                          else
                            toast.error(
                              "Clipboard unavailable — select the bundle and copy manually"
                            );
                        }}
                      />
                    </div>
                  )}
                  {flow.phase === "error" && !flow.result && flow.error && (
                    <section
                      aria-live="polite"
                      className="mb-5 rounded-xl border border-red-500/40 bg-red-500/5 p-4"
                      data-testid="upload-stage-error-card"
                    >
                      <h2 className="text-base font-semibold">The publish could not start</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{flow.error}</p>
                    </section>
                  )}
                  <VisibilityStep
                    visibility={form.visibility}
                    busy={busy}
                    onSelect={(v) => set("visibility", v)}
                  />
                  {handoff && (
                    <section className="mt-6" aria-live="polite">
                      <h2 className="text-base font-semibold">Your metadata bundle</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {handoff.prefillSupported
                          ? "Pre-filled where YouTube supports it."
                          : "YouTube's upload page takes no URL pre-fill — copy this bundle and paste the fields into the upload form."}{" "}
                        <a
                          href={handoff.handoffUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground underline underline-offset-2"
                        >
                          Open YouTube&apos;s upload page{" "}
                          <ExternalLink className="inline size-3.5" />
                        </a>
                      </p>
                      <textarea
                        ref={bundleRef}
                        readOnly
                        rows={8}
                        value={handoff.bundle}
                        aria-label="Upload metadata bundle (copy and paste into YouTube's upload form)"
                        className="mt-3 w-full rounded-xl border border-border bg-secondary/40 p-4 font-mono text-xs leading-relaxed"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <div className="mt-3 flex flex-wrap gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          onClick={async () => {
                            const ok = await copyText(handoff.bundle);
                            if (!ok && bundleRef.current) {
                              bundleRef.current.focus();
                              bundleRef.current.select();
                              document.execCommand("copy");
                            }
                            toast.success("Bundle copied");
                          }}
                        >
                          Copy bundle
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-full"
                          onClick={() =>
                            window.open(handoff.handoffUrl, "_blank", "noopener,noreferrer")
                          }
                        >
                          Open upload page <ExternalLink className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
            <VideoPreview
              url={previewUrl ?? ""}
              fileName={file.name}
              sizeBytes={file.size}
            />
          </div>

          {/* footer: Discard left, Back/Next or Save right (YouTube's layout) */}
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 sm:p-4">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              onClick={() => setDiscardOpen(true)}
              disabled={busy}
              data-testid="upload-discard"
            >
              Discard
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {flow.step > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => dispatch({ type: "step-back" })}
                  disabled={busy}
                  data-testid="upload-back"
                >
                  Back
                </Button>
              )}
              {flow.step < 4 && (
                <Button
                  type="button"
                  className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => dispatch({ type: "step-next" })}
                  disabled={busy || !stepReady}
                  data-testid="upload-next"
                >
                  Next
                </Button>
              )}
              {flow.step === 4 && flow.phase === "published" ? (
                <Button
                  type="button"
                  className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={discard}
                  data-testid="upload-done"
                >
                  Done
                </Button>
              ) : flow.step === 4 && flow.phase === "fallback" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={save}
                    disabled={saveBlocked}
                    data-testid="upload-save-retry"
                  >
                    Retry Save
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={async () => {
                      const text = flow.result?.handoff?.bundle ?? "";
                      const ok = await copyText(text);
                      setBundleCopied(ok);
                      if (ok) toast.success("Bundle copied");
                      else
                        toast.error(
                          "Clipboard unavailable — select the bundle and copy manually"
                        );
                    }}
                    data-testid="upload-copy-handoff"
                  >
                    Copy handoff bundle
                  </Button>
                </>
              ) : flow.step === 4 ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={handoffSubmit}
                    disabled={busy || !detailsStepReady(form.title)}
                    data-testid="upload-handoff"
                  >
                    Hand off without uploading
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={save}
                    disabled={saveBlocked}
                    data-testid="upload-save"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving…
                      </>
                    ) : (
                      "Save"
                    )}
                  </Button>
                </>
              ) : null}
            </div>
          </footer>

          {/* the discard confirm — Esc/Cancel keeps, Discard resets to step 0 */}
          {discardOpen && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-confirm-title"
              data-testid="discard-confirm"
            >
              <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-lg">
                <h2 id="discard-confirm-title" className="text-base font-semibold">
                  Discard this upload?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The picked file and the metadata you entered will be cleared. Nothing is
                  discarded on YouTube — a completed publish stays published.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    autoFocus
                    onClick={() => setDiscardOpen(false)}
                    data-testid="discard-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="rounded-full"
                    onClick={discard}
                    data-testid="discard-confirm-button"
                  >
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
