"use client";

import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/use-api";
import type { ViewerDto } from "@/lib/watch/types";

/**
 * The account page — the WebFlix account flow. WebFlix is single-tenant: it
 * acts on the operator's YouTube session (YT_COOKIES env — never committed).
 * This page states the session honestly: viewer identity (local demo), the
 * operator session state (from /api/watch/session), and the connection
 * pointer. No fake login form, never.
 */
export default function AccountPage() {
  const { data } = useApi<{ viewer: ViewerDto; operatorSession: boolean }>("/api/watch/session");
  const viewer = data?.viewer;
  const operatorSession = data?.operatorSession ?? false;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" className="w-fit gap-2 rounded-full px-4">
        <Link href="/">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
      </Button>

      <div className="flex items-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-secondary">
          <UserRound className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            WebFlix acts on the operator&apos;s YouTube session — single-tenant live mode.
          </p>
        </div>
      </div>

      <section
        aria-label="Session status"
        className="rounded-xl border border-border p-4 sm:p-6"
      >
        <h2 className="text-base font-semibold">YouTube session</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {operatorSession
            ? "Operator session connected — comment writes, likes, reports and creator tools act on the operator's real YouTube account."
            : "No operator session is configured (public mode). Reads stay fully live; write surfaces (comments, likes, reports, heart/pin) honestly show their signed-out states until the session is connected."}
        </p>
        {!operatorSession && (
          <p className="mt-2 text-sm text-muted-foreground">
            Connect it by setting <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">YT_COOKIES</code>{" "}
            in the server environment (see <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">.env.example</code>).
            The operator account owner manages this — sessions are never stored in the browser.
          </p>
        )}
      </section>

      <section aria-label="Local identity" className="rounded-xl border border-border p-4 sm:p-6">
        <h2 className="text-base font-semibold">Local identity</h2>
        {viewer ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Viewing as {viewer.name} (@{viewer.handle}) — WebFlix&apos;s local profile for UI
            preferences. All YouTube-side truth (comments, subscriptions, history) belongs to the
            operator account above.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Loading identity…</p>
        )}
      </section>
    </main>
  );
}
