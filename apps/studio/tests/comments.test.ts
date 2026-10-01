import { expect, test } from "bun:test";
import { classifyCommentState, commentActionPath, groupByState } from "@/lib/comments";
import { normalizeComment } from "@/lib/mapping";
import { commentsFixture } from "./helpers/fixtures";

test("classifyCommentState: explicit states + honest published default", () => {
  expect(classifyCommentState({ state: "heldForReview" })).toBe("heldForReview");
  expect(classifyCommentState({ state: "LIKELY_SPAM" })).toBe("likelySpam");
  expect(classifyCommentState({ state: "published" })).toBe("published");
  expect(classifyCommentState({})).toBe("published"); // no state signal → published, never guessed
  expect(classifyCommentState({ state: null })).toBe("published");
});

test("groupByState counts match the fixture mix", () => {
  const comments = commentsFixture.map((c) => normalizeComment(c)).filter((c) => c !== null);
  const counts = groupByState(comments);
  expect(counts.published).toBe(2);
  expect(counts.heldForReview).toBe(1);
  expect(counts.likelySpam).toBe(1);
});

test("broker action paths are upstream-shaped and encoded", () => {
  expect(commentActionPath("abc", "approve")).toBe("/api/comments/abc/approve");
  expect(commentActionPath("a/b c", "delete")).toBe("/api/comments/a%2Fb%20c/delete");
  expect(commentActionPath("x", "heart")).toBe("/api/comments/x/heart");
});
