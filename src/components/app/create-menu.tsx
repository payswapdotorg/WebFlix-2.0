"use client";

/**
 * WFX2-P6-UP — the topbar's "+ CREATE" pill, youtube.com parity: a pill
 * button (Plus + "Create", icon-only below md) opening the create dropdown —
 *   Upload video → /upload (the studio upload wizard, this lane)
 *   Go live      → /explore/live (the real live rail route)
 *   New post     → /channel/{own-handle}?compose=1 — the community composer
 *                  deep link, shown ONLY while the operator's real channel
 *                  handle resolves (the AccountMenu lazy /api/studio idiom;
 *                  honestly absent otherwise, never a dead link).
 * Nothing else is fabricated: items whose surface does not exist stay out.
 */
import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, UploadCloud, Video } from "lucide-react";
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
          <Link href="/explore/live" className="cursor-pointer" data-testid="create-go-live">
            <Video className="size-4" aria-hidden="true" /> Go live
          </Link>
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
