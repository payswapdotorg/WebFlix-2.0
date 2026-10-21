/**
 * WFX2-P36-C tests — the TWO-USER ISOLATION battery + the STRUCTURAL PROOF.
 *
 * The law under test (docs/work-items/P36-ACTION-PERSISTENCE.md §P36-C):
 * actions and read-backs for account A must never be executed/read as
 * account B; no global YT_COOKIES or broker session participates in the
 * production mutation path.
 *
 * Three layers of proof:
 *  1. resolveActionTier / resolveReadTier against the REAL connection-store
 *     Map (encryptSecret blobs, mintSessionCookie per user): the acting
 *     user's OWN connection — and nobody else's — resolves the tier;
 *  2. the proxy isolation: with @/lib/youtube/official-actions mocked and
 *     recording the accessToken of every call, proxyVideoLike for user A's
 *     tier NEVER presents user B's token;
 *  3. THE STRUCTURAL PROOF (pinned forever as text): src/lib/watch/action-proxy.ts,
 *     src/lib/community/action-proxy.ts and the live-chat send module import
 *     neither @/lib/broker nor @/lib/youtube-direct, and NO route file under
 *     src/app/api/ imports @/lib/broker — isolation by construction, not
 *     configuration.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, mock } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/* ------------------------------------------------------------------ */
/* capture the REAL official-actions module before the mock swaps it    */
/* (bun mutates the captured namespace in place — copy to a fresh obj)  */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realOfficial = { ...require("@/lib/youtube/official-actions") } as Record<string, unknown>;

/** Every official call, with the accessToken it was served. */
const officialCalls: { fn: string; token: string }[] = [];

mock.module("@/lib/youtube/official-actions", () => ({
  // action-proxy imports this at module scope — the mock must carry it
  SYSTEM_PLAYLIST_IDS: new Set(["WL", "LL"]),
  officialRateVideo: async (accessToken: string, videoId: string, rating: string) => {
    officialCalls.push({ fn: "rate", token: accessToken });
    void videoId;
    void rating;
    return { ok: true as const };
  },
  officialGetRating: async (accessToken: string, videoId: string) => {
    officialCalls.push({ fn: "getRating", token: accessToken });
    void videoId;
    return { ok: true as const, data: { rating: "like" as const } };
  },
  officialSubscriptionStatus: async (accessToken: string, channelId: string) => {
    officialCalls.push({ fn: "subStatus", token: accessToken });
    void channelId;
    return { ok: true as const, data: { subscribed: false, subscriptionId: null } };
  },
  officialSubscribe: async (accessToken: string, channelId: string) => {
    officialCalls.push({ fn: "subscribe", token: accessToken });
    void channelId;
    return { ok: true as const, data: { subscriptionId: "sub_new", channelId } };
  },
  officialUnsubscribeById: async (accessToken: string, subscriptionId: string) => {
    officialCalls.push({ fn: "unsubscribe", token: accessToken });
    void subscriptionId;
    return { ok: true as const };
  },
}));

/* modules under test (imported after the mock, per the established idiom) */
import { proxyVideoLike, resolveActionTier, resolveReadTier } from "@/lib/watch/action-proxy";
import {
  getYouTubeConnection,
  putYouTubeConnection,
  resetYoutubeConnectionStore,
} from "@/lib/auth/youtube-connection-store";
import { decryptSecret, encryptSecret } from "@/lib/youtube/oauth";
import { mintSessionCookie } from "./helpers";

/* ------------------------------------------------------------------ */
/* fixtures + env hygiene                                              */
/* ------------------------------------------------------------------ */

const USER_A = "u_iso_a";
const USER_B = "u_iso_b";
const TOKEN_A = "tok_iso_a";
const TOKEN_B = "tok_iso_b";

let COOKIE_A = "";
let COOKIE_B = "";

const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];
let respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
  new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });

const ENV_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "YT_COOKIES",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  COOKIE_A = await mintSessionCookie({ sub: USER_A });
  COOKIE_B = await mintSessionCookie({ sub: USER_B });
});

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  officialCalls.length = 0;
  fetchLog.length = 0;
  respond = () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  resetYoutubeConnectionStore();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    fetchLog.push({ url: u, init: i });
    return respond(u, i);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }
  resetYoutubeConnectionStore();
});

afterAll(() => {
  mock.module("@/lib/youtube/official-actions", () => realOfficial);
  resetYoutubeConnectionStore();
});

/** A connected record for one user — real encryptSecret token blobs. */
async function connectUser(
  userId: string,
  token: string,
  opts: { status?: "connected" | "needs_reauth"; expired?: boolean; refreshToken?: string | null; corruptAccessBlob?: boolean } = {},
): Promise<void> {
  await putYouTubeConnection({
    userId,
    channelId: `UC_own_${userId}`,
    channelTitle: `Channel of ${userId}`,
    channelThumbUrl: null,
    scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    accessTokenEnc: opts.corruptAccessBlob ? "v1.c2.hazard.c0rrupt" : await encryptSecret(token),
    refreshTokenEnc: opts.refreshToken ? await encryptSecret(opts.refreshToken) : null,
    accessExpiresAt: opts.expired ? Date.now() - 1_000 : Date.now() + 3_600_000,
    status: opts.status ?? "connected",
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

const reqFor = (cookie: string): Request =>
  new Request("http://localhost/api/x", { method: "POST", headers: { cookie } });

/* ------------------------------------------------------------------ */
/* 1. resolveActionTier — the acting user's OWN connection             */
/* ------------------------------------------------------------------ */

describe("resolveActionTier (the per-user action tier)", () => {
  test("user A connected + a fresh token → tier ok with A's OWN token + channel", async () => {
    await connectUser(USER_A, TOKEN_A);
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier.ok).toBe(true);
    if (tier.ok) {
      expect(tier.accessToken).toBe(TOKEN_A);
      expect(tier.user.id).toBe(USER_A);
      expect(tier.channelId).toBe(`UC_own_${USER_A}`);
    }
  });

  test("THE CORE TWO-USER PIN: user B with NO connection → not-connected EVEN THOUGH A IS CONNECTED", async () => {
    await connectUser(USER_A, TOKEN_A); // A is fully connected…
    const tier = await resolveActionTier(reqFor(COOKIE_B)); // …but B acts
    expect(tier).toEqual({ ok: false, kind: "not-connected" });
    expect(officialCalls).toHaveLength(0); // B never reached ANY official call
  });

  test("user B with a needs_reauth record → needs-reauth (never A's token)", async () => {
    await connectUser(USER_A, TOKEN_A);
    await connectUser(USER_B, TOKEN_B, { status: "needs_reauth" });
    const tier = await resolveActionTier(reqFor(COOKIE_B));
    expect(tier).toEqual({ ok: false, kind: "needs-reauth" });
    expect(officialCalls).toHaveLength(0);
  });

  test("a corrupt accessTokenEnc blob → needs-reauth (a key rotation is an honest re-auth)", async () => {
    await connectUser(USER_A, TOKEN_A, { corruptAccessBlob: true });
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier).toEqual({ ok: false, kind: "needs-reauth" });
  });

  test("a guest (no session cookie) → not-connected", async () => {
    await connectUser(USER_A, TOKEN_A);
    const tier = await resolveActionTier(new Request("http://localhost/api/x"));
    expect(tier).toEqual({ ok: false, kind: "not-connected" });
  });

  test("an expired access token + a valid refresh + a successful refresh → the REFRESHED token serves the call AND the store was updated", async () => {
    await connectUser(USER_A, TOKEN_A, { expired: true, refreshToken: "rt_a" });
    respond = () =>
      new Response(
        JSON.stringify({
          access_token: "tok_refreshed",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/youtube.force-ssl",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier.ok).toBe(true);
    if (tier.ok) expect(tier.accessToken).toBe("tok_refreshed");
    // the refresh actually hit Google's token endpoint with the stored grant
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(String(fetchLog[0].init.body)).toContain("refresh_token=rt_a");
    // the store round-trip: the connection now carries the refreshed token
    const stored = await getYouTubeConnection(USER_A);
    expect(stored).not.toBeNull();
    if (stored) {
      expect(stored.status).toBe("connected");
      expect(await decryptSecret(stored.accessTokenEnc)).toBe("tok_refreshed");
      expect(stored.accessExpiresAt).toBeGreaterThan(Date.now());
      expect(await decryptSecret(stored.refreshTokenEnc)).toBe("rt_a"); // the grant kept
    }
  });

  test("an expired access token + a REFUSED refresh (invalid_grant) → needs-reauth AND the record flipped to needs_reauth", async () => {
    await connectUser(USER_A, TOKEN_A, { expired: true, refreshToken: "rt_revoked" });
    respond = () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "revoked" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier).toEqual({ ok: false, kind: "needs-reauth" });
    const stored = await getYouTubeConnection(USER_A);
    expect(stored).not.toBeNull();
    if (stored) expect(stored.status).toBe("needs_reauth"); // markYouTubeConnectionNeedsReauth fired
  });

  test("an expired access token with NO refresh grant → needs-reauth (nothing to refresh)", async () => {
    await connectUser(USER_A, TOKEN_A, { expired: true, refreshToken: null });
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier).toEqual({ ok: false, kind: "needs-reauth" });
    expect(fetchLog).toHaveLength(0); // no refresh was even attempted
  });
});

/* ------------------------------------------------------------------ */
/* 2. the proxy isolation — the wire NEVER crosses users               */
/* ------------------------------------------------------------------ */

describe("the proxy isolation (proxyVideoLike with recorded tokens)", () => {
  test("acting as A with BOTH users connected: every official call presents A's token — never B's", async () => {
    await connectUser(USER_A, TOKEN_A);
    await connectUser(USER_B, TOKEN_B); // B's connection is RIGHT THERE in the store
    const tier = await resolveActionTier(reqFor(COOKIE_A));
    expect(tier.ok).toBe(true);

    const result = await proxyVideoLike(
      "vid_iso_1",
      { value: "like", baseline: { likes: 0, dislikes: 0, yourLike: null } },
      tier,
    );
    expect(result.ok).toBe(true);
    expect(result.path).toBe("oauth-official");
    expect(result.verified).toBe(true); // the mocked getRating confirmed the write
    // the write AND the read-back both carried A's token — B's never appeared
    expect(officialCalls).toEqual([
      { fn: "rate", token: TOKEN_A },
      { fn: "getRating", token: TOKEN_A },
    ]);
    expect(officialCalls.every((c) => c.token === TOKEN_A)).toBe(true);
    expect(officialCalls.some((c) => c.token === TOKEN_B)).toBe(false);
  });

  test("acting as B in the SAME store: every official call presents B's token — never A's", async () => {
    await connectUser(USER_A, TOKEN_A);
    await connectUser(USER_B, TOKEN_B);
    const tier = await resolveActionTier(reqFor(COOKIE_B));
    expect(tier.ok).toBe(true);
    if (!tier.ok) return;

    await proxyVideoLike("vid_iso_2", { value: "like" }, tier);
    expect(officialCalls).toEqual([
      { fn: "rate", token: TOKEN_B },
      { fn: "getRating", token: TOKEN_B },
    ]);
    expect(officialCalls.some((c) => c.token === TOKEN_A)).toBe(false);
  });

  test("B's tier is refused BEFORE any official call when B has no connection (A connected)", async () => {
    await connectUser(USER_A, TOKEN_A);
    const tier = await resolveActionTier(reqFor(COOKIE_B));
    expect(tier.ok).toBe(false);
    await expect(proxyVideoLike("vid_iso_3", { value: "like" }, tier)).rejects.toThrow(
      "Connect your YouTube account to act",
    );
    expect(officialCalls).toHaveLength(0); // isolation by construction
  });
});

/* ------------------------------------------------------------------ */
/* 3. THE STRUCTURAL PROOF — isolation by construction, read as text   */
/* ------------------------------------------------------------------ */

const REPO_ROOT = resolve(import.meta.dir, "..");

/**
 * Extract every module specifier the source imports (static `from "…"`,
 * dynamic `import("…")`, `require("…")`). Whole-text regex on purpose: for a
 * proof of ABSENCE over-matching is safe (a false hit demands a look),
 * under-matching would be a hole. The doc comments in these files mention
 * @/lib/broker WITHOUT quotes, so they never match `from "…"`.
 */
function moduleSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const from = /\bfrom\s*["']([^"']+)["']/g;
  const dyn = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [from, dyn]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("THE STRUCTURAL PROOF (the work order's literal law, pinned as text)", () => {
  test("src/lib/watch/action-proxy.ts imports NEITHER @/lib/broker NOR @/lib/youtube-direct", async () => {
    const src = await Bun.file(join(REPO_ROOT, "src/lib/watch/action-proxy.ts")).text();
    const specs = moduleSpecifiers(src);
    expect(specs).not.toContain("@/lib/broker");
    expect(specs).not.toContain("@/lib/youtube-direct");
    // sanity: the extraction really sees the module's real imports
    expect(specs).toContain("@/lib/youtube/official-actions");
    expect(specs).toContain("@/lib/auth/youtube-connection-store");
  });

  test("src/lib/community/action-proxy.ts imports NEITHER @/lib/broker NOR @/lib/youtube-direct", async () => {
    const src = await Bun.file(join(REPO_ROOT, "src/lib/community/action-proxy.ts")).text();
    const specs = moduleSpecifiers(src);
    expect(specs).not.toContain("@/lib/broker");
    expect(specs).not.toContain("@/lib/youtube-direct");
    expect(specs.length).toBeGreaterThan(0);
  });

  test("the live-chat send module (src/lib/livechat/send.ts — what live-chat-panel sends through now) does NOT import @/lib/broker", async () => {
    const src = await Bun.file(join(REPO_ROOT, "src/lib/livechat/send.ts")).text();
    const specs = moduleSpecifiers(src);
    expect(specs).not.toContain("@/lib/broker");
    expect(specs).not.toContain("@/lib/youtube-direct");
    // the module stays client-safe: only the DTO type rides along
    expect(specs).toEqual(["@/lib/youtube/livechat"]);
  });

  test("NO route file under src/app/api/ imports @/lib/broker (enumerated by recursive readdir)", async () => {
    const files = readdirSync(join(REPO_ROOT, "src/app/api"), { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(40); // the walk really enumerated the route tree
    const violators: string[] = [];
    for (const f of files) {
      const src = await Bun.file(join(REPO_ROOT, "src/app/api", f)).text();
      if (moduleSpecifiers(src).includes("@/lib/broker")) violators.push(f);
    }
    // Expected: NONE — no end-user write route can reach the shared broker
    // tab. (The surviving @/lib/broker imports live in the READ lane under
    // src/lib/youtube/*.ts, outside src/app/api/.)
    expect(violators).toEqual([]);
  });

  test("the operator cookie env (YT_COOKIES) is READ nowhere in the action-proxy text (no process.env.YT_COOKIES on the mutation path)", async () => {
    const src = await Bun.file(join(REPO_ROOT, "src/lib/watch/action-proxy.ts")).text();
    expect(src).not.toContain("env.YT_COOKIES"); // no global operator cookie read
    expect(src).not.toContain('"YT_COOKIES"');
    expect(src).not.toContain("'YT_COOKIES'");
  });
});

/* ------------------------------------------------------------------ */
/* 4. resolveReadTier — the user's token or null, never the operator   */
/* ------------------------------------------------------------------ */

describe("resolveReadTier (the per-user read tier)", () => {
  test("a connected user → their OWN token + channel", async () => {
    await connectUser(USER_A, TOKEN_A);
    const tier = await resolveReadTier(reqFor(COOKIE_A));
    expect(tier).toEqual({ accessToken: TOKEN_A, channelId: `UC_own_${USER_A}` });
  });

  test("an unconnected user → null — NEVER an operator fallback (YT_COOKIES set and still null)", async () => {
    process.env.YT_COOKIES = "SAPISID=operator-session; SID=x"; // the operator cookie exists…
    await connectUser(USER_B, TOKEN_B); // …and someone else is connected…
    const tier = await resolveReadTier(reqFor(COOKIE_A)); // …but A reads
    expect(tier).toBeNull(); // A's own connection or nothing — the isolation law
  });

  test("a connected user WITH the operator cookie set → still the USER's token, not the operator session", async () => {
    process.env.YT_COOKIES = "SAPISID=operator-session; SID=x";
    await connectUser(USER_A, TOKEN_A);
    const tier = await resolveReadTier(reqFor(COOKIE_A));
    expect(tier).not.toBeNull();
    if (tier) expect(tier.accessToken).toBe(TOKEN_A);
  });

  test("a guest → null", async () => {
    await connectUser(USER_B, TOKEN_B);
    const tier = await resolveReadTier(new Request("http://localhost/api/x"));
    expect(tier).toBeNull();
  });
});
