/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — shared LIVE lane test helpers.
 *
 * One SQLite file (db/live-test.db) pinned by `bun run test:live`; every
 * LIVE lane test file calls setupLiveDb() at the top and creates its OWN
 * rooms/sessions with unique titles — no cross-file state, no wipes (the
 * moderation/poll/chat audit rows of other files are simply untouched).
 * Routes are tested by calling their handlers directly with Requests that
 * carry a real minted session cookie (the tests/helpers.ts law — same
 * decode the gate performs, no network, no fake auth).
 */
import { beforeAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mintSessionCookie } from "./helpers";
import type { WebFlixSessionUser } from "@/lib/auth/types";

let ready = false;

/** Call at the top of every LIVE lane test file. */
export function setupLiveDb() {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? "";
    if (!url.includes("live-test")) {
      throw new Error(
        "Refusing to run against a non-LIVE database — run via `bun run test:live`",
      );
    }
    if (!ready) {
      const { db } = await import("../src/lib/db");
      const probe = await db.liveRoom.count().catch(() => null);
      if (probe === null) {
        const res = spawnSync(
          "bunx",
          ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--accept-data-loss", "--skip-generate"],
          { stdio: "inherit", env: process.env },
        );
        if (res.status !== 0) throw new Error("prisma db push failed for the live test database");
      }
      ready = true;
    }
  });
}

// ── identities (each sub maps to its own shadow User row) ──
export const HOST_CLAIMS = { sub: "u_wfx2_live_host", name: "Live Host", email: "live-host@webflix.test" };
export const VIEWER_CLAIMS = { sub: "u_wfx2_live_viewer", name: "Live Viewer", email: "live-viewer@webflix.test" };
export const MOD_CLAIMS = { sub: "u_wfx2_live_mod", name: "Live Mod", email: "live-mod@webflix.test" };
export const OTHER_CLAIMS = { sub: "u_wfx2_live_other", name: "Live Other", email: "live-other@webflix.test" };

export function sessionUserOf(claims: Record<string, unknown>): WebFlixSessionUser {
  return {
    id: String(claims.sub),
    email: String(claims.email ?? ""),
    displayName: String(claims.name ?? ""),
    avatarSeed: 3,
  };
}

export async function hostCookie(): Promise<string> {
  return mintSessionCookie(HOST_CLAIMS);
}
export async function viewerCookie(): Promise<string> {
  return mintSessionCookie(VIEWER_CLAIMS);
}
export async function modCookie(): Promise<string> {
  return mintSessionCookie(MOD_CLAIMS);
}
export async function otherCookie(): Promise<string> {
  return mintSessionCookie(OTHER_CLAIMS);
}

/** Request with the given cookie (route handlers are called directly). */
export function reqWithCookie(
  url: string,
  cookie: string,
  init?: { method?: string; body?: unknown },
): Request {
  return new Request(url, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Create a room owned by the given session identity (bypasses routes). */
export async function createRoomFixture(
  owner: WebFlixSessionUser,
  title?: string,
): Promise<{ roomId: string; hostShadowId: string }> {
  const { ensureShadowUser } = await import("../src/lib/watch/local-comments");
  const { db } = await import("../src/lib/db");
  const identity = await ensureShadowUser(owner);
  const room = await db.liveRoom.create({
    data: {
      hostId: identity.id,
      title: title ?? `Lane room ${crypto.randomUUID().slice(0, 8)}`,
      status: "idle",
      visibility: "public",
    },
  });
  return { roomId: room.id, hostShadowId: identity.id };
}

/** Start a live session on the room directly (no provider calls in tests). */
export async function startSessionFixture(roomId: string): Promise<{ sessionId: string; providerRoomId: string }> {
  const { db } = await import("../src/lib/db");
  const providerRoomId = `wfl-test-${crypto.randomUUID()}`;
  const session = await db.liveSession.create({
    data: {
      roomId,
      providerRoomId,
      provider: "livekit",
      status: "live",
      startedAt: new Date(),
    },
  });
  await db.liveRoom.update({ where: { id: roomId }, data: { status: "live" } });
  return { sessionId: session.id, providerRoomId };
}

/** End the room's live session directly (back to a terminal state). */
export async function endSessionFixture(roomId: string): Promise<void> {
  const { db } = await import("../src/lib/db");
  await db.liveSession.updateMany({
    where: { roomId, status: { not: "ended" } },
    data: { status: "ended", endedAt: new Date(), endReason: "host" },
  });
  await db.liveRoom.update({ where: { id: roomId }, data: { status: "ended" } });
}
