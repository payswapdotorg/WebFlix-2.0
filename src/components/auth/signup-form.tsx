"use client";

/**
 * WFX2-P2-AU — the /signup form (Google-account create-account parity):
 * name (optional), email, password (≥ 8 — Google's "Use 8 characters or
 * more" helper) with show toggle, honest duplicate-email state linking
 * /signin, then automatic sign-in on success. Register →
 * POST /api/auth/register (a WEBFLIX identity — never a YouTube account).
 */
import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "./auth-card";
import { PASSWORD_MIN_LENGTH as MIN_PASSWORD_LENGTH } from "@/lib/auth/types";
import { signInWithCredentials, safeRedirect } from "@/lib/auth/client";

export function SignUpForm({ redirectTo }: { redirectTo: string | null }) {
  const target = safeRedirect(redirectTo);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorLink, setErrorLink] = useState<"signin" | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setErrorLink(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        setError(body.error ?? "Couldn't create the account. Try again.");
        setErrorLink(body.code === "duplicate-email" ? "signin" : null);
        setBusy(false);
        return;
      }
      // account created → sign straight in
      const outcome = await signInWithCredentials(email.trim(), password);
      if (outcome.ok) {
        window.location.assign(target);
        return;
      }
      setError("Account created, but sign-in failed. Head to the sign-in page to continue.");
      setErrorLink("signin");
      setBusy(false);
    } catch {
      setError("Couldn't reach WebFlix. Check your connection and try again.");
      setBusy(false);
    }
  };

  const passwordHint =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `Use ${MIN_PASSWORD_LENGTH} characters or more`
      : null;

  return (
    <AuthCard
      heading="Create your WebFlix account"
      subheading="one identity for your WebFlix surfaces"
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={target === "/" ? "/signin" : `/signin?redirect=${encodeURIComponent(target)}`}
            className="font-medium text-yt-red hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}{" "}
            {errorLink === "signin" && (
              <Link
                href={target === "/" ? "/signin" : `/signin?redirect=${encodeURIComponent(target)}`}
                className="font-medium underline underline-offset-2"
              >
                Sign in
              </Link>
            )}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="displayName">Your name (optional)</Label>
          <Input
            id="displayName"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={passwordHint ? "password-hint" : undefined}
            required
          />
          {passwordHint && (
            <p id="password-hint" className="text-xs text-muted-foreground">
              {passwordHint}
            </p>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={busy || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
            className="h-10 rounded-full bg-yt-red px-6 font-medium text-white hover:bg-yt-red/90"
          >
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
