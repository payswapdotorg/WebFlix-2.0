/**
 * WFX2-P6-CR — the honest LOCAL comment rung + the read-path merge.
 *
 * LAW (honest outcomes only): a row written here NEVER claims a YouTube
 * write. Every DTO carries `local: true` so the UI discloses the origin
 * ("Stored on WebFlix — not posted to YouTube"), and engagement counts stay
 * honest (likes start at 0 and only move when really liked).
 *
 * The write rung (third after direct SAPISIDHASH → broker, both currently
 * offline: expired operator session + unconfigured BROKER_URL):
 *  - shadow Video row: id = the REAL YouTube video id — an honest mirror of
 *    the real video (title/channel from the watch payload snapshot the
 *    composer forwards), visibility "public", the real YouTube thumbnail.
 *  - shadow Channel row: id = the real YouTube channel id (handle/name/avatar
 *    from the snapshot).
 *  - author bridge: a shadow Prisma User per WebFlix account —
 *    id = `wf-<sessionUser.id>`, handle = a unique-safe `wf_<...>` derived
 *    from the session, name = the session display name, avatar = the
 *    session's avatarSeed rendered as a deterministic data-URI SVG.
 *  - replies to LIVE YouTube comments anchor on a shadow parent row
 *    (id = the YouTube commentId, body = the parent text the request
 *    carries) — the anchor never renders; the live payload owns the parent.
 *
 * The read merge: local rows join the live InnerTube read — locally-written
 * top-level comments PREPEND on the first page (they are the freshest),
 * local replies nest under their parent threads by parentId (YouTube-parent
 * and local-parent alike), and the header count adjusts by the local total.
 */
import { db } from "@/lib/db";
import { ApiError } from "./api";
import { videoThumbnailUrl, watchUrl } from "@/lib/youtube/mappers";
import type {
  CommentAuthorDto,
  CommentDto,
  CommentVideoSnapshotDto,
  LikeValue,
} from "./types";
import type { WebFlixSessionUser } from "@/lib/auth/types";

/** The shadow author id for a WebFlix account (stable, upsertable). */
export function shadowUserId(sessionUserId: string): string {
  return `wf-${sessionUserId}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;"
  );
}

/**
 * The session's deterministic avatar — the avatarSeed hue + the display
 * initial as a self-contained data-URI SVG (the account-menu rendering,
 * server-side; no external asset, no placeholder service).
 */
export function localAvatarUrl(seed: number, displayName: string): string {
  const hue = ((Math.trunc(seed) % 360) + 360) % 360;
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88">` +
    `<rect width="88" height="88" rx="44" fill="hsl(${hue} 65% 45%)"/>` +
    `<text x="44" y="46" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="system-ui,sans-serif" font-size="38" fill="#fff">${escapeXml(initial)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A handle-safe, unique-available handle derived from the session id. */
async function uniqueSessionHandle(sessionUserId: string): Promise<string> {
  const base = `wf_${sessionUserId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "user"}`;
  let handle = base;
  for (let n = 2; ; n++) {
    const taken = await db.user.findUnique({ where: { handle } });
    if (!taken) return handle;
    handle = `${base}${n}`;
  }
}

/**
 * The shadow Prisma User bridging the WebFlix account (author-identity
 * bridge). Upsert by id — the first local write creates it, subsequent
 * writes refresh the name/avatar (the session's current truth).
 */
export async function ensureShadowUser(
  sessionUser: WebFlixSessionUser
): Promise<{ id: string; handle: string; name: string; avatarUrl: string }> {
  const id = shadowUserId(sessionUser.id);
  const existing = await db.user.findUnique({ where: { id } });
  const name = sessionUser.displayName || sessionUser.email || "WebFlix viewer";
  const avatarUrl = localAvatarUrl(sessionUser.avatarSeed, name);
  if (existing) {
    if (existing.name !== name || existing.avatarUrl !== avatarUrl) {
      const updated = await db.user.update({ where: { id }, data: { name, avatarUrl } });
      return updated;
    }
    return existing;
  }
  return db.user.create({
    data: { id, handle: await uniqueSessionHandle(sessionUser.id), name, avatarUrl },
  });
}

/** Stable shadow channel id when the snapshot carries no YouTube channel id. */
function shadowChannelId(snapshot: CommentVideoSnapshotDto): string {
  if (snapshot.channelId) return snapshot.channelId;
  const slug = (snapshot.channelHandle ?? snapshot.channelName ?? "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 40);
  return `ytch-${slug || "unknown"}`;
}

/** Upsert the shadow Channel mirroring the real YouTube channel. */
async function ensureShadowChannel(snapshot: CommentVideoSnapshotDto): Promise<string> {
  const id = shadowChannelId(snapshot);
  const existing = await db.channel.findUnique({ where: { id } });
  if (existing) return id;
  const data = {
    id,
    handle: snapshot.channelHandle?.replace(/^@/, "") || id,
    name: snapshot.channelName || snapshot.channelHandle || "YouTube channel",
    avatarUrl: snapshot.channelAvatarUrl || "",
  };
  // handle collisions (a local channel may already own it): suffix until free
  let handle = data.handle;
  for (let n = 2; ; n++) {
    const taken = await db.channel.findUnique({ where: { handle } });
    if (!taken) break;
    handle = `${data.handle}${n}`;
  }
  await db.channel.create({ data: { ...data, handle } });
  return id;
}

/**
 * Upsert the shadow Video mirroring the real YouTube video (id = videoId).
 *
 * WFX2-P39 — THE HEAL LAW: first-write-wins applies ONLY while the first
 * write carried real display data. A row born GENERIC (the no-snapshot
 * fallbacks — title `YouTube video <id>`, the shadow channel id
 * `ytch-unknown` / name "YouTube channel") is HEALED the first time a save
 * arrives carrying real display data: the generic title takes the
 * snapshot's title, and the generic channel relinks to the snapshot's real
 * shadow channel. A row that already carries REAL data is NEVER
 * overwritten — a later, different snapshot changes nothing (real data is
 * the truth, whichever save wrote it first). Idempotent by construction:
 * a healed row is real, so every later snapshot (same or different) is a
 * no-op.
 */
export async function ensureShadowVideo(
  videoId: string,
  snapshot: CommentVideoSnapshotDto = {}
): Promise<void> {
  const existing = await db.video.findUnique({
    where: { id: videoId },
    include: { channel: true },
  });
  if (!existing) {
    const channelId = await ensureShadowChannel(snapshot);
    await db.video.create({
      data: {
        id: videoId,
        channelId,
        title: snapshot.title || `YouTube video ${videoId}`,
        // honest mirror: the real thumbnail + the real watch page
        thumbnailUrl: videoThumbnailUrl(videoId),
        videoUrl: watchUrl(videoId),
        visibility: "public",
      },
    });
    return;
  }
  // WFX2-P39 — the heal pass: a GENERIC row takes the arriving snapshot's
  // real display data; a REAL row keeps everything (never overwritten).
  const genericTitle = existing.title === `YouTube video ${videoId}`;
  const genericChannel =
    existing.channelId === "ytch-unknown" ||
    existing.channel?.name === "YouTube channel";
  const snapshotHasChannel = Boolean(
    snapshot.channelId ?? snapshot.channelHandle ?? snapshot.channelName,
  );
  const data: { title?: string; channelId?: string } = {};
  if (genericTitle && snapshot.title) data.title = snapshot.title;
  if (genericChannel && snapshotHasChannel) {
    const channelId = await ensureShadowChannel(snapshot);
    if (channelId !== existing.channelId) data.channelId = channelId;
  }
  if (data.title === undefined && data.channelId === undefined) return;
  await db.video.update({ where: { id: videoId }, data });
}

/**
 * Anchor a reply to a LIVE YouTube comment: a shadow parent row with the
 * YouTube commentId (idempotent — an existing row, shadow or local, is left
 * untouched; the anchor never renders, the live payload owns the parent).
 */
export async function ensureShadowParentComment(
  videoId: string,
  parentId: string,
  parentText: string | undefined,
  anchorUserId: string
): Promise<void> {
  const existing = await db.comment.findUnique({ where: { id: parentId } });
  if (existing) return;
  await db.comment.create({
    data: {
      id: parentId,
      videoId,
      userId: anchorUserId,
      body: parentText ?? "",
      // THE ANCHOR LAW: moderation "shadow" — an FK anchor that NEVER renders
      // (every read path filters moderation:"approved"; the live payload owns
      // the parent's rendering). Parent validation accepts it: it is the
      // shadow OF a live YouTube comment, not a deleted local one.
      moderation: "shadow",
    },
  });
}

export interface LocalWriteArgs {
  videoId: string;
  text: string;
  /** present → a reply under this comment id (YouTube or local) */
  parentId?: string;
  /** the parent's current text (the request already carries it) */
  parentText?: string;
  /** the WebFlix account — the author-identity bridge */
  sessionUser: WebFlixSessionUser;
  /** the watch payload's video snapshot (shadow Video/Channel rows) */
  videoSnapshot?: CommentVideoSnapshotDto;
}

export interface LocalCommentResult extends CommentDto {
  ok: true;
  effect: string;
  path: "local";
  local: true;
}

/**
 * The local rung write — persist the comment (or reply) in the honest
 * WebFlix store. NEVER claims a YouTube write: the result carries
 * `local: true` + `path: "local"` and the UI discloses the origin.
 */
export async function writeLocalComment(args: LocalWriteArgs): Promise<LocalCommentResult> {
  const trimmed = args.text.trim();
  if (!trimmed) throw new Error("comment body is empty");

  await ensureShadowVideo(args.videoId, args.videoSnapshot ?? {});
  const author = await ensureShadowUser(args.sessionUser);

  if (args.parentId) {
    // the parent's own anchor: an existing local row is validated in place;
    // a live YouTube comment id gets a shadow anchor (never rendered)
    const parent = await db.comment.findUnique({
      where: { id: args.parentId },
      select: { id: true, videoId: true, moderation: true },
    });
    if (parent) {
      if (parent.videoId !== args.videoId) {
        throw new ApiError(400, "Parent comment belongs to another video");
      }
      if (parent.moderation === "deleted") {
        throw new ApiError(404, "Parent comment not found");
      }
    } else {
      const anchorUserId = (await fallbackAnchorUserId()) || author.id;
      await ensureShadowParentComment(args.videoId, args.parentId, args.parentText, anchorUserId);
    }
  }

  const created = await db.comment.create({
    data: {
      videoId: args.videoId,
      userId: author.id,
      parentId: args.parentId ?? null,
      body: trimmed,
      moderation: "approved",
    },
  });

  const dtoAuthor: CommentAuthorDto = {
    id: author.id,
    handle: author.handle,
    name: author.name,
    avatarUrl: author.avatarUrl,
    isMember: false,
    isCreator: false,
  };
  return {
    id: created.id,
    parentId: created.parentId,
    body: created.body,
    likes: 0,
    heartedByCreator: false,
    pinned: false,
    edited: false,
    moderation: "approved",
    createdAt: created.createdAt.toISOString(),
    author: dtoAuthor,
    yourLike: null,
    isOwn: true,
    replyCount: 0,
    totalReplyCount: 0,
    replies: [],
    replyNextCursor: null,
    ok: true,
    effect: args.parentId ? "comment-replied" : "comment-created",
    path: "local",
    local: true,
  };
}

/** The demo fallback chain's user id — the shadow-parent anchor author. */
async function fallbackAnchorUserId(): Promise<string> {
  for (const handle of ["demo", "you"]) {
    const demo = await db.user.findUnique({ where: { handle } });
    if (demo) return demo.id;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* WFX2-P40 — the LOCAL-ROW ACTION TIER (like / edit / delete / restore) */
/* ------------------------------------------------------------------ */

/**
 * The local-row tier detector: a comment id that resolves to a WebFlix row
 * the store OWNS (moderation "approved" or "deleted" — NEVER the "shadow"
 * FK anchors, which stand for live YouTube comments the store does not own)
 * is served by the LOCAL action tier below; everything else (unknown ids,
 * shadow anchors) is a YouTube comment → the honest unsupported lane.
 *
 * The gap this closes (the operator's 2026-10-23 re-file): pre-P40 the
 * like/edit/delete/restore routes answered the YouTube 501 for EVERY id —
 * including the operator's OWN local rows, whose affordances the UI renders
 * and whose likes the read path already models (CommentLike). A row the
 * store owns gets store-backed actions, disclosed local:true — exactly the
 * create/reply lane's honesty law.
 */
export async function findLocalActionRow(commentId: string): Promise<{
  id: string;
  videoId: string;
  userId: string;
  body: string;
  likes: number;
  moderation: string;
  edited: boolean;
  createdAt: Date;
} | null> {
  const row = await db.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      videoId: true,
      userId: true,
      body: true,
      likes: true,
      moderation: true,
      edited: true,
      createdAt: true,
    },
  });
  if (!row) return null; // unknown id — a YouTube comment (or already gone)
  if (row.moderation === "shadow") return null; // a live YouTube comment's anchor — never local
  return row; // approved | deleted (restorable) | held/flagged/rejected — the store owns it
}

/** Ownership law: the row's author is THIS session's shadow user. */
function assertOwnRow(row: { userId: string }, sessionUser: WebFlixSessionUser): void {
  if (row.userId !== shadowUserId(sessionUser.id)) {
    throw new ApiError(403, "You can only do this on your own comments");
  }
}

export interface LocalLikeResult {
  ok: true;
  effect: string;
  likes: number;
  yourLike: LikeValue | null;
  path: "local";
  local: true;
}

/**
 * Like/dislike a LOCAL row — the store-backed tier (the read path's
 * viewerLikes already models it; the write path finally matches).
 * Semantics identical to the route contract the UI sends:
 *  - {value: "like"|"dislike"} — legacy TOGGLE (same value → remove);
 *  - {action: "like"|"dislike"|"none"} — canonical SET.
 * The like count moves only on like/un-like transitions (dislikes never
 * touch the visible count — YouTube-parity honest counts).
 */
export async function localLikeComment(
  commentId: string,
  sessionUser: WebFlixSessionUser,
  req: { value?: LikeValue; action?: "like" | "dislike" | "none" },
): Promise<LocalLikeResult> {
  const row = await db.comment.findUnique({ where: { id: commentId } });
  if (!row || row.moderation !== "approved") throw new ApiError(404, "Comment not found");
  const likerId = shadowUserId(sessionUser.id);

  const existing = await db.commentLike.findUnique({
    where: { userId_commentId: { userId: likerId, commentId } },
  });
  const prev = (existing?.value as LikeValue | undefined) ?? null;
  const next: LikeValue | null =
    req.action !== undefined
      ? req.action === "none"
        ? null
        : req.action
      : prev === req.value
        ? null
        : (req.value ?? null);

  if (next === prev) {
    return {
      ok: true,
      effect: "comment-like-unchanged",
      likes: row.likes,
      yourLike: prev,
      path: "local",
      local: true,
    };
  }

  if (next === null) {
    await db.commentLike.deleteMany({ where: { userId: likerId, commentId } });
  } else {
    await db.commentLike.upsert({
      where: { userId_commentId: { userId: likerId, commentId } },
      create: { userId: likerId, commentId, value: next },
      update: { value: next },
    });
  }
  const delta = prev === "like" ? -1 : next === "like" ? 1 : 0;
  const likes = Math.max(0, row.likes + delta);
  if (delta !== 0) {
    await db.comment.update({ where: { id: commentId }, data: { likes } });
  }
  return {
    ok: true,
    effect: next === null ? "comment-unliked" : `comment-${next}d`,
    likes,
    yourLike: next,
    path: "local",
    local: true,
  };
}

export interface LocalEditResult {
  ok: true;
  effect: string;
  body: string;
  edited: true;
  path: "local";
  local: true;
}

/** Edit own local row (body + edited flag) — the store-backed tier. */
export async function localEditComment(
  commentId: string,
  sessionUser: WebFlixSessionUser,
  text: string,
): Promise<LocalEditResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new ApiError(400, "Comment cannot be empty");
  const row = await db.comment.findUnique({ where: { id: commentId } });
  if (!row || row.moderation !== "approved") throw new ApiError(404, "Comment not found");
  assertOwnRow(row, sessionUser);
  await db.comment.update({
    where: { id: commentId },
    data: { body: trimmed, edited: true },
  });
  return {
    ok: true,
    effect: "comment-edited",
    body: trimmed,
    edited: true,
    path: "local",
    local: true,
  };
}

export interface LocalDeleteResult {
  ok: true;
  effect: string;
  deleted: true;
  path: "local";
  local: true;
}

/** Soft-delete own local row (moderation "deleted" — restorable). */
export async function localDeleteComment(
  commentId: string,
  sessionUser: WebFlixSessionUser,
): Promise<LocalDeleteResult> {
  const row = await db.comment.findUnique({ where: { id: commentId } });
  if (!row || row.moderation !== "approved") throw new ApiError(404, "Comment not found");
  assertOwnRow(row, sessionUser);
  await db.comment.update({ where: { id: commentId }, data: { moderation: "deleted" } });
  return {
    ok: true,
    effect: "comment-deleted",
    deleted: true,
    path: "local",
    local: true,
  };
}

/** Restore own soft-deleted local row — returns the row's fresh DTO. */
export async function localRestoreComment(
  commentId: string,
  sessionUser: WebFlixSessionUser,
): Promise<CommentDto> {
  const row = await db.comment.findUnique({
    where: { id: commentId },
    include: { user: { select: { id: true, handle: true, name: true, avatarUrl: true } } },
  });
  if (!row || row.moderation !== "deleted") throw new ApiError(404, "Comment not found");
  assertOwnRow(row, sessionUser);
  await db.comment.update({ where: { id: commentId }, data: { moderation: "approved" } });
  const viewerIds = [shadowUserId(sessionUser.id)];
  const [like, replyCount] = await Promise.all([
    db.commentLike.findUnique({
      where: { userId_commentId: { userId: viewerIds[0], commentId } },
      select: { value: true },
    }),
    db.comment.count({ where: { parentId: commentId, moderation: "approved" } }),
  ]);
  return {
    id: row.id,
    parentId: row.parentId,
    body: row.body,
    likes: row.likes,
    heartedByCreator: row.heartedByCreator,
    pinned: row.pinned,
    edited: row.edited,
    moderation: "approved",
    createdAt: row.createdAt.toISOString(),
    author: {
      id: row.user.id,
      handle: row.user.handle,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
      isMember: false,
      isCreator: false,
    },
    yourLike: (like?.value as LikeValue | undefined) ?? null,
    isOwn: true,
    replyCount,
    totalReplyCount: replyCount,
    local: true,
  };
}

/* ------------------------------------------------------------------ */
/* Read-path merge — local rows join the live InnerTube read            */
/* ------------------------------------------------------------------ */

type LocalRow = {
  id: string;
  videoId: string;
  parentId: string | null;
  userId: string;
  body: string;
  likes: number;
  heartedByCreator: boolean;
  pinned: boolean;
  moderation: string;
  edited: boolean;
  createdAt: Date;
  user: { id: string; handle: string; name: string; avatarUrl: string };
};

interface LocalContext {
  rows: LocalRow[];
  creatorUserId: string | null;
  memberUserIds: Set<string>;
  viewerLikes: Map<string, LikeValue>;
  viewerIds: string[];
}

async function loadLocalContext(videoId: string, viewerIds: string[]): Promise<LocalContext | null> {
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { channelId: true, channel: { select: { ownerId: true } } },
  });
  if (!video) return null; // no local store for this video → nothing to merge
  const [rows, memberships, likes] = await Promise.all([
    db.comment.findMany({
      where: { videoId, moderation: "approved" },
      include: { user: { select: { id: true, handle: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.membership.findMany({
      where: { tier: { channelId: video.channelId } },
      select: { userId: true },
    }),
    viewerIds.length
      ? db.commentLike.findMany({
          where: { userId: { in: viewerIds }, comment: { videoId } },
          select: { commentId: true, value: true },
        })
      : Promise.resolve([]),
  ]);
  if (rows.length === 0) return null; // honest nothing — no merge, no shape change
  return {
    rows,
    creatorUserId: video.channel.ownerId,
    memberUserIds: new Set(memberships.map((m) => m.userId)),
    viewerLikes: new Map(likes.map((l) => [l.commentId, l.value as LikeValue])),
    viewerIds,
  };
}

/** direct + total reply counts per local comment id (comment-service's algorithm). */
function localCounts(rows: LocalRow[]): {
  children: Map<string, LocalRow[]>;
  direct: Map<string, number>;
  totals: Map<string, number>;
} {
  const children = new Map<string, LocalRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  const direct = new Map<string, number>();
  const totals = new Map<string, number>();
  const totalOf = (id: string, seen: Set<string>): number => {
    if (totals.has(id)) return totals.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    let n = 0;
    for (const child of children.get(id) ?? []) n += 1 + totalOf(child.id, seen);
    return n;
  };
  for (const row of rows) {
    direct.set(row.id, children.get(row.id)?.length ?? 0);
    totals.set(row.id, totalOf(row.id, new Set()));
  }
  return { children, direct, totals };
}

function toLocalDto(row: LocalRow, ctx: LocalContext, replyCount: number, totalReplyCount: number): CommentDto {
  return {
    id: row.id,
    parentId: row.parentId,
    body: row.body,
    likes: row.likes,
    heartedByCreator: row.heartedByCreator,
    pinned: row.pinned,
    edited: row.edited,
    moderation: row.moderation,
    createdAt: row.createdAt.toISOString(),
    author: {
      id: row.user.id,
      handle: row.user.handle,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
      isMember: ctx.memberUserIds.has(row.userId),
      isCreator: row.userId === ctx.creatorUserId,
    },
    yourLike: ctx.viewerLikes.get(row.id) ?? null,
    isOwn: ctx.viewerIds.includes(row.userId),
    replyCount,
    totalReplyCount,
    local: true,
  };
}

export interface LocalMergeArgs {
  videoId: string;
  /** the live (already inline-attached) top-level items for the page */
  items: CommentDto[];
  /** the live total (the header count) */
  total: number;
  /** the read-path viewers: the resolved viewer + the session's shadow id */
  viewerIds: string[];
  /** page 1 (no cursor) → locally-written top-level comments PREPEND */
  firstPage: boolean;
}

/**
 * Merge the local rows into a live top-level comments page:
 *  - page 1: local top-level comments PREPEND (they are the freshest), each
 *    with their whole local reply thread inline (local threads are small);
 *  - every page: local replies nest under their parent thread by parentId
 *    (YouTube-parent and local-parent alike — the parent's expander counts
 *    adjust honestly);
 *  - the total adjusts by the local row count.
 * TOTAL for reads: a DB failure passes the live page through unchanged.
 */
export async function mergeLocalComments(args: LocalMergeArgs): Promise<{
  items: CommentDto[];
  total: number;
}> {
  let ctx: LocalContext | null = null;
  try {
    ctx = await loadLocalContext(args.videoId, args.viewerIds);
  } catch {
    return { items: args.items, total: args.total }; // store unreachable → live-only, honest
  }
  if (!ctx) return { items: args.items, total: args.total };

  const { children, direct, totals } = localCounts(ctx.rows);
  const dtoOf = (row: LocalRow) =>
    toLocalDto(row, ctx!, direct.get(row.id) ?? 0, totals.get(row.id) ?? 0);

  // index every live row on the page (top-level + nested replies) by id
  const byId = new Map<string, CommentDto>();
  // FIRST-WINS: the top-level occurrence owns the thread root (a duplicate
  // id deeper in the page — an upstream quirk — never steals the nesting:
  // local replies must attach to the thread the UI renders as the root).
  const index = (c: CommentDto) => {
    if (!byId.has(c.id)) byId.set(c.id, c);
    for (const r of c.replies ?? []) index(r);
  };
  for (const item of args.items) index(item);

  // nest local replies under their parents (bump the parents' counts once)
  const localReplies = ctx.rows.filter((r) => r.parentId !== null);
  for (const reply of localReplies) {
    const parent = byId.get(reply.parentId!);
    if (!parent) continue; // parent not on this page — its own page nests it
    parent.replies = [...(parent.replies ?? []), dtoOf(reply)];
    parent.replyCount = (parent.replyCount ?? 0) + 1;
    parent.totalReplyCount = (parent.totalReplyCount ?? 0) + (totals.get(reply.id) ?? 0) + 1;
  }

  let items = args.items;
  if (args.firstPage) {
    // local top-level comments, freshest first, ahead of the live page
    const localTop = ctx.rows
      .filter((r) => r.parentId === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => {
        const dto = dtoOf(row);
        // the whole local thread inline (no local pagination — honest + simple)
        dto.replies = (children.get(row.id) ?? []).map(dtoOf);
        dto.replyCount = direct.get(row.id) ?? 0;
        dto.totalReplyCount = totals.get(row.id) ?? 0;
        dto.replyNextCursor = null;
        return dto;
      });
    items = [...localTop, ...args.items];
  }

  return { items, total: args.total + ctx.rows.length };
}

/**
 * The parentId-path merge: local replies under one parent, served when the
 * live thread has nothing (the parent is local, or a YouTube comment whose
 * thread never loaded). Live threads keep their own pages — local replies
 * already ride the inline nesting, so they are never served twice.
 * TOTAL for reads: a DB failure passes the live page through unchanged.
 */
export async function listLocalReplies(
  videoId: string,
  parentId: string,
  viewerIds: string[]
): Promise<{ items: CommentDto[]; nextCursor: null }> {
  try {
    const ctx = await loadLocalContext(videoId, viewerIds);
    if (!ctx) return { items: [], nextCursor: null };
    const { direct, totals } = localCounts(ctx.rows);
    const replies = ctx.rows
      .filter((r) => r.parentId === parentId)
      .map((row) => toLocalDto(row, ctx!, direct.get(row.id) ?? 0, totals.get(row.id) ?? 0));
    return { items: replies, nextCursor: null };
  } catch {
    return { items: [], nextCursor: null };
  }
}

/**
 * WFX2-P40 — the parentId-path CHILD merge: local replies whose parents are
 * the DEPTH-1 rows this reply page serves nest under them here (each served
 * row's replyCount/totalReplyCount adjust honestly, so its "N replies"
 * expander appears). The top-level page's merge only reaches depth-1 rows
 * that ride the inline set (the first-3 top-level comments' first reply
 * pages); a depth-1 row arriving via this dedicated page (the thread's
 * later pages, or the first page of a comment past the inline set) would
 * otherwise carry NO local children — the operator's "reply didn't reflect
 * after reload" whenever the parent thread paginated. No double-serve by
 * construction: this merge appends only children OF THE SERVED ROWS (the
 * top-level merge appends only children of the top-level page's rows).
 * TOTAL for reads: a DB failure passes the page through unchanged.
 */
export async function mergeLocalChildReplies(args: {
  videoId: string;
  /** the reply page's served rows (depth-1 rows under one parent) */
  items: CommentDto[];
  viewerIds: string[];
}): Promise<CommentDto[]> {
  try {
    const ctx = await loadLocalContext(args.videoId, args.viewerIds);
    if (!ctx) return args.items;
    const { direct, totals } = localCounts(ctx.rows);
    const byId = new Map(args.items.map((i) => [i.id, i]));
    let changed = false;
    for (const row of ctx.rows) {
      if (row.parentId === null) continue;
      const parent = byId.get(row.parentId);
      if (!parent) continue; // this row's parent is not on the served page
      parent.replies = [
        ...(parent.replies ?? []),
        toLocalDto(row, ctx, direct.get(row.id) ?? 0, totals.get(row.id) ?? 0),
      ];
      parent.replyCount = (parent.replyCount ?? 0) + 1;
      parent.totalReplyCount = (parent.totalReplyCount ?? 0) + (totals.get(row.id) ?? 0) + 1;
      changed = true;
    }
    return changed ? [...args.items] : args.items;
  } catch {
    return args.items; // store unreachable → live-only, honest
  }
}
