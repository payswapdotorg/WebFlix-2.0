/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — lane 2-c LIVE EVENTS behavior pins.
 *
 * Pins:
 *  - create: anonymous 401; past scheduledFor 400; within the 60s grace
 *    400; garbage date 400; valid create 200 (scheduled, roomId null,
 *    row-derived registrationCount 0, registered false for the caller).
 *  - PATCH: creator only (403 otherwise); validates like create; the
 *    scheduledFor future rule applies while "scheduled" — a terminal
 *    (canceled) row accepts a past date (the pinned update rule).
 *  - cancel: creator only; idempotent (re-cancel → 200, still canceled).
 *  - registrations: unique (eventId, userId) row — register → count 1;
 *    register twice → STILL 1; unregister → 0; unregister again → success;
 *    canceled events reject registration with 409; `registered` flips for
 *    the caller and is null for anonymous.
 *  - discovery: upcoming list orders by scheduledFor asc, excludes
 *    canceled; /mine is the creator's own events (any status, newest
 *    first, 401 anonymous); rate limits per RATE_LIMITS.eventRegister.
 *
 * The events table is room-less (global discovery), so beforeAll removes
 * THIS lane's own test-identity events from prior runs — no other file's
 * rows are touched (live-helpers no-wipe law, scoped to my own rows).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupLiveDb,
  hostCookie,
  viewerCookie,
  otherCookie,
  reqWithCookie,
  HOST_CLAIMS,
  VIEWER_CLAIMS,
  OTHER_CLAIMS,
  sessionUserOf,
} from "./live-helpers";
import { clearRateLimits } from "@/lib/youtube/cache";
import { ensureShadowUser } from "@/lib/watch/local-comments";

import { GET as listEventsRoute, POST as createEventRoute } from "@/app/api/live-events/route";
import { GET as mineRoute } from "@/app/api/live-events/mine/route";
import { GET as getEventRoute, PATCH as patchEventRoute } from "@/app/api/live-events/[id]/route";
import { POST as cancelRoute } from "@/app/api/live-events/[id]/cancel/route";
import { POST as registerRoute, DELETE as unregisterRoute } from "@/app/api/live-events/[id]/register/route";

setupLiveDb();

interface EventDtoJson {
  id: string;
  creatorId: string;
  creatorHandle: string;
  creatorName: string;
  title: string;
  description: string | null;
  scheduledFor: string;
  status: string;
  roomId: string | null;
  registrationCount: number;
  registered: boolean | null;
  createdAt: string;
}
interface EventJson {
  event?: EventDtoJson;
  events?: EventDtoJson[];
  error?: string;
  message?: string;
}

const eventsUrl = "http://test.local/api/live-events";
const eventUrl = (id: string) => `http://test.local/api/live-events/${id}`;
const cancelUrl = (id: string) => `http://test.local/api/live-events/${id}/cancel`;
const registerUrl = (id: string) => `http://test.local/api/live-events/${id}/register`;
const HOUR = 3_600_000;
const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString();

let db: (typeof import("@/lib/db"))["db"];
let host = "";
let viewer = "";
let other = "";
const hostUser = sessionUserOf(HOST_CLAIMS);
const viewerUser = sessionUserOf(VIEWER_CLAIMS);
const otherUser = sessionUserOf(OTHER_CLAIMS);

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  host = await hostCookie();
  viewer = await viewerCookie();
  other = await otherCookie();
  // Scoped re-run hygiene: drop only MY lane's prior-run event rows
  // (registrations cascade) so global discovery pins stay deterministic.
  const myShadowIds = await Promise.all(
    [hostUser, viewerUser, otherUser].map(async (u) => (await ensureShadowUser(u)).id),
  );
  await db.liveEvent.deleteMany({ where: { creatorId: { in: myShadowIds } } });
});

beforeEach(() => clearRateLimits());
afterAll(() => clearRateLimits());

describe("lane 2-c live events", () => {
  let eventAId = "";
  let eventBId = "";

  test("anonymous create → 401 unauthenticated", async () => {
    const res = await createEventRoute(
      reqWithCookie(eventsUrl, "", {
        method: "POST",
        body: { title: "No one", scheduledFor: futureIso(HOUR) },
      }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as EventJson).error).toBe("unauthenticated");
  });

  test("past scheduledFor → 400 invalid", async () => {
    const res = await createEventRoute(
      reqWithCookie(eventsUrl, host, {
        method: "POST",
        body: { title: "Time travel", scheduledFor: new Date(Date.now() - HOUR).toISOString() },
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as EventJson).error).toBe("invalid");
  });

  test("scheduledFor within the 60s grace → 400 invalid", async () => {
    const res = await createEventRoute(
      reqWithCookie(eventsUrl, host, {
        method: "POST",
        body: { title: "Too soon", scheduledFor: futureIso(15_000) },
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as EventJson).error).toBe("invalid");
  });

  test("garbage scheduledFor → 400 invalid", async () => {
    const res = await createEventRoute(
      reqWithCookie(eventsUrl, host, { method: "POST", body: { title: "NaN", scheduledFor: "not-a-date" } }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as EventJson).error).toBe("invalid");
  });

  test("valid create → 200 (scheduled, roomId null, count 0, registered false)", async () => {
    const res = await createEventRoute(
      reqWithCookie(eventsUrl, host, {
        method: "POST",
        body: { title: "  Lane 2-c premiere  ", description: "  the frozen contract, live  ", scheduledFor: futureIso(2 * HOUR) },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as EventJson;
    expect(json.event?.title).toBe("Lane 2-c premiere");
    expect(json.event?.description).toBe("the frozen contract, live");
    expect(json.event?.status).toBe("scheduled");
    expect(json.event?.roomId).toBeNull();
    expect(json.event?.registrationCount).toBe(0);
    expect(json.event?.registered).toBe(false);
    expect(json.event?.creatorHandle).not.toBe("");
    expect(json.event?.creatorName).not.toBe("");
    eventAId = json.event?.id ?? "";
    expect(eventAId).not.toBe("");
  });

  test("title bounds → 400 (empty and > EVENT_TITLE_MAX)", async () => {
    const empty = await createEventRoute(
      reqWithCookie(eventsUrl, host, { method: "POST", body: { title: "   ", scheduledFor: futureIso(HOUR) } }),
    );
    expect(empty.status).toBe(400);
    const long = await createEventRoute(
      reqWithCookie(eventsUrl, host, {
        method: "POST",
        body: { title: "x".repeat(141), scheduledFor: futureIso(HOUR) },
      }),
    );
    expect(long.status).toBe(400);
    expect(((await long.json()) as EventJson).error).toBe("invalid");
  });

  test("PATCH by non-creator → 403 forbidden", async () => {
    const res = await patchEventRoute(
      reqWithCookie(eventUrl(eventAId), viewer, { method: "PATCH", body: { title: "hijacked" } }),
      { params: Promise.resolve({ id: eventAId }) },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as EventJson).error).toBe("forbidden");
  });

  test("PATCH by creator OK (title + scheduledFor updated)", async () => {
    const newTime = futureIso(3 * HOUR);
    const res = await patchEventRoute(
      reqWithCookie(eventUrl(eventAId), host, {
        method: "PATCH",
        body: { title: "Renamed premiere", scheduledFor: newTime },
      }),
      { params: Promise.resolve({ id: eventAId }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as EventJson;
    expect(json.event?.title).toBe("Renamed premiere");
    expect(Math.abs(new Date(json.event?.scheduledFor ?? "").getTime() - new Date(newTime).getTime())).toBeLessThan(1000);
  });

  test("PATCH past scheduledFor while scheduled → 400 (future rule)", async () => {
    const res = await patchEventRoute(
      reqWithCookie(eventUrl(eventAId), host, {
        method: "PATCH",
        body: { scheduledFor: new Date(Date.now() - 24 * HOUR).toISOString() },
      }),
      { params: Promise.resolve({ id: eventAId }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as EventJson).error).toBe("invalid");
  });

  test("cancel by creator OK; idempotent (re-cancel → 200 still canceled)", async () => {
    const created = await createEventRoute(
      reqWithCookie(eventsUrl, host, {
        method: "POST",
        body: { title: "Doomed webinar", scheduledFor: futureIso(4 * HOUR) },
      }),
    );
    expect(created.status).toBe(200);
    eventBId = ((await created.json()) as EventJson).event?.id ?? "";

    const first = await cancelRoute(reqWithCookie(cancelUrl(eventBId), host, { method: "POST" }), {
      params: Promise.resolve({ id: eventBId }),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as EventJson).event?.status).toBe("canceled");

    const again = await cancelRoute(reqWithCookie(cancelUrl(eventBId), host, { method: "POST" }), {
      params: Promise.resolve({ id: eventBId }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as EventJson).event?.status).toBe("canceled");
  });

  test("PATCH a canceled event's scheduledFor into the past → 200 (terminal rule)", async () => {
    const res = await patchEventRoute(
      reqWithCookie(eventUrl(eventBId), host, {
        method: "PATCH",
        body: { scheduledFor: new Date(Date.now() - 2 * HOUR).toISOString() },
      }),
      { params: Promise.resolve({ id: eventBId }) },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as EventJson).event?.status).toBe("canceled");
  });

  test("register → count 1 (row-derived)", async () => {
    const res = await registerRoute(reqWithCookie(registerUrl(eventAId), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as EventJson;
    expect(json.event?.registered).toBe(true);
    expect(json.event?.registrationCount).toBe(1);
  });

  test("register twice → STILL count 1 (unique (eventId, userId) row)", async () => {
    const res = await registerRoute(reqWithCookie(registerUrl(eventAId), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as EventJson;
    expect(json.event?.registered).toBe(true);
    expect(json.event?.registrationCount).toBe(1);
  });

  test("unregister → count 0; unregister again → success", async () => {
    const first = await unregisterRoute(reqWithCookie(registerUrl(eventAId), viewer, { method: "DELETE" }), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as EventJson;
    expect(firstJson.event?.registered).toBe(false);
    expect(firstJson.event?.registrationCount).toBe(0);

    const again = await unregisterRoute(reqWithCookie(registerUrl(eventAId), viewer, { method: "DELETE" }), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(again.status).toBe(200);
    const againJson = (await again.json()) as EventJson;
    expect(againJson.event?.registered).toBe(false);
    expect(againJson.event?.registrationCount).toBe(0);
  });

  test("register on a canceled event → 409 conflict", async () => {
    const res = await registerRoute(reqWithCookie(registerUrl(eventBId), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: eventBId }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as EventJson).error).toBe("conflict");
  });

  test("`registered` flips for the caller and is null for anonymous", async () => {
    const reRegister = await registerRoute(reqWithCookie(registerUrl(eventAId), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(reRegister.status).toBe(200);

    const asViewer = await getEventRoute(reqWithCookie(eventUrl(eventAId), viewer), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(asViewer.status).toBe(200);
    const viewerJson = (await asViewer.json()) as EventJson;
    expect(viewerJson.event?.registered).toBe(true);
    expect(viewerJson.event?.registrationCount).toBe(1);

    const asAnonymous = await getEventRoute(reqWithCookie(eventUrl(eventAId), ""), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(asAnonymous.status).toBe(200);
    const anonJson = (await asAnonymous.json()) as EventJson;
    expect(anonJson.event?.registered).toBeNull();
    expect(anonJson.event?.registrationCount).toBe(1);

    const asHost = await getEventRoute(reqWithCookie(eventUrl(eventAId), host), {
      params: Promise.resolve({ id: eventAId }),
    });
    expect(((await asHost.json()) as EventJson).event?.registered).toBe(false);
  });

  test("GET a missing event → 404 not-found", async () => {
    const res = await getEventRoute(reqWithCookie(eventUrl("event-does-not-exist"), viewer), {
      params: Promise.resolve({ id: "event-does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  test("mine: 401 anonymous; creator's own events (any status, newest first)", async () => {
    const anon = await mineRoute(reqWithCookie(`http://test.local/api/live-events/mine`, ""));
    expect(anon.status).toBe(401);

    const res = await mineRoute(reqWithCookie("http://test.local/api/live-events/mine", host));
    expect(res.status).toBe(200);
    const json = (await res.json()) as EventJson;
    const mine = (json.events ?? []).filter((e) => [eventAId, eventBId].includes(e.id));
    expect(mine.map((e) => e.id).sort()).toEqual([eventAId, eventBId].sort());
    // newest first: eventB was created after eventA
    expect(mine[0]?.id).toBe(eventBId);
    expect(mine.map((e) => e.status).sort()).toEqual(["canceled", "scheduled"].sort());

    // another creator's events never leak into mine
    const viewerMine = await mineRoute(reqWithCookie("http://test.local/api/live-events/mine", viewer));
    const viewerJson = (await viewerMine.json()) as EventJson;
    expect((viewerJson.events ?? []).some((e) => e.id === eventAId)).toBe(false);
  });

  test("upcoming list orders by scheduledFor asc and excludes canceled", async () => {
    // e0 gets canceled (must not appear); e1..e3 stay scheduled
    const e0 = await createEventRoute(
      reqWithCookie(eventsUrl, viewer, {
        method: "POST",
        body: { title: "cancel me", scheduledFor: futureIso(0.5 * HOUR) },
      }),
    );
    expect(e0.status).toBe(200);
    const e0Id = ((await e0.json()) as EventJson).event?.id ?? "";
    const canceled = await cancelRoute(reqWithCookie(cancelUrl(e0Id), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: e0Id }),
    });
    expect(canceled.status).toBe(200);

    const ids: string[] = [];
    for (const [title, ms] of [
      ["upcoming one", 1 * HOUR],
      ["upcoming two", 2 * HOUR],
      ["upcoming three", 3 * HOUR],
    ] as const) {
      const res = await createEventRoute(
        reqWithCookie(eventsUrl, host, { method: "POST", body: { title, scheduledFor: futureIso(ms) } }),
      );
      expect(res.status).toBe(200);
      ids.push(((await res.json()) as EventJson).event?.id ?? "");
    }
    // the viewer registers for the middle one (list carries per-caller flags)
    const reg = await registerRoute(reqWithCookie(registerUrl(ids[1] ?? ""), viewer, { method: "POST" }), {
      params: Promise.resolve({ id: ids[1] ?? "" }),
    });
    expect(reg.status).toBe(200);

    // anonymous discovery: scheduled-only, scheduledFor asc
    const list = await listEventsRoute(reqWithCookie(eventsUrl, ""));
    expect(list.status).toBe(200);
    const listJson = (await list.json()) as EventJson;
    const mine = (listJson.events ?? []).filter((e) => ids.includes(e.id));
    expect(mine.map((e) => e.id)).toEqual(ids);
    expect(mine.every((e) => e.status === "scheduled")).toBe(true);
    expect(listJson.events?.some((e) => e.id === e0Id)).toBe(false);
    expect(mine.every((e) => e.registered === null)).toBe(true);
    expect(mine.find((e) => e.id === ids[1])?.registrationCount).toBe(1);

    // caller-scoped flags on the same list
    const listView = await listEventsRoute(reqWithCookie(eventsUrl, viewer));
    const listViewJson = (await listView.json()) as EventJson;
    const mineView = (listViewJson.events ?? []).filter((e) => ids.includes(e.id));
    expect(mineView.find((e) => e.id === ids[0])?.registered).toBe(false);
    expect(mineView.find((e) => e.id === ids[1])?.registered).toBe(true);
    expect(mineView.find((e) => e.id === ids[2])?.registered).toBe(false);
  });

  test("register rate limit → 429 (RATE_LIMITS.eventRegister = 20)", async () => {
    const created = await createEventRoute(
      reqWithCookie(eventsUrl, other, {
        method: "POST",
        body: { title: "RL event", scheduledFor: futureIso(5 * HOUR) },
      }),
    );
    expect(created.status).toBe(200);
    const rlEventId = ((await created.json()) as EventJson).event?.id ?? "";
    const ctx = { params: Promise.resolve({ id: rlEventId }) };
    for (let i = 0; i < 20; i++) {
      const res = await registerRoute(reqWithCookie(registerUrl(rlEventId), viewer, { method: "POST" }), ctx);
      expect(res.status).toBe(200);
    }
    const twentyFirst = await registerRoute(
      reqWithCookie(registerUrl(rlEventId), viewer, { method: "POST" }),
      ctx,
    );
    expect(twentyFirst.status).toBe(429);
    expect(((await twentyFirst.json()) as EventJson).error).toBe("rate-limited");
  });
});
