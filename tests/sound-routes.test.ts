/// <reference types="bun-types" />
/**
 * WFX2-P23-C route tests — the /api/sound/[key] read exercised against
 * fixture bytes via the test-only `setUpstream()` seam (the personal-routes
 * pattern). NEVER the network; NEVER the player endpoint.
 *
 *  - the happy read: the REAL captured audio-pivot browse continuation →
 *    the sound card + 15-lockup grid + the next token.
 *  - the honest families: no title AND no items → 404 ("not available");
 *    upstream failure → 502 ("could not be read").
 *  - the key codec: the token (with its literal %3D) survives the route.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { setUpstream } from "@/lib/youtube/innertube";
import { clearCache } from "@/lib/youtube/cache";
import { GET as soundRoute } from "@/app/api/sound/[key]/route";

const FIXTURE_DIR = "tests/fixtures/yt";
const load = (name: string): any =>
  JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}.json`, "utf8"));

const browseAudioPivot = load("browse_audio_pivot");
const TOKEN =
  "4qmFsgKIARISRkVzZnZfYXVkaW9fcGl2b3QaVENBRHlCVG9LTmhJbkNndElNMDlPWnpkVFVGTlhWUklMU0ROUFRtYzNVMUJUVjFVYUMwZ3pUMDVuTjFOUVUxZFZHZw";
const KEY = encodeURIComponent(TOKEN);

/** The fixture upstream: the audio-pivot browse only. */
function fixtureUpstream(opts: { ok?: boolean; empty?: boolean } = {}) {
  return async (url: string): Promise<Response> => {
    const u = String(url);
    if (u.includes("/youtubei/v1/browse")) {
      if (opts.ok === false) return new Response("upstream down", { status: 502 });
      if (opts.empty === true)
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      return new Response(JSON.stringify(browseAudioPivot), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

beforeEach(() => {
  clearCache();
  setUpstream(fixtureUpstream());
});

describe("GET /api/sound/[key] — the audio-pivot read (measured shape)", () => {
  test("the REAL capture maps the sound card + the 15-lockup grid + next token", async () => {
    const res = await soundRoute(
      new Request(`http://localhost/api/sound/${KEY}`),
      { params: Promise.resolve({ key: TOKEN }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.title).toBe(
      "Chill Lofi Coffee Vibes | Relaxing Lofi Hip Hop Beats to Study/Work to",
    );
    expect(data.imageUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
    expect(data.channel?.handle).toBe("LofiCafeChillMRelax");
    expect(data.items).toHaveLength(15);
    expect(data.items[0].id).toBe("vzpP7orCbxQ");
    expect(data.nextCursor).toBeTruthy();
    expect(data.totalLoaded).toBe(15);
  });

  test("the browse request carried the token as the continuation (the measured mechanism)", async () => {
    let seenBody: any = null;
    setUpstream(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/youtubei/v1/browse")) {
        seenBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(browseAudioPivot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    await soundRoute(new Request(`http://localhost/api/sound/${KEY}`), {
      params: Promise.resolve({ key: TOKEN }),
    });
    expect(seenBody?.continuation).toBe(TOKEN);
  });

  test("an empty served read → the honest 404 family (never a fake grid)", async () => {
    setUpstream(fixtureUpstream({ empty: true }));
    const res = await soundRoute(
      new Request(`http://localhost/api/sound/${KEY}`),
      { params: Promise.resolve({ key: TOKEN }) },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toContain("not available");
  });

  test("an upstream failure → the honest 502 family", async () => {
    setUpstream(fixtureUpstream({ ok: false }));
    const res = await soundRoute(
      new Request(`http://localhost/api/sound/${KEY}`),
      { params: Promise.resolve({ key: TOKEN }) },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error).toContain("could not be read");
  });

  test("the deep-linked page param seeds the running total (the N shorts line)", async () => {
    const res = await soundRoute(
      new Request(`http://localhost/api/sound/${KEY}?page=2`),
      { params: Promise.resolve({ key: TOKEN }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    // page 2 → the seed is 48 loaded + this page's 15
    expect(data.totalLoaded).toBe(48 + 15);
  });

  test("a link-form key (the NEXT-16 page-param shape) collapses to the raw token", async () => {
    // page params arrive UNDECODED (measured): the token's literal %3D rides
    // as %253D — the normalizer decodes it once before the browse read
    const linkForm = encodeURIComponent(TOKEN);
    const res = await soundRoute(
      new Request(`http://localhost/api/sound/${linkForm}`),
      { params: Promise.resolve({ key: linkForm }) },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.title).toBe(
      "Chill Lofi Coffee Vibes | Relaxing Lofi Hip Hop Beats to Study/Work to",
    );
  });
});
