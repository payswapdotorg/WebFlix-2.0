"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mainAppUrl, setMainAppUrl] = useState("https://webflix-2-0-one.vercel.app");

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((j) => setMainAppUrl(j.mainAppUrl)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const endpoint = mode === "signin" ? "/api/auth/sign-in" : "/api/auth/sign-up";
    const body = mode === "signin" ? { email, password } : { email, password, displayName: displayName || undefined };
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        setError(j?.error ?? "Sign-in failed. Try again.");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold tracking-tight">WebFlix <span className="font-normal text-muted-foreground">Studio</span></div>
          <h1 className="mt-4 text-lg font-medium">
            {mode === "signin" ? "Sign in to continue to WebFlix Studio" : "Create your WebFlix account"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Same account as the main app — sessions are per-domain, like youtube.com and studio.youtube.com.</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          )}
          <input className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/20" type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "Signing in…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <button className="underline" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
            {mode === "signin" ? "Create account" : "Sign in instead"}
          </button>
          <a className="underline" href={mainAppUrl}>Use the main app instead</a>
        </div>
      </div>
    </main>
  );
}
