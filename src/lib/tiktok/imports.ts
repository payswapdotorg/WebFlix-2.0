/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2 — the import persistence layer (ADR
 * 0013 §7, the work order's "canonical URL paste/import, private saves,
 * curator-public collection rules, dedupe").
 *
 * THE LAYER LAW: this module owns EVERY DB touch of the TikTok import
 * feature; `library.ts` stays DB-free (its battery runs without a
 * datasource). The composed universe is [curated…, public imports
 * (newest-first), own private saves (newest-first)] — deterministic, so
 * the cursor law walks it unchanged.
 *
 * THE RULES:
 * - Dedupe: one row per canonical post id (`TikTokImport.postId @unique`).
 *   A repeat import (by anyone) is idempotent — the first row stands, the
 *   answer is honest about it (`alreadyImported`).
 * - A post already in the curated universe is refused as a no-op (the
 *   curated citation already carries it publicly; an import row would be
 *   dead weight). The honest answer names it curated.
 * - Private saves: a fresh import rides ONLY the importer's feed. The
 *   owner's `visibility` flip ("private" → "public") is the curator rule
 *   that admits the post to every viewer's universe. Only the owner flips
 *   or removes (the row answers 404 to strangers — no existence leak).
 * - No TikTok write is implied anywhere (ADR 0004): these rows are
 *   WebFlix-local shelf membership; the player stays the official embed.
 * - The metadata resolution rides the SAME honest lane as every surface
 *   (getTikTokVideo — cached oEmbed → honest fallback/unavailable). A
 *   walled egress does NOT block an import: the embed player is
 *   viewer-side and may play regardless; the row's `authorHint` (the
 *   handle the pasted URL carried) keeps the fallback card factual.
 */
import { db } from "@/lib/db";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import { curatedPostIds, getTikTokVideo, importedFallbackDTO } from "./library";
import { isTikTokPostId, parseTikTokVideoUrl } from "./urls";
import type { TikTokImportVisibility, TikTokVideoDTO } from "./types";

/**
 * The import lane's identity law (the browser-verified fix): the session's
 * WebFlix SHADOW row — the same lazy identity every write lane resolves.
 * A fresh signup's raw session sub has NO User row (the FK would refuse);
 * ensureShadowUser upserts the stable `wf-<sub>` identity first.
 */
export async function importUserId(sessionUser: WebFlixSessionUser): Promise<string> {
  return (await ensureShadowUser(sessionUser)).id;
}

/** The import universe's hard cap (the curated cap's sibling — the composed
 * feed stays bounded; the embed-domain usage-limit law). */
export const TIKTOK_IMPORT_CAP = 40;

function isVisibility(v: unknown): v is TikTokImportVisibility {
  return v === "private" || v === "public";
}

export function asVisibility(v: unknown): TikTokImportVisibility | null {
  return isVisibility(v) ? v : null;
}

/**
 * The composed universe's import segment ids (PURE DB read):
 * `scope: "public"` — every viewer's feed/hub/search;
 * `scope: "viewer"` — the signed-in viewer's extra segment (their private
 * saves; their public imports already ride the public segment).
 * Newest-first; capped. DB failure degrades to an empty segment (the feed
 * renders the curated shelf — never a 500 from decoration).
 */
async function importIds(scope: "public" | "viewer", viewerId?: string | null): Promise<string[]> {
  try {
    if (scope === "public") {
      const rows = await db.tikTokImport.findMany({
        where: { visibility: "public" },
        orderBy: { createdAt: "desc" },
        take: TIKTOK_IMPORT_CAP,
        select: { postId: true },
      });
      return rows.map((r) => r.postId);
    }
    if (!viewerId) return [];
    const rows = await db.tikTokImport.findMany({
      where: { importedBy: viewerId, visibility: "private" },
      orderBy: { createdAt: "desc" },
      take: TIKTOK_IMPORT_CAP,
      select: { postId: true },
    });
    return rows.map((r) => r.postId);
  } catch {
    return [];
  }
}

/** Public import ids — the hub rail, the search lane, and guests' feeds. */
export function publicImportIds(): Promise<string[]> {
  return importIds("public");
}

/**
 * The feed composition for one acting viewer — public imports plus their
 * own private saves, in one deduped append segment (public first, then
 * private). This is the ONLY extra-ids shape the /shorts feed route uses.
 */
export async function composedFeedExtraIds(
  viewerId: string | null | undefined
): Promise<{ extraIds: string[]; hintByPostId: Map<string, string>; ownPostIds: Set<string> }> {
  const [publicIds, privateIds] = await Promise.all([
    importIds("public"),
    importIds("viewer", viewerId ?? null),
  ]);
  const seen = new Set<string>();
  const extraIds: string[] = [];
  for (const id of [...publicIds, ...privateIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    extraIds.push(id);
  }
  const meta = await importMeta(extraIds);
  const ownPostIds = new Set<string>();
  for (const [postId, row] of meta) {
    if (viewerId && row.importedBy === viewerId) ownPostIds.add(postId);
  }
  const hintByPostId = new Map<string, string>();
  for (const [postId, row] of meta) {
    if (row.authorHint) hintByPostId.set(postId, row.authorHint);
  }
  return { extraIds, hintByPostId, ownPostIds };
}

/** The visibility each composed id carries for the acting viewer — the
 * stamp table the feed route applies AFTER the cached DTO resolves. */
async function importMeta(ids: readonly string[]): Promise<Map<string, { importedBy: string; visibility: string; authorHint: string | null }>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db.tikTokImport.findMany({
      where: { postId: { in: [...ids] } },
      select: { postId: true, importedBy: true, visibility: true, authorHint: true },
    });
    return new Map(rows.map((r) => [r.postId, r]));
  } catch {
    return new Map();
  }
}

/**
 * The request-layer decoration: stamps the viewer-scoped fields on the
 * resolved page items (never inside the shared cache) and swaps a walled
 * imported post's anonymous card for the factual imported fallback when
 * the row carries an authorHint. Curated rows pass through untouched.
 */
export async function decorateFeedPage(
  items: TikTokVideoDTO[],
  viewerId: string | null | undefined
): Promise<TikTokVideoDTO[]> {
  const meta = await importMeta(items.map((v) => v.postId));
  if (meta.size === 0) return items;
  return items.map((item) => {
    const row = meta.get(item.postId);
    if (!row) return item;
    const owned = !!viewerId && row.importedBy === viewerId;
    const vis: TikTokImportVisibility = row.visibility === "public" ? "public" : "private";
    // A walled card with an honest handle rides the imported fallback —
    // the same P59-R2 move the curated cards make, sourced from the row.
    if (item.unavailable && row.authorHint) {
      return { ...importedFallbackDTO(item.postId, row.authorHint), visibility: vis, owned };
    }
    return { ...item, visibility: vis, owned };
  });
}

/**
 * The import itself: parse (URL law) → resolve (the honest lane) → dedupe
 * → persist. Throws typed errors the route maps to honest statuses.
 */
export type TikTokImportResult =
  | { ok: true; post: TikTokVideoDTO; alreadyImported: boolean; curated: boolean }
  | { ok: false; error: "invalid-url" };

export async function importTikTokPost(input: {
  url: string;
  userId: string;
}): Promise<TikTokImportResult> {
  const parsed = parseTikTokVideoUrl(input.url ?? "");
  if (!parsed) return { ok: false, error: "invalid-url" };
  const { postId, author } = parsed;
  if (!isTikTokPostId(postId)) return { ok: false, error: "invalid-url" };

  // The curated no-op: the citation already carries the post publicly.
  if (curatedPostIds().includes(postId)) {
    const post = await getTikTokVideo(postId);
    return { ok: true, post: { ...post, visibility: null, owned: true }, alreadyImported: true, curated: true };
  }

  // Dedupe (the first row stands — a repeat import is idempotent and never
  // demotes a public row back to private).
  const existing = await db.tikTokImport.findUnique({ where: { postId } });
  if (existing) {
    const post = await getTikTokVideo(postId);
    const owned = existing.importedBy === input.userId;
    const vis: TikTokImportVisibility = existing.visibility === "public" ? "public" : "private";
    return { ok: true, post: { ...post, visibility: vis, owned }, alreadyImported: true, curated: false };
  }

  // The honest metadata resolution BEFORE persisting (the row's authorHint
  // records the handle the pasted URL carried — the fallback card's fuel).
  const resolved = await getTikTokVideo(postId);
  await db.tikTokImport.create({
    data: {
      postId,
      authorHint: author ?? resolved.author ?? null,
      importedBy: input.userId,
      visibility: "private",
    },
  });
  return {
    ok: true,
    post: { ...resolved, visibility: "private", owned: true },
    alreadyImported: false,
    curated: false,
  };
}

/** The owner-only visibility flip (the curator rule). Returns the row's
 * state or a typed failure the route maps (404 / 400). */
export async function flipTikTokImportVisibility(input: {
  postId: string;
  userId: string;
  visibility: unknown;
}): Promise<{ ok: true; visibility: TikTokImportVisibility } | { ok: false; error: "not-found" | "bad-visibility" }> {
  const vis = asVisibility(input.visibility);
  if (!vis) return { ok: false, error: "bad-visibility" };
  const row = await db.tikTokImport.findUnique({ where: { postId: input.postId } });
  if (!row || row.importedBy !== input.userId) return { ok: false, error: "not-found" };
  await db.tikTokImport.update({ where: { postId: input.postId }, data: { visibility: vis } });
  return { ok: true, visibility: vis };
}

/** The owner-only un-import (remove the row; the feed membership follows). */
export async function removeTikTokImport(input: {
  postId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const row = await db.tikTokImport.findUnique({ where: { postId: input.postId } });
  if (!row || row.importedBy !== input.userId) return { ok: false, error: "not-found" };
  await db.tikTokImport.delete({ where: { postId: input.postId } });
  return { ok: true };
}

/** The owner's own imports (the management list, newest-first). */
export async function listMyTikTokImports(
  userId: string
): Promise<{ postId: string; visibility: TikTokImportVisibility; createdAt: string; authorHint: string | null }[]> {
  const rows = await db.tikTokImport.findMany({
    where: { importedBy: userId },
    orderBy: { createdAt: "desc" },
    take: TIKTOK_IMPORT_CAP,
  });
  return rows.map((r) => ({
    postId: r.postId,
    visibility: r.visibility === "public" ? "public" : "private",
    createdAt: r.createdAt.toISOString(),
    authorHint: r.authorHint,
  }));
}
