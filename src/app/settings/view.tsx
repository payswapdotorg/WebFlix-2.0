"use client";

import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { SignedOutScreen } from "@/components/auth/signed-out-screen";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AccountSection,
  AdvancedSection,
  AppearanceSection,
  NotificationsSection,
  PlaybackSection,
  PrivacySection,
  SECTIONS,
  YouTubeConnectionSection,
} from "./sections";

/**
 * WFX2-P5-SS — the settings surface.
 *
 * Settings is a personal surface on youtube.com, so the AU guest law applies:
 * guests get the signed-out screen (composed here from the gate's own
 * primitives — useWebFlixSession + SignedOutScreen — because the shared
 * PersonalSurface union has no "settings" member and that file belongs to
 * another lane). The app's session probe decides; signed-in users see
 * youtube.com's settings sections, each labeled LOCAL or MANAGED ON
 * YOUTUBE.COM.
 */
export function SettingsView() {
  const session = useWebFlixSession();

  if (session.status === "loading") {
    return (
      <main
        className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6"
        aria-busy="true"
        aria-label="Checking your session"
      >
        <Skeleton className="h-8 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mt-6 space-y-3">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ))}
      </main>
    );
  }

  if (session.status === "unauthenticated") {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <SignedOutScreen
          title="Your WebFlix settings"
          message="Sign in to manage your WebFlix settings — playback, appearance, and account pointers."
          redirect="/settings"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Preferences saved in this browser are labeled LOCAL. Anything tied to the operator's
        YouTube account is labeled MANAGED ON YOUTUBE.COM — it is managed there, and WebFlix
        says so instead of faking a control.
      </p>

      <div className="mt-8 flex flex-col gap-10 lg:flex-row">
        <nav aria-label="Settings sections" className="lg:w-52 lg:shrink-0">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col lg:gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <AccountSection />
          <YouTubeConnectionSection />
          <NotificationsSection />
          <PlaybackSection />
          <AppearanceSection />
          <PrivacySection />
          <AdvancedSection />
        </div>
      </div>
    </main>
  );
}

export default SettingsView;
