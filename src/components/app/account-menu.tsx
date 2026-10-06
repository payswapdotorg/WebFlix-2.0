"use client";

/**
 * WFX2-P5-YA + P14-YOU — the header account surface, youtube.com parity
 * (item order + labels measured on the LIVE 2026 menu, 2026-10-06):
 *  - guest → the outlined "Sign in" pill (avatar-and-in icon), linking
 *    /signin with the current surface as the redirect (unchanged);
 *  - signed-in → the avatar dropdown whose header carries the operator's
 *    REAL YouTube identity (avatar image, channel name, @handle — read
 *    lazily from /api/studio only while the menu is open; honest
 *    WebFlix-local fallback when the operator session is not live).
 *    Live order: View your channel · Google Account · Sign out — YouTube
 *    Studio · Purchases and memberships · Your data in YouTube —
 *    Appearance · Language · Restricted Mode · Location — Keyboard
 *    shortcuts · Settings — Help · Send feedback.
 *
 * Nothing is fabricated: an item whose data does not exist stays hidden or
 * degrades honestly (no "Switch account" — this app is single-tenant).
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSign,
  CircleHelp,
  Clapperboard,
  Database,
  Keyboard,
  Languages,
  LogOut,
  MapPin,
  MessageSquareWarning,
  Monitor,
  Settings as SettingsIcon,
  Shield,
  ShoppingBag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
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
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref, signOutFromWebFlix } from "@/lib/auth/client";
import { openKeyboardShortcuts } from "@/components/app/keyboard-shortcuts";
import type { StudioPageDTO } from "@/lib/types";

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

/** A dropdown link item (the DropdownMenuItem asChild + Link idiom). */
function MenuLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href} className="cursor-pointer">
        <Icon className="size-4" aria-hidden="true" /> {children}
      </Link>
    </DropdownMenuItem>
  );
}

export function AccountMenu() {
  const session = useWebFlixSession();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // The operator channel's REAL identity — read only while the menu is open
  // (the lazy useApi(null) idiom). Honest null in public mode → the header
  // falls back to the WebFlix-local identity, "View your channel" stays
  // hidden until a real handle exists.
  const { data: studio } = useApi<StudioPageDTO & { loginRequired: boolean }>(
    menuOpen && session.user ? "/api/studio?enrich=0" : null
  );
  const channelHandle = studio?.channel?.handle || null;
  // the REAL YouTube identity for the menu header (avatar image + name +
  // @handle) when the operator session is live — the honest local fallback
  // otherwise
  const operatorIdentity = studio?.channel ?? null;

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
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
          {operatorIdentity ? (
            <img
              src={operatorIdentity.avatarUrl}
              alt=""
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <SessionAvatar displayName={displayName} avatarSeed={avatarSeed} size="size-10" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {operatorIdentity ? operatorIdentity.name : displayName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {operatorIdentity
                ? operatorIdentity.handle.startsWith("@")
                  ? operatorIdentity.handle
                  : `@${operatorIdentity.handle}`
                : email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* the live 2026 order: View your channel · Google Account · Sign out */}
        {channelHandle && (
          <MenuLink href={`/channel/${channelHandle}`} icon={AtSign}>
            View your channel
          </MenuLink>
        )}
        <MenuLink href="/account" icon={UserRound}>
          Google Account
        </MenuLink>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void doSignOut();
          }}
          className="cursor-pointer"
        >
          <LogOut className="size-4" aria-hidden="true" />{" "}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <MenuLink href="/studio" icon={Clapperboard}>
          YouTube Studio
        </MenuLink>
        <DropdownMenuSeparator />
        <MenuLink href="/account/purchases" icon={ShoppingBag}>
          Purchases &amp; memberships
        </MenuLink>
        <MenuLink href="/account/data" icon={Database}>
          Your data in YouTube
        </MenuLink>
        <DropdownMenuSeparator />
        {/* deep links — SS owns /settings (href only, never an import) */}
        <MenuLink href="/settings" icon={Monitor}>
          Appearance
        </MenuLink>
        <MenuLink href="/settings" icon={Languages}>
          Language
        </MenuLink>
        <MenuLink href="/settings" icon={Shield}>
          Restricted Mode
        </MenuLink>
        <MenuLink href="/settings" icon={MapPin}>
          Location
        </MenuLink>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => openKeyboardShortcuts()}
          className="cursor-pointer"
          data-testid="menu-keyboard-shortcuts"
        >
          <Keyboard className="size-4" aria-hidden="true" /> Keyboard shortcuts
        </DropdownMenuItem>
        <MenuLink href="/settings" icon={SettingsIcon}>
          Settings
        </MenuLink>
        <MenuLink href="/help" icon={CircleHelp}>
          Help
        </MenuLink>
        <MenuLink href="/feedback" icon={MessageSquareWarning}>
          Send feedback
        </MenuLink>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
