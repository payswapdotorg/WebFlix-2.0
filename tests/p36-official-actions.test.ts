/**
 * WFX2-P36-C tests — the official-actions ADAPTER CONTRACT battery.
 *
 * The seam under test: src/lib/youtube/official-actions.ts — the ONLY
 * end-user write lane, exercised against a mocked globalThis.fetch (NO
 * network; the youtube-direct.test.ts fetch-swap idiom). Every family pins
 * the TYPED outcome (never a raw exception):
 *
 *  - success shapes (204 → ok; resource bodies mapped to rows);
 *  - malformed 2xx bodies → the honest "malformed" kind (a 2xx is never
 *    alone a success claim — the P36 law);
 *  - 400/401/403/409 → "http-error" with the provider's status;
 *  - 403 quota reasons → the dedicated "quota" kind;
 *  - fetch throws → "timeout" (TimeoutError) vs "network" (anything else);
 *  - the capped pagination laws (5 pages max, the 6th token never fetched);
 *  - the WL/LL up-front rejection (ZERO fetch calls);
 *  - the partial-safe playlist update (title-only change never clears the
 *    description).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { YOUTUBE_DATA_API_BASE } from "@/lib/youtube/oauth";
import {
  officialCreatePlaylist,
  officialDeletePlaylist,
  officialGetRating,
  officialListPlaylists,
  officialPlaylistAdd,
  officialPlaylistMembership,
  officialPlaylistRemoveById,
  officialRateVideo,
  officialSubscribe,
  officialSubscriptionStatus,
  officialUnsubscribeById,
  officialUpdatePlaylist,
} from "@/lib/youtube/official-actions";

/* ------------------------------------------------------------------ */
/* the fetch swap — controllable responses, recorded wire              */
/* ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];

/** The per-test responder (default: an empty 200 JSON body). */
let respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
  jsonResponse({});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const noContent = (): Response => new Response(null, { status: 204 });

/** A thrown named error (the AbortSignal.timeout() shape for TimeoutError). */
const namedError = (name: string, message = name): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

beforeEach(() => {
  fetchLog.length = 0;
  respond = () => jsonResponse({});
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    fetchLog.push({ url: u, init: i });
    return respond(u, i);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const callsTo = (fragment: string): number =>
  fetchLog.filter((c) => c.url.includes(fragment)).length;

const bearerOf = (call: { init: RequestInit }): string => {
  const h = call.init.headers as Record<string, string>;
  return h.Authorization ?? "";
};

/* ------------------------------------------------------------------ */
/* officialRateVideo — the like/dislike/none write                     */
/* ------------------------------------------------------------------ */

describe("officialRateVideo (POST videos.rate)", () => {
  test("204 → {ok:true}; the wire: POST /videos/rate with the acting user's Bearer token", async () => {
    respond = () => noContent();
    const r = await officialRateVideo("tok_user", "vid1", "like");
    expect(r.ok).toBe(true);
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe(`${YOUTUBE_DATA_API_BASE}/videos/rate?id=vid1&rating=like`);
    expect(fetchLog[0].init.method).toBe("POST");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
  });

  test("400 → kind http-error with the provider's status + message", async () => {
    respond = () =>
      jsonResponse(
        { error: { code: 400, message: "Invalid rating", errors: [{ reason: "badRequest" }] } },
        400,
      );
    const r = await officialRateVideo("tok", "vid1", "like");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(400);
      expect(r.message).toBe("Invalid rating");
    }
  });

  test("401 → kind http-error status 401", async () => {
    respond = () =>
      jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401);
    const r = await officialRateVideo("tok", "vid1", "like");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(401);
    }
  });

  test("403 with a non-quota reason → kind http-error status 403", async () => {
    respond = () =>
      jsonResponse(
        { error: { code: 403, message: "Forbidden", errors: [{ reason: "forbidden" }] } },
        403,
      );
    const r = await officialRateVideo("tok", "vid1", "like");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(403);
    }
  });

  for (const reason of ["quotaExceeded", "rateExceeded", "dailyLimitExceeded"]) {
    test(`403 quota reason ${reason} → the dedicated kind "quota"`, async () => {
      respond = () =>
        jsonResponse(
          { error: { code: 403, message: "Quota", errors: [{ reason }] } },
          403,
        );
      const r = await officialRateVideo("tok", "vid1", "like");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe("quota");
        expect(r.status).toBe(403);
        expect(r.message).toBe("YouTube API quota exceeded for today");
      }
    });
  }

  test("fetch throws TimeoutError → kind timeout, status 0", async () => {
    respond = () => {
      throw namedError("TimeoutError");
    };
    const r = await officialRateVideo("tok", "vid1", "like");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("timeout");
      expect(r.status).toBe(0);
    }
  });

  test("fetch throws (other) → kind network, status 0", async () => {
    respond = () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await officialRateVideo("tok", "vid1", "like");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("network");
      expect(r.status).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* officialGetRating — THE authenticated read-back                     */
/* ------------------------------------------------------------------ */

describe("officialGetRating (GET videos.getRating — the read-back)", () => {
  test("like / dislike / none map to ok reads; the wire: GET with the Bearer token", async () => {
    for (const rating of ["like", "dislike", "none"] as const) {
      respond = () => jsonResponse({ items: [{ videoId: "vid1", rating }] });
      const r = await officialGetRating("tok_user", "vid1");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.rating).toBe(rating);
    }
    expect(fetchLog).toHaveLength(3);
    expect(fetchLog[0].url).toBe(`${YOUTUBE_DATA_API_BASE}/videos/getRating?id=vid1`);
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
  });

  test("items with a different videoId → the find falls back to items[0] (honest read)", async () => {
    respond = () => jsonResponse({ items: [{ videoId: "other", rating: "dislike" }] });
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rating).toBe("dislike");
  });

  test("items absent → malformed (no recognizable rating — never a guess)", async () => {
    respond = () => jsonResponse({});
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("getRating carried no recognizable rating");
    }
  });

  test("rating garbage string → malformed", async () => {
    respond = () => jsonResponse({ items: [{ videoId: "vid1", rating: "maybe" }] });
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("malformed");
  });

  test("empty items → malformed", async () => {
    respond = () => jsonResponse({ items: [] });
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("malformed");
  });

  test("non-JSON 2xx body → malformed (a 2xx is never alone a success claim)", async () => {
    respond = () => new Response("gateway drivel", { status: 200 });
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("the YouTube API response was malformed");
    }
  });

  test("403 quota on the read-back → kind quota (honest unknown, never a fake read)", async () => {
    respond = () =>
      jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403);
    const r = await officialGetRating("tok", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("quota");
  });
});

/* ------------------------------------------------------------------ */
/* officialSubscriptionStatus — the authenticated subscription read    */
/* ------------------------------------------------------------------ */

describe("officialSubscriptionStatus (subscriptions.list read-back)", () => {
  const sub = (id: string, channelId: string) => ({
    id,
    snippet: { resourceId: { channelId } },
  });

  test("filtered mine+forChannelId hit → subscribed:true + the subscriptionId; ONE call", async () => {
    respond = () => jsonResponse({ items: [sub("sub_hit", "UC1")] });
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscribed).toBe(true);
      expect(r.data.subscriptionId).toBe("sub_hit");
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toContain("forChannelId=UC1");
    expect(fetchLog[0].url).toContain("mine=true");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok");
  });

  test("the hit is FOUND by resourceId.channelId (a decoy row first is skipped)", async () => {
    respond = () => jsonResponse({ items: [sub("sub_decoy", "UC9"), sub("sub_hit", "UC1")] });
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscribed).toBe(true);
      expect(r.data.subscriptionId).toBe("sub_hit");
    }
  });

  test("empty filtered answer → subscribed:false (an items array present = a real miss)", async () => {
    respond = () => jsonResponse({ items: [] });
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscribed).toBe(false);
      expect(r.data.subscriptionId).toBeNull();
    }
  });

  test("filtered 401 → returned AS-IS (no own-list scan fallback)", async () => {
    respond = () => jsonResponse({ error: { code: 401, message: "Invalid Credentials" } }, 401);
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(401);
    }
    expect(fetchLog).toHaveLength(1); // the scan NEVER ran
  });

  test("filtered 400 → the capped own-list scan: pageToken rides, hit on page 2", async () => {
    respond = (url) => {
      if (url.includes("forChannelId")) {
        return jsonResponse({ error: { code: 400, message: "filter rejected" } }, 400);
      }
      if (url.includes("pageToken=tok2")) {
        return jsonResponse({ items: [sub("sub_p2", "UC1")] });
      }
      return jsonResponse({
        items: [sub("sub_p1_other", "UCother")],
        nextPageToken: "tok2",
      });
    };
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscribed).toBe(true);
      expect(r.data.subscriptionId).toBe("sub_p2");
    }
    // 1 filtered read + 2 scan pages; the token from page 1 rode on page 2
    expect(fetchLog).toHaveLength(3);
    const scan2 = fetchLog[2];
    expect(scan2.url).toContain("mine=true");
    expect(scan2.url).toContain("pageToken=tok2");
  });

  test("filtered 400 → the scan ends honestly when a page has no nextPageToken", async () => {
    respond = (url) => {
      if (url.includes("forChannelId")) {
        return jsonResponse({ error: { code: 400 } }, 400);
      }
      return jsonResponse({ items: [sub("sub_other", "UCother")] }); // no nextPageToken
    };
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.subscribed).toBe(false);
    expect(fetchLog).toHaveLength(2);
  });

  test("5 pages exhausted with a token still present → the honest malformed-kind unknown", async () => {
    respond = (url) => {
      if (url.includes("forChannelId")) {
        return jsonResponse({ error: { code: 400 } }, 400);
      }
      // every scan page misses AND still offers a next token
      return jsonResponse({
        items: [sub("sub_other", "UCother")],
        nextPageToken: `more-${fetchLog.length}`,
      });
    };
    const r = await officialSubscriptionStatus("tok", "UC1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.status).toBe(200);
      expect(r.message).toBe("subscription state beyond the read-back page cap — unknown");
    }
    // 1 filtered + exactly 5 scan pages — the 6th token was never fetched
    expect(fetchLog).toHaveLength(6);
  });
});

/* ------------------------------------------------------------------ */
/* officialSubscribe — the response body IS the created resource       */
/* ------------------------------------------------------------------ */

describe("officialSubscribe (POST subscriptions.insert)", () => {
  test("the created resource body → ok with the subscriptionId; the wire body pins the target channel", async () => {
    respond = () =>
      jsonResponse({ id: "sub_new", snippet: { resourceId: { channelId: "UC1" } } });
    const r = await officialSubscribe("tok_user", "UC1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.subscriptionId).toBe("sub_new");
      expect(r.data.channelId).toBe("UC1");
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe(`${YOUTUBE_DATA_API_BASE}/subscriptions?part=snippet`);
    expect(fetchLog[0].init.method).toBe("POST");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
    const body = JSON.parse(String(fetchLog[0].init.body));
    expect(body).toEqual({
      snippet: { resourceId: { kind: "youtube#channel", channelId: "UC1" } },
    });
  });

  test("malformed 2xx body → the honest malformed kind", async () => {
    respond = () => new Response("<html>oops</html>", { status: 200 });
    const r = await officialSubscribe("tok", "UC1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("the YouTube API response was malformed");
    }
  });

  test("409 duplicate subscription → kind http-error with status 409", async () => {
    respond = () =>
      jsonResponse(
        { error: { code: 409, message: "The subscription that you are trying to create already exists" } },
        409,
      );
    const r = await officialSubscribe("tok", "UC1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(409);
    }
  });
});

/* ------------------------------------------------------------------ */
/* the plain delete families — 204 ok / 404 http-error                 */
/* ------------------------------------------------------------------ */

describe("the delete families (subscriptions.delete / playlists.delete / playlistItems.delete)", () => {
  const cases = [
    {
      name: "officialUnsubscribeById",
      fn: () => officialUnsubscribeById("tok", "sub_1"),
      url: `${YOUTUBE_DATA_API_BASE}/subscriptions/delete?id=sub_1`,
    },
    {
      name: "officialDeletePlaylist",
      fn: () => officialDeletePlaylist("tok", "PL1"),
      url: `${YOUTUBE_DATA_API_BASE}/playlists/delete?id=PL1`,
    },
    {
      name: "officialPlaylistRemoveById",
      fn: () => officialPlaylistRemoveById("tok", "PI1"),
      url: `${YOUTUBE_DATA_API_BASE}/playlistItems/delete?id=PI1`,
    },
  ];

  for (const c of cases) {
    test(`${c.name}: 204 → ok; DELETE on the exact url with the Bearer token`, async () => {
      respond = () => noContent();
      const r = await c.fn();
      expect(r.ok).toBe(true);
      expect(fetchLog).toHaveLength(1);
      expect(fetchLog[0].url).toBe(c.url);
      expect(fetchLog[0].init.method).toBe("DELETE");
      expect(bearerOf(fetchLog[0])).toBe("Bearer tok");
    });

    test(`${c.name}: 404 → kind http-error with status 404`, async () => {
      respond = () => new Response(null, { status: 404 });
      const r = await c.fn();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe("http-error");
        expect(r.status).toBe(404);
        expect(r.message).toBe("the YouTube API answered 404");
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* officialListPlaylists — pagination + the row mapping                */
/* ------------------------------------------------------------------ */

describe("officialListPlaylists (GET playlists.list mine)", () => {
  const resource = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    snippet: {
      title: `Title ${id}`,
      description: `Desc ${id}`,
      thumbnails: { default: { url: `https://t/${id}.jpg` } },
    },
    status: { privacyStatus: "public" },
    contentDetails: { itemCount: 3 },
    ...over,
  });

  test("multi-page pagination: the nextPageToken rides; rows map end-to-end", async () => {
    respond = (url) => {
      if (url.includes("pageToken=p2")) {
        return jsonResponse({
          items: [
            {
              id: "PL2",
              snippet: {
                title: "T2",
                thumbnails: { medium: { url: "https://t/med2.jpg" } },
              },
              status: { privacyStatus: "unlisted" },
            },
          ],
        });
      }
      return jsonResponse({ items: [resource("PL1")], nextPageToken: "p2" });
    };
    const r = await officialListPlaylists("tok_user");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(2);
      // the fully-populated row
      expect(r.data[0]).toEqual({
        id: "PL1",
        title: "Title PL1",
        visibility: "public",
        itemCount: 3,
        thumbUrl: "https://t/PL1.jpg",
        description: "Desc PL1",
      });
      // the degraded row: medium thumb fallback, itemCount 0, description null
      expect(r.data[1]).toEqual({
        id: "PL2",
        title: "T2",
        visibility: "unlisted",
        itemCount: 0,
        thumbUrl: "https://t/med2.jpg",
        description: null,
      });
    }
    expect(fetchLog).toHaveLength(2);
    expect(fetchLog[0].url).toContain("mine=true");
    expect(fetchLog[0].url).toContain("part=snippet%2Cstatus%2CcontentDetails");
    expect(fetchLog[1].url).toContain("pageToken=p2");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
  });

  test("privacyStatus garbage/absent → the private fallback", async () => {
    respond = () =>
      jsonResponse({
        items: [
          resource("PLX", { status: { privacyStatus: "friendsOnly" } }),
          { id: "PLY", snippet: { title: "T no-status" } },
        ],
      });
    const r = await officialListPlaylists("tok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.map((p) => p.visibility)).toEqual(["private", "private"]);
    }
  });

  test("a resource missing id/title is SKIPPED (mapPlaylistRow null), not fatal", async () => {
    respond = () =>
      jsonResponse({
        items: [
          { id: "PL_broken" }, // no snippet.title → skipped
          { snippet: { title: "no id" } }, // no id → skipped
          resource("PL_good"),
        ],
      });
    const r = await officialListPlaylists("tok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.map((p) => p.id)).toEqual(["PL_good"]);
    }
  });

  test("capped at 5 pages — the 6th token is never fetched", async () => {
    respond = () =>
      jsonResponse({ items: [resource(`PL_${fetchLog.length}`)], nextPageToken: "keep-going" });
    const r = await officialListPlaylists("tok");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(5); // the first 250, honest truncation
    expect(callsTo("/playlists?")).toBe(5);
  });

  test("a mid-list page failure → the typed failure propagates (never partial success)", async () => {
    respond = (url) => {
      if (url.includes("pageToken=p2")) {
        return jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403);
      }
      return jsonResponse({ items: [resource("PL1")], nextPageToken: "p2" });
    };
    const r = await officialListPlaylists("tok");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("quota");
  });
});

/* ------------------------------------------------------------------ */
/* officialCreatePlaylist — insert + the honest malformed              */
/* ------------------------------------------------------------------ */

describe("officialCreatePlaylist (POST playlists.insert)", () => {
  test("ok mapping: the created resource maps to a row; the wire body pins title+privacy", async () => {
    respond = () =>
      jsonResponse({
        id: "PL_new",
        snippet: { title: "My List", description: null, thumbnails: {} },
        status: { privacyStatus: "private" },
        contentDetails: { itemCount: 0 },
      });
    const r = await officialCreatePlaylist("tok_user", "My List", "private");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        id: "PL_new",
        title: "My List",
        visibility: "private",
        itemCount: 0,
        thumbUrl: null,
        description: null,
      });
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].init.method).toBe("POST");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
    const body = JSON.parse(String(fetchLog[0].init.body));
    expect(body).toEqual({
      snippet: { title: "My List" },
      status: { privacyStatus: "private" },
    });
  });

  test("a malformed created resource (no id) → the honest malformed kind", async () => {
    respond = () => jsonResponse({ snippet: { title: "x" } }); // 2xx but no id
    const r = await officialCreatePlaylist("tok", "My List", "public");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.message).toBe("the created playlist resource was malformed");
    }
  });
});

/* ------------------------------------------------------------------ */
/* officialUpdatePlaylist — the partial-safe fetch-merge-put           */
/* ------------------------------------------------------------------ */

describe("officialUpdatePlaylist (the partial-safe PUT)", () => {
  const current = {
    id: "PL1",
    snippet: { title: "Old Title", description: "KEEP ME DESCRIPTION" },
    status: { privacyStatus: "unlisted" },
  };

  test("a title-only change PRESERVES the current description in the PUT body", async () => {
    const puts: { body: string }[] = [];
    respond = (url, init) => {
      if (init.method === "PUT") {
        puts.push({ body: String(init.body) });
        return jsonResponse({
          id: "PL1",
          snippet: { title: "New Title", description: "KEEP ME DESCRIPTION" },
          status: { privacyStatus: "unlisted" },
        });
      }
      return jsonResponse({ items: [current] }); // the pre-fetch
    };
    const r = await officialUpdatePlaylist("tok_user", "PL1", { title: "New Title" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBe("New Title");
      expect(r.data.description).toBe("KEEP ME DESCRIPTION");
      expect(r.data.visibility).toBe("unlisted");
    }
    // the pre-fetch (merge base), then exactly one PUT
    expect(fetchLog).toHaveLength(2);
    expect(fetchLog[0].url).toContain("id=PL1");
    expect(fetchLog[1].init.method).toBe("PUT");
    expect(fetchLog[1].url).toBe(`${YOUTUBE_DATA_API_BASE}/playlists?part=snippet,status`);
    expect(bearerOf(fetchLog[1])).toBe("Bearer tok_user");
    const putBody = JSON.parse(puts[0].body);
    // THE partial-safe law: the omitted description rides through unchanged
    expect(putBody.snippet.description).toBe("KEEP ME DESCRIPTION");
    expect(putBody.snippet.title).toBe("New Title");
    // the omitted visibility falls back to the CURRENT privacyStatus
    expect(putBody.status.privacyStatus).toBe("unlisted");
    expect(putBody.id).toBe("PL1");
  });

  test("a description-only change preserves the current title (the merge works both ways)", async () => {
    respond = (url, init) => {
      if (init.method === "PUT") {
        return jsonResponse({
          id: "PL1",
          snippet: { title: "Old Title", description: "New Desc" },
          status: { privacyStatus: "unlisted" },
        });
      }
      return jsonResponse({ items: [current] });
    };
    const r = await officialUpdatePlaylist("tok", "PL1", { description: "New Desc" });
    expect(r.ok).toBe(true);
    const putBody = JSON.parse(String(fetchLog[1].init.body));
    expect(putBody.snippet.title).toBe("Old Title");
    expect(putBody.snippet.description).toBe("New Desc");
  });

  test("the pre-fetch answers 404 → the typed http-error 404 (honest miss, never a blind PUT)", async () => {
    respond = () => jsonResponse({ error: { code: 404, message: "Playlist not found" } }, 404);
    const r = await officialUpdatePlaylist("tok", "PL1", { title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("http-error");
      expect(r.status).toBe(404);
    }
    expect(fetchLog).toHaveLength(1); // NO PUT was attempted
  });

  test("a 2xx pre-fetch with NO items → the honest malformed 404 'could not be read before updating'", async () => {
    respond = () => jsonResponse({ items: [] }); // 2xx but the playlist is unreadable
    const r = await officialUpdatePlaylist("tok", "PL1", { title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.status).toBe(404);
      expect(r.message).toBe("the playlist could not be read before updating");
    }
    expect(fetchLog).toHaveLength(1); // NO PUT was attempted
  });
});

/* ------------------------------------------------------------------ */
/* the playlistItems family — WL/LL up-front + membership/add/delete   */
/* ------------------------------------------------------------------ */

describe("the playlistItems family", () => {
  test("WL is rejected UP-FRONT for the membership read — ZERO fetch calls", async () => {
    const r = await officialPlaylistMembership("tok", "WL", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.status).toBe(400);
      expect(r.message).toBe("WL/LL system playlists are not readable/writable through the Data API");
    }
    expect(fetchLog).toHaveLength(0);
  });

  test("LL is rejected UP-FRONT for the add — ZERO fetch calls", async () => {
    const r = await officialPlaylistAdd("tok", "LL", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("malformed");
      expect(r.status).toBe(400);
      expect(r.message).toBe("WL/LL system playlists are not writable through the Data API");
    }
    expect(fetchLog).toHaveLength(0);
  });

  test("WL is rejected UP-FRONT for the add too — ZERO fetch calls", async () => {
    const r = await officialPlaylistAdd("tok", "WL", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("malformed");
    expect(fetchLog).toHaveLength(0);
  });

  test("membership: the hit is FOUND by snippet.resourceId.videoId (a decoy row is skipped)", async () => {
    respond = () =>
      jsonResponse({
        items: [
          { id: "PI_other", snippet: { resourceId: { videoId: "vid9" } } },
          { id: "PI_1", snippet: { resourceId: { videoId: "vid1" } } },
        ],
      });
    const r = await officialPlaylistMembership("tok_user", "PL1", "vid1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contains).toBe(true);
      expect(r.data.itemId).toBe("PI_1");
    }
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toContain("playlistId=PL1");
    expect(fetchLog[0].url).toContain("videoId=vid1");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
  });

  test("membership: no matching videoId → contains:false, itemId null (an honest miss)", async () => {
    respond = () =>
      jsonResponse({ items: [{ id: "PI_other", snippet: { resourceId: { videoId: "vid9" } } }] });
    const r = await officialPlaylistMembership("tok", "PL1", "vid1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.contains).toBe(false);
      expect(r.data.itemId).toBeNull();
    }
  });

  test("membership: empty items → the honest miss (contains:false)", async () => {
    respond = () => jsonResponse({ items: [] });
    const r = await officialPlaylistMembership("tok", "PL1", "vid1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contains).toBe(false);
  });

  test("add: the created playlistItem resource → ok with the itemId; the wire body pins playlist+video", async () => {
    respond = () => jsonResponse({ id: "PI_new" });
    const r = await officialPlaylistAdd("tok_user", "PL1", "vid1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.itemId).toBe("PI_new");
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].url).toBe(`${YOUTUBE_DATA_API_BASE}/playlistItems?part=snippet`);
    expect(fetchLog[0].init.method).toBe("POST");
    expect(bearerOf(fetchLog[0])).toBe("Bearer tok_user");
    const body = JSON.parse(String(fetchLog[0].init.body));
    expect(body).toEqual({
      snippet: { playlistId: "PL1", resourceId: { kind: "youtube#video", videoId: "vid1" } },
    });
  });

  test("add: malformed 2xx body → the honest malformed kind", async () => {
    respond = () => new Response("garbage", { status: 200 });
    const r = await officialPlaylistAdd("tok", "PL1", "vid1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("malformed");
  });
});
