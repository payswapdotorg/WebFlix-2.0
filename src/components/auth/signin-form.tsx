"use client";

/**
 * WFX2-P2-AU — the /signin form (Google-account visual parity):
 * email + password fields with labels, show-password toggle, inline error
 * states, the honest account-recovery degradation ("account recovery is
 * not available yet" — no email flows exist in this build, and "ask the
 * operator to reset" is NOT honest copy), and the return-to-surface
 * `redirect` param. Posts through the stock NextAuth credentials route
 * (see lib/auth/client — no next-auth/react bundle).
 */
import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "./auth-card";
import { signInWithCredentials, safeRedirect } from "@/lib/auth/client";

export function SignInForm({ redirectTo }: { redirectTo: string | null }) {
  const target = safeRedirect(redirectTo);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setForgot(false);
    setBusy(true);
    const outcome = await signInWithCredentials(email.trim(), password);
    if (outcome.ok) {
      // full navigation — every mounted surface refetches the session
      window.location.assign(target);
      return;
    }
    setError(
      outcome.error === "credentials"
        ? "Wrong password. Try again or click Forgot password to reset it."
        : "Couldn't reach WebFlix sign-in. Check your connection and try again."
    );
    setBusy(false);
  };

  return (
    <AuthCard
      heading="Sign in"
      subheading="to continue to WebFlix"
      footer={
        <p className="text-sm text-muted-foreground">
          New to WebFlix?{" "}
          <Link
            href={target === "/" ? "/signup" : `/signup?redirect=${encodeURIComponent(target)}`}
            className="font-medium text-yt-red hover:underline"
          >
            Create account
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setForgot((f) => !f)}
            className="text-sm text-muted-foreground transition hover:text-foreground"
          >
            Forgot password?
          </button>
          {forgot && (
            <p className="rounded-md bg-secondary px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Account recovery is not available yet — WebFlix accounts can&apos;t be recovered
              by email in this build. If you lost the password, that account can&apos;t be
              recovered; you can create a new WebFlix account instead.
            </p>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="h-10 rounded-full bg-yt-red px-6 font-medium text-white hover:bg-yt-red/90"
          >
            {busy ? "Signing in…" : "Next"}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
