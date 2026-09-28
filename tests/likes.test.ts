/**
 * WFX2-W tests — video like/dislike toggle semantics (like→like unsets,
 * like→dislike swaps) + comment like semantics + honest aggregate counts.
 * Each test reads fresh state and is order-independent.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { setVideoLike, setCommentLike } from "../src/lib/watch/like-service";
import { db } from "../src/lib/db";

setupTestDb();

/** Make the user's rating state clean before each scenario. */
async function ensureNoRating(videoId: string, userId: string) {
  const row = await db.videoLike.findUnique({
    where: { videoId_userId: { videoId, userId } },
  });
  if (row) await setVideoLike(videoId, userId, row.value as "like" | "dislike"); // same value → unset
}

async function ensureNoCommentRating(commentId: string, userId: string) {
  const row = await db.commentLike.findUnique({
    where: { commentId_userId: { commentId, userId } },
  });
  if (row) await setCommentLike(commentId, userId, row.value as "like" | "dislike");
}

describe("video like toggle semantics", () => {
  test("first like sets state and increments the aggregate", async () => {
    const { bbb, pip } = await fixtures();
    await ensureNoRating(bbb.id, pip.id);
    const before = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    const r = await setVideoLike(bbb.id, pip.id, "like");
    expect(r.yourLike).toBe("like");
    expect(r.likes).toBe(before.likes + 1);
    expect(r.dislikes).toBe(before.dislikes);
  });

  test("like → like unsets (toggle off)", async () => {
    const { bbb, pip } = await fixtures();
    await ensureNoRating(bbb.id, pip.id);
    const clean = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    await setVideoLike(bbb.id, pip.id, "like"); // on
    const on = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(on.likes).toBe(clean.likes + 1);
    const r = await setVideoLike(bbb.id, pip.id, "like"); // same → off
    expect(r.yourLike).toBeNull();
    const off = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(off.likes).toBe(clean.likes);
  });

  test("like → dislike swaps (one or the other, never both)", async () => {
    const { bbb, pip } = await fixtures();
    await ensureNoRating(bbb.id, pip.id);
    const clean = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    await setVideoLike(bbb.id, pip.id, "like"); // on
    const r = await setVideoLike(bbb.id, pip.id, "dislike"); // swap
    expect(r.yourLike).toBe("dislike");
    const video = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(video.likes).toBe(clean.likes);
    expect(video.dislikes).toBe(clean.dislikes + 1);
    const rows = await db.videoLike.findMany({ where: { videoId: bbb.id, userId: pip.id } });
    expect(rows.length).toBe(1);
  });

  test("dislike → dislike unsets", async () => {
    const { bbb, pip } = await fixtures();
    await ensureNoRating(bbb.id, pip.id);
    const clean = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    await setVideoLike(bbb.id, pip.id, "dislike"); // on
    const on = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(on.dislikes).toBe(clean.dislikes + 1);
    const r = await setVideoLike(bbb.id, pip.id, "dislike"); // same → off
    expect(r.yourLike).toBeNull();
    const off = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(off.dislikes).toBe(clean.dislikes);
  });

  test("two users keep independent states; aggregates are honest", async () => {
    const { bbb, pip, demo } = await fixtures();
    // demo already likes BBB from the seed; pip is made clean
    await ensureNoRating(bbb.id, pip.id);
    const base = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    await setVideoLike(bbb.id, pip.id, "like"); // +1
    await setVideoLike(bbb.id, demo.id, "like"); // unset demo's seed like → -1
    const video = await db.video.findUniqueOrThrow({ where: { id: bbb.id } });
    expect(video.likes).toBe(base.likes); // -1 +1
    const rows = await db.videoLike.findMany({ where: { videoId: bbb.id } });
    expect(rows.map((r) => r.value).sort()).toEqual(["like"]);
  });
});

describe("comment like semantics", () => {
  test("like increments; unlike decrements; swap removes the like", async () => {
    const { bbb, demo, pip, gwenwatches } = await fixtures();
    // gwenwatches has a top-level comment on BBB ("Came for the cars…")
    const target = await db.comment.findFirstOrThrow({
      where: { videoId: bbb.id, userId: gwenwatches.id },
    });
    await ensureNoCommentRating(target.id, demo.id);
    await ensureNoCommentRating(target.id, pip.id);

    const r1 = await setCommentLike(target.id, demo.id, "like");
    expect(r1.yourLike).toBe("like");
    expect(r1.likes).toBe(target.likes + 1);

    const r2 = await setCommentLike(target.id, demo.id, "dislike");
    expect(r2.yourLike).toBe("dislike");
    const afterSwap = await db.comment.findUniqueOrThrow({ where: { id: target.id } });
    expect(afterSwap.likes).toBe(target.likes); // dislike removes the like (YouTube: no dislike count)

    const r3 = await setCommentLike(target.id, pip.id, "like");
    expect(r3.yourLike).toBe("like");
    expect(r3.likes).toBe(target.likes + 1);
  });
});
