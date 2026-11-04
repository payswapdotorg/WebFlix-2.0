/// <reference types="bun-types" />
/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M2 — the import lane battery (ADR 0013
 * §7): the canonical URL paste/import with the WebFlix account-session
 * gate (the P83 law — no operator gate), the dedupe law (one row per
 * post, idempotent repeats), the curated no-op, PRIVATE saves riding only
 * the owner's feed, the owner-only curator visibility flip, the owner-only
 * remove, the honest walled-egress import (the authorHint fallback card),
 * and the viewer-scoped stamps applied OUTSIDE the shared cache.
 *
 * DB-backed (watch-test.db, fresh-seeded per file); the upstream seam is
 * injected — no network anywhere (lane law).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { clearCache, clearRateLimits } from "@/lib/youtube/cache";
import { setTikTokUpstream, type TikTokUpstreamFetch } from "@/lib/tiktok/upstream";
import { setupTestDb, fixtures, mintSessionCookie } from "./helpers";
import { db } from "../src/lib/db";

setupTestDb();

const DOCS_ID = "6718335390845095173";
const IMPORT_ID = "7280000000000000001";
const IMPORT_ID_2 = "7280000000000000002";
const IMPORT_URL = `https://www.tiktok.com/@echoauthor/video/${IMPORT_ID}`;
const IMPORT_URL_2 = `https://www.tiktok.com/@echoauthor/video/${IMPORT_ID_2}`;

let PIP_COOKIE = "";
let DEMO_COOKIE = "";

beforeAll(async () => {
  const { pip, demo } = await fixtures();
  PIP_COOKIE = await mintSessionCookie({ sub: pip.id });
  DEMO_COOKIE = await mintSessionCookie({ sub: demo.id });
});

/** The upstream seam that echoes the requested post id (the oEmbed lane's
 * `embed_product_id` contract — a mismatch is honest absence). */
function echoUpstream(
  status = 200,
  payload?: Record<string, unknown>
): TikTokUpstreamFetch {
  return (url) => {
    if (status !== 200) return Promise.resolve(new Response("walled", { status }));
    const target = new URL(url).searchParams.get("url") ?? "";
    const m = target.match(/\/(\d{6,32})$/);
    const id = m?.[1] ?? "0";
    return Promise.resolve(
      new Response(
        JSON.stringify(
          payload ?? {
            title: `Echo post ${id}`,
            author_name: "echoauthor",
            author_url: "https://www.tiktok.com/@echoauthor",
            thumbnail_url: "https://p16-sign-va.tiktokcdn.com/echo.jpg",
            width: 720,
            height: 1280,
            embed_product_id: id,
          }
        ),
        { status }
      )
    );
  };
}

beforeEach(() => {
  clearCache();
  clearRateLimits();
  setTikTokUpstream(echoUpstream());
});
/** Per-test import-table cleanliness (the file's seed is per-FILE). */
beforeEach(async () => {
  await db.tikTokImport.deleteMany().catch(() => {});
});
/** Leave the shared db file clean for the sibling DB-free batteries. */
afterAll(async () => {
  await db.tikTokImport.deleteMany().catch(() => {});
});
afterEach(() => setTikTokUpstream(null));

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, init as never);
}

function postReq(url: string, body: unknown, cookie?: string): NextRequest {
  return req(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function patchReq(postId: string, body: unknown, cookie?: string): NextRequest {
  return req(`/api/tiktok/import/${postId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deleteReq(postId: string, cookie?: string): NextRequest {
  return req(`/api/tiktok/import/${postId}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

async function importIds(): Promise<string[]> {
  const rows = await db.tikTokImport.findMany({ select: { postId: true } });
  return rows.map((r) => r.postId).sort();
}

describe("POST /api/tiktok/import — the gate + the URL law", () => {
  test("a guest gets the uniform 401 BEFORE any work", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const res = await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(await importIds()).toHaveLength(0);
  });

  test("an empty/invalid body and a non-canonical URL answer 400", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const empty = await POST(postReq("/api/tiktok/import", {}, PIP_COOKIE));
    expect(empty.status).toBe(400);
    const shortLink = await POST(
      postReq("/api/tiktok/import", { url: "https://vm.tiktok.com/ZMabcdef/" }, PIP_COOKIE)
    );
    expect(shortLink.status).toBe(400); // short links honestly refuse (the URL law)
    const foreign = await POST(
      postReq("/api/tiktok/import", { url: "https://youtube.com/watch?v=abc" }, PIP_COOKIE)
    );
    expect(foreign.status).toBe(400);
    expect(await importIds()).toHaveLength(0);
  });

  test("a fresh signup's raw sub (no User row) imports via the shadow identity", async () => {
    // The browser-caught FK break: a fresh signup's session sub has no User
    // row — the import lane must resolve the shadow `wf-<sub>` identity
    // (the same lazy upsert every write lane rides) before persisting.
    const FRESH_COOKIE = await mintSessionCookie({ sub: "fresh-signup-85" });
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const res = await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, FRESH_COOKIE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.visibility).toBe("private");
    expect(body.post.owned).toBe(true);
    const rows = await db.tikTokImport.findMany();
    expect(rows).toHaveLength(1);
    const shadow = await db.user.findUnique({ where: { id: "wf-fresh-signup-85" } });
    expect(shadow).toBeTruthy();
    // the row belongs to the SHADOW id, not the raw sub
    expect(rows[0].importedBy).toBe("wf-fresh-signup-85");
    // and the owner's own feed rides the same identity
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    const mine = await (await GET(req("/api/tiktok/feed?limit=40", {
      headers: { cookie: FRESH_COOKIE },
    }))).json();
    expect(mine.items.some((v: { postId: string }) => v.postId === IMPORT_ID)).toBe(true);
  });

  test("a canonical URL imports as a PRIVATE save owned by the importer", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const res = await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyImported).toBe(false);
    expect(body.curated).toBe(false);
    expect(body.post.postId).toBe(IMPORT_ID);
    expect(body.post.visibility).toBe("private");
    expect(body.post.owned).toBe(true);
    // the honest metadata lane served the card
    expect(body.post.author).toBe("echoauthor");
    expect(body.post.embedUrl).toContain(`player/v1/${IMPORT_ID}`);
    const rows = await db.tikTokImport.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe("private");
  });

  test("a repeat import is idempotent — one row, the first owner stands", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    // a DIFFERENT account imports the same post
    const again = await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, DEMO_COOKIE));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.alreadyImported).toBe(true);
    // the first row stands: pip's private save; demo is NOT the owner
    expect(body.post.visibility).toBe("private");
    expect(body.post.owned).toBe(false);
    expect(await importIds()).toHaveLength(1);
  });

  test("a curated post is the honest no-op (curated: true, no row)", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const res = await POST(
      postReq("/api/tiktok/import", { url: `https://www.tiktok.com/@scout2015/video/${DOCS_ID}` }, PIP_COOKIE)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.curated).toBe(true);
    expect(body.alreadyImported).toBe(true);
    expect(body.post.postId).toBe(DOCS_ID);
    expect(await importIds()).toHaveLength(0);
  });

  test("a walled metadata lane does NOT block the import (the embed rides viewer-side)", async () => {
    setTikTokUpstream(echoUpstream(404));
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const res = await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post.postId).toBe(IMPORT_ID);
    expect(await importIds()).toHaveLength(1);
  });
});

describe("the feed composition — private saves ride the owner's feed ONLY", () => {
  test("a private import is invisible to guests and other accounts, visible to the owner", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));

    const guestPage = await (await GET(req("/api/tiktok/feed?limit=40"))).json();
    const guestIds = guestPage.items.map((v: { postId: string }) => v.postId);
    expect(guestIds).not.toContain(IMPORT_ID);

    const demoPage = await (await GET(req("/api/tiktok/feed?limit=40", {
      headers: { cookie: DEMO_COOKIE },
    }))).json();
    const demoIds = demoPage.items.map((v: { postId: string }) => v.postId);
    expect(demoIds).not.toContain(IMPORT_ID);

    const pipPage = await (await GET(req("/api/tiktok/feed?limit=40", {
      headers: { cookie: PIP_COOKIE },
    }))).json();
    const pipItems = pipPage.items.filter((v: { postId: string }) => v.postId === IMPORT_ID);
    expect(pipItems).toHaveLength(1);
    // the owner's stamp: private + owned; the row APPENDS after the curated flow
    expect(pipItems[0].visibility).toBe("private");
    expect(pipItems[0].owned).toBe(true);
    expect(pipPage.items[pipPage.items.length - 1].postId).toBe(IMPORT_ID);
  });

  test("the curator flip admits the post to EVERY viewer's feed", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { PATCH } = await import("../src/app/api/tiktok/import/[postId]/route");
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));

    const flipped = await PATCH(patchReq(IMPORT_ID, { visibility: "public" }, PIP_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(flipped.status).toBe(200);
    expect((await flipped.json()).visibility).toBe("public");

    // guests now see it, stamped public and NOT owned
    const guestPage = await (await GET(req("/api/tiktok/feed?limit=40"))).json();
    const row = guestPage.items.find((v: { postId: string }) => v.postId === IMPORT_ID);
    expect(row).toBeTruthy();
    expect(row.visibility).toBe("public");
    expect(row.owned).toBe(false);
  });

  test("the flip is OWNER-ONLY: strangers get 404 (no existence leak)", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { PATCH } = await import("../src/app/api/tiktok/import/[postId]/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    const stranger = await PATCH(patchReq(IMPORT_ID, { visibility: "public" }, DEMO_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(stranger.status).toBe(404);
    const unknown = await PATCH(
      patchReq("7290000000000000999", { visibility: "public" }, PIP_COOKIE),
      { params: Promise.resolve({ postId: "7290000000000000999" }) }
    );
    expect(unknown.status).toBe(404);
    const bad = await PATCH(patchReq(IMPORT_ID, { visibility: "unlisted" }, PIP_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(bad.status).toBe(400);
    const guest = await PATCH(patchReq(IMPORT_ID, { visibility: "public" }), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(guest.status).toBe(401);
  });

  test("remove is OWNER-ONLY and un-lists the post from every feed", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { PATCH } = await import("../src/app/api/tiktok/import/[postId]/route");
    const { DELETE } = await import("../src/app/api/tiktok/import/[postId]/route");
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    await PATCH(patchReq(IMPORT_ID, { visibility: "public" }, PIP_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });

    const strangerDelete = await DELETE(deleteReq(IMPORT_ID, DEMO_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(strangerDelete.status).toBe(404);

    const gone = await DELETE(deleteReq(IMPORT_ID, PIP_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    expect(gone.status).toBe(200);
    const guestPage = await (await GET(req("/api/tiktok/feed?limit=40"))).json();
    const ids = guestPage.items.map((v: { postId: string }) => v.postId);
    expect(ids).not.toContain(IMPORT_ID);
  });

  test("GET /api/tiktok/import lists the owner's imports newest-first; guests 401", async () => {
    const { POST, GET } = await import("../src/app/api/tiktok/import/route");
    const guest = await GET(req("/api/tiktok/import"));
    expect(guest.status).toBe(401);
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL_2 }, PIP_COOKIE));
    const mine = await (await GET(req("/api/tiktok/import", {
      headers: { cookie: PIP_COOKIE },
    }))).json();
    const ids = mine.imports.map((r: { postId: string }) => r.postId);
    expect(ids).toContain(IMPORT_ID);
    expect(ids).toContain(IMPORT_ID_2);
    // newest first
    expect(ids.indexOf(IMPORT_ID_2)).toBeLessThan(ids.indexOf(IMPORT_ID));
    for (const row of mine.imports) {
      expect(["private", "public"]).toContain(row.visibility);
    }
  });

  test("a walled imported post rides the factual authorHint fallback card in the owner's feed", async () => {
    setTikTokUpstream(echoUpstream(404));
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    clearCache(); // the walled answer cached — force the fallback path fresh
    const pipPage = await (await GET(req("/api/tiktok/feed?limit=40", {
      headers: { cookie: PIP_COOKIE },
    }))).json();
    const row = pipPage.items.find((v: { postId: string }) => v.postId === IMPORT_ID);
    expect(row).toBeTruthy();
    // the hint came from the pasted URL's own handle — factual, never guessed
    expect(row.author).toBe("echoauthor");
    expect(row.source).toBe("tiktok-imported");
    expect(row.unavailable).toBe(false);
    expect(row.embedUrl).toContain(`player/v1/${IMPORT_ID}`);
  });

  test("a public import deep-links (the page-1 splice works on composed ids too)", async () => {
    const { POST } = await import("../src/app/api/tiktok/import/route");
    const { PATCH } = await import("../src/app/api/tiktok/import/[postId]/route");
    const { GET } = await import("../src/app/api/tiktok/feed/route");
    await POST(postReq("/api/tiktok/import", { url: IMPORT_URL }, PIP_COOKIE));
    await PATCH(patchReq(IMPORT_ID, { visibility: "public" }, PIP_COOKIE), {
      params: Promise.resolve({ postId: IMPORT_ID }),
    });
    clearCache();
    const page = await (await GET(req(`/api/tiktok/feed?post=${IMPORT_ID}&limit=5`))).json();
    expect(page.items[0].postId).toBe(IMPORT_ID);
    expect(page.items[0].visibility).toBe("public");
  });
});
