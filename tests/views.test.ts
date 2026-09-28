/**
 * WFX2-W tests — view-count dedupe window (per user+video per hour).
 * Each test uses its own user to stay order-independent.
 */
import { describe, expect, test } from "bun:test";
import { setupTestDb, fixtures } from "./helpers";
import { registerView } from "../src/lib/watch/video-service";
import { db } from "../src/lib/db";

setupTestDb();

const HOUR = 3_600_000;

describe("view counting (deduped per user+video per hour)", () => {
  test("first view counts and creates the ViewEvent", async () => {
    const { sintel, mocapmike } = await fixtures();
    const before = (await db.video.findUniqueOrThrow({ where: { id: sintel.id } })).views;
    const r = await registerView(sintel.id, mocapmike.id, new Date());
    expect(r.counted).toBe(true);
    expect(r.views).toBe(before + 1);
    const events = await db.viewEvent.findMany({
      where: { videoId: sintel.id, userId: mocapmike.id },
    });
    expect(events.length).toBe(1);
  });

  test("second view within the hour does NOT increment", async () => {
    const { sintel, gwenwatches } = await fixtures();
    const t0 = new Date();
    await registerView(sintel.id, gwenwatches.id, t0);
    const before = (await db.video.findUniqueOrThrow({ where: { id: sintel.id } })).views;
    const r = await registerView(sintel.id, gwenwatches.id, new Date(t0.getTime() + 30 * 60_000));
    expect(r.counted).toBe(false);
    expect(r.views).toBe(before);
  });

  test("view after the 1h window increments again; progress saves don't extend the window", async () => {
    const { sintel, pip } = await fixtures();
    const t0 = new Date(Date.now() - 2 * HOUR); // 2h ago
    await registerView(sintel.id, pip.id, t0);
    // a progress save (should not bump `at`)
    await db.viewEvent.update({
      where: { videoId_userId: { videoId: sintel.id, userId: pip.id } },
      data: { lastPositionSec: 42, watchedSec: 42 },
    });
    const before = (await db.video.findUniqueOrThrow({ where: { id: sintel.id } })).views;
    // 59 minutes after t0 (progress didn't move the anchor) → still deduped
    const dedupe = await registerView(sintel.id, pip.id, new Date(t0.getTime() + 59 * 60_000));
    expect(dedupe.counted).toBe(false);
    // 61 minutes → fresh view
    const fresh = await registerView(sintel.id, pip.id, new Date(t0.getTime() + 61 * 60_000));
    expect(fresh.counted).toBe(true);
    expect(fresh.views).toBe(before + 1);
    // resume position survived the fresh view registration
    const event = await db.viewEvent.findUniqueOrThrow({
      where: { videoId_userId: { videoId: sintel.id, userId: pip.id } },
    });
    expect(event.lastPositionSec).toBe(42);
  });

  test("different users each get their own view", async () => {
    const { sintel, mocapmike, demo } = await fixtures();
    const before = (await db.video.findUniqueOrThrow({ where: { id: sintel.id } })).views;
    const r1 = await registerView(sintel.id, mocapmike.id, new Date(Date.now() + 5 * HOUR));
    const r2 = await registerView(sintel.id, demo.id, new Date(Date.now() + 5 * HOUR));
    expect(r1.counted).toBe(true);
    expect(r2.counted).toBe(true); // demo's seed event is 2h old → outside the window
    expect(r2.views).toBe(before + 2);
  });
});
