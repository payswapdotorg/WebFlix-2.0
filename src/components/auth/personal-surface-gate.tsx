"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { SignedOutScreen } from "./signed-out-screen";

/**
 * WFX2-P2-AU — the personal-surface gate (youtube.com signed-out parity).
 *
 * Wrap, never rewrite: the gated page keeps its internals; this component
 * decides what renders —
 *   loading          → the surface's skeleton (the session probe is fast);
 *   guest            → the youtube.com/history-style signed-out screen;
 *   signed-in        → the surface itself, EXACTLY as before (the WebFlix
 *                      session fronts the operator backend — no new
 *                      restrictions behind the gate).
 */
export type PersonalSurface =
  | "history"
  | "liked"
  | "playlists"
  | "subscriptions"
  | "notifications"
  | "account"
  | "studio";

const SURFACE_COPY: Record<PersonalSurface, { title?: string; message: string }> = {
  history: { message: "Sign in to see your history on WebFlix" },
  liked: { message: "Sign in to see your liked videos on WebFlix" },
  playlists: { message: "Sign in to see your playlists on WebFlix" },
  subscriptions: { message: "Sign in to see your subscriptions on WebFlix" },
  notifications: { message: "Sign in to see your notifications on WebFlix" },
  account: {
    title: "Your WebFlix account",
    message: "Sign in to manage your WebFlix identity and see how WebFlix connects to YouTube.",
  },
  studio: {
    title: "Creator tools need your account",
    message:
      "Sign in to open WebFlix Studio — creator surfaces act on the operator's YouTube session, honestly labeled.",
  },
};

export function PersonalSurfaceGate({
  surface,
  redirect,
  children,
}: {
  surface: PersonalSurface;
  /** where sign-in returns to (defaults to the surface's own path) */
  redirect?: string;
  children: React.ReactNode;
}) {
  const session = useWebFlixSession();

  if (session.status === "loading") {
    return (
      <div className="space-y-4 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-7 w-52" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 py-2">
            <Skeleton className="aspect-video w-[160px] shrink-0 rounded-xl sm:w-[246px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (session.status === "unauthenticated") {
    const copy = SURFACE_COPY[surface];
    return <SignedOutScreen title={copy.title} message={copy.message} redirect={redirect ?? defaultPath(surface)} />;
  }

  return <>{children}</>;
}

function defaultPath(surface: PersonalSurface): string {
  return `/${surface}`;
}
