/**
 * WFX2-W opaque cursors — base64 JSON {"o": offset}.
 */

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0) {
      return parsed.o;
    }
  } catch {
    // fallthrough
  }
  return null;
}

/** Slice a list by cursor offset; returns page + nextCursor (null = end). */
export function pageSlice<T>(items: T[], offset: number, limit: number): {
  items: T[];
  nextCursor: string | null;
} {
  const page = items.slice(offset, offset + limit);
  const next = offset + limit;
  const nextCursor = next < items.length ? encodeCursor(next) : null;
  return { items: page, nextCursor };
}
