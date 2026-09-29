/**
 * WFX2-A-W Session Broker — append-only action journal (JSONL).
 * One line per action attempt: {ts, kind, target, result}.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { JournalEntry } from "./types";

export class Journal {
  constructor(private file: string) {}

  append(entry: JournalEntry): void {
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** Last entry (used for healthz lastActionAt) — null when empty. */
  last(): JournalEntry | null {
    try {
      if (!existsSync(this.file)) return null;
      const text = readFileSync(this.file, "utf8").trim();
      if (!text) return null;
      const lastLine = text.slice(text.lastIndexOf("\n") + 1);
      return JSON.parse(lastLine) as JournalEntry;
    } catch {
      return null;
    }
  }

  /** Tail of the journal (for tests / debugging). */
  tail(n: number): JournalEntry[] {
    try {
      if (!existsSync(this.file)) return [];
      const lines = readFileSync(this.file, "utf8").trim().split("\n").filter(Boolean);
      return lines.slice(-n).map((l) => JSON.parse(l) as JournalEntry);
    } catch {
      return [];
    }
  }
}
