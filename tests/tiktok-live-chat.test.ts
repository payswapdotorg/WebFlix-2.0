/// <reference types="bun-types" />
/**
 * P100 — the watch-party chat battery (the durable lane): send gates
 * (session, validation, idempotency, rate limit), the cursor list law,
 * tombstone deletion, and the G20 law on roomKeys. The route contracts run
 * against the real test DB through the real session seam (the imports-test
 * pattern).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { clearRateLimits } from "@/lib/youtube/cache";
import {
  deleteOwnTikTokLiveChatMessage,
  listTikTokLiveChatMessages,
  sendTikTokLiveChatMessage,
  TIKTOK_LIVE_CHAT_BODY_MAX,
} from "@/lib/tiktok/live-chat";
import { mintSessionCookie, setupTestDb } from "./helpers";
import { db } from "../src/lib/db";

setupTestDb();

const PIP = { id: "u_wfx2_test", name: "Pip", email: "pip@webflix.test" };

function sessionUser(id = PIP.id): { id: string; name: string; email: string; displayName: string; avatarSeed: number } {
  return {
    id,
    name: id === PIP.id ? "Pip" : "Second Viewer",
    email: `${id}@webflix.test`,
    displayName: id === PIP.id ? "Pip" : "Second Viewer",
    avatarSeed: 7,
  };
}

async function cleanupRoom(roomKey = "lofigirl") {
  await db.tikTokLiveChatMessage.deleteMany({ where: { roomKey } });
}

beforeAll(async () => {
  await cleanupRoom();
});
afterAll(async () => {
  await cleanupRoom();
});

describe("sendTikTokLiveChatMessage — the send gates", () => {
  test("a signed-in send stores the message with its shadow sender", async () => {
    const dto = await sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-1", "first!");
    expect(dto.body).toBe("first!");
    expect(dto.deleted).toBe(false);
    expect(dto.roomKey).toBe("lofigirl");
    expect(dto.sender).not.toBeNull();
    expect(dto.duplicate).toBeFalsy();
  });

  test("a retried clientMessageId returns the ORIGINAL row with duplicate:true", async () => {
    const first = await sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-2", "hello");
    const retried = await sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-2", "hello");
    expect(retried.id).toBe(first.id);
    expect(retried.duplicate).toBe(true);
    // a DIFFERENT viewer may absolutely reuse the clientMessageId
    const other = await sendTikTokLiveChatMessage(sessionUser("u_second"), "lofigirl", "cm-2", "hi");
    expect(other.id).not.toBe(first.id);
    expect(other.duplicate).toBeFalsy();
  });

  test("empty and oversized bodies are 400s; the cap is exported for the client", async () => {
    await expect(sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-3", "")).rejects.toMatchObject({ status: 400 });
    await expect(sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-3", "   ")).rejects.toMatchObject({ status: 400 });
    await expect(
      sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-3", "x".repeat(TIKTOK_LIVE_CHAT_BODY_MAX + 1))
    ).rejects.toMatchObject({ status: 400 });
    expect(TIKTOK_LIVE_CHAT_BODY_MAX).toBe(500);
    // the cap itself passes and trims nothing away
    const dto = await sendTikTokLiveChatMessage(sessionUser(), "lofigirl", "cm-cap", "y".repeat(TIKTOK_LIVE_CHAT_BODY_MAX));
    expect(dto.body).toHaveLength(TIKTOK_LIVE_CHAT_BODY_MAX);
  });

  test("roomKeys ride the G20 law; truly-invalid rooms are 400s", async () => {
    const dto = await sendTikTokLiveChatMessage(sessionUser(), "@@LoFiGirl", "cm-g20", "sigil soup");
    expect(dto.roomKey).toBe("LoFiGirl"); // sigils strip; case rides (the G20 law)
    await expect(
      sendTikTokLiveChatMessage(sessionUser(), "bad handle!", "cm-bad", "hi")
    ).rejects.toMatchObject({ status: 400 });
    await expect(sendTikTokLiveChatMessage(sessionUser(), "", "cm-bad2", "hi")).rejects.toMatchObject({
      status: 400,
    });
  });

  test("the per-sender rate limit answers 429 at the route (the request-layer law)", async () => {
    clearRateLimits();
    const cookie = await mintSessionCookie({ sub: "u_ratelimit" });
    const { POST } = await import("@/app/api/tiktok/live/chat/[room]/route");
    const url = "http://localhost:3000/api/tiktok/live/chat/lofigirl";
    let hit429 = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await POST(
        new NextRequest(url, {
          method: "POST",
          body: JSON.stringify({ clientMessageId: `rl-${i}`, body: `msg ${i}` }),
          headers: { "Content-Type": "application/json", Cookie: cookie },
        }),
        { params: Promise.resolve({ room: "lofigirl" }) }
      );
      if (res.status === 429) {
        hit429 = true;
        break;
      }
    }
    expect(hit429).toBe(true);
  });
});

describe("listTikTokLiveChatMessages — the cursor law", () => {
  test("default answers the LATEST window in chronological order", async () => {
    await cleanupRoom("listing");
    for (let i = 1; i <= 5; i += 1) {
      await sendTikTokLiveChatMessage(sessionUser(), "listing", `cl-${i}`, `m${i}`);
    }
    const page = await listTikTokLiveChatMessages("listing", { limit: 3 });
    expect(page.items.map((m) => m.body)).toEqual(["m3", "m4", "m5"]);
    // nextCursor feeds the poller: everything AFTER the window's last row
    const newer = await listTikTokLiveChatMessages("listing", { after: page.nextCursor! });
    expect(newer.items).toHaveLength(0);
  });

  test("the after-cursor returns only newer rows, oldest first", async () => {
    await cleanupRoom("listing2");
    const dtos = [];
    for (let i = 1; i <= 4; i += 1) {
      dtos.push(await sendTikTokLiveChatMessage(sessionUser(), "listing2", `c2-${i}`, `m${i}`));
    }
    const page = await listTikTokLiveChatMessages("listing2", { after: dtos[1].id, limit: 10 });
    expect(page.items.map((m) => m.body)).toEqual(["m3", "m4"]);
  });

  test("tombstoned rows keep their place and render removed", async () => {
    await cleanupRoom("tombs");
    const a = await sendTikTokLiveChatMessage(sessionUser(), "tombs", "t-1", "will vanish");
    await sendTikTokLiveChatMessage(sessionUser(), "tombs", "t-2", "stays");
    const gone = await deleteOwnTikTokLiveChatMessage(sessionUser(), "tombs", a.id);
    expect(gone).toBe(true);
    const page = await listTikTokLiveChatMessages("tombs", { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0].deleted).toBe(true);
    expect(page.items[0].body).toBe("");
    expect(page.items[1].deleted).toBe(false);
  });

  test("delete-own is owner-only; strangers cannot tombstone", async () => {
    await cleanupRoom("own");
    const mine = await sendTikTokLiveChatMessage(sessionUser(), "own", "o-1", "mine");
    expect(await deleteOwnTikTokLiveChatMessage(sessionUser("u_stranger"), "own", mine.id)).toBe(false);
    expect(await deleteOwnTikTokLiveChatMessage(sessionUser(), "own", mine.id)).toBe(true);
    expect(await deleteOwnTikTokLiveChatMessage(sessionUser(), "own", "missing-id")).toBe(false);
  });
});

describe("the chat route contracts (real session seam)", () => {
  let PIP_COOKIE = "";

  beforeAll(async () => {
    PIP_COOKIE = await mintSessionCookie({ sub: "u_wfx2_test" });
    await db.tikTokLiveChatMessage.deleteMany({ where: { roomKey: "routetest" } });
  });

  function roomUrl(room = "routetest") {
    return `http://localhost:3000/api/tiktok/live/chat/${room}`;
  }

  test("a guest reads freely but sends hit the 401 (no hard eject happens here)", async () => {
    const { GET, POST } = await import("@/app/api/tiktok/live/chat/[room]/route");
    const get = await GET(new NextRequest(roomUrl()), { params: Promise.resolve({ room: "routetest" }) });
    expect(get.status).toBe(200);
    const post = await POST(
      new NextRequest(roomUrl(), {
        method: "POST",
        body: JSON.stringify({ clientMessageId: "guest-1", body: "hi" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    expect(post.status).toBe(401);
  });

  test("a signed-in POST stores through the real session and the GET serves it", async () => {
    const { GET, POST } = await import("@/app/api/tiktok/live/chat/[room]/route");
    const post = await POST(
      new NextRequest(roomUrl(), {
        method: "POST",
        body: JSON.stringify({ clientMessageId: "r-1", body: "from the cookie" }),
        headers: { "Content-Type": "application/json", Cookie: PIP_COOKIE },
      }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.message.body).toBe("from the cookie");

    const get = await GET(new NextRequest(roomUrl()), {
      params: Promise.resolve({ room: "routetest" }),
    });
    const list = await get.json();
    expect(list.items.at(-1).body).toBe("from the cookie");
  });

  test("bad JSON bodies answer 400 without crashing the route", async () => {
    const { POST } = await import("@/app/api/tiktok/live/chat/[room]/route");
    const res = await POST(
      new NextRequest(roomUrl(), {
        method: "POST",
        body: "not json at all",
        headers: { "Content-Type": "application/json", Cookie: PIP_COOKIE },
      }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    expect(res.status).toBe(400);
  });

  test("DELETE tombstones the caller's own message only", async () => {
    const { POST, DELETE } = await import("@/app/api/tiktok/live/chat/[room]/route");
    const post = await POST(
      new NextRequest(roomUrl(), {
        method: "POST",
        body: JSON.stringify({ clientMessageId: "d-1", body: "delete me" }),
        headers: { "Content-Type": "application/json", Cookie: PIP_COOKIE },
      }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    const { message } = await post.json();
    const del = await DELETE(
      new NextRequest(`${roomUrl()}?messageId=${message.id}`, { method: "DELETE", headers: { Cookie: PIP_COOKIE } }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    expect(del.status).toBe(200);
    const missing = await DELETE(
      new NextRequest(`${roomUrl()}?messageId=nope`, { method: "DELETE", headers: { Cookie: PIP_COOKIE } }),
      { params: Promise.resolve({ room: "routetest" }) }
    );
    expect(missing.status).toBe(404);
  });
});
