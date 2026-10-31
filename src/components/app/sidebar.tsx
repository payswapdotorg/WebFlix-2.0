"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChefHat,
  Clapperboard,
  Clock,
  Code,
  Compass,
  Cpu,
  Crown,
  Disc3,
  Dumbbell,
  Flag,
  Flame,
  Gamepad2,
  GraduationCap,
  HelpCircle,
  History,
  Home,
  Layers,
  ListVideo,
  Mic,
  MonitorPlay,
  Music,
  Newspaper,
  Plane,
  Radio,
  Settings,
  SquarePlay,
  ThumbsUp,
  Trophy,
  TvMinimalPlay,
  UserRound,
  Download,
  MessageSquarePlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import { useSidebarHydration } from "@/lib/sidebar-store";
import { CATEGORIES, categoryDestination } from "@/lib/categories";
import { VerifiedBadge } from "./verified-badge";
import type { MeDTO } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/shorts", label: "Shorts", icon: SquarePlay },
  { href: "/subscriptions", label: "Subscriptions", icon: Layers },
  // P42-NETFLIX-SOURCE — the second source's hub (ADR 0002): Netflix's own
  // Top 10 data browsed natively; playback hands off to Netflix's player.
  { href: "/netflix", label: "Netflix", icon: TvMinimalPlay },
  // P58-TIKTOK-SOURCE — the third source's hub (ADR 0004): the curated shelf
  // played through TikTok's own official embed player.
  { href: "/tiktok", label: "TikTok", icon: Clapperboard },
  // WFX2-LIVE-PLATFORM-1 — the FIRST-PARTY WebFlix LIVE destination (issue
  // #2): WebFlix-owned broadcast rooms. Deliberately distinct from the
  // YouTube LIVE discovery at /explore/live (that stays YouTube's surface).
  { href: "/live", label: "WebFlix LIVE", icon: Radio },
];

/**
 * P22-B — the You section, measured against youtube.com's guide (the
 * operator's signed-in view; the signed-out guide carries only
 * Home/Shorts/Subscriptions/You/History — measured live 2026-10-11).
 * REA-3 (station pack, logged-in 2026-10-17): the guide ladder reads
 * Home, Shorts, Subscriptions, You, History, … — the "You" row rides the
 * ladder itself (it links WebFlix's real /you hub), Trending moved DOWN
 * into the Explore section (youtube.com's own placement — it never rides
 * between Shorts and Subscriptions).
 * youtube.com's You section carries, in order: Your channel, History,
 * Playlists, Your videos, Watch later, Liked videos, Downloads.
 * Mapping to WebFlix's real surfaces:
 *   Your channel → the operator's REAL channel page (the /api/me
 *                  ownedChannel seam — honestly hidden when unresolved)
 *   Your videos  → /studio (WebFlix's your-videos surface — the same target
 *                  the /you hub's Your-videos section links)
 *   Watch later  → /playlist/WL (the special-list read, P22-B)
 *   Downloads    → /downloads (the honest no-tier page)
 * Creator Studio moved OUT of the You section (youtube.com carries no
 * studio row in its guide — creator tools live in the account menu and the
 * /you hub's More-from-WebFlix rail on both youtube.com and WebFlix).
 */
const YOU_ROW: NavItem = { href: "/you", label: "You", icon: UserRound };

const YOU_NAV: NavItem[] = [
  { href: "/history", label: "History", icon: History },
  { href: "/playlists", label: "Playlists", icon: ListVideo },
  { href: "/studio", label: "Your videos", icon: MonitorPlay },
  { href: "/playlist/WL", label: "Watch later", icon: Clock },
  { href: "/liked", label: "Liked videos", icon: ThumbsUp },
  { href: "/downloads", label: "Downloads", icon: Download },
];

const MORE_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/premium", label: "WebFlix Premium", icon: Crown },
  { href: "/report-history", label: "Report history", icon: Flag },
  { href: "/help", label: "Help", icon: HelpCircle },
  { href: "/feedback", label: "Send feedback", icon: MessageSquarePlus },
];

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  Music,
  Gaming: Gamepad2,
  Live: Radio,
  News: Newspaper,
  Sports: Trophy,
  Coding: Code,
  Tech: Cpu,
  Education: GraduationCap,
  Travel: Plane,
  Cooking: ChefHat,
  Fitness: Dumbbell,
  Comedy: Clapperboard,
  Mixes: Disc3,
  Podcasts: Mic,
};

const SIDEBAR_FOOTER_LINKS = [
  "About",
  "Press",
  "Copyright",
  "Contact us",
  "Creators",
  "Advertise",
  "Developers",
] as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };
}

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-6 rounded-lg px-3 py-2.5 text-sm font-medium leading-none transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-foreground/90 hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <Icon className="size-[22px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function Divider() {
  return <div className="mx-3 my-2 border-t border-border/70" role="separator" />;
}

/** The expanded navigation (desktop sidebar + mobile drawer). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const isActive = useIsActive();
  const { data: me } = useApi<MeDTO>("/api/me");
  // P22-B: "Your channel" resolves to the operator's REAL channel (the
  // ownedChannel seam). Honest hide when unresolved — youtube.com's own guide
  // always resolves it (every Google account has a channel); WebFlix degrades
  // by hiding the row, never by guessing a target.
  const yourChannel = me?.ownedChannel ?? null;

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 pb-4">
      {MAIN_NAV.map((item) => (
        <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
      ))}

      <Divider />
      <NavRow item={YOU_ROW} active={isActive("/you")} onNavigate={onNavigate} />
      {yourChannel && (
        <NavRow
          item={{
            href: `/channel/${yourChannel.handle}`,
            label: "Your channel",
            icon: UserRound,
          }}
          active={isActive(`/channel/${yourChannel.handle}`)}
          onNavigate={onNavigate}
        />
      )}
      {YOU_NAV.map((item) => (
        <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
      ))}

      <Divider />
      <SectionHeader>Subscriptions</SectionHeader>
      {(me?.subscriptions ?? []).map((ch) => (
        <Link
          key={ch.id}
          href={`/channel/${ch.handle}`}
          onClick={onNavigate}
          className="flex items-center gap-6 rounded-lg px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-accent/60"
        >
          <img
            src={ch.avatarUrl}
            alt=""
            loading="lazy"
            className="size-6 shrink-0 rounded-full object-cover"
          />
          <span className="truncate">{ch.name}</span>
          {ch.verified && <VerifiedBadge className="ml-auto shrink-0" />}
        </Link>
      ))}
      {!me &&
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-3 py-2" aria-hidden="true">
            <div className="size-6 shrink-0 animate-pulse rounded-full bg-secondary" />
            <div className="h-3.5 w-28 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      {me && me.subscriptions.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No subscriptions yet — subscribe from any channel page.
        </p>
      )}

      <Divider />
      <SectionHeader>Explore</SectionHeader>
      {/* REA-3 — Trending rides the Explore section's first rung, youtube.com's
          own guide placement (never between Shorts and Subscriptions). */}
      <NavRow
        item={{ href: "/trending", label: "Trending", icon: Flame }}
        active={isActive("/trending")}
        onNavigate={onNavigate}
      />
      <Link
        href="/explore"
        onClick={onNavigate}
        aria-current={isActive("/explore") ? "page" : undefined}
        className="flex items-center gap-6 rounded-lg px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <Compass className="size-[22px] shrink-0" strokeWidth={1.8} />
        <span>Explore</span>
      </Link>
      {CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICON_MAP[category] ?? Disc3;
        return (
          <Link
            key={category}
            href={categoryDestination(category)}
            onClick={onNavigate}
            className="flex items-center gap-6 rounded-lg px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-accent/60"
          >
            <Icon className="size-[22px] shrink-0" strokeWidth={1.8} />
            <span>{category}</span>
          </Link>
        );
      })}

      <Divider />
      <SectionHeader>More from WebFlix</SectionHeader>
      {MORE_NAV.map((item) => (
        <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
      ))}

      <Divider />
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pt-2 text-[11px] text-muted-foreground">
        {SIDEBAR_FOOTER_LINKS.map((label) => (
          <span key={label} className="cursor-default hover:text-foreground">
            {label}
          </span>
        ))}
      </div>
      <p className="px-3 pt-2 text-[11px] text-muted-foreground/70">© 2026 WebFlix 2.0</p>
    </nav>
  );
}

/** Collapsed icon rail (desktop, collapsed state). */
export function SidebarRail() {
  const isActive = useIsActive();
  const { data: me } = useApi<MeDTO>("/api/me");
  const yourChannel = me?.ownedChannel ?? null;
  const railItems: NavItem[] = [
    ...MAIN_NAV,
    // REA-3 — the rail mirrors the expanded guide's You family: the You row
    // (/you hub) + the full You-section set incl. Your videos (/studio).
    YOU_ROW,
    ...(yourChannel
      ? [{ href: `/channel/${yourChannel.handle}`, label: "Your channel", icon: UserRound }]
      : []),
    { href: "/history", label: "History", icon: History },
    { href: "/playlists", label: "Playlists", icon: ListVideo },
    { href: "/studio", label: "Your videos", icon: MonitorPlay },
    { href: "/playlist/WL", label: "Watch later", icon: Clock },
    { href: "/liked", label: "Liked", icon: ThumbsUp },
    { href: "/downloads", label: "Downloads", icon: Download },
  ];
  return (
    <nav
      aria-label="Main navigation (collapsed)"
      className="flex w-full flex-col items-center gap-1 px-1 py-2"
    >
      {railItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-3.5 text-[10px] leading-tight transition-colors",
              active ? "bg-secondary text-foreground" : "text-foreground/90 hover:bg-accent/60"
            )}
          >
            <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop sidebar: expanded ⇄ icon rail, collapse persisted (localStorage). */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  useSidebarHydration();
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "hidden shrink-0 overflow-y-auto slim-scrollbar transition-[width] duration-200 md:block",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      {collapsed ? <SidebarRail /> : <SidebarNav />}
    </aside>
  );
}
