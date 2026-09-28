"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { postJson } from "@/hooks/use-api";
import { CATEGORIES } from "@/lib/categories";

const DEMO_MP4 = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

/**
 * Upload — creates a real Video row on your channel (CodeCraft).
 * The full upload flow (file storage, AI title/thumbnail helpers, tags,
 * member-only tiers) lands with WFX2-U (Wave 2).
 */
export default function UploadPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    videoUrl: "",
    thumbnailUrl: "",
    category: "",
    visibility: "public" as "public" | "unlisted" | "private",
    isShort: false,
    durationSec: "60",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await postJson<{ id: string }>("/api/upload", {
        title: form.title,
        description: form.description,
        videoUrl: form.videoUrl,
        thumbnailUrl: form.thumbnailUrl || undefined,
        category: form.category,
        visibility: form.visibility,
        isShort: form.isShort,
        durationSec: Number(form.durationSec) || 60,
      });
      toast.success("Video published to your channel");
      router.push(`/watch/${res.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setSubmitting(false);
    }
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6">
      <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
        <UploadCloud className="size-7 text-yt-red" /> Upload video
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Publishes to <span className="font-medium text-foreground">CodeCraft</span> (your channel).
        This demo stores a playable video URL instead of a file upload — paste any https mp4.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            required
            maxLength={140}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Building a $5000 Gaming PC — Ultimate 2026 Guide"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={4}
            maxLength={5000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Tell viewers about your video…"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="videoUrl">Video URL (mp4)</Label>
          <Input
            id="videoUrl"
            required
            type="url"
            value={form.videoUrl}
            onChange={(e) => set("videoUrl", e.target.value)}
            placeholder="https://…/video.mp4"
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => set("videoUrl", DEMO_MP4)}
          >
            Use a demo mp4 from Google's public bucket
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="thumbnailUrl">Thumbnail URL (optional)</Label>
          <Input
            id="thumbnailUrl"
            type="url"
            value={form.thumbnailUrl}
            onChange={(e) => set("thumbnailUrl", e.target.value)}
            placeholder="https://…/image.jpg — blank gets an auto-generated still"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select required value={form.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger id="category" className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="duration">Duration (seconds)</Label>
            <Input
              id="duration"
              type="number"
              min={1}
              max={43200}
              value={form.durationSec}
              onChange={(e) => set("durationSec", e.target.value)}
            />
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

        <div className="flex justify-end gap-3 pt-2">
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
            disabled={submitting || !form.title || !form.videoUrl || !form.category}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </form>
    </div>
  );
}
