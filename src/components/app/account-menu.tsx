"use client";

import Link from "next/link";
import { Clapperboard, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApi } from "@/hooks/use-api";
import type { MeDTO } from "@/lib/types";

/** Your account — avatar menu (demo account state from the DB). */
export function AccountMenu() {
  const { data: me } = useApi<MeDTO>("/api/me");
  const user = me?.user;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Your account"
          className="rounded-full p-0.5"
        >
          {user ? (
            <Avatar className="size-8">
              <AvatarImage src={user.avatarUrl} alt={user.name} />
              <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="size-8">
              <AvatarFallback>
                <UserRound className="size-4" />
              </AvatarFallback>
            </Avatar>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-3">
          {user && (
            <Avatar className="size-10">
              <AvatarImage src={user.avatarUrl} alt={user.name} />
              <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.name ?? "Demo Viewer"}</p>
            <p className="truncate text-xs text-muted-foreground">@{user?.handle ?? "you"}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {me?.ownedChannel && (
          <DropdownMenuItem asChild>
            <Link href={`/channel/${me.ownedChannel.handle}`} className="cursor-pointer">
              <UserRound className="size-4" /> Your channel
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/studio" className="cursor-pointer">
            <Clapperboard className="size-4" /> Creator Studio
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toast("Demo mode — sign in / sign out ships with the account wave (WFX2-A).");
          }}
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
