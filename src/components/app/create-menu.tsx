"use client";

/**
 * WFX2-P6-UP — the topbar's "+ CREATE" pill, youtube.com parity: a pill
 * button (Plus + "Create", icon-only below md) opening the create dropdown —
 *   Upload video → /upload (the studio upload wizard, this lane)
 *   Go live      → youtube.com's own live surface, EXTERNAL (see the G10
 *                  note below — the honest-degradation form)
 *   New post     → /channel/{own-handle}?compose=1 — the community composer
 *                  deep link, shown ONLY while the operator's real channel
 *                  handle resolves (the AccountMenu lazy /api/studio idiom;
 *                  honestly absent otherwise, never a dead link).
 * Nothing else is fabricated: items whose surface does not exist stay out.
 *
 * P24-SEND (G10) — the "Go live" rung speaks the Join-sheet precedent,
 * generalized to a menu rung: youtube.com's CREATE menu "Go live" opens
 * the Live Control Room (the creator's stream-setup surface — the
 * ingestion surface), NOT a live-video browse page. WebFlix has NO
 * streaming-ingestion surface and the control room's DOM is unmeasurable
 * from this egress (the logged-out /live hub is the browse page — real
 * live cards, no go-live CTA anywhere; the CREATE menu itself is
 * login-walled) — the invented-shape law forbids guessing a broker drive.
 * The honest form: the rung STAYS in the menu (youtube.com's own rung
 * family), routes EXTERNALLY to the measured real URL
 * https://www.youtube.com/live (noopener/noreferrer, _blank), carries the
 * honest reason in the tooltip + aria-label, and the app's live BROWSE
 * page keeps its honest home at /explore/live (the Explore hub card).
 * Parity-debt: the full go-live flow needs measured Live Control Room DOM
 * shapes + an ingestion surface (a future lane's seam).
 */
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, Plus, UploadCloud, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApi } from "@/hooks/use-api";
import type { StudioPageDTO } from "@/lib/types";

export function CreateMenu() {
  const [menuOpen, setMenuOpen] = useState(false);

  // The operator channel's REAL handle — read only while the menu is open
  // (the lazy useApi(null) idiom; one small call, honest absence on a 401 /
  // unresolved channel — the "New post" deep link needs an own channel).
  const { data: studio } = useApi<StudioPageDTO & { loginRequired: boolean }>(
    menuOpen ? "/api/studio?enrich=0" : null
  );
  const channelHandle = studio?.channel?.handle || null;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Create"
          aria-haspopup="menu"
          title="Create"
          className="gap-1.5 rounded-full px-3 text-sm font-medium"
          data-testid="create-button"
        >
          <Plus className="size-5" aria-hidden="true" />
          <span className="hidden md:inline">Create</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" data-testid="create-menu">
        <DropdownMenuItem asChild>
          <Link href="/upload" className="cursor-pointer" data-testid="create-upload-video">
            <UploadCloud className="size-4" aria-hidden="true" /> Upload video
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/* P24-SEND (G10): the honest-degradation form — youtube.com's own
              live surface, EXTERNAL (the Live Control Room is the creator's
              stream-setup surface; WebFlix has no ingestion surface — the
              tooltip + aria-label carry the honest reason). */}
          <a
            href="https://www.youtube.com/live"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer"
            data-testid="create-go-live"
            title="Go live opens YouTube's Live Control Room — WebFlix has no streaming setup; live browsing stays in Explore"
            aria-label="Go live on YouTube — opens YouTube's live surface in a new tab; WebFlix has no streaming setup"
          >
            <Video className="size-4" aria-hidden="true" /> Go live
            <ExternalLink className="size-3 opacity-60" aria-hidden="true" />
          </a>
        </DropdownMenuItem>
        {channelHandle && (
          <DropdownMenuItem asChild>
            <Link
              href={`/channel/${channelHandle}?compose=1`}
              className="cursor-pointer"
              data-testid="create-new-post"
            >
              <Pencil className="size-4" aria-hidden="true" /> New post
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
