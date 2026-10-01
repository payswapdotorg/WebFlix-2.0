"use client";

/**
 * WFX2-P3-SG search suggest dropdown — youtube.com autocomplete parity for
 * the topbar search box (docs/plans/2026-09-29-live-roadmap.md, P3-SG).
 *
 * Contract:
 * - suggestions from `/api/search/suggest?q=` (the suggestqueries read),
 *   debounced ≥150ms, cancelled on new input, honest empty on refusal — a
 *   failed suggest never fakes rows and never blocks the search;
 * - recent searches in localStorage (`webflix-recent-searches`), capped 10,
 *   move-to-front dedupe, honest clear-all;
 * - keyboard: ↑/↓ wrap navigation, Enter commits the active row (Enter with
 *   no active row falls through to the form submit), Esc closes, Tab closes
 *   and lets focus move; rows commit on mousedown (before the input blurs);
 * - the dropdown never interferes with the form submit or the voice dialog.
 *
 * `useSuggestDropdown` owns the logic; the topbar only wires focus/blur/
 * keydown and renders `<SuggestDropdown control={…} />`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Search, Trash2 } from "lucide-react";

export const RECENTS_STORAGE_KEY = "webflix-recent-searches";
export const RECENTS_CAP = 10;
export const SUGGEST_LISTBOX_ID = "webflix-search-suggest-listbox";

/** youtube.com's own dropdown debounce floor (the lane law: ≥150ms). */
const DEFAULT_DEBOUNCE_MS = 150;

export function suggestOptionId(index: number): string {
  return `webflix-search-suggest-option-${index}`;
}

export type SuggestRow = {
  kind: "recent" | "suggestion";
  text: string;
};

// ---------------------------------------------------------------------------
// Recents — localStorage, honest: corrupt or unavailable storage degrades to
// no recents (never a crash, never fabricated rows).
// ---------------------------------------------------------------------------

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecents(storage: Storage | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, RECENTS_CAP);
  } catch {
    return [];
  }
}

function writeRecents(storage: Storage | null, list: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // private mode / quota exceeded — recents stay in-memory only (honest)
  }
}

/** Pure: insert at the front (case-insensitive dedupe), cap at 10. */
export function pushRecent(list: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return list;
  const rest = list.filter((r) => r.toLowerCase() !== q.toLowerCase());
  return [q, ...rest].slice(0, RECENTS_CAP);
}

// ---------------------------------------------------------------------------
// The controller hook
// ---------------------------------------------------------------------------

export interface SuggestController {
  open: boolean;
  /** Rows to show; empty when there is nothing honest to show. */
  rows: SuggestRow[];
  /** -1 = no active row. */
  activeIndex: number;
  setOpen(open: boolean): void;
  close(): void;
  /** Feed the input's keydown; true = consumed (caller preventDefaults). */
  handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): boolean;
  /** Commit a row: record it as a recent, close, hand the text to the parent. */
  commitRow(index: number): void;
  /** Record an executed search (plain form submit) as a recent. */
  recordRecent(query: string): void;
  clearRecents(): void;
}

export interface UseSuggestDropdownOptions {
  /** The live input value — suggestions follow it, debounced. */
  query: string;
  /** Called with the committed text; the parent navigates to the search page. */
  onCommit: (query: string) => void;
  /** Test seam — production default 150ms. */
  debounceMs?: number;
}

export function useSuggestDropdown(opts: UseSuggestDropdownOptions): SuggestController {
  const { query, debounceMs = DEFAULT_DEBOUNCE_MS } = opts;
  const [open, setOpenState] = useState(false);
  /** The last suggestion list landed (kept with its query — derived away below). */
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  /** Keyboard navigation: the active row + the query it belongs to (derived
   * away when the query changes — no reset effect, no stale index). */
  const [nav, setNav] = useState<{ query: string; index: number } | null>(null);

  // Opening hydrates the recents from storage in the event handler itself
  // (SSR-safe: focus only fires client-side; always the honest current
  // storage state — another tab's writes show up too).
  const setOpen = useCallback((next: boolean) => {
    if (next) {
      setRecents(readRecents(safeStorage()));
      setOpenState(true);
    } else {
      setOpenState(false);
      setNav(null);
    }
  }, []);

  const close = useCallback(() => {
    setOpenState(false);
    setNav(null);
  }, []);

  // Suggestions: debounced fetch, cancelled on new input / close. The abort
  // + stale guard together give the cancel semantics: only the newest
  // input's response may land, and an in-flight request is aborted. State
  // only updates inside the async callbacks (never synchronously in the
  // effect body); stale lists are derived away at render time.
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) return;
    const controller = new AbortController();
    let stale = false;
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(async (res) => {
          if (stale) return;
          if (!res.ok) {
            setSuggestions([]); // honest empty — a refused suggest is not an error surface
            return;
          }
          const body = (await res.json().catch(() => null)) as { suggestions?: unknown } | null;
          const list = Array.isArray(body?.suggestions)
            ? body.suggestions.filter((s): s is string => typeof s === "string" && s.length > 0)
            : [];
          if (!stale) setSuggestions(list);
        })
        .catch(() => {
          if (!stale) setSuggestions([]); // aborted or refused — honest empty
        });
    }, debounceMs);
    return () => {
      stale = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, debounceMs]);

  // Rows (derived): with input → prefix-matched recents + suggestions that
  // prefix-match the CURRENT query (a stale list for an older prefix keeps
  // showing — youtube.com's own behavior — but never a mismatched one);
  // with an empty box → the recents themselves.
  const rows = useMemo<SuggestRow[]>(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const recentMatches = q
      ? recents.filter((r) => r.toLowerCase().startsWith(q))
      : recents;
    const shown = new Set(recentMatches.map((r) => r.toLowerCase()));
    const fresh =
      q && suggestions.length > 0
        ? suggestions.filter(
            (s) => s.toLowerCase().startsWith(q) && !shown.has(s.toLowerCase())
          )
        : [];
    return [
      ...recentMatches.map((text): SuggestRow => ({ kind: "recent", text })),
      ...fresh.map((text): SuggestRow => ({ kind: "suggestion", text })),
    ];
  }, [open, query, recents, suggestions]);

  const active =
    nav && nav.query === query && nav.index >= 0 && nav.index < rows.length ? nav.index : -1;

  const commitRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      const next = pushRecent(recents, row.text);
      writeRecents(safeStorage(), next);
      setRecents(next);
      setOpenState(false);
      setNav(null);
      opts.onCommit(row.text);
    },
    [rows, recents, opts.onCommit]
  );

  const recordRecent = useCallback(
    (searchQuery: string) => {
      const q = searchQuery.trim();
      if (!q) return;
      const next = pushRecent(recents, q);
      writeRecents(safeStorage(), next);
      setRecents(next);
    },
    [recents]
  );

  const clearRecents = useCallback(() => {
    writeRecents(safeStorage(), []);
    setRecents([]);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!open || rows.length === 0) return false;
      switch (e.key) {
        case "ArrowDown":
          setNav({ query, index: active < 0 ? 0 : (active + 1) % rows.length });
          return true;
        case "ArrowUp":
          setNav({
            query,
            index: active < 0 ? rows.length - 1 : (active - 1 + rows.length) % rows.length,
          });
          return true;
        case "Enter":
          if (active >= 0) {
            commitRow(active);
            return true; // consumed — the form submit must not also fire
          }
          return false; // fall through: the form submits the typed query
        case "Escape":
          close();
          return true;
        case "Tab":
          close();
          return false; // close, then let focus move naturally
        default:
          return false;
      }
    },
    [open, rows, active, query, commitRow, close]
  );

  return {
    open,
    rows,
    activeIndex: active,
    setOpen,
    close,
    handleKeyDown,
    commitRow,
    recordRecent,
    clearRecents,
  };
}

// ---------------------------------------------------------------------------
// The view — compact youtube.com dropdown rows, the recent-search header
// with its honest clear-all, keyboard-active highlight, capped height.
// ---------------------------------------------------------------------------

export function SuggestDropdown({ control }: { control: SuggestController }) {
  const { open, rows, activeIndex } = control;
  if (!open || rows.length === 0) return null;
  const recentsCount = rows.filter((r) => r.kind === "recent").length;
  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
      {recentsCount > 0 && (
        <div className="flex items-center justify-between px-4 pb-0.5 pt-2.5">
          <span className="text-xs font-medium text-muted-foreground">Recent searches</span>
          <button
            type="button"
            aria-label="Clear all recent searches"
            title="Clear all recent searches"
            onMouseDown={(e) => {
              e.preventDefault(); // keep the input's focus — clear honestly, no blur race
              control.clearRecents();
            }}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
      <ul
        id={SUGGEST_LISTBOX_ID}
        role="listbox"
        aria-label="Search suggestions"
        className="max-h-96 overflow-y-auto py-1.5 slim-scrollbar"
      >
        {rows.map((row, i) => (
          <li
            key={`${i}:${row.text}`}
            id={suggestOptionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault(); // commit before the input blurs
              control.commitRow(i);
            }}
            className={`flex h-9 cursor-pointer select-none items-center gap-3 px-4 text-sm transition-colors ${
              i === activeIndex ? "bg-accent" : "hover:bg-accent/60"
            }`}
          >
            {row.kind === "recent" ? (
              <Clock className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Search className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{row.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
