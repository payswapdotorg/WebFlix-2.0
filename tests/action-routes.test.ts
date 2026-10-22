/**
 * WFX2-P36 tests — the action routes re-pointed to the per-user lanes:
 *
 *  - OFFICIAL lane (like / dislike / remove-rating, subscribe / unsubscribe):
 *    the signed-in user's OWN OAuth connection (the real connection-store Map
 *    + real encryptSecret blobs, env-clean) driving the official-actions
 *    adapter MOCKED at the seam — controllable typed results, no network;
 *    the authenticated read-back (getRating / subscriptions.list) is the ONLY
 *    success confirmation, reported as `verified`;
 *  - LOCAL lane (watch-later, dont-recommend-channel, the feedback undos):
 *    the honest WebFlix store (local:true disclosed, the real test DB via
 *    setupTestDb) — YouTube's WL is a system playlist the Data API cannot
 *    write and feed feedback has no end-user API;
 *  - tier failures: no connection → 403 youtube-not-connected (the P38
 *    battery sets GOOGLE_CLIENT_ID/SECRET for this pin — connecting is
 *    possible there); a deployment WITHOUT the Google OAuth env → 503
 *    youtube-not-configured (the WFX2-P38 deployment-truth law: never the
 *    user connect errand where connecting is impossible); a revoked grant →
 *    403 youtube-needs-reauth; official failures → the honest officialFailure
 *    mapping (quota → 502 youtube-quota, 401/403 → youtube-provider-rejected,
 *    else youtube-provider-error).
 *
 * The pre-P36 direct-first/broker-fallback pins are RETIRED with the shared
 * operator identity itself (action-proxy imports neither @/lib/broker nor
 * @/lib/youtube-direct — isolation by construction; these tests pin exactly
 * that: ZERO official calls whenever the tier or lane says no).
 *
 * Same mock pattern as the lane's established idiom: real modules captured
 * up front and re-installed in `afterAll` (bun's mock.module is
 * process-wide).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";

/* ------------------------------------------------------------------ */
/* capture the REAL official-actions module before the mock swaps it    */
/*                                                                      */
/* NOTE: a plain `const real = require(...)` snapshot is NOT enough —   */
/* bun mutates the captured namespace in place when mock.module swaps   */
/* the registry, so the values must be copied into a fresh object.      */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOfficial = { ...require("@/lib/youtube/official-actions") } as Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* the official-actions MOCK — controllable typed results               */
/* ------------------------------------------------------------------ */

/** The typed failure shape every official call maps into. */
interface Failure {
  ok: false;
  kind: "http-error" | "network" | "timeout" | "malformed" | "quota";
  status: number;
  message: string;
}
type Result<T> = { ok: true; data: T } | Failure;
type MaybeFn<T> = T | ((call: number) => T);

const officialCalls: { fn: string; args: unknown[] }[] = [];

let rateResult: MaybeFn<{ ok: true } | Failure> = { ok: true };
let ratingRead: MaybeFn<Result<{ rating: "like" | "dislike" | "none" }>> = {
  ok: true,
  data: { rating: "like" },
};
let subStatus: MaybeFn<Result<{ subscribed: boolean; subscriptionId: string | null }>> = {
  ok: true,
  data: { subscribed: false, subscriptionId: null },
};
let subscribeResult: MaybeFn<Result<{ subscriptionId: string | null; channelId: string }>> = {
  ok: true,
  data: { subscriptionId: "sub_new", channelId: "UC1" },
};
let unsubscribeResult: MaybeFn<{ ok: true } | Failure> = { ok: true };

const resolve = <T>(v: MaybeFn<T>, call: number): T =>
  typeof v === "function" ? (v as (n: number) => T)(call) : v;

const callsOf = (fn: string): number => officialCalls.filter((c) => c.fn === fn).length;

mock.module("@/lib/youtube/official-actions", () => ({
  // action-proxy imports this at module scope — the mock must carry it
  SYSTEM_PLAYLIST_IDS: new Set(["WL", "LL"]),
  officialRateVideo: async (accessToken: string, videoId: string, rating: string) => {
    officialCalls.push({ fn: "rate", args: [accessToken, videoId, rating] });
    return resolve(rateResult, callsOf("rate"));
  },
  officialGetRating: async (accessToken: string, videoId: string) => {
    officialCalls.push({ fn: "getRating", args: [accessToken, videoId] });
    return resolve(ratingRead, callsOf("getRating"));
  },
  officialSubscriptionStatus: async (accessToken: string, channelId: string) => {
    officialCalls.push({ fn: "subStatus", args: [accessToken, channelId] });
    return resolve(subStatus, callsOf("subStatus"));
  },
  officialSubscribe: async (accessToken: string, channelId: string) => {
    officialCalls.push({ fn: "subscribe", args: [accessToken, channelId] });
    return resolve(subscribeResult, callsOf("subscribe"));
  },
  officialUnsubscribeById: async (accessToken: string, subscriptionId: string) => {
    officialCalls.push({ fn: "unsubscribe", args: [accessToken, subscriptionId] });
    return resolve(unsubscribeResult, callsOf("unsubscribe"));
  },
}));

/* routes + stores (imported after the mocks) */
import { POST as postLike } from "@/app/api/videos/[id]/like/route";
import { clearCache } from "@/lib/youtube/cache";
import { cacheJsonSet, cachePeek } from "@/lib/youtube/upstash-cache";
import { POST as postSubscribe } from "@/app/api/subscribe/route";
import { POST as postWatchLater } from "@/app/api/playlists/watch-later/route";
import { POST as postDontRecommendChannel } from "@/app/api/dont-recommend-channel/route";
import { POST as postDontRecommendChannelUndo } from "@/app/api/dont-recommend-channel/undo/route";
import { POST as postNotInterestedUndo } from "@/app/api/not-interested/undo/route";
import { putYouTubeConnection, resetYoutubeConnectionStore } from "@/lib/auth/youtube-connection-store";
import { encryptSecret } from "@/lib/youtube/oauth";
import { ensureShadowVideo } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { mintSessionCookie, setupTestDb } from "./helpers";

/* the working tier: the session's sub IS the connection-store key */
const USER_A = "u_test_a";
const TOKEN_A = "tok_a";

let AUTH_COOKIE = "";
let COOKIE_B = "";

beforeAll(async () => {
  AUTH_COOKIE = await mintSessionCookie({ sub: USER_A });
  COOKIE_B = await mintSessionCookie({ sub: "u_test_b" });
});

setupTestDb(); // the LOCAL families write the real (test) DB

/* WFX2-P38 — the Google OAuth env originals, captured up front and restored
 * in afterAll: the not-connected pins SET the pair (oauthConfigured → true),
 * the not-configured pins DELETE it (the deployment truth). The test process
 * itself starts without them. */
const savedGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const savedGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/** WFX2-P38 — make this deployment "configured" (the connect errand is real). */
const setGoogleEnv = (): void => {
  process.env.GOOGLE_CLIENT_ID = "p38-action-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "p38-action-client-secret";
};

/** WFX2-P38 — make this deployment UNCONFIGURED (the deployment truth). */
const deleteGoogleEnv = (): void => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
};

/** The user's own connected account record — tokens as real encryptSecret blobs. */
async function connectUser(userId: string, token: string): Promise<void> {
  await putYouTubeConnection({
    userId,
    channelId: `UC_own_${userId}`,
    channelTitle: `Test ${userId}`,
    channelThumbUrl: null,
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    accessTokenEnc: await encryptSecret(token),
    refreshTokenEnc: null,
    accessExpiresAt: Date.now() + 3_600_000,
    status: "connected",
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

beforeEach(async () => {
  officialCalls.length = 0;
  rateResult = { ok: true };
  ratingRead = { ok: true, data: { rating: "like" } };
  subStatus = { ok: true, data: { subscribed: false, subscriptionId: null } };
  subscribeResult = { ok: true, data: { subscriptionId: "sub_new", channelId: "UC1" } };
  unsubscribeResult = { ok: true };
  resetYoutubeConnectionStore();
  await connectUser(USER_A, TOKEN_A);
});

/* bun's mock.module is process-wide — restore the real module so any
 * later-loaded contract tests exercise the real adapter again. */
afterAll(() => {
  mock.module("@/lib/youtube/official-actions", () => realOfficial);
  resetYoutubeConnectionStore();
  // WFX2-P38 — the Google OAuth env back to its process-original state
  if (savedGoogleClientId !== undefined) process.env.GOOGLE_CLIENT_ID = savedGoogleClientId;
  else delete process.env.GOOGLE_CLIENT_ID;
  if (savedGoogleClientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = savedGoogleClientSecret;
  else delete process.env.GOOGLE_CLIENT_SECRET;
});

import type { NextRequest } from "next/server";

const req = (body: unknown, url = "http://localhost/api/x", cookie = AUTH_COOKIE): NextRequest =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe("POST /api/videos/[id]/like (the per-user OFFICIAL lane — videos.rate + getRating)", () => {
  const ctx = { params: Promise.resolve({ id: "dQw4w9WgXcQ" }) };

  test("official like: the user's own token on the wire + the getRating read-back → verified:true, honest counts", async () => {
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: null } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      likes: number;
      dislikes: number;
      yourLike: string | null;
      path?: string;
      verified?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("liked");
    expect(body.yourLike).toBe("like");
    expect(body.likes).toBe(6);
    expect(body.dislikes).toBe(0);
    expect(body.path).toBe("oauth-official");
    expect(body.verified).toBe(true);
    // the user's OWN token drove the write AND the authenticated read-back
    expect(officialCalls).toEqual([
      { fn: "rate", args: [TOKEN_A, "dQw4w9WgXcQ", "like"] },
      { fn: "getRating", args: [TOKEN_A, "dQw4w9WgXcQ"] },
    ]);
  });

  test("P35 law kept: a verified like DROPS the cached watch response (the reload-persistence law)", async () => {
    clearCache();
    const key = "yt:watch:dQw4w9WgXcQ";
    await cacheJsonSet(key, { marker: "stale-next" }, 60_000);
    expect(await cachePeek<any>(key)).not.toBeNull();
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(200);
    expect(await cachePeek<any>(key)).toBeNull(); // invalidated — the next bootstrap re-reads per-user state
  });

  test("a like whose read-back is unavailable STILL drops the cached watch response (the write changed YouTube-side state)", async () => {
    clearCache();
    const key = "yt:watch:dQw4w9WgXcQ";
    await cacheJsonSet(key, { marker: "stale-next" }, 60_000);
    ratingRead = { ok: false, kind: "network", status: 0, message: "network error reaching the YouTube API" };
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(200);
    expect(await cachePeek<any>(key)).toBeNull();
  });

  test("the legacy toggle: the UI's own baseline resolves the remove — one none call on the official lane", async () => {
    ratingRead = { ok: true, data: { rating: "none" } };
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: "like" } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { yourLike: string | null; likes: number; effect: string; verified?: boolean };
    expect(body.yourLike).toBeNull();
    expect(body.likes).toBe(4);
    expect(body.effect).toBe("rating-removed");
    expect(body.verified).toBe(true); // the read-back confirmed the removal
    expect(officialCalls).toEqual([
      { fn: "rate", args: [TOKEN_A, "dQw4w9WgXcQ", "none"] },
      { fn: "getRating", args: [TOKEN_A, "dQw4w9WgXcQ"] },
    ]);
  });

  test("canonical action=none maps to the official none rating", async () => {
    ratingRead = { ok: true, data: { rating: "none" } };
    const res = await postLike(req({ action: "none" }), ctx);
    expect(res.status).toBe(200);
    expect(officialCalls[0]).toEqual({ fn: "rate", args: [TOKEN_A, "dQw4w9WgXcQ", "none"] });
    const body = (await res.json()) as { yourLike: string | null; effect: string };
    expect(body.yourLike).toBeNull();
    expect(body.effect).toBe("rating-removed");
  });

  test("dislike rides the SAME official lane (the P33 broker-only gap closed the policy-aligned way)", async () => {
    ratingRead = { ok: true, data: { rating: "dislike" } };
    const res = await postLike(
      req({ value: "dislike", baseline: { likes: 5, dislikes: 2, yourLike: "like" } }),
      ctx,
    );
    const body = (await res.json()) as {
      likes: number;
      dislikes: number;
      yourLike: string;
      verified?: boolean;
    };
    expect(officialCalls[0]).toEqual({ fn: "rate", args: [TOKEN_A, "dQw4w9WgXcQ", "dislike"] });
    expect(body.yourLike).toBe("dislike");
    expect(body.likes).toBe(4);
    expect(body.dislikes).toBe(3);
    expect(body.verified).toBe(true);
  });

  test("read-back MISMATCH → verified:false honest (a 2xx write alone is never a success claim)", async () => {
    ratingRead = { ok: true, data: { rating: "none" } }; // target like, YouTube says none
    const res = await postLike(
      req({ value: "like", baseline: { likes: 5, dislikes: 0, yourLike: null } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified?: boolean; yourLike: string | null };
    expect(body.verified).toBe(false); // honest — never a claimed success
    expect(body.yourLike).toBeNull(); // the read-back's own truth
  });

  test("read-back UNAVAILABLE → verified:false + the honest note; the intended rating is shown as such", async () => {
    ratingRead = { ok: false, kind: "network", status: 0, message: "network error reaching the YouTube API" };
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified?: boolean; yourLike: string | null; note?: string };
    expect(body.verified).toBe(false);
    expect(body.yourLike).toBe("like"); // the intended rating, disclosed as unconfirmed
    expect(body.note).toBe(
      "the rating was written; the read-back was unavailable so the state shows your intended rating",
    );
  });

  test("no connected account → 403 youtube-not-connected; ZERO official calls (isolation by construction)", async () => {
    setGoogleEnv(); // WFX2-P38: a CONFIGURED deployment — the connect errand is the honest ask
    resetYoutubeConnectionStore(); // drop the connection
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("Connect your YouTube account to act — Settings → YouTube connection");
    expect(body.kind).toBe("youtube-not-connected");
    expect(officialCalls).toEqual([]);
  });

  test("WFX2-P38: deployment without Google OAuth env → 503 youtube-not-configured; ZERO official calls (the deployment-truth law — never the connect errand)", async () => {
    deleteGoogleEnv(); // this deployment can NEVER offer the connect flow
    resetYoutubeConnectionStore(); // drop the connection
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "YouTube actions aren't available yet — this WebFlix deployment isn't connected to Google",
    );
    expect(body.kind).toBe("youtube-not-configured");
    expect(officialCalls).toEqual([]); // isolation by construction still holds
    setGoogleEnv(); // leave the configured state for the sibling pins
  });

  test("a revoked/expired grant (status needs_reauth) → 403 youtube-needs-reauth", async () => {
    setGoogleEnv(); // WFX2-P38: a CONFIGURED deployment for the tier-failure family
    resetYoutubeConnectionStore();
    await putYouTubeConnection({
      userId: USER_A,
      channelId: null,
      channelTitle: null,
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret(TOKEN_A),
      refreshTokenEnc: null,
      accessExpiresAt: Date.now() + 3_600_000,
      status: "needs_reauth",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "Your YouTube account connection needs re-authorizing — Settings → YouTube connection",
    );
    expect(body.kind).toBe("youtube-needs-reauth");
    expect(officialCalls).toEqual([]);
  });

  test("quota exhaustion → 502 youtube-quota (never fake success)", async () => {
    rateResult = { ok: false, kind: "quota", status: 403, message: "YouTube API quota exceeded for today" };
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("YouTube API quota exceeded for today");
    expect(body.kind).toBe("youtube-quota");
    expect(callsOf("getRating")).toBe(0); // the write refused — no read-back claimed
  });

  test("provider 401 → 502 youtube-provider-rejected with the re-connect hint", async () => {
    rateResult = { ok: false, kind: "http-error", status: 401, message: "Invalid Credentials" };
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe(
      "YouTube rejected the action (Invalid Credentials) — re-connect your account in Settings if it persists",
    );
    expect(body.kind).toBe("youtube-provider-rejected");
  });

  test("other provider failures → 502 youtube-provider-error with the provider's own message", async () => {
    rateResult = { ok: false, kind: "http-error", status: 500, message: "the YouTube API answered 500" };
    const res = await postLike(req({ value: "like" }), ctx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("the YouTube API answered 500");
    expect(body.kind).toBe("youtube-provider-error");
  });

  test("the transparent refresh: an expired access token is refreshed server-side and the FRESH token serves the rate", async () => {
    resetYoutubeConnectionStore();
    await putYouTubeConnection({
      userId: USER_A,
      channelId: "UC_own_a",
      channelTitle: "Test u_test_a",
      channelThumbUrl: null,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      accessTokenEnc: await encryptSecret("tok_stale"),
      refreshTokenEnc: await encryptSecret("refresh_a"),
      accessExpiresAt: Date.now() - 1_000, // expired → the refresh path
      status: "connected",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // the oauth token endpoint (the only real fetch left on this path)
    const realFetch = globalThis.fetch;
    const tokenCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      tokenCalls.push(u);
      return new Response(
        JSON.stringify({ access_token: "tok_refreshed", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.force-ssl" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    try {
      const res = await postLike(req({ value: "like" }), ctx);
      expect(res.status).toBe(200);
      expect(tokenCalls[0]).toContain("https://oauth2.googleapis.com/token");
      // the REFRESHED token is the one on the official wire
      expect(officialCalls[0]).toEqual({ fn: "rate", args: ["tok_refreshed", "dQw4w9WgXcQ", "like"] });
      // the store now carries the refreshed record (accessExpiresAt in the future)
      const { getYouTubeConnection } = await import("@/lib/auth/youtube-connection-store");
      const updated = await getYouTubeConnection(USER_A);
      expect(updated?.accessExpiresAt).toBeGreaterThan(Date.now());
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("missing action/value → 400", async () => {
    const res = await postLike(req({}), ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/subscribe (the per-user OFFICIAL lane — subscriptions.insert/delete + list read-back)", () => {
  test("subscribe: the own-state pre-read, the insert on the user's token, the list read-back → verified:true", async () => {
    subStatus = (n) =>
      n === 1
        ? { ok: true, data: { subscribed: false, subscriptionId: null } }
        : { ok: true, data: { subscribed: true, subscriptionId: "sub_new" } };
    const res = await postSubscribe(req({ channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", on: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      subscribed: boolean;
      path: string;
      verified?: boolean;
      already?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.subscribed).toBe(true);
    expect(body.path).toBe("oauth-official");
    expect(body.verified).toBe(true);
    expect(body.already).toBeUndefined();
    expect(officialCalls).toEqual([
      { fn: "subStatus", args: [TOKEN_A, "UCuAXFkgsw1L7xaCfnd5JJOw"] },
      { fn: "subscribe", args: [TOKEN_A, "UCuAXFkgsw1L7xaCfnd5JJOw"] },
      { fn: "subStatus", args: [TOKEN_A, "UCuAXFkgsw1L7xaCfnd5JJOw"] },
    ]);
  });

  test("already-subscribed → idempotent already:true (the own-state pre-read is the guard), NO insert call", async () => {
    subStatus = { ok: true, data: { subscribed: true, subscriptionId: "sub_exists" } };
    const res = await postSubscribe(req({ channelId: "UC1", on: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscribed: boolean; already?: boolean; verified?: boolean };
    expect(body.subscribed).toBe(true);
    expect(body.already).toBe(true);
    expect(body.verified).toBe(true);
    expect(callsOf("subscribe")).toBe(0); // never a redundant YouTube write
    expect(callsOf("subStatus")).toBe(1);
  });

  test("unsubscribe resolves the subscription id from the OWN list, never a guess", async () => {
    subStatus = (n) =>
      n === 1
        ? { ok: true, data: { subscribed: true, subscriptionId: "sub_123" } }
        : { ok: true, data: { subscribed: false, subscriptionId: null } };
    const res = await postSubscribe(req({ channelId: "UC1", on: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscribed: boolean; verified?: boolean; effect: string };
    expect(body.subscribed).toBe(false);
    expect(body.effect).toBe("unsubscribed");
    expect(body.verified).toBe(true);
    expect(officialCalls[1]).toEqual({ fn: "unsubscribe", args: [TOKEN_A, "sub_123"] });
  });

  test("on omitted → toggle resolved from the user's OWN subscription state (subscribed → unsubscribe)", async () => {
    subStatus = (n) =>
      n === 1
        ? { ok: true, data: { subscribed: true, subscriptionId: "sub_123" } }
        : { ok: true, data: { subscribed: false, subscriptionId: null } };
    const res = await postSubscribe(req({ channelId: "UC1" }));
    const body = (await res.json()) as { subscribed: boolean };
    expect(body.subscribed).toBe(false);
    expect(officialCalls[1]).toEqual({ fn: "unsubscribe", args: [TOKEN_A, "sub_123"] });
  });

  test("the own-state pre-read fails → the honest 502 provider error (never a guessed toggle)", async () => {
    subStatus = { ok: false, kind: "network", status: 0, message: "network error reaching the YouTube API" };
    const res = await postSubscribe(req({ channelId: "UC1" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind?: string };
    expect(body.error).toBe("network error reaching the YouTube API");
    expect(body.kind).toBe("youtube-provider-error");
    expect(callsOf("subscribe")).toBe(0);
    expect(callsOf("unsubscribe")).toBe(0);
  });

  test("channelId missing → 400", async () => {
    const res = await postSubscribe(req({ on: true }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/playlists/watch-later (the honest WebFlix-LOCAL list)", () => {
  test("add:true → the LOCAL list: local:true + the disclosed note + the DB row — ZERO official calls", async () => {
    const res = await postWatchLater(req({ videoId: "wlAdd1", add: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      added: boolean;
      playlistId: string;
      effect: string;
      path?: string;
      local?: boolean;
      note?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.added).toBe(true);
    expect(body.playlistId).toBe("WL"); // the save button's contract shape kept
    expect(body.effect).toBe("watch-later-added");
    expect(body.path).toBe("local");
    expect(body.local).toBe(true); // origin disclosed — never a YouTube write claimed
    expect(body.note).toBe(
      "Saved on WebFlix — YouTube's own Watch Later isn't writable through the official API",
    );
    // the row lives in the WebFlix store (the shadow author's own list)
    const wl = await db.playlist.findFirstOrThrow({
      where: { userId: `wf-${USER_A}`, isWatchLater: true },
    });
    expect(await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: wl.id, videoId: "wlAdd1" } },
    })).not.toBeNull();
    expect(officialCalls).toEqual([]); // the local lane never touches the official seam
  });

  test("add:false → removed from the LOCAL list (idempotent already:true when absent)", async () => {
    const res = await postWatchLater(req({ videoId: "wlRemove1", add: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: boolean; effect: string; already?: boolean; local?: boolean };
    expect(body.added).toBe(false);
    expect(body.effect).toBe("watch-later-removed");
    expect(body.already).toBe(true); // nothing to remove — the honest idempotence
    expect(body.local).toBe(true);
    expect(officialCalls).toEqual([]);
  });

  test("toggle: the fresh LOCAL read decides — add then toggle removes", async () => {
    const first = await postWatchLater(req({ videoId: "wlToggle1" }));
    expect(((await first.json()) as { added: boolean }).added).toBe(true);
    const second = await postWatchLater(req({ videoId: "wlToggle1" }));
    const body = (await second.json()) as { added: boolean; effect: string; already?: boolean };
    expect(body.added).toBe(false);
    expect(body.effect).toBe("watch-later-removed");
    expect(body.already).toBe(false); // a real transition, not a no-op
    const wl = await db.playlist.findFirstOrThrow({
      where: { userId: `wf-${USER_A}`, isWatchLater: true },
    });
    expect(await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: wl.id, videoId: "wlToggle1" } },
    })).toBeNull();
  });

  test("add twice → the second is already:true, ONE row (the unique playlistId_videoId key)", async () => {
    await postWatchLater(req({ videoId: "wlDup1", add: true }));
    const second = await postWatchLater(req({ videoId: "wlDup1", add: true }));
    const body = (await second.json()) as { added: boolean; already?: boolean };
    expect(body.added).toBe(true);
    expect(body.already).toBe(true);
    const wl = await db.playlist.findFirstOrThrow({
      where: { userId: `wf-${USER_A}`, isWatchLater: true },
    });
    expect(await db.playlistItem.count({ where: { playlistId: wl.id, videoId: "wlDup1" } })).toBe(1);
  });

  test("guest (no session) → 401, never a write", async () => {
    const res = await postWatchLater(req({ videoId: "wlGuest1", add: true }, "http://localhost/api/x", ""));
    expect(res.status).toBe(401);
    expect(await db.playlistItem.count({ where: { videoId: "wlGuest1" } })).toBe(0);
  });

  test("missing videoId → 400", async () => {
    const res = await postWatchLater(req({}));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// P24-SEND (G12) → P36 — the feed-feedback family's route contracts: the
// channel variant of not-interested + the shared undo, all on the honest
// WebFlix-LOCAL signal lane (no official end-user API exists — disclosed).
// ---------------------------------------------------------------------------

describe("POST /api/dont-recommend-channel (the LOCAL signal lane)", () => {
  test("ok path: the {hidden:true} contract the card kebab consumes, local:true disclosed, the signal row per user", async () => {
    const res = await postDontRecommendChannel(req({ videoId: "dQw4w9WgXcQ" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      dontRecommendChannel: boolean;
      hidden: boolean;
      path: string;
      local?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("dont-recommend-channel");
    expect(body.dontRecommendChannel).toBe(true);
    expect(body.hidden).toBe(true);
    expect(body.path).toBe("local");
    expect(body.local).toBe(true);
    const signal = await db.videoSignal.findUniqueOrThrow({
      where: { videoId_userId: { videoId: "dQw4w9WgXcQ", userId: `wf-${USER_A}` } },
    });
    expect(signal.kind).toBe("dont_recommend_channel");
    expect(officialCalls).toEqual([]); // never a YouTube-side claim
  });

  test("the local note rides the response (the honest disclosure)", async () => {
    const res = await postDontRecommendChannel(req({ videoId: "abc123" }));
    const body = (await res.json()) as { note?: string };
    expect(body.note).toBe(
      "The channel won't be recommended on WebFlix — YouTube's own feed feedback isn't available through the official API",
    );
  });

  test("the signal is PER USER (the P36 isolation law): user B's write never touches user A's row", async () => {
    await postDontRecommendChannel(req({ videoId: "dQw4w9WgXcQ" })); // A
    const res = await postDontRecommendChannel(
      req({ videoId: "dQw4w9WgXcQ" }, "http://localhost/api/x", COOKIE_B),
    );
    expect(res.status).toBe(200);
    const rows = await db.videoSignal.findMany({ where: { videoId: "dQw4w9WgXcQ" } });
    expect(rows.map((r) => r.userId).sort()).toEqual([`wf-${USER_A}`, "wf-u_test_b"]);
  });

  test("guest → 401, never a write (the honest gate)", async () => {
    const res = await postDontRecommendChannel(req({ videoId: "drcGuest1" }, "http://localhost/api/x", ""));
    expect(res.status).toBe(401);
    expect(await db.videoSignal.count({ where: { videoId: "drcGuest1" } })).toBe(0);
  });

  test("missing videoId → 400; non-JSON body → 400", async () => {
    const res = await postDontRecommendChannel(req({}));
    expect(res.status).toBe(400);
    const res2 = await postDontRecommendChannel(
      new Request("http://localhost/api/dont-recommend-channel", {
        method: "POST",
        headers: { "Content-Type": "text/plain", cookie: AUTH_COOKIE },
        body: "not json",
      }) as unknown as NextRequest,
    );
    expect(res2.status).toBe(400);
  });
});

describe("POST /api/dont-recommend-channel/undo + /api/not-interested/undo (the LOCAL feedback-undo)", () => {
  test("the dont-recommend-channel undo removes the LOCAL signal; the {restored:true} contract + the local disclosure", async () => {
    await postDontRecommendChannel(req({ videoId: "undoDrc1" }));
    const res = await postDontRecommendChannelUndo(req({ videoId: "undoDrc1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      effect: string;
      restored: boolean;
      path: string;
      local?: boolean;
      note?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.effect).toBe("feedback-undo");
    expect(body.restored).toBe(true);
    expect(body.path).toBe("local");
    expect(body.local).toBe(true);
    expect(body.note).toBe("Restored on WebFlix");
    expect(await db.videoSignal.count({ where: { videoId: "undoDrc1" } })).toBe(0);
  });

  test("the not-interested undo is the SAME local seam (one signal store, kind-scoped removal)", async () => {
    await ensureShadowVideo("undoNi1");
    await db.videoSignal.create({
      data: { videoId: "undoNi1", userId: `wf-${USER_A}`, kind: "not_interested" },
    });
    const res = await postNotInterestedUndo(req({ videoId: "undoNi1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { effect: string; restored: boolean };
    expect(body.effect).toBe("feedback-undo");
    expect(body.restored).toBe(true);
    expect(await db.videoSignal.count({ where: { videoId: "undoNi1" } })).toBe(0);
  });

  test("the undo targets its OWN kind only — the other kind's signal for the same video stays", async () => {
    await ensureShadowVideo("undoKind1");
    // one signal row per user+video; its kind is the LATEST verdict
    await db.videoSignal.create({
      data: { videoId: "undoKind1", userId: `wf-${USER_A}`, kind: "not_interested" },
    });
    // the dont-recommend undo never removes a not-interested signal
    const res = await postDontRecommendChannelUndo(req({ videoId: "undoKind1" }));
    expect(res.status).toBe(200);
    const remaining = await db.videoSignal.findMany({ where: { videoId: "undoKind1" } });
    expect(remaining.map((r) => r.kind)).toEqual(["not_interested"]);
    // ...but the not-interested undo (its own kind) removes it
    const res2 = await postNotInterestedUndo(req({ videoId: "undoKind1" }));
    expect(res2.status).toBe(200);
    expect(await db.videoSignal.count({ where: { videoId: "undoKind1" } })).toBe(0);
  });

  test("guest → 401 on both undo routes (never a write)", async () => {
    const res = await postDontRecommendChannelUndo(req({ videoId: "undoGuest1" }, "http://localhost/api/x", ""));
    expect(res.status).toBe(401);
    const res2 = await postNotInterestedUndo(req({ videoId: "undoGuest1" }, "http://localhost/api/x", ""));
    expect(res2.status).toBe(401);
  });
});
