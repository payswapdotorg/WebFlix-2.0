"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X } from "lucide-react";
import {
  FILTER_GROUPS,
  appliedFilterChips,
  clearFilters,
  hasActiveFilters,
  isOptionActive,
  withGroupValue,
  type FilterGroupId,
  type SearchFilterState,
} from "@/lib/youtube/search-filters";
import { cn } from "@/lib/utils";

type FilterPanelProps = {
  state: SearchFilterState;
  /** push the next state up (the page owns the URL sync) */
  onChange: (next: SearchFilterState) => void;
};

/**
 * The search filter panel — the LIVE 2026 youtube.com filter dialog: a
 * Filters button (tune icon) opening the grouped options (single-select per
 * group; selecting the active option clears the group), groups ordered
 * Type / Duration / Upload date / Features / Prioritize, "Clear all" at the
 * bottom.
 */
export function FilterPanel({ state, onChange }: FilterPanelProps) {
  const chips = appliedFilterChips(state);

  function select(group: FilterGroupId, value: string) {
    // single-select: clicking the active option deselects it
    const next = withGroupValue(
      state,
      group,
      isOptionActive(state, group, value) ? null : value
    );
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className="gap-2 rounded-full"
          aria-label={`Filters${chips.length > 0 ? `, ${chips.length} applied` : ""}`}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {chips.length > 0 && (
            <span
              className="ml-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold tabular-nums text-background"
              aria-hidden
            >
              {chips.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,20rem)] p-0"
      >
        <div
          role="group"
          aria-label="Search filters"
          className="max-h-[70vh] overflow-y-auto slim-scrollbar"
        >
          {FILTER_GROUPS.map((group) => (
            <section key={group.id} className="border-b border-border/60 px-4 py-3 last:border-b-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-0.5">
                {group.options.map((option) => {
                  const active = isOptionActive(state, group.id, option.value);
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => select(group.id, option.value)}
                        className={cn(
                          "flex min-h-9 w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                          active
                            ? "bg-secondary font-medium text-foreground"
                            : "text-foreground/90 hover:bg-accent/60"
                        )}
                      >
                        {option.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex justify-end border-t border-border/60 p-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasActiveFilters(state)}
            onClick={() => onChange(clearFilters(state))}
            aria-label="Clear all filters"
          >
            Clear all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The applied-filter chips row (each chip removable → clears its group). */
export function AppliedFilterChips({
  state,
  onChange,
}: {
  state: SearchFilterState;
  onChange: (next: SearchFilterState) => void;
}) {
  const chips = appliedFilterChips(state);
  if (chips.length === 0) return null;
  return (
    <ul
      className="flex flex-wrap items-center gap-2"
      aria-label="Applied search filters"
    >
      {chips.map((chip) => (
        <li key={chip.group}>
          <button
            type="button"
            onClick={() => onChange(withGroupValue(state, chip.group, null))}
            className="group flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            aria-label={`Remove filter ${chip.label}`}
          >
            {chip.label}
            <X className="size-3.5 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() => onChange(clearFilters(state))}
          className="px-2 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          aria-label="Clear all filters"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}
