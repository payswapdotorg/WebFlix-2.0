"use client";

/**
 * WFX2-P2-AU — the WebFlix session hook.
 *
 * A light fetch hook on the stock `/api/auth/session` route, built on the
 * repo's established useApi pattern (React Query is a dependency but no
 * QueryClientProvider is mounted anywhere in the app — useApi IS the
 * server-state pattern here). The next-auth/react client bundle is NOT
 * pulled in: a fetch suffices.
 *
 *   status: "loading"          → the session probe is in flight
 *          | "authenticated"   → `user` carries the WebFlix identity
 *          | "unauthenticated" → guest (youtube.com signed-out parity)
 */
import { useApi } from "@/hooks/use-api";
import type { WebFlixSessionPayload, WebFlixSessionUser } from "@/lib/auth/types";

export type WebFlixSessionStatus = "loading" | "authenticated" | "unauthenticated";

export interface WebFlixSession {
  status: WebFlixSessionStatus;
  user: WebFlixSessionUser | null;
}

export function useWebFlixSession(): WebFlixSession {
  const { data } = useApi<WebFlixSessionPayload>("/api/auth/session");

  const raw = data?.user;
  const user: WebFlixSessionUser | null =
    raw && typeof raw.id === "string"
      ? {
          id: raw.id,
          email: typeof raw.email === "string" ? raw.email : "",
          displayName: typeof raw.name === "string" ? raw.name : "",
          avatarSeed: typeof raw.avatarSeed === "number" ? raw.avatarSeed : 0,
        }
      : null;

  // no payload yet → loading; payload without a user → guest ({})
  const status: WebFlixSessionStatus = data === null ? "loading" : user ? "authenticated" : "unauthenticated";
  return { status, user };
}
