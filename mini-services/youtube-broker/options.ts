/**
 * WFX2-A-W Session Broker — environment options.
 *
 * Secrets come from env ONLY (never committed):
 *   BROKER_SECRET  — shared secret required on every /broker/* action
 *   CDP_HTTP       — DevTools HTTP endpoint of the logged-in browser
 *                    (default http://127.0.0.1:9222)
 *   BROKER_JOURNAL — action journal path (default ./actions.jsonl)
 */
import { resolve } from "node:path";

export interface BrokerOptions {
  cdpHttp: string;
  secret: string | null;
  journalPath: string;
  port: number;
  hostname?: string;
}

export function createBrokerOptions(env: Record<string, string | undefined> = process.env): BrokerOptions {
  const secret = env.BROKER_SECRET?.trim() || null;
  const cdpHttp = (env.CDP_HTTP || "http://127.0.0.1:9222").replace(/\/+$/, "");
  const journalPath = env.BROKER_JOURNAL
    ? resolve(env.BROKER_JOURNAL)
    : resolve(import.meta.dir, "actions.jsonl");
  return {
    cdpHttp,
    secret,
    journalPath,
    port: 3055,
  };
}
