/**
 * WFX2-W tests — heart / pin / report state transitions.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import {
  heartComment,
  pinComment,
  reportComment,
  restoreComment,
  deleteComment,
  listComments,
} from "../src/lib/watch/comment-service";
import { db } from "../src/lib/db";
import { ApiError } from "../src/lib/watch/api";

setupTestDb();

describe("creator heart", () => {
  test("only the video channel's owner can heart; toggling flips state", async () => {
    const { bbb, demo, blenderStudioUser } = await fixtures();
    const target = await db.comment.findFirstOrThrow({
      where: { videoId: bbb.id, user: { handle: "gwenwatches" } },
    });
    let forbidden = false;
    try {
      await heartComment(target.id, demo.id);
    } catch (e) {
      forbidden = e instanceof ApiError && e.status === 403;
    }
    expect(forbidden).toBe(true);

    const on = await heartComment(target.id, blenderStudioUser.id);
    expect(on.heartedByCreator).toBe(true);
    const off = await heartComment(target.id, blenderStudioUser.id);
    expect(off.heartedByCreator).toBe(false);
  });

  test("hearted badge surfaces on the comment DTO", async () => {
    const { bbb, demo, blenderStudioUser } = await fixtures();
    const target = await db.comment.findFirstOrThrow({
      where: { videoId: bbb.id, user: { handle: "gwenwatches" } },
    });
    await heartComment(target.id, blenderStudioUser.id);
    const page = await listComments(bbb.id, demo.id, "top");
    const row = [...page.items, ...page.items.flatMap((c) => c.replies ?? [])].find(
      (c) => c.id === target.id
    );
    expect(row?.heartedByCreator).toBe(true);
  });
});

describe("creator pin", () => {
  test("pin toggles; pinned stays first in both sort modes", async () => {
    const { bbb, demo, blenderStudioUser } = await fixtures();
    const target = await db.comment.findFirstOrThrow({
      where: { videoId: bbb.id, user: { handle: "critic99" }, parentId: null, pinned: false },
    });
    // seed pin is on the blenderstudio comment; pin another one too
    const on = await pinComment(target.id, blenderStudioUser.id);
    expect(on.pinned).toBe(true);
    const top = await listComments(bbb.id, demo.id, "top");
    expect(top.items[0].pinned).toBe(true);
    const fresh = await listComments(bbb.id, demo.id, "new");
    expect(fresh.items[0].pinned).toBe(true);
    const off = await pinComment(target.id, blenderStudioUser.id);
    expect(off.pinned).toBe(false);
  });

  test("non-owner cannot pin", async () => {
    const { bbb, demo } = await fixtures();
    const target = await db.comment.findFirstOrThrow({
      where: { videoId: bbb.id, user: { handle: "pip" } },
    });
    let forbidden = false;
    try {
      await pinComment(target.id, demo.id);
    } catch (e) {
      forbidden = e instanceof ApiError && e.status === 403;
    }
    expect(forbidden).toBe(true);
  });
});

describe("report", () => {
  test("reporting flags the comment → disappears from the default view", async () => {
    const { bbb, demo } = await fixtures();
    const before = await listComments(bbb.id, demo.id, "top");
    const target = before.items.find((c) => !c.pinned)!;
    const r = await reportComment(target.id, demo.id);
    expect(r.flagged).toBe(true);
    const after = await listComments(bbb.id, demo.id, "top");
    expect(after.items.find((c) => c.id === target.id)).toBeUndefined();
    expect(after.total).toBe(before.total - 1);
  });
});

describe("delete → undo (restore)", () => {
  test("full state transition: deleted → invisible → restored → visible", async () => {
    const { bbb, demo } = await fixtures();
    const created = await (
      await import("../src/lib/watch/comment-service")
    ).createComment(bbb.id, demo.id, "undo me");
    await deleteComment(created.id, demo.id);
    let hidden = await listComments(bbb.id, demo.id, "top");
    expect(hidden.items.find((c) => c.id === created.id)).toBeUndefined();

    const restored = await restoreComment(created.id, demo.id);
    expect(restored.body).toBe("undo me");
    hidden = await listComments(bbb.id, demo.id, "top");
    expect(hidden.items.find((c) => c.id === created.id)).toBeDefined();
  });

  test("restore only works on deleted comments", async () => {
    const { bbb, demo } = await fixtures();
    const created = await (
      await import("../src/lib/watch/comment-service")
    ).createComment(bbb.id, demo.id, "still alive");
    let rejected = false;
    try {
      await restoreComment(created.id, demo.id);
    } catch (e) {
      rejected = e instanceof ApiError && e.status === 400;
    }
    expect(rejected).toBe(true);
  });
});
