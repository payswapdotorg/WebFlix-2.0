import {
  AudioLines, BarChart3, Captions, CircleDollarSign, Copyright, Files,
  LayoutDashboard, MessageSquareText, Paintbrush, Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon }

// Exact studio.youtube.com left-nav structure and order.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/content", label: "Content", icon: Files },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/community", label: "Community", icon: MessageSquareText },
  { href: "/subtitles", label: "Subtitles", icon: Captions },
  { href: "/copyright", label: "Copyright", icon: Copyright },
  { href: "/earn", label: "Earn", icon: CircleDollarSign },
  { href: "/customization", label: "Customization", icon: Paintbrush },
  { href: "/audio-library", label: "Audio library", icon: AudioLines },
  { href: "/settings", label: "Settings", icon: Settings },
];
