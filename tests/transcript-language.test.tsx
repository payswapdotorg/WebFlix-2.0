/// <reference types="bun-types" />
/**
 * WFX2-P4-QT tests — the transcript language battery:
 * - the pure extractors/mappers (player-response captionTracks → the
 *   language list; json3 timedtext → cues) against SYNTHETIC inline
 *   fixtures (sanitized, provenance-marked — no network, no live pages);
 * - the captions lib ladder via the ssr/upstream seams (mock.module with
 *   capture/restore, the action-routes pattern): tracks list, per-language
 *   fetch, the honest 404 when a language has no track, the honest 502 when
 *   upstream fails;
 * - the route contracts: /transcript (no lang → the DB default, unchanged
 *   — a regression guard), /transcript?lang= (live cues + the unavailable
 *   state), /transcript/languages (the tracks list);
 * - selection persistence (session storage, per video) + the option dedupe
 *   (manual beats auto-generated);
 * - the panel's honest unavailable state (happy-dom + createRoot/act with a
 *   stubbed fetch — the search-suggest/miniplayer idiom).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/* ------------------------------------------------------------------ */
/* Synthetic inline fixtures (shape-faithful, provenance-marked)        */
/* ------------------------------------------------------------------ */

/** A sanitized SYNTHETIC watch-page HTML carrying a player response with
 * caption tracks (the shape verified against real watch pages; the lazy
 * `};</script>` termination is the ytInitialData escape law). */
const FIXTURE_HTML = [
  "<!DOCTYPE html><html><head><title>synthetic</title></head><body>",
  "<script nonce=x>var ytInitialData = ({\"dummy\":true});</script>",
  "<script nonce=x>var ytInitialPlayerResponse = {",
  "\"captions\":{\"playerCaptionsTracklistRenderer\":{\"captionTracks\":[",
  "{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=SYNTH&lang=en&kind=asr\",\"name\":{\"simpleText\":\"English (auto-generated)\"},\"vssId\":\".en\",\"languageCode\":\"en\",\"kind\":\"asr\",\"isTranslatable\":false},",
  "{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=SYNTH&lang=de\",\"name\":{\"runs\":[{\"text\":\"Deutsch\"}]},\"vssId\":\".de\",\"languageCode\":\"de\",\"isTranslatable\":true},",
  "{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=SYNTH&lang=en\",\"name\":{\"simpleText\":\"English\"},\"vssId\":\"en\",\"languageCode\":\"en\",\"isTranslatable\":false}",
  "]}},\"videoDetails\":{\"videoId\":\"SYNTH\",\"title\":\"synthetic\"}};</script>",
  "<script nonce=x>window.ytcfg = {};</script>",
  "</body></html>",
].join("");

const FIXTURE_PLAYER_RESPONSE: Record<string, unknown> = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=SYNTH&lang=en&kind=asr",
          name: { simpleText: "English (auto-generated)" },
          vssId: ".en",
          languageCode: "en",
          kind: "asr",
        },
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=SYNTH&lang=de",
          name: { runs: [{ text: "Deutsch" }] },
          vssId: ".de",
          languageCode: "de",
        },
      ],
    },
  },
};

/** A sanitized SYNTHETIC json3 timedtext payload (two text events, one
 * newline-only event that must be skipped, one with no segs). */
const FIXTURE_JSON3: Record<string, unknown> = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "hello" }, { utf8: " world" }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "\n" }] }, // newline-only → skipped
    { tStartMs: 3500, dDurationMs: 2000, segs: [{ utf8: "second\nline" }] },
    { tStartMs: 5500 }, // no segs → skipped
  ],
};

/* ---- happy-dom globals (the miniplayer setup — the panel render test) ---- */
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "sessionStorage", {
  value: win.sessionStorage,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ */
/* capture the real modules before the mocks (action-routes pattern)    */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const realSsr = { ...require("@/lib/youtube/ssr") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realUpstream = { ...require("@/lib/youtube/upstream") } as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realCaptions = { ...require("@/lib/youtube/captions") } as Record<string, unknown>;

/** Controllable page-HTML responder (the fetchPageHtml seam). */
let pageHtml: () => string = () => FIXTURE_HTML;

mock.module("@/lib/youtube/ssr", () => ({
  YT_BASE: "https://www.youtube.com",
  fetchPageHtml: async () => pageHtml(),
}));

/** Controllable timedtext responder (the upstreamFetch seam). */
let timedtextResponse: () => Response = () =>
  new Response(JSON.stringify(FIXTURE_JSON3), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

mock.module("@/lib/youtube/upstream", () => ({
  upstreamFetch: () => async (_url: string | URL | Request, _init?: RequestInit) =>
    timedtextResponse(),
}));

/* ---- modules under test (imported after the mocks) ---- */
import {
  extractCaptionTracks,
  extractYtInitialPlayerResponse,
  fetchCaptionCues,
  getCaptionTracks,
  mapJson3Cues,
  pickCaptionTrack,
} from "@/lib/youtube/captions";
import { clearCache } from "@/lib/youtube/cache";
import { GET as transcriptRoute } from "@/app/api/videos/[id]/transcript/route";
import { GET as languagesRoute } from "@/app/api/videos/[id]/transcript/languages/route";
import { setupTestDb, fixtures } from "./helpers";
import {
  TranscriptPanel,
  dedupeLanguageOptions,
  readTranscriptLangPref,
  transcriptLangKey,
  writeTranscriptLangPref,
  type TranscriptLanguageOption,
} from "@/components/watch/transcript-panel";

setupTestDb();

beforeEach(() => {
  clearCache(); // per-test cache isolation (unique video ids would also do)
  pageHtml = () => FIXTURE_HTML;
  timedtextResponse = () =>
    new Response(JSON.stringify(FIXTURE_JSON3), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  win.sessionStorage.clear();
});

afterAll(() => {
  mock.module("@/lib/youtube/ssr", () => realSsr);
  mock.module("@/lib/youtube/upstream", () => realUpstream);
  mock.module("@/lib/youtube/captions", () => realCaptions);
});

/* ------------------------------------------------------------------ */
/* 1. Pure extractors/mappers                                          */
/* ------------------------------------------------------------------ */

describe("extractYtInitialPlayerResponse (the page-HTML seam)", () => {
  test("extracts the player response object from the watch page HTML", () => {
    const pr = extractYtInitialPlayerResponse(FIXTURE_HTML);
    expect((pr as Record<string, unknown>).videoDetails).toBeDefined();
    expect((pr as { captions?: unknown }).captions).toBeDefined();
  });

  test("no player response in the page → the honest throw", () => {
    expect(() => extractYtInitialPlayerResponse("<html><body>no scripts</body></html>")).toThrow(
      "ytInitialPlayerResponse not found"
    );
  });
});

describe("extractCaptionTracks (the tracks list mapping)", () => {
  test("maps name (simpleText + runs) + languageCode + kind per track", () => {
    const tracks = extractCaptionTracks(FIXTURE_PLAYER_RESPONSE);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      languageCode: "en",
      name: "English (auto-generated)",
      kind: "asr",
      baseUrl: "https://www.youtube.com/api/timedtext?v=SYNTH&lang=en&kind=asr",
    });
    expect(tracks[1]).toMatchObject({ languageCode: "de", name: "Deutsch", kind: null });
  });

  test("no captions in the player response → the honest empty list", () => {
    expect(extractCaptionTracks({ videoDetails: {} })).toEqual([]);
    expect(extractCaptionTracks(undefined)).toEqual([]);
  });

  test("pickCaptionTrack prefers a manual track over auto-generated for a code", () => {
    const tracks = [
      { languageCode: "en", name: "en-asr", kind: "asr" as const, baseUrl: "u1" },
      { languageCode: "en", name: "en-manual", kind: null, baseUrl: "u2" },
    ];
    expect(pickCaptionTrack(tracks, "en")?.name).toBe("en-manual");
    expect(pickCaptionTrack(tracks, "de")).toBeNull();
  });
});

describe("mapJson3Cues (the per-language cue mapping)", () => {
  test("maps tStartMs/dDurationMs + segs to cue rows; skips blank events", () => {
    const cues = mapJson3Cues(FIXTURE_JSON3, "en");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ id: "en-0", startSec: 0, endSec: 2, text: "hello world" });
    expect(cues[1]).toMatchObject({ startSec: 3, endSec: 5, text: "second line" });
  });

  test("no events array → the honest empty list", () => {
    expect(mapJson3Cues({}, "en")).toEqual([]);
    expect(mapJson3Cues({ events: "not-an-array" }, "en")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The captions lib ladder (the ssr + upstream seams)               */
/* ------------------------------------------------------------------ */

describe("getCaptionTracks / fetchCaptionCues (the lib ladder)", () => {
  test("the tracks list: page HTML → player response → mapped languages", async () => {
    const tracks = await getCaptionTracks("SYNTH1");
    expect(tracks).toHaveLength(3);
    expect(tracks.map((t) => t.languageCode)).toEqual(["en", "de", "en"]);
    expect(tracks.every((t) => !("baseUrl" in t))).toBe(true); // the wire DTO carries no endpoint
  });

  test("the per-language fetch: the track's timedtext json3 → cues", async () => {
    const cues = await fetchCaptionCues("SYNTH2", "de");
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("hello world");
  });

  test("a language with no track → the honest 404", async () => {
    await expect(fetchCaptionCues("SYNTH3", "fr")).rejects.toMatchObject({
      status: 404,
      message: 'No transcript track for language "fr"',
    });
  });

  test("an upstream timedtext failure → the honest 502", async () => {
    timedtextResponse = () => new Response("nope", { status: 500 });
    await expect(fetchCaptionCues("SYNTH4", "de")).rejects.toMatchObject({ status: 502 });
  });

  test("the watch page HTML fetch failing → propagates (never a guessed list)", async () => {
    pageHtml = () => {
      throw new Error("SSR fetch /watch/SYNTH5 failed: HTTP 403");
    };
    await expect(getCaptionTracks("SYNTH5")).rejects.toThrow("HTTP 403");
  });

  test("a page without a player response → the honest 502 (never a guessed list)", async () => {
    pageHtml = () => "<html><body><script>var ytInitialData = ({});</script></body></html>";
    await expect(getCaptionTracks("SYNTH6")).rejects.toMatchObject({ status: 502 });
  });
});

/* ------------------------------------------------------------------ */
/* 3. Route contracts (captions module mocked per case)                */
/* ------------------------------------------------------------------ */

describe("GET /api/videos/[id]/transcript — the language ladder", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (id: string, lang?: string) =>
    new Request(
      `http://localhost/api/videos/${id}/transcript${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`
    ) as unknown as Parameters<typeof transcriptRoute>[0];

  test("no lang → the default DB transcript, unchanged (the regression guard)", async () => {
    const { bbb } = await fixtures();
    const res = await transcriptRoute(req(bbb.id), ctx(bbb.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cues: { startSec: number }[] };
    expect(body.cues.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < body.cues.length; i++) {
      expect(body.cues[i].startSec).toBeGreaterThanOrEqual(body.cues[i - 1].startSec);
    }
  });

  test("?lang=de → the per-language cues + the language echo", async () => {
    const res = await transcriptRoute(req("SYNTH7", "de"), ctx("SYNTH7"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cues: { text: string }[]; language: string };
    expect(body.language).toBe("de");
    expect(body.cues.map((c) => c.text)).toEqual(["hello world", "second line"]);
  });

  test("?lang=fr → the honest unavailable state (404, never fabricated cues)", async () => {
    const res = await transcriptRoute(req("SYNTH8", "fr"), ctx("SYNTH8"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('No transcript track for language "fr"');
  });

  test("upstream failure → the honest 502", async () => {
    timedtextResponse = () => new Response("nope", { status: 503 });
    const res = await transcriptRoute(req("SYNTH9", "de"), ctx("SYNTH9"));
    expect(res.status).toBe(502);
  });
});

describe("GET /api/videos/[id]/transcript/languages — the tracks list", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (id: string) =>
    new Request(`http://localhost/api/videos/${id}/transcript/languages`) as unknown as Parameters<
      typeof languagesRoute
    >[0];

  test("the wire DTO: name + languageCode + kind per track", async () => {
    const res = await languagesRoute(req("SYNTH10"), ctx("SYNTH10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tracks: TranscriptLanguageOption[] };
    expect(body.tracks).toHaveLength(3);
    expect(body.tracks[0]).toMatchObject({
      languageCode: "en",
      name: "English (auto-generated)",
      kind: "asr",
    });
    expect(body.tracks[1]).toMatchObject({ languageCode: "de", name: "Deutsch", kind: null });
  });

  test("upstream page failure → the honest 502 (not an empty list)", async () => {
    pageHtml = () => {
      throw new Error("SSR fetch failed");
    };
    const res = await languagesRoute(req("SYNTH11"), ctx("SYNTH11"));
    expect(res.status).toBe(502);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Selection persistence + option dedupe                            */
/* ------------------------------------------------------------------ */

describe("transcript language selection persistence (session storage, per video)", () => {
  test("key is per-video; write → read round-trip; \"\" removes the preference", () => {
    expect(transcriptLangKey("dQw4")).toBe("wfx2-transcript-lang:dQw4");
    writeTranscriptLangPref(win.sessionStorage, "dQw4", "de");
    expect(readTranscriptLangPref(win.sessionStorage, "dQw4")).toBe("de");
    // a different video is untouched (per-video scoping)
    expect(readTranscriptLangPref(win.sessionStorage, "other")).toBeNull();
    writeTranscriptLangPref(win.sessionStorage, "dQw4", "");
    expect(readTranscriptLangPref(win.sessionStorage, "dQw4")).toBeNull();
  });

  test("a throwing storage degrades honestly (null / no throw)", () => {
    const hostile: Storage = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
      clear: () => {},
      length: 0,
      key: () => null,
    };
    expect(readTranscriptLangPref(hostile, "V1")).toBeNull();
    expect(() => writeTranscriptLangPref(hostile, "V1", "de")).not.toThrow();
  });

  test("dedupeLanguageOptions: one option per code, manual beats auto-generated", () => {
    const options = dedupeLanguageOptions([
      { languageCode: "en", name: "English (auto-generated)", kind: "asr" },
      { languageCode: "en", name: "English", kind: null },
      { languageCode: "de", name: "Deutsch", kind: null },
    ]);
    expect(options).toHaveLength(2);
    expect(options.find((o) => o.languageCode === "en")?.name).toBe("English");
    expect(options.find((o) => o.languageCode === "de")?.name).toBe("Deutsch");
  });
});

/* ------------------------------------------------------------------ */
/* 5. The panel's honest unavailable state (component render)          */
/* ------------------------------------------------------------------ */

describe("TranscriptPanel: the language selector + honest states", () => {
  let root: Root | null = null;
  let host: ReturnType<typeof win.document.createElement> | null = null;

  const realFetch = globalThis.fetch;
  const fetchLog: string[] = [];

  afterEach(() => {
    const r = root;
    if (r) {
      act(() => {
        r.unmount();
      });
      root = null;
    }
    host?.remove();
    host = null;
    globalThis.fetch = realFetch;
    fetchLog.length = 0;
  });

  const q = (sel: string): HTMLElement | null =>
    host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;

  async function renderPanel(cues: { id: string; startSec: number; endSec: number; text: string }[]) {
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <TranscriptPanel
          videoId="PANELV1"
          cues={cues}
          getTime={() => 0}
          query=""
          onQueryChange={() => {}}
          onSeek={() => {}}
          onClose={() => {}}
        />
      );
    });
    await sleep(20);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("tracks > 0 → the selector lists them; a 404 language → the honest unavailable message + persistence", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      fetchLog.push(u);
      if (u.includes("/transcript/languages")) {
        return new Response(
          JSON.stringify({
            tracks: [
              { languageCode: "en", name: "English (auto-generated)", kind: "asr" },
              { languageCode: "de", name: "Deutsch", kind: null },
              // a stale-list case: the panel knows "es", but the per-language
              // route honestly reports no track for it
              { languageCode: "es", name: "Español", kind: null },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (u.includes("/transcript?lang=es")) {
        return new Response(JSON.stringify({ error: 'No transcript track for language "es"' }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await renderPanel([]);
    const select = q('select[aria-label="Transcript language"]');
    expect(select).not.toBeNull();
    const options = Array.from(select!.querySelectorAll("option"));
    expect(options.map((o) => o.textContent)).toEqual([
      "Default",
      "English (auto-generated)",
      "Deutsch",
      "Español",
    ]);

    // pick a language with no track → the honest unavailable state surfaces
    await act(async () => {
      const sel = select as unknown as HTMLSelectElement;
      sel.value = "es";
      sel.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
    });
    await sleep(20);
    const alert = q('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('No transcript track for language "es"');

    // the selection persisted per video (session storage)
    expect(win.sessionStorage.getItem("wfx2-transcript-lang:PANELV1")).toBe("es");
  });

  test("no tracks ([]) → no selector; the default cues still render", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("/transcript/languages")) {
        return new Response(JSON.stringify({ tracks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await renderPanel([
      { id: "c1", startSec: 0, endSec: 2, text: "default cue" },
    ]);
    expect(q('select[aria-label="Transcript language"]')).toBeNull();
    expect(host!.textContent).toContain("default cue");
  });

  test("the persisted selection restores on mount (per video)", async () => {
    win.sessionStorage.setItem("wfx2-transcript-lang:PANELV2", "de");
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      fetchLog.push(u);
      if (u.includes("/transcript/languages")) {
        return new Response(
          JSON.stringify({ tracks: [{ languageCode: "de", name: "Deutsch", kind: null }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (u.includes("/transcript?lang=de")) {
        return new Response(
          JSON.stringify({ cues: [{ id: "de-0", startSec: 1, endSec: 2, text: "hallo" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <TranscriptPanel
          videoId="PANELV2"
          cues={[]}
          getTime={() => 0}
          query=""
          onQueryChange={() => {}}
          onSeek={() => {}}
          onClose={() => {}}
        />
      );
    });
    await sleep(20);
    expect(fetchLog.some((u) => u.includes("/transcript?lang=de"))).toBe(true);
    expect(host!.textContent).toContain("hallo");
  });
});
