"use client";

import { useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileVideo,
  Info,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useApi, postJson } from "@/hooks/use-api";
import type { UploadContextDTO, UploadHandoffDTO } from "@/lib/types";
import {
  canPublish,
  initialUploadFlowState,
  uploadFlowNext,
  type UploadExecuteResponseDTO,
} from "@/lib/upload/flow";
import UploadResultCard from "./upload-result";

const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";
const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX = 5000;

const STAGE_MB_CAP = 256;

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * WFX2-P3-UP — the REAL upload flow: pick the video (accept="video/*"),
 * gather the metadata (prefilled from the current fields), Publish — the
 * file is staged in memory and the session broker drives the operator's
 * logged-in YouTube tab through youtube.com/upload (file input → metadata →
 * Next×3 → visibility → publish), with staged progress (uploading →
 * processing → published) from the broker's honest response. The published
 * card deep-links the REAL video.
 *
 * The fallback law (unchanged): when the broker is OFFLINE or refuses, the
 * hand-off rung carries the user — the metadata bundle + YouTube's upload
 * page. Nothing is ever claimed that YouTube did not confirm: an unverified
 * publish says so, a refused publish renders the broker's honest error.
 */
export default function UploadPage() {
  const router = useRouter();
  const { data: context, loading } = useApi<UploadContextDTO>("/api/upload");
  const [flow, dispatch] = useReducer(uploadFlowNext, undefined, initialUploadFlowState);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [bundleCopied, setBundleCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [handoff, setHandoff] = useState<UploadHandoffDTO | null>(null);
  const bundleRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    tags: "",
    thumbnailUrl: "",
    visibility: "public" as "public" | "unlisted" | "private",
    isShort: false,
  });

  const busy = flow.phase === "staging" || flow.phase === "executing";

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** The real drive: stage the file → execute the broker publish → settle. */
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    dispatch({ type: "publish-started" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const stageRes = await fetch("/api/upload/stage", { method: "POST", body: fd });
      const stageJson = (await stageRes.json().catch(() => ({}))) as {
        stageId?: string;
        error?: string;
      };
      if (!stageRes.ok || !stageJson.stageId) {
        const error = stageJson.error ?? `could not stage the file (HTTP ${stageRes.status})`;
        dispatch({ type: "stage-failed", error });
        toast.error(error);
        return;
      }
      dispatch({ type: "stage-succeeded", stageId: stageJson.stageId });
      dispatch({ type: "execute-started" });
      const result = await postJson<UploadExecuteResponseDTO>("/api/upload/execute", {
        stageId: stageJson.stageId,
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
    }
  }

  /** The hand-off rung (the pre-P3 flow, verbatim): bundle → YouTube. */
  async function handoffSubmit() {
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6">
      <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
        <UploadCloud className="size-7 text-yt-red" aria-hidden="true" /> Upload video
      </h1>
      <div className="mt-2 text-sm text-muted-foreground">
        {loading ? (
          <Skeleton className="h-4 w-64" />
        ) : context?.channel ? (
          <p>
            Gathering metadata to publish as{" "}
            <span className="font-medium text-foreground">{context.channel.name}</span> — the
            upload itself happens on YouTube.
          </p>
        ) : (
          <p>
            Gathering video metadata for YouTube — the upload itself happens on YouTube
            {context ? " (public mode: the operator channel is not connected)" : ""}.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-border bg-secondary/30 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Publish drives the REAL upload: WebFlix stages your file and the session broker operates
          the logged-in YouTube tab through youtube.com&apos;s upload dialog. When the broker is
          offline or refuses, the honest hand-off remains — the metadata bundle into{" "}
          <a
            href={YOUTUBE_UPLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            YouTube&apos;s upload page <ExternalLink className="inline size-3.5" />
          </a>
          . WebFlix never claims a publish YouTube did not confirm.
        </p>
      </div>

      <form onSubmit={publish} className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="file">Video file</Label>
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 p-6 text-center text-sm transition-colors hover:bg-secondary/50"
            data-testid="upload-file-picker"
          >
            <FileVideo className="size-6 text-muted-foreground" aria-hidden="true" />
            {file ? (
              <span data-testid="upload-file-name">
                <span className="font-medium text-foreground">{file.name}</span>
                <span className="text-muted-foreground"> · {formatBytes(file.size)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Click to choose a video file (MP4, MOV, WebM…)
              </span>
            )}
            <input
              id="file"
              ref={fileRef}
              type="file"
              accept="video/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) {
                  setFile(f);
                  dispatch({ type: "file-picked", fileName: f.name, sizeBytes: f.size });
                }
              }}
            />
          </label>
          {file && !busy ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
                dispatch({ type: "file-cleared" });
              }}
            >
              <X className="size-4" aria-hidden="true" /> Remove file
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            The file is staged in memory (capped at {STAGE_MB_CAP}MB) and fetched by the operator
            tab — larger uploads should use the hand-off below.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="title">
            Title{" "}
            <span className="text-xs text-muted-foreground">
              ({form.title.length}/{YOUTUBE_TITLE_MAX})
            </span>
          </Label>
          <Input
            id="title"
            required
            maxLength={YOUTUBE_TITLE_MAX}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Building a $5000 Gaming PC — Ultimate 2026 Guide"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">
            Description{" "}
            <span className="text-xs text-muted-foreground">
              ({form.description.length}/{YOUTUBE_DESCRIPTION_MAX})
            </span>
          </Label>
          <Textarea
            id="description"
            rows={4}
            maxLength={YOUTUBE_DESCRIPTION_MAX}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Tell viewers about your video…"
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            value={form.tags}
            onChange={(e) => set("tags", e.target.value)}
            placeholder="pc build, gaming, 2026"
            aria-describedby="tags-hint"
            disabled={busy}
          />
          <p id="tags-hint" className="text-xs text-muted-foreground">
            Hand-off fields (like tags and thumbnail) ride the bundle — the broker drive fills
            title, description and visibility.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
          <Input
            id="thumbnailUrl"
            type="url"
            inputMode="url"
            value={form.thumbnailUrl}
            onChange={(e) => set("thumbnailUrl", e.target.value)}
            placeholder="https://…/image.jpg"
            aria-describedby="thumb-hint"
            disabled={busy}
          />
          <p id="thumb-hint" className="text-xs text-muted-foreground">
            Noted in the bundle — YouTube&apos;s real thumbnail upload happens in the upload form
            (or later in Studio).
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select
              value={form.visibility}
              onValueChange={(v) => set("visibility", v as typeof form.visibility)}
              disabled={busy}
            >
              <SelectTrigger id="visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Checkbox
              id="isShort"
              checked={form.isShort}
              onCheckedChange={(v) => set("isShort", v === true)}
              disabled={busy}
            />
            <Label htmlFor="isShort" className="cursor-pointer font-normal">
              This is a Short (vertical)
            </Label>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded-full"
            onClick={() => router.back()}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={handoffSubmit}
            disabled={submitting || busy || form.title.trim().length === 0}
          >
            {submitting ? "Building hand-off…" : "Hand off without uploading"}
          </Button>
          <Button
            type="submit"
            disabled={busy || !canPublish(flow, form.title)}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="upload-publish-button"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Publishing…
              </>
            ) : (
              "Publish"
            )}
          </Button>
        </div>
      </form>

      {(flow.phase === "staging" || flow.phase === "executing") && (
        <section
          aria-live="polite"
          className="mt-6 rounded-xl border border-border bg-secondary/30 p-4 sm:p-5"
          data-testid="upload-progress"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            {flow.phase === "staging" ? "Staging the file…" : "Publishing through the session broker"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Uploading and processing happen on YouTube — this can take several minutes. Keep this
            tab open; the result below is the broker&apos;s honest report, not a timer&apos;s guess.
          </p>
          <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Publish stages">
            {(["Uploading", "Processing", "Published"] as const).map((label, i) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1"
              >
                {i < 2 ? (
                  <span className="size-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
                ) : (
                  <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
                )}
                <span className={i < 2 ? "text-foreground" : "text-muted-foreground"}>{label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {flow.result && flow.phase !== "staging" && flow.phase !== "executing" && (
        <UploadResultCard
          result={flow.result}
          copied={bundleCopied}
          onCopyBundle={async () => {
            const text = flow.result?.handoff?.bundle ?? "";
            const ok = await copyText(text);
            setBundleCopied(ok);
            if (ok) toast.success("Bundle copied");
            else toast.error("Clipboard unavailable — select the bundle and copy manually");
          }}
        />
      )}

      {flow.phase === "error" && !flow.result && flow.error && (
        <section
          aria-live="polite"
          className="mt-6 rounded-xl border border-red-500/40 bg-red-500/5 p-4 sm:p-5"
          data-testid="upload-stage-error-card"
        >
          <h2 className="text-base font-semibold">The publish could not start</h2>
          <p className="mt-1 text-sm text-muted-foreground">{flow.error}</p>
        </section>
      )}

      {handoff && (
        <section className="mt-8" aria-live="polite">
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
              Open YouTube&apos;s upload page <ExternalLink className="inline size-3.5" />
            </a>
          </p>
          <textarea
            ref={bundleRef}
            readOnly
            rows={10}
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
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => window.open(handoff.handoffUrl, "_blank", "noopener,noreferrer")}
            >
              Open upload page <ExternalLink className="size-4" />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
