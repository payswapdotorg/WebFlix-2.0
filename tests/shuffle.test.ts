/// <reference types="bun-types" />
/**
 * REA-1 G16 — the deterministic seeded shuffle (pure lib, fixtures-free by
 * construction: the law under test is arithmetic, not upstream data).
 */
import { describe, expect, test } from "bun:test";

import {
  makeShuffleSeed,
  parseShuffleSeedParam,
  seededShuffle,
} from "@/lib/playlist/shuffle";

const LIST = Array.from({ length: 24 }, (_, i) => `v${i + 1}`);

describe("seededShuffle — the deterministic-seed law", () => {
  test("the same seed always yields the same order", () => {
    const a = seededShuffle(LIST, 12345);
    const b = seededShuffle(LIST, 12345);
    expect(a).toEqual(b);
  });

  test("a different seed yields a different order (on a 24-item list)", () => {
    const a = seededShuffle(LIST, 1);
    const b = seededShuffle(LIST, 2);
    expect(a).not.toEqual(b);
  });

  test("the output is a permutation of the input (no loss, no dupes)", () => {
    for (const seed of [1, 7, 99, 123456]) {
      const out = seededShuffle(LIST, seed);
      expect([...out].sort()).toEqual([...LIST].sort());
    }
  });

  test("an actually-shuffled order (not the identity, on a 24-item list)", () => {
    const out = seededShuffle(LIST, 4242);
    expect(out).not.toEqual(LIST);
  });

  test("length 0 and 1 lists pass through unchanged", () => {
    expect(seededShuffle([], 5)).toEqual([]);
    expect(seededShuffle(["only"], 5)).toEqual(["only"]);
  });

  test("pure — the input array is never mutated", () => {
    const input = ["a", "b", "c", "d", "e", "f"];
    const snapshot = [...input];
    seededShuffle(input, 777);
    expect(input).toEqual(snapshot);
  });

  test("object items keep their identity (the queue rows ride by reference)", () => {
    const items = LIST.map((id) => ({ id }));
    const out = seededShuffle(items, 31337);
    expect(out.length).toBe(items.length);
    for (const it of out) expect(items).toContain(it);
  });
});

describe("parseShuffleSeedParam — the URL param law", () => {
  test("a valid positive integer parses", () => {
    expect(parseShuffleSeedParam("42")).toBe(42);
    expect(parseShuffleSeedParam("999999999")).toBe(999999999);
  });

  test("absent / empty / junk → null (never a coerced seed)", () => {
    expect(parseShuffleSeedParam(null)).toBeNull();
    expect(parseShuffleSeedParam(undefined)).toBeNull();
    expect(parseShuffleSeedParam("")).toBeNull();
    expect(parseShuffleSeedParam("abc")).toBeNull();
    expect(parseShuffleSeedParam("12x")).toBeNull();
    expect(parseShuffleSeedParam("-5")).toBeNull();
    expect(parseShuffleSeedParam("0")).toBeNull();
    expect(parseShuffleSeedParam("1.5")).toBeNull();
    expect(parseShuffleSeedParam("99999999999")).toBeNull(); // > 10 digits
  });
});

describe("makeShuffleSeed — a fresh seed per click", () => {
  test("two consecutive clicks never collide", () => {
    const a = makeShuffleSeed();
    const b = makeShuffleSeed();
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  test("seeds are URL-safe positive integers", () => {
    for (let i = 0; i < 5; i++) {
      const s = makeShuffleSeed();
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(String(s)).toMatch(/^\d{1,10}$/);
    }
  });
});
