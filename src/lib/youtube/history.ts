/**
 * WFX2-B-B history — the operator's real watch history (SSR + continuation).
 *
 * VERIFIED shape (tests/fixtures/yt/ssr_history.json — a REAL capture of
 * /feed/history with the operator session, 2.9MB):
 *  - page: contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
 *      .sectionListRenderer.contents[] = itemSectionRenderer per DAY group:
 *      header.itemSectionHeaderRenderer.title (simpleText "Apr 7" / runs
 *      "Today") + contents[] = lockupViewModel | videoRenderer |
 *      reelShelfRenderer
 *  - the final section is a continuationItemRenderer whose
 *      continuationEndpoint.continuationCommand.token is the next-page cursor
 *      (browse {continuation} — the standard pattern from A-B's comments.ts)
 *  - per-item watched progress: contentImage.thumbnailViewModel.overlays[]
 *      .thumbnailBottomOverlayViewModel.progressBar
 *      .thumbnailOverlayProgressBarViewModel.startPercent (0–100)
 *  - watched-when: the DAY headers are the timestamps; some newer responses
 *      also carry a `watchedProgressAgoText` part in the lockup metadata rows
 *      (parsed when present, fixture-observed absence honored)
 *  - pause/clear controls: secondaryContents.browseFeedActionsRenderer
 *      .contents[].buttonRenderer.text ("Pause watch history" = currently
 *      recording, "Resume watch history" = paused, "Clear all watch history")
 *  - public mode (no session): the page answers a messageRenderer /
 *      backgroundPromoRenderer sign-in promo and zero items — honest
 *      login-required degradation (fixture ssr_history_public.json, REAL).
 *
 * Writes (remove / clear-all / pause) are broker-tier (mini-services/
 * youtube-broker executor kinds history-remove, history-clear-all,
 * history-pause, search-history-pause) — Tier-2 law.
 */
import { innertubeBrowse } from "./innertube";
import { fetchYtInitialData } from "./ssr";
import { cached, TTL } from "./cache";
import { hasSession } from "./session";
import {
  walkTree,
  runsText,
  mapLockupViewModel,
  mapVideoRenderer,
  mapVideos,
  relativeAgeToDate,
} from "./mappers";
import type { ContinueVideoDTO, HistoryGroupDTO } from "@/lib/types";

export interface HistoryFeed {
  groups: HistoryGroupDTO[];
  items: ContinueVideoDTO[];
  nextCursor: string | null;
  /** true when the SSR response is the logged-out promo (no session) */
  loginRequired: boolean;
  /** watch-history pause state from the page's own controls (null = unknown) */
  watchHistoryPaused: boolean | null;
  /** search-history pause state (null = not surfaced by this response) */
  searchHistoryPaused: boolean | null;
  total: number;
}

/** The known day-header labels → an approximate ISO date (honest best-effort). */
export function historyDayLabelToDate(label: string, now = new Date()): string | null {
  const text = label.trim();
  if (!text) return null;
  if (/^today$/i.test(text)) return now.toISOString();
  if (/^yesterday$/i.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
  const monthDay = /^([A-Z][a-z]{2,8})\s+(\d{1,2})$/.exec(text);
  if (monthDay) {
    const months = [
      "January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December",
    ];
    const mi = months.findIndex((m) => m.startsWith(monthDay[1]));
    if (mi === -1) return null;
    // most recent PAST date with that month/day (a day header never sits in
    // the future — a month that already passed this year means last year)
    let year = now.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, mi, Number(monthDay[2])));
    if (candidate.getTime() > now.getTime()) candidate.setUTCFullYear(--year);
    return candidate.toISOString();
  }
  const full = /^([A-Z][a-z]{2,8})\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
  if (full) {
    const months = [
      "January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December",
    ];
    const mi = months.findIndex((m) => m.startsWith(full[1]));
    if (mi === -1) return null;
    return new Date(Date.UTC(Number(full[3]), mi, Number(full[2]))).toISOString();
  }
  return null;
}

/** True when the SSR response is the logged-out promo (login required). */
export function historyLoginRequired(response: unknown): boolean {
  // the promo renderers with an accounts.google.com sign-in CTA
  for (const promo of walkTree(response, "backgroundPromoRenderer")) {
    const cta = JSON.stringify(promo?.ctaButton ?? {});
    if (/accounts\.google\.com\/ServiceLogin/.test(cta)) return true;
  }
  for (const msg of walkTree(response, "messageRenderer")) {
    const button = JSON.stringify(msg?.button ?? {});
    if (/accounts\.google\.com\/ServiceLogin/.test(button)) return true;
  }
  return false;
}

/** Watched-progress percent from a history lockup's thumbnail overlay (0–100 | null). */
function progressPercent(item: unknown): number | null {
  for (const bar of walkTree(item, "thumbnailOverlayProgressBarViewModel")) {
    const pct = bar?.startPercent;
    if (typeof pct === "number" && Number.isFinite(pct)) {
      return Math.max(0, Math.min(100, pct));
    }
  }
  return null;
}

/** The watched-ago passthrough when the newer response shape carries it. */
export function watchedProgressAgoText(item: unknown): string | null {
  for (const row of walkTree(item, "metadataRows")) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text?.content ?? "";
      const a11y = part?.text?.accessibilityLabel ?? "";
      if (typeof text === "string" && /watched/i.test(a11y) && /ago$/i.test(text)) return text;
      if (typeof text === "string" && /^\d+\s+\w+\s+ago$/i.test(text) && a11y === "" && part?.leadingIcon?.name === "HISTORY") return text;
    }
  }
  return null;
}

/** Map one history response (first page or continuation) into the DTO. */
export function mapHistoryPage(response: unknown): HistoryFeed {
  const loginRequired = historyLoginRequired(response);

  // first page: the twoColumnBrowseResultsRenderer day sections; continuation
  // pages: onResponseReceivedActions[].appendContinuationItemsCommand
  // .continuationItems (the standard browse continuation shape)
  const sections: any[] = walkTree(response, "itemSectionRenderer");
  const appended: any[] = [];
  // both live wire variants exist: appendContinuationItemsCommand (classic)
  // and appendContinuationItemsAction (the current playlist/feed continuations
  // — verified live: the browse VL continuation answers the Action variant)
  for (const cmd of walkTree(response, "appendContinuationItemsCommand")) {
    appended.push(...(cmd?.continuationItems ?? []));
  }
  for (const cmd of walkTree(response, "appendContinuationItemsAction")) {
    appended.push(...(cmd?.continuationItems ?? []));
  }
  for (const cmd of walkTree(response, "appendContinuationItemsEndpoint")) {
    appended.push(...(cmd?.continuationItems ?? []));
  }

  const groups: HistoryGroupDTO[] = [];
  const seen = new Set<string>();
  const items: ContinueVideoDTO[] = [];
  let nextCursor: string | null = null;

  const push = (raw: any, dayLabel: string | null) => {
    if (raw?.continuationItemRenderer) {
      const token =
        raw.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === "string" && token) nextCursor = token;
      return null;
    }
    const dto = historyItemToContinue(raw);
    if (!dto || seen.has(dto.id)) return null;
    seen.add(dto.id);
    const watchedAt = dayLabel
      ? (historyDayLabelToDate(dayLabel) ?? new Date().toISOString())
      : dto.watchedAt;
    const item: ContinueVideoDTO = { ...dto, watchedAt };
    items.push(item);
    return item;
  };

  for (const section of sections) {
    // the last section may itself be the continuationItemRenderer
    const dayLabel = runsText(section?.header?.itemSectionHeaderRenderer?.title) || null;
    const sectionItems: ContinueVideoDTO[] = [];
    for (const raw of section?.contents ?? []) {
      const item = push(raw, dayLabel);
      if (item) sectionItems.push(item);
    }
    if (dayLabel && sectionItems.length > 0) {
      const existing = groups.find((g) => g.label === dayLabel);
      if (existing) existing.items.push(...sectionItems);
      else groups.push({ label: dayLabel, items: sectionItems });
    }
  }

  // continuation-page items (no day headers) → the flat "Earlier" bucket
  const appendedItems: ContinueVideoDTO[] = [];
  for (const raw of appended) {
    const item = push(raw, null);
    if (item) appendedItems.push(item);
  }
  if (appendedItems.length > 0) {
    const existing = groups.find((g) => g.label === "Earlier");
    if (existing) existing.items.push(...appendedItems);
    else groups.push({ label: "Earlier", items: appendedItems });
  }

  // continuation token at top level (richGrid/richSection variants)
  if (!nextCursor) {
    for (const item of walkTree(response, "continuationItemRenderer")) {
      const token = item?.continuationEndpoint?.continuationCommand?.token;
      if (typeof token === "string" && token) {
        nextCursor = token;
        break;
      }
    }
  }
  if (!nextCursor) {
    // the newer continuationItemViewModel nests the token (playlist pages)
    for (const item of walkTree(response, "continuationItemViewModel")) {
      const token = item?.continuationCommand?.innertubeCommand?.continuationCommand?.token;
      if (typeof token === "string" && token) {
        nextCursor = token;
        break;
      }
    }
  }

  return {
    groups,
    items,
    nextCursor,
    loginRequired,
    watchHistoryPaused: watchHistoryPausedFromPage(response),
    searchHistoryPaused: null,
    total: items.length,
  };
}

/** One history card (lockupViewModel | videoRenderer) → ContinueVideoDTO. */
function historyItemToContinue(raw: unknown): ContinueVideoDTO | null {
  const node = raw as Record<string, any>;
  const video =
    mapLockupViewModel(node?.lockupViewModel ?? null) ??
    mapVideoRenderer(node?.videoRenderer ?? null);
  if (!video) return null;
  const percent = progressPercent(node?.lockupViewModel ?? node?.videoRenderer ?? null);
  const watchedSec =
    percent !== null && video.durationSec
      ? Math.max(1, Math.round((video.durationSec * percent) / 100))
      : percent !== null && percent >= 99
        ? (video.durationSec ?? 0)
        : 0;
  const ago = watchedProgressAgoText(node?.lockupViewModel ?? null);
  return {
    ...video,
    watchedSec,
    watchedAt: ago ? (relativeAgeToDate(ago) ?? new Date().toISOString()) : new Date().toISOString(),
  };
}

/** Pause state from the page's own control rail (null = unknown/not present). */
export function watchHistoryPausedFromPage(response: unknown): boolean | null {
  for (const button of walkTree(response, "buttonRenderer")) {
    const label = runsText(button?.text).trim();
    if (/^resume watch history$/i.test(label)) return true;
    if (/^pause watch history$/i.test(label)) return false;
  }
  return null;
}

/** True when a session is configured (personalized history active). */
export function historyAvailable(): boolean {
  return hasSession();
}

const HISTORY_CACHE_KEY = "yt:history:page";

/**
 * The live history feed. Without a session the SSR page is the logged-out
 * promo → honest loginRequired empties (no fake data). `cursor` pages via
 * browse {continuation}.
 */
export async function getHistoryFeed(cursor?: string): Promise<HistoryFeed> {
  if (cursor) {
    const response = await innertubeBrowse({ continuation: cursor });
    return mapHistoryPage(response);
  }
  if (!hasSession()) {
    // still probe once (honest): the public page answers the login promo
    const response = await cached(`${HISTORY_CACHE_KEY}:public`, TTL.FEED_MS, () =>
      fetchYtInitialData("/feed/history", { cookies: null })
    );
    return mapHistoryPage(response);
  }
  const response = await cached(HISTORY_CACHE_KEY, TTL.FEED_MS, () =>
    fetchYtInitialData("/feed/history")
  );
  return mapHistoryPage(response);
}

/** Flat video list for other surfaces (continue-watching already has feeds.ts). */
export async function getHistoryVideos(limit = 48): Promise<ContinueVideoDTO[]> {
  const feed = await getHistoryFeed();
  return feed.items.slice(0, limit);
}

/** mapVideos passthrough so route tests can assert against the shared mapper. */
export const historyMapVideos = mapVideos;
