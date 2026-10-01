import type { CommentState } from "./types";

export function classifyCommentState(raw: { state?: string | null }): CommentState {
  const s = (raw.state ?? "").toLowerCase();
  if (s.includes("spam")) return "likelySpam";
  if (s.includes("held") || s.includes("pending") || s.includes("review")) return "heldForReview";
  return "published";
}

export function commentActionPath(commentId: string, action: "approve" | "delete" | "heart"): string {
  return `/api/comments/${encodeURIComponent(commentId)}/${action}`;
}

export function groupByState(comments: Array<{ state: CommentState }>): Record<CommentState, number> {
  const out: Record<CommentState, number> = { published: 0, heldForReview: 0, likelySpam: 0 };
  for (const c of comments) out[c.state] += 1;
  return out;
}
