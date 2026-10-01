/// <reference types="bun-types" />
/**
 * WFX2-P4-NC tests — the notification center battery, mocked at the
 * InnerTube seam (the personal-routes / auth-gating pattern — NEVER the
 * network):
 *
 *  - the CENTER ROUTE CONTRACT: guests 401; signed-in 200 with the
 *    unread-first ordering, honest pagination (server-side slices of the
 *    TRUE items), the shared { unread, pollIntervalMs, loginRequired,
 *    session } flags, and the bell's menu contract byte-identical
 *    (the additive-only regression guard);
 *  - the per-item READ FLOW: POST /api/notifications/[id]/read — the menu
 *    re-read choice (cache-bypassed §12-verified endpoint), the honest
 *    upstreamWrite: false disclosure, 404 for unknown ids;
 *  - the GUEST GATE + the EMPTY STATE (the public promo → loginRequired,
 *    zero is valid);
 *  - HONEST DEGRADATION: upstream down → the honest 502, never fake items;
 *  - the LOCAL READ OVERLAY: the per-item view-state semantics (effective
 *    read, the badge decrement, reconciliation against fresh feeds).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { mintSessionCookie } from "./helpers";

import { GET as centerRoute } from "@/app/api/notifications/center/route";
import { POST as itemReadRoute } from "@/app/api/notifications/[id]/read/route";
import { GET as menuRoute } from "@/app/api/notifications/route";
import {
  clampCenterPaging,
  orderNotificationsUnreadFirst,
  pageNotifications,
} from "@/lib/youtube/notifications";
import { effectiveRead, effectiveUnread, useLocalRead } from "@/app/notifications/local-read-store";
import type { NotificationDTO } from "@/lib/types";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie();
});

const guestReq = (url: string, init?: RequestInit): never => new Request(url, init) as never;
const authedReq = (url: string, init?: RequestInit): never =>
  new Request(url, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), cookie: AUTH_COOKIE },
  }) as never;

interface Recorded {
  method: string;
  url: string;
  body: any;
}

/** Fixture-backed upstream: session mode serves the synth items menu (3
 * items, 2 unread), public mode serves the real public captures (the
 * "Your notifications live here" promo + unseen 0). */
function fixtureUpstream() {
  const recorded: Recorded[] = [];
  const notifMenuItems = load("notification_menu_items_synth");
  const notifMenu = load("notification_menu_public");
  const notifUnseen = load("notification_unseen_public");
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    if (url.includes("/youtubei/v1/notification/get_notification_menu")) return json(notifMenuItems);
    if (url.includes("/youtubei/v1/notification/get_unseen_count")) return json(notifUnseen);
    return new Response("not found", { status: 404 });
  };
  const implPublic = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    recorded.push({ method: init?.method ?? "GET", url, body });
    if (url.includes("/youtubei/v1/notification/get_notification_menu")) return json(notifMenu);
    if (url.includes("/youtubei/v1/notification/get_unseen_count")) return json(notifUnseen);
    return new Response("not found", { status: 404 });
  };
  const implDown = async (url: string, init?: RequestInit): Promise<Response> => {
    recorded.push({ method: init?.method ?? "GET", url, body: null });
    if (url.includes("/youtubei/v1/notification/")) {
      return new Response("upstream down", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  };
  return { impl, implPublic, implDown, recorded };
}

let upstream: ReturnType<typeof fixtureUpstream>;

beforeEach(() => {
  clearCache();
  upstream = fixtureUpstream();
  useLocalRead.getState().reset();
  process.env.YT_COOKIES = "SAPISID=fixture; SID=fixture"; // session mode default
});

afterEach(() => {
  setUpstream(null);
  delete process.env.YT_COOKIES;
});

// ---------------------------------------------------------------------------

describe("the center's honest ordering + paging primitives (lib)", () => {
  const n = (id: string, read: boolean): NotificationDTO => ({
    id,
    kind: "video",
    title: "title",
    body: "body",
    read,
    createdAt: new Date().toISOString(),
    videoId: "v",
    videoThumbnailUrl: null,
    channel: { id: "c", handle: "@h", name: "n", avatarUrl: "", verified: false, subscriberCount: 0 },
  });

  test("orderNotificationsUnreadFirst — stable partition, upstream order kept within groups", () => {
    const items = [n("a", false), n("b", true), n("c", false), n("d", true), n("e", false)];
    expect(orderNotificationsUnreadFirst(items).map((i) => i.id)).toEqual(["a", "c", "e", "b", "d"]);
    expect(orderNotificationsUnreadFirst([])).toEqual([]);
    // input is not mutated
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("pageNotifications — honest slices + hasMore boundaries", () => {
    const items = [n("a", false), n("b", false), n("c", true)];
    expect(pageNotifications(items, 1, 2)).toEqual({ items: [items[0], items[1]], hasMore: true });
    expect(pageNotifications(items, 2, 2)).toEqual({ items: [items[2]], hasMore: false });
    expect(pageNotifications(items, 3, 2)).toEqual({ items: [], hasMore: false });
    expect(pageNotifications(items, 1, 50)).toEqual({ items, hasMore: false });
  });

  test("clampCenterPaging — defaults + the honest bounds", () => {
    expect(clampCenterPaging(null, null)).toEqual({ page: 1, pageSize: 50 });
    expect(clampCenterPaging("2", "10")).toEqual({ page: 2, pageSize: 10 });
    expect(clampCenterPaging("0", "999")).toEqual({ page: 1, pageSize: 100 });
    expect(clampCenterPaging("-3", "abc")).toEqual({ page: 1, pageSize: 50 });
  });
});

describe("GET /api/notifications/center — the route contract", () => {
  test("guests → the uniform 401 (the gate fires before any upstream call)", async () => {
    setUpstream(upstream.impl);
    const res = await centerRoute(guestReq("http://localhost/api/notifications/center"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe("unauthenticated");
    expect(upstream.recorded).toHaveLength(0);
  });

  test("signed-in → 200: unread-first, the shared flags, the paging fields", async () => {
    setUpstream(upstream.impl);
    const res = await centerRoute(authedReq("http://localhost/api/notifications/center"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // unread-first ordering: the two unread items (upstream order) then the read one
    expect(data.items.map((i: any) => i.id)).toEqual(["ntf_synth_001", "ntf_synth_003", "ntf_synth_002"]);
    expect(data.total).toBe(3);
    expect(data.unread).toBe(2);
    expect(data.loginRequired).toBe(false);
    expect(data.pollIntervalMs).toBe(1800000);
    expect(data.session).toBe(true);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(50);
    expect(data.hasMore).toBe(false);
    // one shared cached call per endpoint (the same read path as the bell)
    expect(
      upstream.recorded.filter((r) => r.url.includes("notification/get_notification_menu"))
    ).toHaveLength(1);
    expect(
      upstream.recorded.filter((r) => r.url.includes("notification/get_unseen_count"))
    ).toHaveLength(1);
  });

  test("pagination — honest server-side slices of the TRUE items", async () => {
    setUpstream(upstream.impl);
    const p1 = (await (
      await centerRoute(authedReq("http://localhost/api/notifications/center?page=1&pageSize=2"))
    ).json()) as any;
    expect(p1.items.map((i: any) => i.id)).toEqual(["ntf_synth_001", "ntf_synth_003"]);
    expect(p1.hasMore).toBe(true);
    expect(p1.total).toBe(3);

    const p2 = (await (
      await centerRoute(authedReq("http://localhost/api/notifications/center?page=2&pageSize=2"))
    ).json()) as any;
    expect(p2.items.map((i: any) => i.id)).toEqual(["ntf_synth_002"]);
    expect(p2.hasMore).toBe(false);

    const p3 = (await (
      await centerRoute(authedReq("http://localhost/api/notifications/center?page=3&pageSize=2"))
    ).json()) as any;
    expect(p3.items).toEqual([]);
    expect(p3.hasMore).toBe(false);
  });

  test("out-of-bounds params are clamped, never fatal, never fabricating", async () => {
    setUpstream(upstream.impl);
    const res = await centerRoute(
      authedReq("http://localhost/api/notifications/center?page=0&pageSize=999")
    );
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(100);
    expect(data.items).toHaveLength(3);
  });

  test("the bell's menu contract stays byte-identical (additive-only guard)", async () => {
    setUpstream(upstream.impl);
    const res = await menuRoute(authedReq("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.unread).toBe(2);
    expect(data.items).toHaveLength(3);
    expect(data.pollIntervalMs).toBe(1800000);
    expect(data.loginRequired).toBe(false);
    expect(data.session).toBe(true);
  });
});

describe("POST /api/notifications/[id]/read — the per-item read flow (the menu re-read choice)", () => {
  test("guests → the uniform 401", async () => {
    setUpstream(upstream.impl);
    const res = await itemReadRoute(guestReq("http://localhost/api/notifications/x/read", { method: "POST" }), {
      params: Promise.resolve({ id: "ntf_synth_001" }),
    } as never);
    expect(res.status).toBe(401);
  });

  test("opening an item → the fresh upstream read state, honestly disclosed as NOT an upstream write", async () => {
    setUpstream(upstream.impl);
    // the center GET warms the shared cache first (one menu call) …
    await centerRoute(authedReq("http://localhost/api/notifications/center"));
    // … then the per-item re-read must BYPASS it (a second menu call)
    const res = await itemReadRoute(
      authedReq("http://localhost/api/notifications/ntf_synth_001/read", { method: "POST" }),
      { params: Promise.resolve({ id: "ntf_synth_001" }) } as never
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.id).toBe("ntf_synth_001");
    expect(data.read).toBe(false); // the honest upstream state (still unread there)
    expect(data.loginRequired).toBe(false);
    expect(data.upstreamWrite).toBe(false); // the disclosure
    expect(String(data.note)).toContain("menu re-read");
    expect(
      upstream.recorded.filter((r) => r.url.includes("notification/get_notification_menu"))
    ).toHaveLength(2);
  });

  test("an id the account's inbox does not carry → the honest 404", async () => {
    setUpstream(upstream.impl);
    const res = await itemReadRoute(
      authedReq("http://localhost/api/notifications/ntf_unknown/read", { method: "POST" }),
      { params: Promise.resolve({ id: "ntf_unknown" }) } as never
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("not found");
  });
});

describe("the empty + public states (honest — zero is valid)", () => {
  test("public menu → loginRequired with zero items (the promo data state)", async () => {
    delete process.env.YT_COOKIES;
    setUpstream(upstream.implPublic);
    const res = await centerRoute(authedReq("http://localhost/api/notifications/center"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.unread).toBe(0); // zero is valid
    expect(data.loginRequired).toBe(true);
    expect(data.hasMore).toBe(false);
    expect(data.session).toBe(false);
  });
});

describe("honest degradation (upstream down → the honest error, never fake items)", () => {
  test("center route → 502 with the error shape", async () => {
    setUpstream(upstream.implDown);
    const res = await centerRoute(authedReq("http://localhost/api/notifications/center"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Failed to load notifications");
  });

  test("per-item read route → 502 (never a synthesized read state)", async () => {
    setUpstream(upstream.implDown);
    const res = await itemReadRoute(
      authedReq("http://localhost/api/notifications/ntf_synth_001/read", { method: "POST" }),
      { params: Promise.resolve({ id: "ntf_synth_001" }) } as never
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Failed to refresh");
  });
});

describe("the local read overlay (the per-item view state)", () => {
  const n = (id: string, read: boolean): NotificationDTO => ({
    id,
    kind: "video",
    title: "title",
    body: "body",
    read,
    createdAt: new Date().toISOString(),
    videoId: "v",
    videoThumbnailUrl: null,
    channel: { id: "c", handle: "@h", name: "n", avatarUrl: "", verified: false, subscriberCount: 0 },
  });

  test("effectiveRead — upstream read OR opened this session", () => {
    const item = n("a", false);
    expect(effectiveRead(item, [])).toBe(false);
    expect(effectiveRead(item, ["a"])).toBe(true);
    expect(effectiveRead(n("b", true), [])).toBe(true);
  });

  test("the badge decrements — effectiveUnread, clamped at zero", () => {
    expect(effectiveUnread(2, [])).toBe(2);
    expect(effectiveUnread(2, ["a"])).toBe(1);
    expect(effectiveUnread(2, ["a", "b"])).toBe(0);
    expect(effectiveUnread(2, ["a", "b", "c"])).toBe(0); // never negative
  });

  test("markLocalRead is idempotent (no double-counting the badge)", () => {
    useLocalRead.getState().markLocalRead("a");
    useLocalRead.getState().markLocalRead("a");
    expect(useLocalRead.getState().readIds).toEqual(["a"]);
    expect(effectiveUnread(2, useLocalRead.getState().readIds)).toBe(1);
  });

  test("reconcile drops ids the fresh feed reads (or no longer carries), keeps the rest", () => {
    const { markLocalRead, reconcile } = useLocalRead.getState();
    markLocalRead("gone-read");
    markLocalRead("gone-missing");
    markLocalRead("still-unread");
    reconcile([n("gone-read", true), n("still-unread", false)]);
    expect(useLocalRead.getState().readIds).toEqual(["still-unread"]);
  });
});
