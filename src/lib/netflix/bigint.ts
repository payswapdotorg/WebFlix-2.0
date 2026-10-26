/**
 * P55-LAW — the Int↔BigInt seam.
 *
 * Netflix publishes cumulative all-time hours in the billions (measured:
 * Squid Game S1 rides 2,205,200,000 weekly hours in the all-time mirror).
 * The mirror columns are BigInt in BOTH schemas (SQLite dev, Postgres prod)
 * because a 32-bit Int silently caps at 2,147,483,647 — on Postgres the same
 * write throws and the mirror quietly stops at legacy rows.
 *
 * The DTO contract stays `number` (every value is exact below 2^53); these
 * two helpers are the ONLY conversion points — every Prisma write converts
 * up, every read converts back down.
 */
export function toBig(n: number | null | undefined): bigint | null {
  return n == null ? null : BigInt(Math.trunc(n));
}

export function fromBig(v: bigint | number | null | undefined): number | null {
  return v == null ? null : Number(v);
}
