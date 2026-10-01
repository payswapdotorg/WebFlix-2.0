"use client";

/**
 * WFX2-P2-AU — the header account surface, youtube.com parity:
 *  - guest → the outlined "Sign in" pill (avatar-and-in icon), linking
 *    /signin with the current surface as the redirect;
 *  - signed-in → the initial-based avatar (avatarSeed hue) with the
 *    account dropdown: display name, email, Your account, WebFlix Studio,
 *    Sign out (the stock NextAuth signout route).
 *
 * The demo-account menu this replaces read /api/me; the WebFlix identity
 * now fronts everything (the honest operator-session wording stays on the
 * account page).
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref, signOutFromWebFlix } from "@/lib/auth/client";

/** The initial-based avatar — the avatarSeed hue decides its color. */
export function SessionAvatar({
  displayName,
  avatarSeed,
  size = "size-8",
}: {
  displayName: string;
  avatarSeed: number;
  size?: string;
}) {
  const initial = (displayName.trim()[0] ?? "W").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} select-none items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: `hsl(${avatarSeed} 65% 45%)` }}
    >
      {initial}
    </span>
  );
}

export function AccountMenu() {
  const session = useWebFlixSession();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  if (session.status === "unauthenticated") {
    // the youtube-style outlined pill: circle avatar-and-in icon + "Sign in"
    return (
      <Button
        asChild
        variant="outline"
        className="h-9 gap-2 rounded-full border-border px-3 text-sm font-medium sm:px-4"
        data-testid="guest-signin-pill"
      >
        <Link href={signInHref(pathname)} aria-label="Sign in">
          <span className="flex size-6 items-center justify-center rounded-full border border-current">
            <UserRound className="size-3.5" aria-hidden="true" />
          </span>
          Sign in
        </Link>
      </Button>
    );
  }

  if (!session.user) {
    // session probe in flight — the neutral ghost button (no layout shift)
    return (
      <Button variant="ghost" size="icon" aria-label="Your account" className="rounded-full p-0.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </Button>
    );
  }

  const { displayName, email, avatarSeed } = session.user;

  const doSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutFromWebFlix();
    } finally {
      // full reload — every mounted surface re-probes the session
      window.location.assign("/");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Your account"
          className="rounded-full p-0.5"
          data-testid="account-avatar-button"
        >
          <SessionAvatar displayName={displayName} avatarSeed={avatarSeed} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-3">
          <SessionAvatar displayName={displayName} avatarSeed={avatarSeed} size="size-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account" className="cursor-pointer">
            <UserRound className="size-4" /> Your account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/studio" className="cursor-pointer">
            <Clapperboard className="size-4" /> WebFlix Studio
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); void doSignOut(); }} className="cursor-pointer">
          <LogOut className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
