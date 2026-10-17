/**
 * REA-1 G16 — the deterministic playlist shuffle (pure, shared).
 *
 * youtube.com's Shuffle (measured live 2026-10-17, docs/research/
 * 2026-10-17-rea1-measurements.md): the playlist page's Shuffle navigates to
 * `/watch?v=<random video>&list=<playlistId>` and the watch page's queue
 * panel follows a shuffled sequence. youtube.com rebuilds the shuffle
 * server-side per navigation (the state never rides the URL).
 *
 * WebFlix's honest mapping (the work order's contract): a DETERMINISTIC seed
 * per click rides the URL (`&shuffle=<seed>`), and the shuffled order is
 * local playback-order logic over the already-fetched list — the same seed
 * always yields the same order (shareable/reloadable autoplay chains), a new
 * click yields a new seed. No live YouTube write — this is pure ordering.
 */

/** A shuffle seed as it rides the URL: a positive 31-bit integer string. */
export type ShuffleSeed = number;

const SEED_RE = /^\d{1,10}$/;

/** Parse a `?shuffle=` param → a seed (null when absent/invalid). */
export function parseShuffleSeedParam(raw: string | null | undefined): ShuffleSeed | null {
  if (typeof raw !== "string" || !SEED_RE.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * A fresh seed per click (client-safe). `crypto.getRandomValues` when
 * available, Date.now()+counter otherwise — either way a positive integer a
 * user could have plausibly typed; the ONLY property the contract needs is
 * "different on each click, deterministic once fixed".
 */
let seedCounter = 0;
export function makeShuffleSeed(): ShuffleSeed {
  const c = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  if (c) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0]! % 0x7ffffff0) + 1;
  }
  seedCounter = (seedCounter + 1) % 1000;
  return (Date.now() % 0x7ffffff0) + seedCounter;
}

/** mulberry32 — the small, well-known deterministic PRNG (32-bit state). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded Fisher–Yates: the SAME items + seed always produce the SAME order
 * (the deterministic-seed law); a permutation of the input (length 0/1 → the
 * input unchanged). Pure — no mutation of the input array.
 */
export function seededShuffle<T>(items: readonly T[], seed: ShuffleSeed): T[] {
  if (items.length <= 1) return [...items];
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
