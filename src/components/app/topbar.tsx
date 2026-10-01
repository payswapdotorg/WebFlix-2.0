"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flame, Menu, Mic, Search, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WebFlixLogo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { NotificationsBell } from "./notifications-bell";
import { AccountMenu } from "./account-menu";
import { VoiceSearchDialog } from "./voice-search";
import { SidebarNav } from "./sidebar";
import { useSidebar } from "@/lib/sidebar-store";
import {
  SUGGEST_LISTBOX_ID,
  SuggestDropdown,
  suggestOptionId,
  useSuggestDropdown,
} from "@/components/search/suggest-dropdown";

export function Topbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toggleSidebar = useSidebar((s) => s.toggle);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // P3-SG: youtube.com autocomplete parity — suggestions + recents dropdown
  // under the search box (additive; the form submit + voice dialog are untouched).
  const suggest = useSuggestDropdown({
    query,
    onCommit: (text) => {
      setQuery(text);
      router.push(`/search?q=${encodeURIComponent(text)}`);
    },
  });

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    suggest.recordRecent(q); // an executed search is a recent (capped, deduped)
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-background px-2 sm:px-4">
      {/* left: menu + logo */}
      <div className="flex items-center gap-1">
        {/* Mobile: drawer; desktop: collapse toggle */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation menu"
              className="rounded-full md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[280px] overflow-y-auto p-0 pt-14 slim-scrollbar"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className="hidden rounded-full md:inline-flex"
          onClick={toggleSidebar}
        >
          <Menu className="size-5" />
        </Button>
        <Link href="/" aria-label="WebFlix Home" className="px-1">
          <WebFlixLogo />
        </Link>
      </div>

      {/* center: search */}
      <form
        role="search"
        onSubmit={submitSearch}
        className="mx-auto hidden w-full max-w-[560px] items-center gap-2 sm:flex"
      >
        <div className="relative flex h-10 flex-1 items-center rounded-full border border-border bg-secondary/40 focus-within:border-foreground/40">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggest.setOpen(true)}
            onBlur={() => suggest.close()}
            onKeyDown={(e) => {
              if (suggest.handleKeyDown(e)) e.preventDefault();
            }}
            placeholder="Search"
            aria-label="Search videos and channels"
            role="combobox"
            aria-expanded={suggest.open}
            aria-autocomplete="list"
            aria-controls={SUGGEST_LISTBOX_ID}
            aria-activedescendant={
              suggest.activeIndex >= 0 ? suggestOptionId(suggest.activeIndex) : undefined
            }
            className="h-full flex-1 rounded-l-full border-0 bg-transparent pl-4 text-sm shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            aria-label="Search"
            className="h-full rounded-r-full border-l border-border bg-secondary px-5 hover:bg-accent"
          >
            <Search className="size-5" />
          </Button>
          <SuggestDropdown control={suggest} />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Search with your voice"
          title="Voice search"
          onClick={() => setVoiceOpen(true)}
          className="size-10 shrink-0 rounded-full bg-secondary/60"
        >
          <Mic className="size-5" />
        </Button>
      </form>

      {/* mobile: search icon → /search */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        className="rounded-full sm:hidden"
        onClick={() => router.push("/search")}
      >
        <Search className="size-5" />
      </Button>

      {/* right: actions */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Button
          asChild
          variant="ghost"
          className="hidden rounded-full px-3 text-sm font-medium md:inline-flex"
        >
          <Link href="/upload" aria-label="Upload video">
            <Video className="mr-2 size-5" /> Upload video
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon" className="rounded-full" title="Trending">
          <Link href="/trending" aria-label="Trending">
            <Flame className="size-5" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="rounded-full md:hidden"
          title="Upload video"
        >
          <Link href="/upload" aria-label="Upload video">
            <Video className="size-5" />
          </Link>
        </Button>
        <NotificationsBell />
        <ThemeToggle />
        <AccountMenu />
      </div>

      <VoiceSearchDialog open={voiceOpen} onOpenChange={setVoiceOpen} />
    </header>
  );
}
