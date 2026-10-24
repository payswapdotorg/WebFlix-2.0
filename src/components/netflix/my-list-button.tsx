"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { postJson } from "@/hooks/use-api";

/**
 * P42 — the My Netflix List toggle (WebFlix-LOCAL list — ADR 0002 §5: no
 * Netflix credentials anywhere, so the list lives in WebFlix's own DB, like
 * the watch lane's local Watch-Later rung).
 */
export function MyListButton({
  netflixId,
  titleName,
  initial,
  variant = "secondary",
  onChanged,
}: {
  netflixId: number;
  titleName: string;
  initial: boolean;
  variant?: "secondary" | "hero";
  onChanged?: (next: boolean) => void;
}) {
  const [inList, setInList] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (inList) {
        const res = await fetch(`/api/netflix/my-list?netflixId=${netflixId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setInList(false);
        toast.success(`Removed “${titleName}” from My List`);
      } else {
        await postJson<{ myList: boolean }>("/api/netflix/my-list", { netflixId });
        setInList(true);
        toast.success(`Added “${titleName}” to My List`);
      }
      onChanged?.(!inList);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      if (message.includes("401")) {
        toast.error("Sign in to build your Netflix list");
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={inList}
      data-testid="netflix-my-list-toggle"
      className={cn(
        "flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-60",
        variant === "hero"
          ? "border border-white/25 bg-white/10 text-white hover:bg-white/20"
          : "border border-white/15 text-white/80 hover:bg-white/5",
        inList && "border-[#e50914]/60 text-white"
      )}
    >
      {inList ? <Check className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
      {inList ? "In My List" : "My List"}
    </button>
  );
}
