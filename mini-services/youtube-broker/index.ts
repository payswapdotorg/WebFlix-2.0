/**
 * WFX2-A-W Session Broker — entry point.
 *
 * Run:    BROKER_SECRET=… CDP_HTTP=http://127.0.0.1:9222 bun run dev
 * Health: curl http://127.0.0.1:3055/healthz
 *
 * Localhost-only by default. The Vercel app reaches this through the lead's
 * gateway (see README.md).
 */
import { createBrokerServer, createBrokerOptions } from "./server";

const opts = createBrokerOptions();
const server = createBrokerServer(opts);

console.log(`[youtube-broker] listening on http://127.0.0.1:${server.port}`);
console.log(`[youtube-broker] CDP: ${opts.cdpHttp}`);
console.log(
  `[youtube-broker] secret: ${opts.secret ? "configured" : "MISSING — actions are refused (fail-closed)"}`
);
console.log(`[youtube-broker] journal: ${opts.journalPath}`);

process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});
process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});
