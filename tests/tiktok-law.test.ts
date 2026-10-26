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
    expect(names).toEqual(["library.ts", "types.ts", "upstream.ts", "urls.ts"]);
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
