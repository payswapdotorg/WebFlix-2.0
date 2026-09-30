"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Info, UploadCloud } from "lucide-react";
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

const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";
const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX = 5000;

/**
 * Upload — gathers the video metadata (title, description, visibility, tags,
 * thumbnail) and HANDS OFF to YouTube's real upload flow: the bundle is
 * copied to the clipboard and https://www.youtube.com/upload opens in a new
 * tab. WebFlix does NOT upload and never pretends a video was published —
 * the button does exactly what it says.
 */
export default function UploadPage() {
  const router = useRouter();
  const { data: context, loading } = useApi<UploadContextDTO>("/api/upload");
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      // copy the bundle (clipboard API with a select-and-copy fallback)
      let copied = false;
      try {
        await navigator.clipboard.writeText(result.bundle);
        copied = true;
      } catch {
        const el = bundleRef.current;
        if (el) {
          el.focus();
          el.select();
          copied = document.execCommand("copy");
        }
      }
      // open the real YouTube upload flow in a new tab
      window.open(result.handoffUrl, "_blank", "noopener,noreferrer");
      toast.success(
        copied
          ? "Metadata bundle copied — YouTube's upload page is open in a new tab. Paste the bundle into the upload form."
          : "YouTube's upload page is open in a new tab — copy the bundle below into the upload form."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build the hand-off");
    } finally {
      setSubmitting(false);
    }
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-border bg-secondary/30 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          WebFlix hands off — it does not upload. Your metadata travels via a copy-to-clipboard
          bundle into{" "}
          <a
            href={YOUTUBE_UPLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            YouTube&apos;s upload page <ExternalLink className="inline size-3.5" />
          </a>
          , which owns the file upload, processing and publishing. Nothing is stored or
          simulated on WebFlix.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5">
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
          />
          <p id="tags-hint" className="text-xs text-muted-foreground">
            Added to the bundle — paste them into YouTube&apos;s tags field.
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
          />
          <p id="thumb-hint" className="text-xs text-muted-foreground">
            Noted in the bundle — YouTube&apos;s real thumbnail upload happens in the upload
            form (or later in Studio).
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select
              value={form.visibility}
              onValueChange={(v) => set("visibility", v as typeof form.visibility)}
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
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || form.title.trim().length === 0}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? "Building hand-off…" : "Hand off to YouTube"}
          </Button>
        </div>
      </form>

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
                try {
                  await navigator.clipboard.writeText(handoff.bundle);
                  toast.success("Bundle copied");
                } catch {
                  bundleRef.current?.focus();
                  bundleRef.current?.select();
                  document.execCommand("copy");
                  toast.success("Bundle copied");
                }
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
