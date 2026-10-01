"use client";

import Link from "next/link";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signInHref } from "@/lib/auth/client";

/**
 * WFX2-P2-AU — the youtube.com signed-out screen (the /history parity
 * layout): the rounded account-illustration area, the
 * "Don't miss new videos" heading, the "Sign in to see your X" line, and
 * the red Sign in button — linking the sign-in flow with the redirect back
 * to the surface that prompted it.
 */
export function SignedOutScreen({
  title = "Don't miss new videos",
  message,
  redirect,
  compact = false,
  className,
}: {
  title?: string;
  message: string;
  /** the path to return to after sign-in (same-app relative only) */
  redirect?: string | null;
  /** the bell dropdown's narrow variant */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="signed-out-screen"
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "px-4 py-8" : "px-4 py-16 sm:px-6",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-3xl border border-border bg-secondary/40",
          compact ? "h-[76px] w-[150px]" : "h-[120px] w-[226px]",
        )}
      >
        <UserRound className={cn("text-muted-foreground/60", compact ? "size-10" : "size-16")} />
      </div>
      <h2 className={cn("font-medium", compact ? "mt-4 text-base" : "mt-6 text-lg sm:text-xl")}>
        {title}
      </h2>
      <p className={cn("max-w-md text-sm text-muted-foreground", compact ? "mt-1" : "mt-2")}>
        {message}
      </p>
      <Button
        asChild
        className={cn(
          "rounded-full bg-yt-red font-medium text-white hover:bg-yt-red/90",
          compact ? "mt-4 h-9 px-4 text-sm" : "mt-6 h-10 px-5",
        )}
      >
        <Link href={signInHref(redirect)} aria-label="Sign in">
          Sign in
        </Link>
      </Button>
    </div>
  );
}
