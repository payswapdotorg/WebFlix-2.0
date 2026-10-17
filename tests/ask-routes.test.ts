/**
 * P23-B route tests — the AI routes exercised against fixture bytes via the
 * test-only `setUpstream()` seam + the injected LLM (`setLlmForTests`) +
 * the seeded watch DB (the bbb transcript rows are the REAL grounding
 * cues). NEVER the network; NEVER the player endpoint; the real LLM is never
 * constructed (no env key is set anywhere in this file).
 *
 *  - POST /api/search/ask: validation, disabled-before-work, grounded
 *    citations (the top results the grid itself reads), the honest
 *    no-results / 502 families, the answer cache.
 *  - POST /api/videos/[id]/ask: validation, disabled, the seek-validation
 *    law (cue-exact timestamps survive, fabricated drop), 404, 502.
 *  - GET /api/videos/[id]/summary: disabled, the chapters-aware key moments
 *    on real chapter timestamps (fabricated dropped), 502.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setupTestDb, fixtures } from "./helpers";
import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { searchYouTube } from "@/lib/youtube/search";
import { setLlmForTests } from "@/lib/ai/llm";

import { POST as searchAskRoute } from "@/app/api/search/ask/route";
import { POST as watchAskRoute } from "@/app/api/videos/[id]/ask/route";
import { GET as summaryRoute } from "@/app/api/videos/[id]/summary/route";

setupTestDb();

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any => JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const nextFixture = load("next_dQw4");
const searchFixture = load("search_lofi");

/** A `next` fixture whose description carries REAL chapters. */
const CHAPTERED_DESCRIPTION =
  "The world's first open movie.\n\n0:00 The machine wakes\n1:15 Proog leads the way\n3:40 The hall of telephones\n6:02 Emo starts to doubt\n8:44 The void\n10:10 Reality breaks\n\n#elephantsdream";

function withDescription(fixture: unknown, description: string): unknown {
  const clone = JSON.parse(JSON.stringify(fixture));
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.attributedDescription?.content !== undefined) {
      node.attributedDescription.content = description;
      return;
    }
    for (const k of Object.keys(node)) visit(node[k]);
  };
  visit(clone);
  return clone;
}

const chapteredNext = withDescription(nextFixture, CHAPTERED_DESCRIPTION);
const deadPage = { nothing: true };

/** The fixture upstream: search + next (plain or chaptered or dead). */
function fixtureUpstream(opts: { next?: unknown; search?: unknown } = {}) {
  const nextBody = opts.next ?? nextFixture;
  const searchBody = opts.search ?? searchFixture;
  return async (url: string): Promise<Response> => {
    const u = String(url);
    if (u.includes("/youtubei/v1/search")) {
      return new Response(JSON.stringify(searchBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/youtubei/v1/next")) {
      return new Response(JSON.stringify(nextBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

const savedKey = process.env.ZAI_API_KEY;
let BBB_ID = "";
beforeAll(async () => {
  const { bbb } = await fixtures();
  BBB_ID = bbb.id;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.ZAI_API_KEY;
  else process.env.ZAI_API_KEY = savedKey;
});

beforeEach(() => {
  // a CONFIGURED deployment (the env gate opens; the injected LLM serves
  // the calls — the real SDK is never constructed)
  process.env.ZAI_API_KEY = "test-key";
  setUpstream(fixtureUpstream());
  clearCache();
  setLlmForTests(null);
});
afterEach(() => {
  setUpstream(null);
  setLlmForTests(null);
});

const req = (url: string, init?: RequestInit): never => new Request(url, init) as never;
const jsonOf = (r: Response) => r.json() as Promise<any>;

describe("POST /api/search/ask — G3", () => {
  test("a missing/empty question → 400", async () => {
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
  });

  test("no env key → 200 disabled BEFORE any search or LLM call (the honest gate)", async () => {
    delete process.env.ZAI_API_KEY; // the unconfigured deployment
    // no LLM injected and no upstream for search would both explode if the
    // route misordered its work — the disabled status proves it did not
    setUpstream(async () => {
      throw new Error("upstream must not be touched while disabled");
    });
    clearCache();
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ q: "what is lofi music?" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ status: "disabled" });
  });

  test("an answer grounded on the top results + citations bound to those videos", async () => {
    setLlmForTests(async () => "Lofi is relaxing music [1], often live-streamed [2].");
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ q: "what is lofi music?" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.status).toBe("ok");
    expect(body.answer).toContain("[1]");
    // the citations are exactly the videos the results grid itself would
    // read for this query (the same cached search)
    const expected = (await searchYouTube("what is lofi music?", {})).videos.slice(0, 8);
    expect(body.citations.length).toBe(expected.length);
    body.citations.forEach((c: any, i: number) => {
      expect(c.n).toBe(i + 1);
      expect(c.videoId).toBe(expected[i].id);
      expect(c.title).toBe(expected[i].title);
    });
  });

  test("client filters ride the grounding (the answer matches the filtered results)", async () => {
    setLlmForTests(async () => "Recent uploads [1].");
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ q: "what is lofi music?", filters: { uploadDate: "week" } }),
      })
    );
    expect(res.status).toBe(200);
    const expected = (
      await searchYouTube("what is lofi music?", { uploadDate: "week" })
    ).videos.slice(0, 8);
    const body = await jsonOf(res);
    expect(body.citations.length).toBe(expected.length);
  });

  test("no results to ground on → the honest no-results (the card hides)", async () => {
    setUpstream(fixtureUpstream({ search: {} }));
    clearCache();
    setLlmForTests(async () => "should not be called");
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ q: "zzz nothing at all?" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ status: "no-results" });
  });

  test("an LLM failure → the honest 502 (never a fake answer)", async () => {
    setLlmForTests(async () => {
      throw new Error("model unavailable");
    });
    const res = await searchAskRoute(
      req("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ q: "what is lofi music?" }),
      })
    );
    expect(res.status).toBe(502);
    const body = await jsonOf(res);
    expect(body.error).toContain("model unavailable");
  });

  test("the answer is cached per (query, filters) — one LLM call for two asks", async () => {
    let llmCalls = 0;
    setLlmForTests(async () => {
      llmCalls += 1;
      return "Cached answer [1].";
    });
    const ask = () =>
      searchAskRoute(
        req("http://localhost/api/search/ask", {
          method: "POST",
          body: JSON.stringify({ q: "what is lofi music?" }),
        })
      );
    const first = await ask();
    const second = await ask();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(llmCalls).toBe(1);
    expect((await jsonOf(second)).answer).toBe("Cached answer [1].");
  });
});

describe("POST /api/videos/[id]/ask — G4", () => {
  const askBody = (question: string) =>
    req(`http://localhost/api/videos/${BBB_ID}/ask`, {
      method: "POST",
      body: JSON.stringify({ question }),
    });
  const ctx = () => ({ params: Promise.resolve({ id: BBB_ID }) } as never);

  test("a too-short question → 400", async () => {
    const res = await watchAskRoute(askBody("hi"), ctx());
    expect(res.status).toBe(400);
  });

  test("no env key → 200 disabled before any work", async () => {
    delete process.env.ZAI_API_KEY; // the unconfigured deployment
    const res = await watchAskRoute(askBody("does the bunny win"), ctx());
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ status: "disabled" });
  });

  test("an answer whose [:ss] chips are the REAL cue timestamps (fabricated dropped)", async () => {
    setLlmForTests(async () =>
      "The rodents bully the butterfly at [2:12]. The bunny plots revenge by [3:04]. Fake moment [9:59]."
    );
    const res = await watchAskRoute(askBody("what happens in this video"), ctx());
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.status).toBe("ok");
    // 2:12 → 132s and 3:04 → 184s are seeded Big Buck Bunny cue starts;
    // 9:59 → 599s matches nothing and must be dropped
    expect(body.seeks).toEqual([
      { sec: 132, label: "2:12" },
      { sec: 184, label: "3:04" },
    ]);
  });

  test("an unknown video → 404 (honest, no fabrication)", async () => {
    setUpstream(fixtureUpstream({ next: deadPage })); // no primaryInfo → metadata null
    clearCache();
    setLlmForTests(async () => "x");
    const res = await watchAskRoute(
      req("http://localhost/api/videos/unknownVideo/ask", {
        method: "POST",
        body: JSON.stringify({ question: "what is this" }),
      }),
      { params: Promise.resolve({ id: "unknownVideo" }) } as never
    );
    expect(res.status).toBe(404);
  });

  test("an LLM failure → the honest 502", async () => {
    setUpstream(fixtureUpstream({ next: deadPage }));
    clearCache();
    setLlmForTests(async () => {
      throw new Error("model down");
    });
    // a live metadata read first (dead page → null → 404 before the LLM)
    const res = await watchAskRoute(
      req(`http://localhost/api/videos/${BBB_ID}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: "what happens here" }),
      }),
      ctx()
    );
    expect(res.status).toBe(404);
    // and with real metadata the LLM failure surfaces as 502
    setUpstream(fixtureUpstream());
    clearCache();
    const res2 = await watchAskRoute(
      req(`http://localhost/api/videos/${BBB_ID}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: "what happens here" }),
      }),
      ctx()
    );
    expect(res2.status).toBe(502);
    expect((await jsonOf(res2)).error).toContain("model down");
  });
});

describe("GET /api/videos/[id]/summary — the AI summary block", () => {
  const ctx = () => ({ params: Promise.resolve({ id: BBB_ID }) } as never);

  test("no env key → 200 disabled before any work", async () => {
    delete process.env.ZAI_API_KEY; // the unconfigured deployment
    const res = await summaryRoute(req(`http://localhost/api/videos/${BBB_ID}/summary`), ctx());
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ status: "disabled" });
  });

  test("summary + key moments on the REAL chapter timestamps (fabricated dropped)", async () => {
    setUpstream(fixtureUpstream({ next: chapteredNext }));
    clearCache();
    setLlmForTests(
      async () =>
        "A machine world where Proog guides Emo.\nKEYMOMENT 1:15 - Proog leads\nKEYMOMENT 3:40 - the telephones\nKEYMOMENT 9:99 - fabricated"
    );
    const res = await summaryRoute(req(`http://localhost/api/videos/${BBB_ID}/summary`), ctx());
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.status).toBe("ok");
    expect(body.summary).toBe("A machine world where Proog guides Emo.");
    // 1:15 → 75s and 3:40 → 220s are REAL chapter starts of the description;
    // 9:99 is not and must be dropped
    expect(body.keyMoments).toEqual([
      { sec: 75, label: "1:15", title: "Proog leads the way" },
      { sec: 220, label: "3:40", title: "The hall of telephones" },
    ]);
  });

  test("an LLM failure → the honest 502", async () => {
    setLlmForTests(async () => {
      throw new Error("summary model down");
    });
    const res = await summaryRoute(req(`http://localhost/api/videos/${BBB_ID}/summary`), ctx());
    expect(res.status).toBe(502);
    expect((await jsonOf(res)).error).toContain("summary model down");
  });
});
