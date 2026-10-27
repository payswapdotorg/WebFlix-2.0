/// <reference types="bun-types" />
/**
 * P58-TIKTOK-SOURCE — the non-interference laws (ADR 0002 §6 applied to the
 * third source, ADR 0004): the tiktok module mirrors the netflix seams, never
 * touches youtube business logic (the shared Upstash cache adapter is the one
 * infrastructure exception the netflix module already rides), and no file
 * outside the URL law constructs a tiktok.com URL. The additive surfaces
 * (sidebar row, search shelf mount) are pinned byte-level.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { TIKTOK_CURATED_UNIVERSE } from "@/lib/tiktok/curated";
import { getDeadPost, isLethalPlayerError, recordDeadPost } from "@/lib/tiktok/dead";
import { clearCache } from "@/lib/youtube/cache";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the tiktok module's import law", () => {
  const libFiles = walk("src/lib/tiktok");

  test("lib/tiktok imports @/lib/youtube ONLY for the shared cache adapter", () => {
    const offenders = libFiles
      .map((f) => ({ f, src: readFileSync(f, "utf8") }))
      .filter(({ src }) => src.includes('@/lib/youtube/'))
      .flatMap(({ f, src }) =>
        (src.match(/from "@\/lib\/youtube\/[^"]+"/g) ?? [])
          .filter((imp) => imp !== 'from "@/lib/youtube/upstash-cache"')
          .map((imp) => `${f}: ${imp}`)
      );
    expect(offenders).toEqual([]);
  });

  test("lib/tiktok mirrors the netflix seams (upstream injectable, URL law, typed DTOs)", () => {
    const names = libFiles.map((f) => f.split("/").pop()).sort();
    expect(names).toEqual(["curated.ts", "dead.ts", "library.ts", "types.ts", "upstream.ts", "urls.ts"]);
  });
});

describe("the curated universe law (P59-R1) — cited, never guessed", () => {
  test("every entry is a format-valid post id with a factual handle", () => {
    expect(TIKTOK_CURATED_UNIVERSE.length).toBe(17);
    const seen = new Set<string>();
    for (const p of TIKTOK_CURATED_UNIVERSE) {
      expect(p.postId).toMatch(/^\d{6,32}$/);
      expect(p.author).toMatch(/^[\w.\-]{1,30}$/);
      expect(seen.has(p.postId)).toBeFalse();
      seen.add(p.postId);
    }
  });

  test("TikTok's own docs example stays in the universe (P58 continuity)", () => {
    expect(TIKTOK_CURATED_UNIVERSE[0]).toEqual({ postId: "6718335390845095173", author: "scout2015" });
  });

  test("the citation ledger carries every curated post (provenance law)", () => {
    const ledger = JSON.parse(readFileSync("scripts/ops/tiktok-curated-citations.json", "utf8")) as {
      cited: { postId: string }[];
    };
    const ledgerIds = new Set(ledger.cited.map((c) => c.postId));
    for (const p of TIKTOK_CURATED_UNIVERSE.slice(1)) {
      expect(ledgerIds.has(p.postId)).toBeTrue();
    }
  });
});

describe("the dead-post ledger law (P59-R3) — only lethal errors are remembered", () => {
  test("the lethal family is exactly 1000–1099", () => {
    expect(isLethalPlayerError(1001)).toBeTrue();
    expect(isLethalPlayerError(1000)).toBeTrue();
    expect(isLethalPlayerError(1099)).toBeTrue();
    expect(isLethalPlayerError(999)).toBeFalse();
    expect(isLethalPlayerError(2001)).toBeFalse();
    expect(isLethalPlayerError(3001)).toBeFalse();
    expect(isLethalPlayerError(3002)).toBeFalse();
    expect(isLethalPlayerError(Number.NaN)).toBeFalse();
  });

  test("a lethal report is recorded for the soft TTL; a non-lethal one never lands", async () => {
    clearCache();
    const ok = await recordDeadPost("7212953186724842795", 1001, "INVALID_VIDEO");
    expect(ok).toEqual({ recorded: true });
    const rec = await getDeadPost("7212953186724842795");
    expect(rec?.code).toBe(1001);

    const guarded = await recordDeadPost("7212953186724842795", 2001, "SERVER_ERROR");
    expect(guarded).toEqual({ recorded: null });
    expect(await getDeadPost("7213856534080605483")).toBeNull();

    const malformed = await recordDeadPost("bogus", 1001, "INVALID_VIDEO");
    expect(malformed).toEqual({ recorded: false });
  });
});

describe("the URL law — only urls.ts constructs tiktok.com URLs", () => {
  test("no tiktok.com URL literal outside src/lib/tiktok/urls.ts (src tree)", () => {
    const offenders = walk("src")
      .filter((f) => f !== join("src", "lib", "tiktok", "urls.ts"))
      .map((f) => ({ f, src: readFileSync(f, "utf8") }))
      .filter(({ src }) => /https?:\/\/[a-z.]*tiktok\.com/.test(src))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});

describe("the additive surfaces", () => {
  test("the sidebar carries the /tiktok row", () => {
    const s = readFileSync("src/components/app/sidebar.tsx", "utf8");
    expect(s.includes('href: "/tiktok"')).toBeTrue();
  });

  test("the global search page mounts the TikTok shelf AFTER the Netflix shelf", () => {
    const s = readFileSync("src/app/search/view.tsx", "utf8");
    const netflix = s.indexOf("<NetflixSearchShelf");
    const tiktok = s.indexOf("<TikTokSearchShelf");
    expect(netflix).toBeGreaterThan(-1);
    expect(tiktok).toBeGreaterThan(netflix);
  });

  test("the youtube lanes stay untouched by this lane (no tiktok imports)", () => {
    const offenders = walk("src/lib/youtube").filter((f) =>
      readFileSync(f, "utf8").includes("@/lib/tiktok")
    );
    expect(offenders).toEqual([]);
  });
});
