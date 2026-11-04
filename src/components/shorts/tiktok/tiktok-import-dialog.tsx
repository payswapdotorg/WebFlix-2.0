"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { signInHref } from "@/lib/auth/client";
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2 — the canonical URL paste/import
 * affordance (ADR 0013 §7): a signed-in viewer pastes a canonical
 * tiktok.com URL (or a bare post id) and the post joins their feed as a
 * PRIVATE save; the owner's "Make public" flip (the curator rule) admits
 * it to every viewer's feed. Guests route to /signin (the AU gate
 * pattern). NO TikTok write is implied — this is a WebFlix-local shelf
 * (ADR 0004); the copy says so.
 */
export function TikTokImportDialog({
  authenticated,
  onImported,
}: {
  /** The WebFlix account session state (the AU gate source of truth):
   * true → the dialog opens; false → the click routes to /signin (and
   * straight back); null → the session is still resolving (no open). */
  authenticated: boolean | null;
  onImported: (post: TikTokVideoDTO, alreadyImported: boolean, curated: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next && authenticated === false) {
      // The AU gate: guests route to /signin and come straight back.
      window.location.assign(signInHref("/shorts?source=tiktok"));
      return;
    }
    if (next && authenticated === null) return;
    setOpen(next);
  }

  async function submit() {
    const value = url.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tiktok/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      if (res.status === 401) {
        // The AU gate: guests route to /signin and come straight back.
        window.location.assign(signInHref("/shorts?source=tiktok"));
        return;
      }
      const body = (await res.json()) as {
        post?: TikTokVideoDTO;
        alreadyImported?: boolean;
        curated?: boolean;
        error?: string;
      };
      if (!res.ok || !body.post) {
        toast.error(body.error ?? "Could not import that TikTok post");
        return;
      }
      onImported(body.post, !!body.alreadyImported, !!body.curated);
      setUrl("");
      setOpen(false);
      if (body.curated) {
        toast.info("Already in WebFlix's curated TikTok shelf");
      } else if (body.alreadyImported) {
        toast.info("That post is already in the TikTok shelf");
      } else {
        toast.success("TikTok post added to your feed (only you can see it)");
      }
    } catch {
      toast.error("Could not import that TikTok post");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 shrink-0 gap-1 rounded-full px-3 text-xs"
          data-testid="tiktok-import-open"
          aria-label="Add a TikTok post"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add TikTok
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" data-testid="tiktok-import-dialog">
        <DialogHeader>
          <DialogTitle>Add a TikTok post</DialogTitle>
          <DialogDescription>
            Paste a canonical tiktok.com link (
            <span className="font-mono text-xs">www.tiktok.com/@user/video/…</span> or a bare
            post id). Short links can&apos;t be resolved honestly, so they&apos;re refused.
            The post joins YOUR feed first — make it public to share it with every viewer.
            WebFlix-local only: nothing is posted to TikTok.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="www.tiktok.com/@user/video/1234567890123456789"
          inputMode="url"
          autoComplete="off"
          aria-label="TikTok post URL"
          data-testid="tiktok-import-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void submit();
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !url.trim()}
            data-testid="tiktok-import-submit"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Add to feed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
