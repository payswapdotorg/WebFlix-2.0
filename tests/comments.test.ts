/**
 * WFX2-W tests — comments sort orders, reply thread shape, composer
 * validation, edit/delete permissions.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { listComments, createComment, editComment, deleteComment } from "../src/lib/watch/comment-service";
import { ApiError } from "../src/lib/watch/api";

setupTestDb();

describe("comment sort orders", () => {
  test("top comments: pinned first, then likes desc", async () => {
    const { bbb, demo } = await fixtures();
    const page = await listComments(bbb.id, demo.id, "top");
    const items = page.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].pinned).toBe(true); // pinned stays on top
    const rest = items.slice(1);
    for (let i = 1; i < rest.length; i++) {
      expect(rest[i - 1].likes).toBeGreaterThanOrEqual(rest[i].likes);
    }
  });

  test("newest first: pinned first, then createdAt desc", async () => {
    const { bbb, demo } = await fixtures();
    const page = await listComments(bbb.id, demo.id, "new");
    expect(page.items[0].pinned).toBe(true);
    const rest = page.items.slice(1);
    for (let i = 1; i < rest.length; i++) {
      expect(new Date(rest[i - 1].createdAt).getTime()).toBeGreaterThan(
        new Date(rest[i].createdAt).getTime()
      );
    }
  });

  test("header total counts all approved comments incl. replies", async () => {
    const { bbb, demo } = await fixtures();
    const page = await listComments(bbb.id, demo.id, "top");
    const topLevel = page.items.length;
    const replies = page.items.reduce((n, c) => n + c.totalReplyCount, 0);
    // BBB seeds: 5 top-level + 8 replies = 13 approved comments
    expect(page.total).toBe(topLevel + replies);
    expect(page.total).toBe(13);
  });
});

describe("reply thread shape", () => {
  test("two-level reply thread with deeper collapse: direct vs total counts", async () => {
    const { bbb, demo } = await fixtures();
    const page = await listComments(bbb.id, demo.id, "top");
    // the pinned thread: blenderstudio → sintelfan → (blenderstudio, mocapmike) + critic99 reply
    const pinned = page.items[0];
    expect(pinned.replyCount).toBe(2); // direct replies (sintelfan + critic99)
    expect(pinned.totalReplyCount).toBe(4); // includes the 2 level-3 replies
    expect(pinned.replies?.length).toBe(2); // first inline replies
    const sintelReply = pinned.replies!.find((r) => r.author.handle === "sintelfan");
    expect(sintelReply).toBeDefined();
    expect(sintelReply!.replyCount).toBe(2); // level-3 children → "N replies" expander
  });

  test("reply page (parentId) lists children oldest-first", async () => {
    const { bbb, demo } = await fixtures();
    const page = await listComments(bbb.id, demo.id, "top");
    const pinned = page.items[0];
    const replyPage = await listComments(bbb.id, demo.id, "top", undefined, pinned.id);
    expect(replyPage.items.length).toBe(2);
    expect(new Date(replyPage.items[0].createdAt).getTime()).toBeLessThan(
      new Date(replyPage.items[1].createdAt).getTime()
    );
    // nested level-3 children of the sintelfan reply are fetched separately
    const nested = await listComments(bbb.id, demo.id, "top", undefined, replyPage.items[0].id);
    expect(nested.items.length).toBe(2);
    expect(nested.items.map((c) => c.author.handle).sort()).toEqual(["blenderstudio", "mocapmike"]);
  });

  test("pagination: 10 per page via cursor", async () => {
    const { bbb, demo } = await fixtures();
    // add 8 more top-level comments to cross the page boundary
    for (let i = 0; i < 8; i++) {
      await createComment(bbb.id, demo.id, `Bulk comment number ${i + 1}`);
    }
    const page1 = await listComments(bbb.id, demo.id, "top");
    expect(page1.items.length).toBe(10);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listComments(bbb.id, demo.id, "top", page1.nextCursor!);
    expect(page2.items.length).toBe(3); // 13 top-level − 10
    expect(page2.nextCursor).toBeNull();
  });
});

describe("composer + edit/delete", () => {
  test("empty body rejected; valid body persists approved", async () => {
    const { bbb, demo } = await fixtures();
    let rejected = false;
    try {
      await createComment(bbb.id, demo.id, "   ");
    } catch (e) {
      rejected = e instanceof ApiError && e.status === 400;
    }
    expect(rejected).toBe(true);
    const created = await createComment(bbb.id, demo.id, "Fresh honest comment");
    expect(created.moderation).toBe("approved");
    expect(created.isOwn).toBe(true);
    expect(created.body).toBe("Fresh honest comment");
  });

  test("reply requires a parent on the same video", async () => {
    const { bbb, sintel, demo } = await fixtures();
    const onBbb = await createComment(bbb.id, demo.id, "on bbb");
    let rejected = false;
    try {
      await createComment(sintel.id, demo.id, "bad parent", onBbb.id);
    } catch (e) {
      rejected = e instanceof ApiError && e.status === 400;
    }
    expect(rejected).toBe(true);
  });

  test("edit own comment; editing someone else's is forbidden", async () => {
    const { bbb, demo, pip } = await fixtures();
    const own = await createComment(bbb.id, demo.id, "will be edited");
    const edited = await editComment(own.id, demo.id, "edited body");
    expect(edited.body).toBe("edited body");
    expect(edited.edited).toBe(true);

    let forbidden = false;
    try {
      await editComment(own.id, pip.id, "hijack");
    } catch (e) {
      forbidden = e instanceof ApiError && e.status === 403;
    }
    expect(forbidden).toBe(true);
  });

  test("delete is soft (restorable) and disappears from the default view", async () => {
    const { bbb, demo } = await fixtures();
    const created = await createComment(bbb.id, demo.id, "to be deleted");
    await deleteComment(created.id, demo.id);
    const row = await (await import("../src/lib/db")).db.comment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.moderation).toBe("deleted"); // soft → undo toast can restore
    const page = await listComments(bbb.id, demo.id, "top");
    expect(page.items.find((c) => c.id === created.id)).toBeUndefined();
  });
});
