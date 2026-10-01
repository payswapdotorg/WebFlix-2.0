/**
 * WFX2-P4-PE app-side tests — the playlist-edit flow at the API + UI seam
 * (the upload-flow.test.ts / action-routes.test.ts idiom: routes with the
 * broker MOCKED at the seam — no network, no live CDP):
 *
 *  - PATCH /api/playlists/[id] (the rename + privacy switch + description
 *    edit): auth gate, body validation (special lists refused; empty title;
 *    at-least-one-field), the happy path (broker playlist-update with only
 *    the present fields), the honest verified:false path (the dialog closed
 *    but the header did not re-render), the broker-offline path (502 with
 *    the honest message), and the broker-action-failed path (the broker's
 *    stage-accurate error rides the response)
 *  - POST /api/playlists/[id]/reorder: the same ladder (auth, validation,
 *    happy path, verified:false, broker-offline 502, broker-action-failed)
 *  - the action-proxy helpers (proxyPlaylistUpdate + proxyPlaylistReorder):
 *    the field map + the verified/unverified flags + the unverifiedNote
 *    propagation; the broker-call shape (only the present fields ride the
 *    payload)
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";

/* ------------------------------------------------------------------ */
/* capture the REAL broker module before the mock replaces it           */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realBroker = { ...require("@/lib/broker") } as Record<string, unknown>;

class MockBrokerError extends Error {
  kind: string;
  status: number;
  detail?: unknown;
  constructor(kind: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const brokerCalls: { kind: string; target: unknown; payload: unknown }[] = [];
let brokerResponse: unknown = { ok: true, verified: true, path: "ui" };

mock.module("@/lib/broker", () => ({
  BROKER_OFFLINE_MESSAGE: "action backend offline — the lead's broker must be running",
  BrokerError: MockBrokerError,
  brokerAction: async (kind: string, target: unknown, payload?: unknown) => {
    brokerCalls.push({ kind, target, payload });
    return typeof brokerResponse === "function"
      ? brokerResponse({ kind, target, payload })
      : brokerResponse;
  },
  brokerOk: (r: unknown) => !(r instanceof MockBrokerError),
  brokerUrl: () => "http://127.0.0.1:3055",
  brokerSecret: () => "s3cret",
  brokerConfigured: () => true,
  brokerTimeoutMs: () => 15000,
}));

/* routes + helpers (imported AFTER the mocks) */
import { PATCH as patchPlaylist, DELETE as deletePlaylist } from "@/app/api/playlists/[id]/route";
import { POST as postReorder } from "@/app/api/playlists/[id]/reorder/route";
import {
  proxyPlaylistUpdate,
  proxyPlaylistReorder,
} from "@/lib/watch/action-proxy";
import { mintSessionCookie } from "./helpers";

const OFFLINE_MSG = "action backend offline — the lead's broker must be running";

let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie();
});

beforeEach(() => {
  brokerCalls.length = 0;
  brokerResponse = { ok: true, verified: true, path: "ui" };
});

afterAll(() => {
  mock.module("@/lib/broker", () => realBroker);
});

/* ------------------------------------------------------------------ */
/* shared request helpers                                              */
/* ------------------------------------------------------------------ */

const patchReq = (id: string, body: unknown): NextRequest =>
  new Request(`http://localhost/api/playlists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const reorderReq = (id: string, body: unknown): NextRequest =>
  new Request(`http://localhost/api/playlists/${id}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/* ------------------------------------------------------------------ */
/* PATCH /api/playlists/[id] — the rename + privacy switch drive       */
/* ------------------------------------------------------------------ */

describe("PATCH /api/playlists/[id] — the playlist-update drive (broker mocked)", () => {
  test("guest → 401 before any broker call", async () => {
    const res = await patchPlaylist(
      new Request("http://localhost/api/playlists/PLx", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "X" }),
      }) as unknown as NextRequest,
      ctx("PLx")
    );
    expect(res.status).toBe(401);
    expect(brokerCalls).toHaveLength(0);
  });

  test("invalid playlist id → 400 before any broker call", async () => {
    const res = await patchPlaylist(patchReq("bad id!", { title: "X" }), ctx("bad id!"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("special lists (WL/LL) → 400 (YouTube's own lists cannot be edited)", async () => {
    const res = await patchReq_WL();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("YouTube's own lists");
    expect(brokerCalls).toHaveLength(0);

    async function patchReq_WL() {
      return patchPlaylist(patchReq("WL", { title: "X" }), ctx("WL"));
    }
  });

  test("no fields in the body → 400 (at least one required)", async () => {
    const res = await patchPlaylist(patchReq("PLx", {}), ctx("PLx"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("at least one of");
    expect(brokerCalls).toHaveLength(0);
  });

  test("empty title → 400", async () => {
    const res = await patchPlaylist(patchReq("PLx", { title: "   " }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("happy path: title only → broker playlist-update with only title; verified:true", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "updated" } };
    const res = await patchPlaylist(patchReq("PLx", { title: "Renamed" }), ctx("PLx"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      fields: { title: boolean; description: boolean; visibility: boolean };
      verified: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("playlist-updated");
    expect(body.fields).toEqual({ title: true, description: false, visibility: false });
    expect(body.verified).toBe(true);
    expect(brokerCalls).toEqual([
      { kind: "playlist-update", target: { playlistId: "PLx" }, payload: { title: "Renamed" } },
    ]);
  });

  test("title + visibility together → both ride the payload", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "updated" } };
    const res = await patchPlaylist(
      patchReq("PLx", { title: "New", visibility: "unlisted" }),
      ctx("PLx")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: { title: boolean; description: boolean; visibility: boolean } };
    expect(body.fields).toEqual({ title: true, description: false, visibility: true });
    expect(brokerCalls[0].payload).toEqual({ title: "New", visibility: "unlisted" });
  });

  test("non-canonical visibility → dropped (the route refuses it before the broker)", async () => {
    const res = await patchPlaylist(
      patchReq("PLx", { visibility: "friends-only" }),
      ctx("PLx")
    );
    // visibility is dropped → no fields → 400
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("honest verified:false (dialog closed but header did not re-render) → unverifiedNote rides the response", async () => {
    brokerResponse = {
      ok: true,
      verified: false,
      path: "ui",
      detail: {
        stage: "updated-unverified",
        note: "the edit dialog closed after Save but the header did not re-render the new title within the deadline",
      },
    };
    const res = await patchPlaylist(patchReq("PLx", { title: "Renamed" }), ctx("PLx"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; verified: boolean; unverifiedNote?: string };
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.unverifiedNote).toContain("did not re-render");
  });

  test("already:true (no fields changed) → effect playlist-update-noop", async () => {
    brokerResponse = { ok: true, verified: true, already: true, path: "ui" };
    // the route enforces "at least one field", so the already:true path
    // is reachable only when the broker itself reports already (the drive
    // found nothing to change after the route's payload passed)
    const res = await patchPlaylist(patchReq("PLx", { title: "Same" }), ctx("PLx"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { effect: string; already?: boolean };
    expect(body.effect).toBe("playlist-update-noop");
    expect(body.already).toBe(true);
  });

  test("broker OFFLINE → 502 with the honest offline message", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });

  test("broker ACTION-FAILED → 502 with the broker's stage-accurate error", async () => {
    brokerResponse = new MockBrokerError(
      "action-failed",
      "playlist-edit-dialog-not-found",
      502
    );
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("playlist-edit-dialog-not-found");
  });

  test("broker BAD-REQUEST → 400 (the route's fail mapping)", async () => {
    brokerResponse = new MockBrokerError("bad-request", "playlist-not-found", 400);
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("playlist-not-found");
  });

  test("non-JSON body → 400", async () => {
    const res = await patchPlaylist(
      new Request("http://localhost/api/playlists/PLx", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: AUTH_COOKIE },
        body: "not-json",
      }) as unknown as NextRequest,
      ctx("PLx")
    );
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/playlists/[id]/reorder — the playlist-reorder drive       */
/* ------------------------------------------------------------------ */

describe("POST /api/playlists/[id]/reorder — the reorder drive (broker mocked)", () => {
  test("guest → 401 before any broker call", async () => {
    const res = await postReorder(
      new Request("http://localhost/api/playlists/PLx/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIndex: 0, toIndex: 1 }),
      }) as unknown as NextRequest,
      ctx("PLx")
    );
    expect(res.status).toBe(401);
    expect(brokerCalls).toHaveLength(0);
  });

  test("invalid playlist id → 400 before any broker call", async () => {
    const res = await postReorder(reorderReq("bad id!", { fromIndex: 0, toIndex: 1 }), ctx("bad id!"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("special lists (WL/LL) → 400 (YouTube's own lists cannot be reordered)", async () => {
    const res = await postReorder(reorderReq("LL", { fromIndex: 0, toIndex: 1 }), ctx("LL"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("YouTube's own lists");
    expect(brokerCalls).toHaveLength(0);
  });

  test("missing fromIndex or toIndex → 400", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: 0 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("negative index → 400", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: -1, toIndex: 1 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("fromIndex === toIndex → 400 (must differ)", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: 1, toIndex: 1 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(brokerCalls).toHaveLength(0);
  });

  test("happy path: fromIndex/toIndex/videoId → broker playlist-reorder; verified:true", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "reordered" } };
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 0, toIndex: 2, videoId: "dQw4w9WgXcQ" }),
      ctx("PLx")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      verified: boolean;
      fromIndex: number;
      toIndex: number;
      videoId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("playlist-reordered");
    expect(body.verified).toBe(true);
    expect(body.fromIndex).toBe(0);
    expect(body.toIndex).toBe(2);
    expect(body.videoId).toBe("dQw4w9WgXcQ");
    expect(brokerCalls).toEqual([
      {
        kind: "playlist-reorder",
        target: { playlistId: "PLx" },
        payload: { fromIndex: 0, toIndex: 2, videoId: "dQw4w9WgXcQ" },
      },
    ]);
  });

  test("videoId omitted → still works (the verification aid is optional)", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "reordered" } };
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 1, toIndex: 0 }),
      ctx("PLx")
    );
    expect(res.status).toBe(200);
    expect(brokerCalls[0].payload).toEqual({ fromIndex: 1, toIndex: 0 });
  });

  test("honest verified:false (drop fired but order not confirmed) → unverifiedNote rides the response", async () => {
    brokerResponse = {
      ok: true,
      verified: false,
      path: "ui",
      detail: {
        stage: "reorder-unverified",
        note: "the drag gesture fired (pointerup landed on the target row) but the list did not re-render the new order within the deadline",
      },
    };
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 0, toIndex: 2, videoId: "dQw4w9WgXcQ" }),
      ctx("PLx")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; verified: boolean; unverifiedNote?: string };
    expect(body.ok).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.unverifiedNote).toContain("did not re-render");
  });

  test("broker OFFLINE → 502 with the honest offline message", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 0, toIndex: 1 }),
      ctx("PLx")
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(OFFLINE_MSG);
  });

  test("broker ACTION-FAILED (playlist-drag-handle-not-found — read-only playlist) → 502", async () => {
    brokerResponse = new MockBrokerError(
      "action-failed",
      "playlist-drag-handle-not-found",
      502
    );
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 0, toIndex: 1 }),
      ctx("PLx")
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("playlist-drag-handle-not-found");
  });

  test("broker ACTION-FAILED (playlist-item-not-found — fromIndex out of range) → 502", async () => {
    brokerResponse = new MockBrokerError(
      "action-failed",
      "playlist-item-not-found",
      502
    );
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 99, toIndex: 0 }),
      ctx("PLx")
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("playlist-item-not-found");
  });
});

/* ------------------------------------------------------------------ */
/* the action-proxy helpers (the field map + verified/unverified flags) */
/* ------------------------------------------------------------------ */

describe("proxyPlaylistUpdate — the field map + verified/unverified flags", () => {
  test("only the present fields ride the broker payload", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "updated" } };
    const r = await proxyPlaylistUpdate("PLx", { title: "T" });
    expect(r.fields).toEqual({ title: true, description: false, visibility: false });
    expect(brokerCalls[0].payload).toEqual({ title: "T" });
  });

  test("all three fields → the field map is all-true; the payload carries all three", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "updated" } };
    const r = await proxyPlaylistUpdate("PLx", {
      title: "T",
      description: "D",
      visibility: "public",
    });
    expect(r.fields).toEqual({ title: true, description: true, visibility: true });
    expect(brokerCalls[0].payload).toEqual({ title: "T", description: "D", visibility: "public" });
  });

  test("verified:false + note → unverifiedNote rides the result", async () => {
    brokerResponse = {
      ok: true,
      verified: false,
      path: "ui",
      detail: { stage: "updated-unverified", note: "the header lag" },
    };
    const r = await proxyPlaylistUpdate("PLx", { title: "T" });
    expect(r.verified).toBe(false);
    expect(r.unverifiedNote).toBe("the header lag");
  });

  test("already:true → effect playlist-update-noop + already flag", async () => {
    brokerResponse = { ok: true, verified: true, already: true, path: "ui" };
    const r = await proxyPlaylistUpdate("PLx", { title: "Same" });
    expect(r.effect).toBe("playlist-update-noop");
    expect(r.already).toBe(true);
  });

  test("broker offline → ApiError 502 (the routes map it to the honest response)", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    await expect(proxyPlaylistUpdate("PLx", { title: "T" })).rejects.toThrow(OFFLINE_MSG);
  });

  test("broker bad-request → ApiError 400", async () => {
    brokerResponse = new MockBrokerError("bad-request", "playlist-not-found", 400);
    await expect(proxyPlaylistUpdate("PLx", { title: "T" })).rejects.toThrow("playlist-not-found");
  });
});

describe("proxyPlaylistReorder — the fromIndex/toIndex/videoId shape", () => {
  test("fromIndex + toIndex + videoId ride the payload", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "reordered" } };
    const r = await proxyPlaylistReorder("PLx", 0, 2, "dQw4w9WgXcQ");
    expect(r.verified).toBe(true);
    expect(r.fromIndex).toBe(0);
    expect(r.toIndex).toBe(2);
    expect(r.videoId).toBe("dQw4w9WgXcQ");
    expect(brokerCalls[0].payload).toEqual({ fromIndex: 0, toIndex: 2, videoId: "dQw4w9WgXcQ" });
  });

  test("videoId omitted → payload carries only fromIndex + toIndex", async () => {
    brokerResponse = { ok: true, verified: true, path: "ui", detail: { stage: "reordered" } };
    await proxyPlaylistReorder("PLx", 1, 0);
    expect(brokerCalls[0].payload).toEqual({ fromIndex: 1, toIndex: 0 });
  });

  test("verified:false + note → unverifiedNote rides the result", async () => {
    brokerResponse = {
      ok: true,
      verified: false,
      path: "ui",
      detail: { stage: "reorder-unverified", note: "the list lag" },
    };
    const r = await proxyPlaylistReorder("PLx", 0, 1, "vid");
    expect(r.verified).toBe(false);
    expect(r.unverifiedNote).toBe("the list lag");
  });

  test("broker offline → ApiError 502", async () => {
    brokerResponse = new MockBrokerError("offline", OFFLINE_MSG, 502);
    await expect(proxyPlaylistReorder("PLx", 0, 1)).rejects.toThrow(OFFLINE_MSG);
  });
});
