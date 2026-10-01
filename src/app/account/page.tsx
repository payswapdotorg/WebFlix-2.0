"use client";

/**
 * WFX2-P2-AU — the account page: the REAL WebFlix account surface.
 *
 * Guest → the youtube.com signed-out screen (the personal-surface gate).
 * Signed-in →
 *   1. the WebFlix identity card: edit display name + avatar color (the
 *      WebFlix-local identity — never a YouTube account, per the law);
 *   2. the honest operator-session section (unchanged wording law): the
 *      app still acts on the operator's YouTube session — single-tenant
 *      live mode, no fake login, never.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { SessionAvatar } from "@/components/app/account-menu";
import { useApi } from "@/hooks/use-api";
import { patch } from "@/lib/watch/client";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { cn } from "@/lib/utils";

/** The avatar-color palette — the hue ring (every 30°). */
const AVATAR_HUES = Array.from({ length: 12 }, (_, i) => i * 30);

export default function AccountPage() {
  return (
    <PersonalSurfaceGate surface="account">
      <AccountContent />
    </PersonalSurfaceGate>
  );
}

function AccountContent() {
  const session = useWebFlixSession(); // authenticated here (the gate ran)
  const identity = session.user;

  const { data } = useApi<{ operatorSession: boolean }>("/api/watch/session");
  const operatorSession = data?.operatorSession ?? false;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" className="w-fit gap-2 rounded-full px-4">
        <Link href="/">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Account</h1>
      </div>

      {identity && <IdentityCard key={identity.id} initial={identity} />}

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
        <p className="mt-2 text-sm text-muted-foreground">
          Your WebFlix account fronts that session — it is not a YouTube account, and WebFlix never
          fabricates YouTube-account data.
        </p>
      </section>
    </main>
  );
}

function IdentityCard({
  initial,
}: {
  initial: { displayName: string; email: string; avatarSeed: number };
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [avatarSeed, setAvatarSeed] = useState(initial.avatarSeed);
  const [busy, setBusy] = useState(false);
  const dirty = displayName.trim() !== initial.displayName || avatarSeed !== initial.avatarSeed;

  async function save() {
    if (busy || !dirty) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error("Use 1–50 characters for your name");
      return;
    }
    setBusy(true);
    try {
      const result = await patch<{ user: { displayName: string; avatarSeed: number } }>(
        "/api/auth/profile",
        { displayName: trimmed, avatarSeed }
      );
      setDisplayName(result.user.displayName);
      setAvatarSeed(result.user.avatarSeed);
      toast.success("Profile updated");
      // the header avatar + JWT name refresh on the next session probe —
      // nudge it with a reload so the avatar color follows immediately
      if (result.user.avatarSeed !== initial.avatarSeed) {
        setTimeout(() => window.location.reload(), 600);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="WebFlix identity" className="rounded-xl border border-border p-4 sm:p-6" data-testid="identity-card">
      <h2 className="text-base font-semibold">WebFlix identity</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        How you appear on WebFlix — signed in as <span className="font-medium text-foreground">{initial.email}</span>.
      </p>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <SessionAvatar displayName={displayName || initial.displayName} avatarSeed={avatarSeed} size="size-20 text-2xl" />
          <span className="text-xs text-muted-foreground">Preview</span>
        </div>

        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Avatar color</Label>
            <div className="flex max-w-sm flex-wrap gap-2" role="radiogroup" aria-label="Avatar color">
              {AVATAR_HUES.map((hue) => (
                <button
                  key={hue}
                  type="button"
                  role="radio"
                  aria-checked={avatarSeed === hue}
                  aria-label={`Hue ${hue}`}
                  onClick={() => setAvatarSeed(hue)}
                  className={cn(
                    "size-7 rounded-full transition",
                    avatarSeed === hue
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : "hover:scale-110"
                  )}
                  style={{ backgroundColor: `hsl(${hue} 65% 45%)` }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => void save()}
              disabled={busy || !dirty}
              className="rounded-full px-6"
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
