"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

/** WebFlix chips row — All + the 14 categories, filters the feed via query param. */
export function CategoryChips({
  chips,
  active,
  className,
}: {
  chips: string[];
  active: string;
  className?: string;
}) {
  const current = active || "All";
  return (
    <div
      role="tablist"
      aria-label="Filter by category"
      className={cn("no-scrollbar flex gap-3 overflow-x-auto px-4 py-3 sm:px-6", className)}
    >
      {chips.map((chip) => {
        const isActive = chip === current;
        return (
          <Link
            key={chip}
            role="tab"
            aria-selected={isActive}
            href={chip === "All" ? "/" : `/?category=${encodeURIComponent(chip)}`}
            scroll={false}
            data-testid="category-chip"
            data-active={isActive}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium leading-none transition-colors",
              isActive
                ? "bg-foreground text-background"
                : "bg-secondary text-foreground/90 hover:bg-accent"
            )}
          >
            {chip}
          </Link>
        );
      })}
    </div>
  );
}
