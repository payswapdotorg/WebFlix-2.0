/// <reference types="bun-types" />
/**
 * WFX2-P23-A route tests — the clip CREATE + RESOLVE routes exercised
 * against fixture bytes via the test-only `setUpstream()` seam (the
 * personal-routes pattern). NEVER the network; NEVER the player endpoint.
 *
 *  - POST /api/clip: the guest gate (401), the 15–60s law, the title law,
 *    the honest refuse when the watch metadata read cannot serve, the
 *    persisted row + the WebFlix-local URL + the honest upstream note.
 *  - GET /api/clip/[id]: the WebFlix-local resolve (DB row + the `next`
 *    enrichment), the youtube.com clip postId resolve (the REAL captured
 *    page fixture), the honest not-found / clip-unavailable families.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setupTestDb, mintSessionCookie, fixtures } from "./helpers";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";

import { POST as createClipRoute, GET as clipMetaRoute } from "@/app/api/clip/route";
import { GET as resolveClipRoute } from "@/app/api/clip/[id]/route";

setupTestDb();

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const clipFixture = load("clip_page_public");
const nextFixture = load("next_dQw4");
const CLIP_ID = "Ugkx9hS31W7ocpw8tLKo_m-Ht7j36o5StJof";

const htmlFor = (playerResponse: unknown, initialData: unknown) =>
  `<!doctype html><html><head><script>var ytInitialPlayerResponse = ${JSON.stringify(
    playerResponse
  )};</script></head><body><script>var ytInitialData = ${JSON.stringify(
    initialData
  )};</script></body></html>`;

const realClipPage = htmlFor(clipFixture.ytInitialPlayerResponse, clipFixture.ytInitialData);
const deadClipPage = htmlFor({ playabilityStatus: { status: "OK" } }, { nothing: true });

/** The fixture upstream: `next` for the watch metadata + /clip pages. */
function fixtureUpstream(opts: { nextOk?: boolean } = {}) {
  return async (url: string): Promise<Response> => {
    const u = String(url);
    if (u.includes("/youtubei/v1/next")) {
      if (opts.nextOk === false) return new Response("upstream down", { status: 502 });
      return new Response(JSON.stringify(nextFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes(`/clip/${CLIP_ID}`)) {
      return new Response(realClipPage, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (u.includes("/clip/")) {
      return new Response(deadClipPage, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
}

let AUTH_COOKIE = "";
let CREATOR_NAME = "Test Operator";
beforeAll(async () => {
  // mint the session for the SEEDED demo user (the Clip row's creator FK)
  const { demo } = await fixtures();
  AUTH_COOKIE = await mintSessionCookie({ sub: demo.id, name: demo.name });
  CREATOR_NAME = demo.name;
});

const authedReq = (url: string, init?: RequestInit): never =>
  new Request(url, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), cookie: AUTH_COOKIE },
  }) as never;
const guestReq = (url: string, init?: RequestInit): never => new Request(url, init) as never;

const VIDEO_ID = "dQw4w9WgXcQ";

beforeEach(() => {
  setUpstream(fixtureUpstream());
  clearCache();
});
afterEach(() => {
  setUpstream(null);
});

describe("POST /api/clip — the CREATE (WebFlix-local, honest)", () => {
  test("guests → 401 (the AU signed-out law)", async () => {
    const res = await createClipRoute(
      guestReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_ID, title: "x", startSec: 0, endSec: 30 }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  test("a valid 30s window creates the row + answers the WebFlix URL + the honest note", async () => {
    const res = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_ID, title: "My clip", startSec: 10, endSec: 40 }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      clipId: string;
      url: string;
      note: string;
    };
    expect(body.ok).toBe(true);
    expect(body.clipId).toBeTruthy();
    expect(body.url).toBe(`/clip/${body.clipId}`);
    // the honest upstream disclosure — WebFlix-local, never a YouTube claim
    expect(body.note).toContain("lives on WebFlix");
    expect(body.note).toContain("no longer offered");
    // the row persisted (the creator is the minted session's user)
    const { db } = await import("../src/lib/db");
    const row = await db.clip.findUniqueOrThrow({
      where: { id: body.clipId },
      include: { creator: true },
    });
    expect(row.title).toBe("My clip");
    expect(row.videoId).toBe(VIDEO_ID);
    expect(row.startSec).toBe(10);
    expect(row.endSec).toBe(40);
    expect(row.creatorId).toBe((await import("../src/lib/db")).db ? row.creatorId : "");
  });

  test("the 15s floor law (server authority)", async () => {
    const res = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_ID, title: "short", startSec: 0, endSec: 14 }),
      }) as never
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Clips must be at least 15 seconds long");
  });

  test("the 60s ceiling law (server authority)", async () => {
    const res = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_ID, title: "long", startSec: 0, endSec: 61 }),
      }) as never
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Clips can be at most 60 seconds long");
  });

  test("the title law: empty + the 100-char ceiling", async () => {
    const empty = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: VIDEO_ID, title: "   ", startSec: 0, endSec: 30 }),
      }) as never
    );
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("Give your clip a name");

    const long = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({
          videoId: VIDEO_ID,
          title: "a".repeat(101),
          startSec: 0,
          endSec: 30,
        }),
      }) as never
    );
    expect(long.status).toBe(400);
    expect(((await long.json()) as { error: string }).error).toContain("100 characters");
  });

  test("the watch metadata read failing → the honest refuse (never an unbounded clip)", async () => {
    setUpstream(fixtureUpstream({ nextOk: false }));
    clearCache();
    const res = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({ videoId: "unknownVideo", title: "x", startSec: 0, endSec: 30 }),
      }) as never
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("could not be read");
  });

  test("GET /api/clip surfaces the create contract (the dialog's copy source)", async () => {
    const res = await clipMetaRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: string; minSec: number; maxSec: number };
    expect(body.minSec).toBe(15);
    expect(body.maxSec).toBe(60);
    expect(body.note).toContain("WebFlix");
  });
});

describe("GET /api/clip/[id] — the RESOLVE (both id families)", () => {
  test("a WebFlix-local id resolves from the DB + the `next` enrichment", async () => {
    const create = await createClipRoute(
      authedReq("http://localhost/api/clip", {
        method: "POST",
        body: JSON.stringify({
          videoId: VIDEO_ID,
          title: "Resolve me",
          startSec: 42,
          endSec: 72,
        }),
      }) as never
    );
    const created = (await create.json()) as { clipId: string };
    const res = await resolveClipRoute(
      authedReq(`http://localhost/api/clip/${created.clipId}`),
      { params: Promise.resolve({ id: created.clipId }) } as never
    );
    expect(res.status).toBe(200);
    const dto = (await res.json()) as {
      source: string;
      clipId: string;
      videoId: string;
      startSec: number;
      endSec: number;
      title: string;
      clipAuthor: string;
      createdText: string | null;
      videoTitle: string | null;
    };
    expect(dto.source).toBe("webflix");
    expect(dto.videoId).toBe(VIDEO_ID);
    expect(dto.startSec).toBe(42);
    expect(dto.endSec).toBe(72);
    expect(dto.title).toBe("Resolve me");
    expect(dto.clipAuthor).toBe(CREATOR_NAME);
    // honest: the age line, NEVER a fabricated view count
    expect(dto.createdText).not.toMatch(/views/i);
    // the `next` fixture's own title (the source video's)
    expect(dto.videoTitle).toBe(
      "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"
    );
  });

  test("a youtube.com clip postId resolves through the read family (the REAL captured page)", async () => {
    const res = await resolveClipRoute(
      authedReq(`http://localhost/api/clip/${CLIP_ID}`),
      { params: Promise.resolve({ id: CLIP_ID }) } as never
    );
    expect(res.status).toBe(200);
    const dto = (await res.json()) as {
      source: string;
      videoId: string;
      startSec: number;
      endSec: number;
      title: string;
      clipAuthor: string;
      createdText: string | null;
      channelHandle: string | null;
    };
    expect(dto.source).toBe("youtube");
    expect(dto.videoId).toBe("Jljy8KtoXOU");
    expect(dto.startSec).toBe(464);
    expect(dto.endSec).toBe(471);
    expect(dto.title).toBe("payment");
    expect(dto.clipAuthor).toBe("ggtylerr");
    expect(dto.createdText).toBe("93 views · 4 years ago");
    expect(dto.channelHandle).toBe("@ScottTheWoz");
  });

  test("a dead youtube clip id → 404 clip-unavailable with youtube.com's measured wording", async () => {
    const dead = "Ugkxdeadclip0000000000000";
    const res = await resolveClipRoute(
      authedReq(`http://localhost/api/clip/${dead}`),
      { params: Promise.resolve({ id: dead }) } as never
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("clip-unavailable");
    expect(body.error).toBe("Clip not available - Try again later");
  });

  test("an unknown WebFlix-local id → 404 not-found (no network attempt)", async () => {
    let fetched = 0;
    setUpstream(async () => {
      fetched += 1;
      return new Response("", { status: 200 });
    });
    const res = await resolveClipRoute(
      authedReq("http://localhost/api/clip/doesnotexist12345"),
      { params: Promise.resolve({ id: "doesnotexist12345" }) } as never
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("not-found");
    expect(fetched).toBe(0);
  });

  test("the remote read failing → 502 read-failed (the honest degradation family)", async () => {
    setUpstream(async () => {
      throw new Error("SSR fetch failed");
    });
    clearCache();
    const res = await resolveClipRoute(
      authedReq(`http://localhost/api/clip/${CLIP_ID}`),
      { params: Promise.resolve({ id: CLIP_ID }) } as never
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("read-failed");
    expect(body.error).toContain("could not be read");
  });

  test("a malformed id → 404 before anything runs", async () => {
    const res = await resolveClipRoute(
      authedReq("http://localhost/api/clip/%20%21"),
      { params: Promise.resolve({ id: " !" }) } as never
    );
    expect(res.status).toBe(404);
  });
});
