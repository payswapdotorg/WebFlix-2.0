"use client";

import { NetflixCard } from "./netflix-card";
import type { NetflixRailDTO } from "@/lib/netflix/types";

/**
 * P42 — one hub rail. Renders nothing when the pool dropped out (the honest
 * absence); the rank numeral rides only when the rail carries rank semantics.
 */
export function NetflixRail({ rail }: { rail: NetflixRailDTO }) {
  if (rail.titles.length === 0) return null;
  return (
    <section aria-label={rail.label} className="mt-8" data-testid={`netflix-rail-${rail.key}`}>
      <div className="flex items-baseline justify-between gap-3 px-4 sm:px-6">
        <h2 className="text-lg font-semibold text-white sm:text-xl">
          {rail.label}
          <span className="ml-2 text-sm font-normal text-white/50">
            {rail.country !== "Global" ? `· ${rail.country}` : "· Global"}
          </span>
        </h2>
        {rail.weekEndDate && (
          <span className="shrink-0 text-xs text-white/40">
            week of {rail.weekEndDate}
          </span>
        )}
      </div>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {rail.titles.map((title, i) => (
          <NetflixCard
            key={`${rail.key}-${title.netflixId}`}
            title={title}
            rank={rail.ranking === "weekly" || rail.ranking === "alltime" ? i + 1 : null}
          />
        ))}
      </div>
    </section>
  );
}
