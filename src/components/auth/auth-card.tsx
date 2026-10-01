"use client";

import { WebFlixLogo } from "@/components/app/logo";

/**
 * WFX2-P2-AU — the Google-account sign-in visual parity shell: the
 * WebFlix wordmark above a centered white card ("Sign in / to continue
 * to WebFlix"), used by both /signin and /signup.
 */
export function AuthCard({
  heading,
  subheading,
  children,
  footer,
}: {
  heading: string;
  subheading: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6" aria-hidden="true">
        <WebFlixLogo className="scale-110" />
      </div>
      <div
        className="w-full max-w-[450px] rounded-lg border border-border bg-card p-8 shadow-sm"
        data-testid="auth-card"
      >
        <h1 className="text-2xl font-normal">{heading}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subheading}</p>
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 border-t border-border pt-4">{footer}</div>}
      </div>
      <p className="mt-6 max-w-[450px] text-center text-xs text-muted-foreground">
        A WebFlix account is a WebFlix identity — it fronts this app&apos;s YouTube session; it
        is not a YouTube account.
      </p>
    </main>
  );
}
