/// <reference types="bun-types" />
/**
 * P49-CONTINUE-WATCHING — the /api/netflix/progress battery (the honest-local
 * play memory) + the P49 suggest lane pins:
 *  - GET answers honest-empty for anonymous viewers, never a fake row;
 *  - POST (the watch-lane kick / hand-off click shape) upserts ONE row per
 *    (viewer, title): a replay bumps playCount + refreshes lastPlayedAt;
 *  - the mirror row upserts from the live pools first (the FK law — the
 *    same move My List makes);
 *  - DELETE removes (the hub rail's remove affordance);
 *  - malformed ids → 400, ids outside the tracked universe → 404;
 *  - the suggest route's additive `netflix` lane: scored mirror matches ride
 *    BESIDE the untouched `suggestions` contract, honest-empty when the
 *    mirror has nothing.
 * Runs against the real throwaway watch-test DB + the netflix upstream seam
 * (the netflix-routes idiom; rate limiting stands down via the test flag).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { setNetflixUpstream } from "@/lib/netflix/upstream";
import { getTop10Pool } from "@/lib/netflix/top10";
import { setupTestDb, fixtures, mintSessionCookie } from "./helpers";
import { db } from "@/lib/db";

import {
  GET as progressGet,
  POST as progressPost,
  DELETE as progressDelete,
} from "@/app/api/netflix/progress/route";
import { GET as suggestRoute } from "@/app/api/search/suggest/route";

const FIXTURE = readFileSync("tests/fixtures/netflix/top10-films.html", "utf8");

setupTestDb();

function req(url: string, headers: Record<string, string> = {}): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"), { headers });
}

function postReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const serveFixture = async (): Promise<Response> =>
  new Response(FIXTURE, { status: 200, headers: { "Content-Type": "text/html" } });

const ANIMALS_ID = 81757047; // the fixture's weekly #1

beforeEach(() => {
  clearCache();
  setUpstream(async () => new Response("{}", { status: 200 }));
  setNetflixUpstream(serveFixture);
});

afterEach(() => {
  setUpstream(null);
  setNetflixUpstream(null);
});

describe("GET /api/netflix/progress — honest reads", () => {
  test("anonymous viewers get the honest empty payload", async () => {
    const res = await progressGet(req("http://localhost:3000/api/netflix/progress"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; source: string };
    expect(body.items).toEqual([]);
    expect(body.source).toBe("netflix-progress");
  });

  test("the viewer's plays come back newest-first with the joined title", async () => {
    const { demo, pip } = await fixtures();
    await progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: ANIMALS_ID }, { "x-wfx2-user": demo.id }));
    // a second title, recorded later — it must lead the rail
    const second = 82023496; // Doing Life in the fixture
    await progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: second }, { "x-wfx2-user": demo.id }));

    const res = await progressGet(req("http://localhost:3000/api/netflix/progress", { "x-wfx2-user": demo.id }));
    const body = (await res.json()) as {
      items: { title: { netflixId: number; title: string }; lastPlayedAt: string; playCount: number }[];
    };
    expect(body.items.length).toBe(2);
    expect(body.items[0].title.netflixId).toBe(second);
    expect(body.items[0].title.title).toBe("Doing Life");
    expect(body.items[0].playCount).toBe(1);
    expect(new Date(body.items[0].lastPlayedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(body.items[1].lastPlayedAt).getTime()
    );

    // pip's rail is pip's own — the per-user isolation law
    const pipRes = await progressGet(req("http://localhost:3000/api/netflix/progress", { "x-wfx2-user": pip.id }));
    expect(((await pipRes.json()) as { items: unknown[] }).items).toEqual([]);
  });
});

describe("POST /api/netflix/progress — one row per (viewer, title)", () => {
  test("a replay bumps playCount and refreshes lastPlayedAt, never stacks rows", async () => {
    const { demo } = await fixtures();
    const post = (body: unknown) =>
      progressPost(postReq("http://localhost:3000/api/netflix/progress", body, { "x-wfx2-user": demo.id }));
    const first = await post({ netflixId: ANIMALS_ID });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { recorded: boolean }).recorded).toBe(true);

    // one row after the first play
    expect(await db.netflixWatchEvent.count({ where: { userId: demo.id } })).toBe(1);

    // the replay: same row, playCount 2, later timestamp
    await new Promise((r) => setTimeout(r, 15));
    const replay = await post({ netflixId: ANIMALS_ID });
    expect(replay.status).toBe(200);
    const rows = await db.netflixWatchEvent.findMany({ where: { userId: demo.id, netflixId: ANIMALS_ID } });
    expect(rows.length).toBe(1);
    expect(rows[0].playCount).toBe(2);

    // the GET rail carries the honest count
    const res = await progressGet(req("http://localhost:3000/api/netflix/progress", { "x-wfx2-user": demo.id }));
    const body = (await res.json()) as { items: { playCount: number }[] };
    expect(body.items[0].playCount).toBe(2);
  });

  test("the mirror row upserts from the pools first (the FK law)", async () => {
    const { demo } = await fixtures();
    // self-clean: earlier tests in this file may have already mirrored the id
    await db.netflixWatchEvent.deleteMany({ where: { userId: demo.id, netflixId: ANIMALS_ID } });
    await db.netflixTitle.deleteMany({ where: { netflixId: ANIMALS_ID } });
    // the title is NOT pre-mirrored — the play itself seeds the mirror
    expect(await db.netflixTitle.findUnique({ where: { netflixId: ANIMALS_ID } })).toBeNull();
    await progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: ANIMALS_ID }, { "x-wfx2-user": demo.id }));
    const mirrored = await db.netflixTitle.findUnique({ where: { netflixId: ANIMALS_ID } });
    expect(mirrored?.title).toBe("Animals");
  });

  test("malformed ids → 400", async () => {
    const { demo } = await fixtures();
    const res = await progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: "abc" }, { "x-wfx2-user": demo.id }));
    expect(res.status).toBe(400);
  });

  test("ids outside the tracked universe → 404", async () => {
    const { demo } = await fixtures();
    const res = await progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: 99999999 }, { "x-wfx2-user": demo.id }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("tracked");
  });

  test("P49 — a signed-in WebFlix session records under its own shadow user", async () => {
    // the P2-AU identity rung: the NextAuth JWT resolves through the SAME
    // getSessionUser decode every gated route uses, then bridges to its
    // shadow prisma user (the local-comment bridge) — the play NEVER lands
    // on the demo fallback.
    const sub = "u_nf_p49";
    const cookie = await mintSessionCookie({ sub, name: "NF Viewer", email: "nf@webflix.test" });
    const res = await progressPost(
      postReq("http://localhost:3000/api/netflix/progress", { netflixId: ANIMALS_ID }, { cookie })
    );
    expect(res.status).toBe(200);
    const shadowId = `wf-${sub}`;
    expect(await db.netflixWatchEvent.findFirst({ where: { userId: shadowId } })).not.toBeNull();
    // the shadow user row exists (the bridge upserts it), with exactly ONE
    // event — isolation from the demo fallback's earlier rows in this file
    expect(await db.user.findUnique({ where: { id: shadowId } })).not.toBeNull();
    expect(await db.netflixWatchEvent.count({ where: { userId: shadowId } })).toBe(1);
    // the signed-in GET reads the same rail back
    const get = await progressGet(req("http://localhost:3000/api/netflix/progress", { cookie }));
    const body = (await get.json()) as { items: { title: { title: string } }[] };
    expect(body.items[0]?.title.title).toBe("Animals");
  });
});

describe("DELETE /api/netflix/progress — the rail's remove affordance", () => {
  test("removes exactly the viewer's row (and nothing else's)", async () => {
    const { demo, pip } = await fixtures();
    const post = (viewer: string) =>
      progressPost(postReq("http://localhost:3000/api/netflix/progress", { netflixId: ANIMALS_ID }, { "x-wfx2-user": viewer }));
    await post(demo.id);
    await post(pip.id);

    const del = await progressDelete(req(`http://localhost:3000/api/netflix/progress?netflixId=${ANIMALS_ID}`, { "x-wfx2-user": demo.id }));
    expect(del.status).toBe(200);
    expect(((await del.json()) as { recorded: boolean }).recorded).toBe(false);

    expect(await db.netflixWatchEvent.findFirst({ where: { userId: demo.id } })).toBeNull();
    expect(await db.netflixWatchEvent.findFirst({ where: { userId: pip.id } })).not.toBeNull();
  });

  test("malformed ids → 400", async () => {
    const { demo } = await fixtures();
    const res = await progressDelete(req("http://localhost:3000/api/netflix/progress?netflixId=0", { "x-wfx2-user": demo.id }));
    expect(res.status).toBe(400);
  });
});

describe("P49 — the suggest route's additive Netflix lane", () => {
  test("mirror matches ride BESIDE the untouched suggestions contract", async () => {
    // warm the mirror (the pools feed it on every load) + serve the YT lane
    setUpstream(async () =>
      new Response(loadAutocomplete("animals"), { status: 200, headers: { "Content-Type": "text/javascript" } })
    );
    await getTop10Pool("weekly-films");
    const res = await suggestRoute(new Request("http://localhost:3000/api/search/suggest?q=animals"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suggestions: unknown[];
      netflix: { netflixId: number; title: string; kind: string }[];
    };
    expect(body.suggestions.every((s) => typeof s === "string")).toBe(true);
    expect(body.netflix.length).toBeGreaterThan(0);
    expect(body.netflix[0].netflixId).toBe(ANIMALS_ID);
    expect(body.netflix[0].title).toBe("Animals");
  });

  test("a query with no mirror match → netflix: [] while suggestions still flow", async () => {
    setUpstream(async () =>
      new Response(loadAutocomplete("lofi"), { status: 200, headers: { "Content-Type": "text/javascript" } })
    );
    const res = await suggestRoute(new Request("http://localhost:3000/api/search/suggest?q=lofi"));
    const body = (await res.json()) as { suggestions: string[]; netflix: unknown[] };
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.netflix).toEqual([]);
  });

  test("an empty query answers both lanes empty", async () => {
    const res = await suggestRoute(new Request("http://localhost:3000/api/search/suggest?q="));
    const body = (await res.json()) as { suggestions: unknown[]; netflix: unknown[] };
    expect(body.suggestions).toEqual([]);
    expect(body.netflix).toEqual([]);
  });

  function loadAutocomplete(q: string): string {
    // minimal valid JSONP — the lane only needs the shape, not lofi's list
    return `window.google.ac.h(["${q}",[["${q} full",0],["${q} radio",0]],{"k":1}]);`;
  }
});

afterEach(async () => {
  // leave the shared test DB as the suite found it (the seed wipes per file,
  // but the netflix rows this file mints must not leak into a later describe)
  await db.netflixWatchEvent.deleteMany({});
  await db.netflixMyListItem.deleteMany({});
});
