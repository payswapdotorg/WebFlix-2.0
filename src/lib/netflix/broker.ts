/**
 * P47 — the netflix-desktop broker endpoint seam (the production wiring).
 *
 * Every /api/netflix/watch/* route proxies the playback broker
 * (mini-services/netflix-desktop). Dev talks to it directly on its own port;
 * production (Vercel) reaches it through a gateway that needs a routing query
 * on EVERY request — the exact shape the YouTube write broker already solved
 * with brokerEndpoint (src/lib/broker.ts). This is that same composition law,
 * carried over for the netflix broker so the two brokers stay symmetrical.
 *
 * Env (names only — values live in the deployment env, never committed):
 *   NETFLIX_DESKTOP_URL    default http://127.0.0.1:3030 (direct local
 *                          broker); or a gateway base, optionally WITH query
 *                          — e.g. https://host/?XTransformPort=3030 — whose
 *                          routing query rides on every request
 *   NETFLIX_DESKTOP_QUERY  optional routing query for gateway bases, e.g.
 *                          "XTransformPort=3030" — appended to EVERY broker
 *                          request (`?<QUERY>`); composes safely with a
 *                          plain base and with a query already embedded in
 *                          NETFLIX_DESKTOP_URL
 */

/** Dev default — the broker's own port on the sandbox (local runs work with
 *  no env at all; production overrides via the deployment env). */
const DEFAULT_BROKER_URL = "http://127.0.0.1:3030";

export function netflixBrokerUrl(): string {
  return process.env.NETFLIX_DESKTOP_URL?.trim() || DEFAULT_BROKER_URL;
}

/** The optional gateway routing query (e.g. "XTransformPort=3030"). */
export function netflixBrokerQuery(): string {
  return (process.env.NETFLIX_DESKTOP_QUERY ?? "").trim().replace(/^[?&]+/, "");
}

/**
 * Compose one broker endpoint. NETFLIX_DESKTOP_QUERY env — composed safely
 * (single "?", "&"-joined, no doubled separators, trailing slashes stripped
 * from the base, the path always "/…") — the same law as brokerEndpoint.
 */
export function netflixBrokerEndpoint(path: string): string {
  const url = netflixBrokerUrl();
  const q = url.indexOf("?");
  const base = (q === -1 ? url : url.slice(0, q)).replace(/\/+$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const query = [q === -1 ? "" : url.slice(q + 1), netflixBrokerQuery()]
    .filter(Boolean)
    .join("&");
  return `${base}${safePath}${query ? `?${query}` : ""}`;
}
