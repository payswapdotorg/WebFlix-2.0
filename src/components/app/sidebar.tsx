"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChefHat,
  Clapperboard,
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
  Music,
  Newspaper,
  Plane,
  Radio,
  Settings,
  SquarePlay,
  ThumbsUp,
  Trophy,
  MessageSquarePlus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
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
  { href: "/trending", label: "Trending", icon: Flame },
  { href: "/subscriptions", label: "Subscriptions", icon: Layers },
];

const YOU_NAV: NavItem[] = [
  { href: "/history", label: "History", icon: History },
  { href: "/playlists", label: "Playlists", icon: ListVideo },
  { href: "/liked", label: "Liked videos", icon: ThumbsUp },
  { href: "/studio", label: "Creator Studio", icon: Clapperboard },
];

const MORE_NAV: { label: string; icon: LucideIcon; toast: string }[] = [
  { label: "Settings", icon: Settings, toast: "Settings ships in Wave 4 (WFX2-P)" },
  { label: "WebFlix Premium", icon: Crown, toast: "WebFlix Premium ships in Wave 4 (WFX2-P)" },
  { label: "Report history", icon: Flag, toast: "Report history ships in Wave 4 (WFX2-P)" },
  { label: "Help", icon: HelpCircle, toast: "Help ships in Wave 4 (WFX2-P)" },
  { label: "Send feedback", icon: MessageSquarePlus, toast: "Feedback ships in Wave 4 (WFX2-P)" },
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

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 pb-4">
      {MAIN_NAV.map((item) => (
        <NavRow key={item.href} item={item} active={isActive(item.href)} onNavigate={onNavigate} />
      ))}

      <Divider />
      <SectionHeader>You</SectionHeader>
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
      {MORE_NAV.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => toast(item.toast)}
            className="flex w-full items-center gap-6 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 transition-colors hover:bg-accent/60"
          >
            <Icon className="size-[22px] shrink-0" strokeWidth={1.8} />
            <span>{item.label}</span>
          </button>
        );
      })}

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
  const railItems: NavItem[] = [
    ...MAIN_NAV,
    { href: "/history", label: "History", icon: History },
    { href: "/playlists", label: "Playlists", icon: ListVideo },
    { href: "/liked", label: "Liked", icon: ThumbsUp },
    { href: "/studio", label: "Studio", icon: Clapperboard },
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
