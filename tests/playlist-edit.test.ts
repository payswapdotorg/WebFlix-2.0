/**
 * WFX2-P4-PE app-side tests → WFX2-P36 re-point — the playlist-edit flow at
 * the API + proxy seam (the official-actions adapter MOCKED at the seam — no
 * network, no live CDP):
 *
 *  - PATCH /api/playlists/[id] (the rename + privacy switch + description
 *    edit): the tier-gated OFFICIAL lane — playlists.update on the signed-in
 *    user's OWN OAuth connection (the real connection-store Map + real
 *    encryptSecret blobs, env-clean). The API's own response is the
 *    read-back, so verified:true rides the success; official failures map to
 *    the honest 502 taxonomy (quota / provider-rejected / provider-error).
 *    WFX2-P38: the not-connected pin SETS GOOGLE_CLIENT_ID/SECRET (a
 *    configured deployment — the connect errand is the honest ask); the
 *    not-configured pin deletes them (the deployment truth: 503
 *    youtube-not-configured, never the connect errand).
 *  - POST /api/playlists/[id]/reorder: the HONEST UNSUPPORTED lane — the
 *    proxy always throws the 501 {error, kind:"youtube-unsupported"} (no safe
 *    official reorder path; the pre-P36 broker drag-drive is retired).
 *  - the action-proxy helpers: proxyPlaylistUpdate(playlistId, req, tier) —
 *    the field map, the noop path, the officialFailure mapping, the tier
 *    gate; proxyPlaylistReorder — always the honest unsupported verdict.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";

/* ------------------------------------------------------------------ */
/* capture the REAL official-actions module before the mock swaps it    */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOfficial = { ...require("@/lib/youtube/official-actions") } as Record<string, unknown>;

/** The typed failure shape every official call maps into. */
interface Failure {
  ok: false;
  kind: "http-error" | "network" | "timeout" | "malformed" | "quota";
  status: number;
  message: string;
}

const officialCalls: { fn: string; args: unknown[] }[] = [];

let updateResult: { ok: true; data: unknown } | Failure = {
  ok: true,
  data: {
    id: "PLx",
    title: "T",
    visibility: "private",
    itemCount: 0,
    thumbUrl: null,
    description: null,
  },
};

mock.module("@/lib/youtube/official-actions", () => ({
  // action-proxy imports this at module scope — the mock must carry it
  SYSTEM_PLAYLIST_IDS: new Set(["WL", "LL"]),
  officialUpdatePlaylist: async (
    accessToken: string,
    playlistId: string,
    changes: Record<string, unknown>,
  ) => {
    officialCalls.push({ fn: "update", args: [accessToken, playlistId, changes] });
    return updateResult;
  },
  // the sibling official fns (unused by this file's paths) stay honest no-ops
  officialCreatePlaylist: async (accessToken: string, title: string, visibility: string) => {
    officialCalls.push({ fn: "create", args: [accessToken, title, visibility] });
    return { ok: true, data: { id: "PLnew", title, visibility, itemCount: 0, thumbUrl: null, description: null } };
  },
  officialDeletePlaylist: async (accessToken: string, playlistId: string) => {
    officialCalls.push({ fn: "delete", args: [accessToken, playlistId] });
    return { ok: true };
  },
}));

/* routes + helpers (imported AFTER the mocks) */
import { PATCH as patchPlaylist } from "@/app/api/playlists/[id]/route";
import { POST as postReorder } from "@/app/api/playlists/[id]/reorder/route";
import {
  proxyPlaylistUpdate,
  proxyPlaylistReorder,
  type UserActionTier,
} from "@/lib/watch/action-proxy";
import { putYouTubeConnection, resetYoutubeConnectionStore } from "@/lib/auth/youtube-connection-store";
import { encryptSecret } from "@/lib/youtube/oauth";
import { mintSessionCookie } from "./helpers";

/* the working tier: the session's sub IS the connection-store key */
const USER_ID = "u_test_a";
const ACCESS_TOKEN = "tok_official_a";

let AUTH_COOKIE = "";
beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie({ sub: USER_ID });
});

/* WFX2-P38 — the Google OAuth env originals, captured up front and restored
 * in afterAll: the not-connected pins SET the pair (oauthConfigured → true),
 * the not-configured pins DELETE it (the deployment truth). */
const savedGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const savedGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/** WFX2-P38 — make this deployment "configured" (the connect errand is real). */
const setGoogleEnv = (): void => {
  process.env.GOOGLE_CLIENT_ID = "p38-playlist-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "p38-playlist-client-secret";
};

/** WFX2-P38 — make this deployment UNCONFIGURED (the deployment truth). */
const deleteGoogleEnv = (): void => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
};

beforeEach(async () => {
  officialCalls.length = 0;
  updateResult = {
    ok: true,
    data: {
      id: "PLx",
      title: "T",
      visibility: "private",
      itemCount: 0,
      thumbUrl: null,
      description: null,
    },
  };
  resetYoutubeConnectionStore();
  await putYouTubeConnection({
    userId: USER_ID,
    channelId: "UC_own_a",
    channelTitle: "Test u_test_a",
    channelThumbUrl: null,
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    accessTokenEnc: await encryptSecret(ACCESS_TOKEN),
    refreshTokenEnc: null,
    accessExpiresAt: Date.now() + 3_600_000,
    status: "connected",
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

afterAll(() => {
  mock.module("@/lib/youtube/official-actions", () => realOfficial);
  resetYoutubeConnectionStore();
  // WFX2-P38 — the Google OAuth env back to its process-original state
  if (savedGoogleClientId !== undefined) process.env.GOOGLE_CLIENT_ID = savedGoogleClientId;
  else delete process.env.GOOGLE_CLIENT_ID;
  if (savedGoogleClientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = savedGoogleClientSecret;
  else delete process.env.GOOGLE_CLIENT_SECRET;
});

/** A resolved official tier for the direct proxy-level tests. */
const tierFor = (token = ACCESS_TOKEN): UserActionTier => ({
  ok: true,
  user: { id: USER_ID, email: "u_test_a@webflix.test", displayName: "Test A", avatarSeed: 7 },
  accessToken: token,
  channelId: "UC_own_a",
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
/* PATCH /api/playlists/[id] — the official playlist-update drive       */
/* ------------------------------------------------------------------ */

describe("PATCH /api/playlists/[id] — the official playlist-update drive (official-actions mocked)", () => {
  test("guest → 401 before any official call", async () => {
    const res = await patchPlaylist(
      new Request("http://localhost/api/playlists/PLx", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "X" }),
      }) as unknown as NextRequest,
      ctx("PLx")
    );
    expect(res.status).toBe(401);
    expect(officialCalls).toHaveLength(0);
  });

  test("invalid playlist id → 400 before any official call", async () => {
    const res = await patchPlaylist(patchReq("bad id!", { title: "X" }), ctx("bad id!"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("special lists (WL/LL) → 400 (YouTube's own lists cannot be edited)", async () => {
    const res = await patchPlaylist(patchReq("WL", { title: "X" }), ctx("WL"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("YouTube's own lists");
    expect(officialCalls).toHaveLength(0);
  });

  test("no fields in the body → 400 (at least one required)", async () => {
    const res = await patchPlaylist(patchReq("PLx", {}), ctx("PLx"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("at least one of");
    expect(officialCalls).toHaveLength(0);
  });

  test("empty title → 400", async () => {
    const res = await patchPlaylist(patchReq("PLx", { title: "   " }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("no connected YouTube account → 403 youtube-not-connected (the tier gate precedes the official call)", async () => {
    setGoogleEnv(); // WFX2-P38: a CONFIGURED deployment — the connect errand is the honest ask
    resetYoutubeConnectionStore(); // drop the connection
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("Connect your YouTube account to act — Settings → YouTube connection");
    expect(body.kind).toBe("youtube-not-connected");
    expect(officialCalls).toHaveLength(0);
  });

  test("WFX2-P38: deployment without Google OAuth env → 503 youtube-not-configured (the deployment-truth law — never the connect errand)", async () => {
    deleteGoogleEnv(); // this deployment can NEVER offer the connect flow
    resetYoutubeConnectionStore(); // drop the connection
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "YouTube actions aren't available yet — this WebFlix deployment isn't connected to Google",
    );
    expect(body.kind).toBe("youtube-not-configured");
    expect(officialCalls).toHaveLength(0); // isolation by construction still holds
    setGoogleEnv(); // leave the configured state for the sibling pins
  });

  test("happy path: title only → official update with only title on the user's token; verified:true", async () => {
    const res = await patchPlaylist(patchReq("PLx", { title: "Renamed" }), ctx("PLx"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      fields: { title: boolean; description: boolean; visibility: boolean };
      verified: boolean;
      path?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("playlist-updated");
    expect(body.fields).toEqual({ title: true, description: false, visibility: false });
    expect(body.verified).toBe(true); // the API's own response IS the read-back
    expect(body.path).toBe("oauth-official");
    expect(officialCalls).toEqual([
      { fn: "update", args: [ACCESS_TOKEN, "PLx", { title: "Renamed" }] },
    ]);
  });

  test("title + visibility together → both ride the official changes", async () => {
    const res = await patchPlaylist(
      patchReq("PLx", { title: "New", visibility: "unlisted" }),
      ctx("PLx")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fields: { title: boolean; description: boolean; visibility: boolean } };
    expect(body.fields).toEqual({ title: true, description: false, visibility: true });
    expect(officialCalls[0].args[2]).toEqual({ title: "New", visibility: "unlisted" });
  });

  test("non-canonical visibility → dropped (the route refuses it before the official call)", async () => {
    const res = await patchPlaylist(
      patchReq("PLx", { visibility: "friends-only" }),
      ctx("PLx")
    );
    // visibility is dropped → no fields → 400
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("a malformed pre-update read → the honest 502 provider error (the partial-safe merge base could not be read)", async () => {
    updateResult = { ok: false, kind: "malformed", status: 404, message: "the playlist could not be read before updating" };
    const res = await patchPlaylist(patchReq("PLx", { title: "Renamed" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("the playlist could not be read before updating");
    expect(body.kind).toBe("youtube-provider-error");
  });

  test("official network failure → 502 with the honest provider error", async () => {
    updateResult = { ok: false, kind: "network", status: 0, message: "network error reaching the YouTube API" };
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("network error reaching the YouTube API");
    expect(body.kind).toBe("youtube-provider-error");
  });

  test("provider 403 → 502 youtube-provider-rejected with the re-connect hint", async () => {
    updateResult = { ok: false, kind: "http-error", status: 403, message: "forbidden" };
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "YouTube rejected the action (forbidden) — re-connect your account in Settings if it persists",
    );
    expect(body.kind).toBe("youtube-provider-rejected");
  });

  test("quota exhaustion → 502 youtube-quota", async () => {
    updateResult = { ok: false, kind: "quota", status: 403, message: "YouTube API quota exceeded for today" };
    const res = await patchPlaylist(patchReq("PLx", { title: "X" }), ctx("PLx"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("YouTube API quota exceeded for today");
    expect(body.kind).toBe("youtube-quota");
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
    expect(officialCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/playlists/[id]/reorder — the honest unsupported drive      */
/* ------------------------------------------------------------------ */

describe("POST /api/playlists/[id]/reorder — the honest UNSUPPORTED drive (no official reorder path)", () => {
  test("guest → 401 before anything runs", async () => {
    const res = await postReorder(
      new Request("http://localhost/api/playlists/PLx/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIndex: 0, toIndex: 1 }),
      }) as unknown as NextRequest,
      ctx("PLx")
    );
    expect(res.status).toBe(401);
    expect(officialCalls).toHaveLength(0);
  });

  test("invalid playlist id → 400 before anything runs", async () => {
    const res = await postReorder(reorderReq("bad id!", { fromIndex: 0, toIndex: 1 }), ctx("bad id!"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("special lists (WL/LL) → 400 (YouTube's own lists cannot be reordered)", async () => {
    const res = await postReorder(reorderReq("LL", { fromIndex: 0, toIndex: 1 }), ctx("LL"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("YouTube's own lists");
    expect(officialCalls).toHaveLength(0);
  });

  test("missing fromIndex or toIndex → 400", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: 0 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("negative index → 400", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: -1, toIndex: 1 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("fromIndex === toIndex → 400 (must differ)", async () => {
    const res = await postReorder(reorderReq("PLx", { fromIndex: 1, toIndex: 1 }), ctx("PLx"));
    expect(res.status).toBe(400);
    expect(officialCalls).toHaveLength(0);
  });

  test("a well-formed reorder → the honest 501 {error, kind: youtube-unsupported} — the broker drag-drive is retired", async () => {
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 0, toIndex: 2, videoId: "dQw4w9WgXcQ" }),
      ctx("PLx")
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Reordering playlists isn't supported by the official YouTube API — open the video on YouTube to do it there",
    );
    expect(body.kind).toBe("youtube-unsupported");
    expect(officialCalls).toHaveLength(0); // no official seam is touched — the verdict is policy, not backend state
  });

  test("videoId omitted → the same honest 501 (the verification aid is irrelevant — no drive exists)", async () => {
    const res = await postReorder(
      reorderReq("PLx", { fromIndex: 1, toIndex: 0 }),
      ctx("PLx")
    );
    expect(res.status).toBe(501);
    expect(((await res.json()) as { kind?: string }).kind).toBe("youtube-unsupported");
    expect(officialCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* the action-proxy helpers (the field map + the official semantics)    */
/* ------------------------------------------------------------------ */

describe("proxyPlaylistUpdate — the field map + the official read-back semantics", () => {
  test("only the present fields ride the official changes", async () => {
    const r = await proxyPlaylistUpdate("PLx", { title: "T" }, tierFor());
    expect(r.fields).toEqual({ title: true, description: false, visibility: false });
    expect(officialCalls[0].args[2]).toEqual({ title: "T" });
  });

  test("all three fields → the field map is all-true; the changes carry all three", async () => {
    const r = await proxyPlaylistUpdate(
      "PLx",
      { title: "T", description: "D", visibility: "public" },
      tierFor(),
    );
    expect(r.fields).toEqual({ title: true, description: true, visibility: true });
    expect(officialCalls[0].args[2]).toEqual({ title: "T", description: "D", visibility: "public" });
  });

  test("the official update's response IS the read-back → verified:true (a 2xx alone is never the claim)", async () => {
    const r = await proxyPlaylistUpdate("PLx", { title: "T" }, tierFor());
    expect(r.ok).toBe(true);
    expect(r.effect).toBe("playlist-updated");
    expect(r.verified).toBe(true);
    expect(r.path).toBe("oauth-official");
    expect(r.unverifiedNote).toBeUndefined(); // no unverifiable middle state exists on this lane
  });

  test("no fields at all → the noop: effect playlist-update-noop + already:true, ZERO official calls", async () => {
    const r = await proxyPlaylistUpdate("PLx", {}, tierFor());
    expect(r.effect).toBe("playlist-update-noop");
    expect(r.already).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.fields).toEqual({ title: false, description: false, visibility: false });
    expect(officialCalls).toHaveLength(0);
  });

  test("official network failure → ApiError 502 (the routes map it to the honest response)", async () => {
    updateResult = { ok: false, kind: "network", status: 0, message: "network error reaching the YouTube API" };
    await expect(proxyPlaylistUpdate("PLx", { title: "T" }, tierFor())).rejects.toThrow(
      "network error reaching the YouTube API",
    );
  });

  test("official quota failure → ApiError 502 youtube-quota", async () => {
    updateResult = { ok: false, kind: "quota", status: 403, message: "YouTube API quota exceeded for today" };
    await expect(proxyPlaylistUpdate("PLx", { title: "T" }, tierFor())).rejects.toThrow(
      "YouTube API quota exceeded for today",
    );
  });

  test("the tier gate: a not-connected tier rejects before ANY official call", async () => {
    setGoogleEnv(); // WFX2-P38: a CONFIGURED deployment — the connect-errand mapping is the honest ask
    await expect(
      proxyPlaylistUpdate("PLx", { title: "T" }, { ok: false, kind: "not-connected" }),
    ).rejects.toThrow("Connect your YouTube account to act");
    expect(officialCalls).toHaveLength(0);
  });
});

describe("proxyPlaylistReorder — the honest UNSUPPORTED verdict (always)", () => {
  test("any well-formed reorder → the 501 ApiError; ZERO official calls (no safe official path exists)", async () => {
    await expect(proxyPlaylistReorder("PLx", 0, 2, "dQw4w9WgXcQ")).rejects.toThrow(
      "Reordering playlists isn't supported by the official YouTube API",
    );
    expect(officialCalls).toHaveLength(0);
  });

  test("videoId omitted → the same honest verdict", async () => {
    await expect(proxyPlaylistReorder("PLx", 1, 0)).rejects.toThrow(
      "Reordering playlists isn't supported by the official YouTube API",
    );
    expect(officialCalls).toHaveLength(0);
  });
});
