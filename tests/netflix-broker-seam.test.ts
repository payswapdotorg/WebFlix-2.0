/// <reference types="bun-types" />
/**
 * P47 — the netflix-desktop broker endpoint seam (the production wiring).
 *
 * The composition law the two brokers share: a plain base, a base with the
 * routing query already embedded, a NETFLIX_DESKTOP_QUERY env, or both —
 * every request carries the query exactly once, the base never grows
 * trailing slashes, and the path always lands after the base (never inside
 * the query). Hermetic: env-only, zero network, zero Netflix touches.
 */
import { afterEach, describe, expect, test } from "bun:test";

const mod = await import("../src/lib/netflix/broker");
const { netflixBrokerUrl, netflixBrokerQuery, netflixBrokerEndpoint } = mod;

const ENV_KEYS = ["NETFLIX_DESKTOP_URL", "NETFLIX_DESKTOP_QUERY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the netflix broker endpoint seam", () => {
  test("no env → the dev default (the broker's own port)", () => {
    delete process.env.NETFLIX_DESKTOP_URL;
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerUrl()).toBe("http://127.0.0.1:3030");
    expect(netflixBrokerQuery()).toBe("");
    expect(netflixBrokerEndpoint("/healthz")).toBe("http://127.0.0.1:3030/healthz");
  });

  test("a plain gateway base gains the NETFLIX_DESKTOP_QUERY on every request", () => {
    process.env.NETFLIX_DESKTOP_URL = "https://gw.example.com";
    process.env.NETFLIX_DESKTOP_QUERY = "XTransformPort=3030";
    expect(netflixBrokerEndpoint("/ingest/token")).toBe(
      "https://gw.example.com/ingest/token?XTransformPort=3030",
    );
    expect(netflixBrokerEndpoint("/session")).toBe(
      "https://gw.example.com/session?XTransformPort=3030",
    );
  });

  test("a query embedded in the base composes with the env query (&-joined, once)", () => {
    process.env.NETFLIX_DESKTOP_URL = "https://gw.example.com/?XTransformPort=3030";
    process.env.NETFLIX_DESKTOP_QUERY = "flag=1";
    expect(netflixBrokerEndpoint("/ingest")).toBe(
      "https://gw.example.com/ingest?XTransformPort=3030&flag=1",
    );
  });

  test("both queries present and no env query → the embedded one still rides", () => {
    process.env.NETFLIX_DESKTOP_URL = "https://gw.example.com?XTransformPort=3030";
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerEndpoint("/healthz")).toBe(
      "https://gw.example.com/healthz?XTransformPort=3030",
    );
  });

  test("trailing slashes on the base never double into the path", () => {
    process.env.NETFLIX_DESKTOP_URL = "http://127.0.0.1:3030///";
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerEndpoint("/healthz")).toBe("http://127.0.0.1:3030/healthz");
  });

  test("a path without its leading slash is normalized (the law: always /…)", () => {
    delete process.env.NETFLIX_DESKTOP_URL;
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerEndpoint("ingest/token")).toBe("http://127.0.0.1:3030/ingest/token");
  });

  test("whitespace-only env values fall back to the dev default (trim law)", () => {
    process.env.NETFLIX_DESKTOP_URL = "   ";
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerUrl()).toBe("http://127.0.0.1:3030");
  });

  test("the query env tolerates a stray leading ? or & (the brokerQuery law)", () => {
    process.env.NETFLIX_DESKTOP_URL = "https://gw.example.com";
    process.env.NETFLIX_DESKTOP_QUERY = "?XTransformPort=3030";
    expect(netflixBrokerQuery()).toBe("XTransformPort=3030");
    expect(netflixBrokerEndpoint("/session")).toBe(
      "https://gw.example.com/session?XTransformPort=3030",
    );
  });

  test("the seam keeps the dev default verbatim — the test stub intercepts by URL", () => {
    // tests/netflix-autoauth.test.ts intercepts fetch on "127.0.0.1:3030";
    // the default must never grow a suffix or the stub goes blind.
    delete process.env.NETFLIX_DESKTOP_URL;
    delete process.env.NETFLIX_DESKTOP_QUERY;
    expect(netflixBrokerEndpoint("/ingest")).toMatch(/^http:\/\/127\.0\.0\.1:3030\/ingest$/);
  });
});
