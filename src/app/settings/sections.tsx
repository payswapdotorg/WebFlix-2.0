"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, PlugZap, RotateCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SessionAvatar } from "@/components/app/account-menu";
import { useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { useYouTubeConnection } from "@/hooks/use-youtube-connection";
import { relativeTime } from "@/lib/watch/format";
import {
  parseConnectionTimestamp,
  type YouTubeConnectionState,
} from "@/lib/watch/connection-client";
import { useAutoplayPreference } from "./use-autoplay-pref";

/**
 * WFX2-P5-SS — youtube.com's settings sections, wired honestly. Every section
 * carries a visible scope label (the honesty law):
 *   LOCAL (this browser)                    — a preference this browser owns
 *   MANAGED ON YOUTUBE.COM (the operator)   — the operator account owns it
 * Where no write exists, the row says so (read-only / not-available) — never
 * a fake toggle.
 */

export const SCOPE_LOCAL_LABEL = "LOCAL (this browser)";
export const SCOPE_MANAGED_LABEL = "MANAGED ON YOUTUBE.COM (the operator account)";

export const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "youtube-connection", label: "YouTube connection" },
  { id: "notifications", label: "Notifications" },
  { id: "playback", label: "Playback and performance" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "advanced", label: "Advanced" },
] as const;

/** The account page's operator-session wording law, verbatim. */
const OPERATOR_SESSION_CONNECTED =
  "Operator session connected — comment writes, likes, reports and creator tools act on the operator's real YouTube account.";
const OPERATOR_SESSION_PUBLIC =
  "No operator session is configured (public mode). Reads stay fully live; write surfaces (comments, likes, reports, heart/pin) honestly show their signed-out states until the session is connected.";
const OPERATOR_SESSION_FRONTING =
  "Your WebFlix account fronts that session — it is not a YouTube account, and WebFlix never fabricates YouTube-account data.";

const LANGUAGE_KEY = "wfx2-language";
const LOCATION_KEY = "wfx2-location";

const LANGUAGES = [
  { value: "en", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "ja", label: "日本語" },
] as const;

const LOCATIONS = [
  { value: "", label: "Not set" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "BR", label: "Brazil" },
  { value: "JP", label: "Japan" },
  { value: "AU", label: "Australia" },
] as const;

const selectClass =
  "rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ScopeBadge({ scope }: { scope: "local" | "managed" }) {
  return (
    <span
      data-scope={scope}
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wide ${
        scope === "local"
          ? "border border-border text-muted-foreground"
          : "border border-border bg-secondary/60 text-muted-foreground"
      }`}
    >
      {scope === "local" ? SCOPE_LOCAL_LABEL : SCOPE_MANAGED_LABEL}
    </span>
  );
}

function SettingsSection({
  id,
  title,
  scope,
  description,
  children,
}: {
  id: string;
  title: string;
  scope: "local" | "managed";
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      className="scroll-mt-20 border-b border-border py-6 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <ScopeBadge scope={scope} />
      </div>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  note,
  control,
  badge,
}: {
  title: string;
  note?: React.ReactNode;
  control?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        {note ? (
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{note}</p>
        ) : null}
      </div>
      <div className="shrink-0 sm:pl-6">
        {badge ? (
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
            {badge}
          </span>
        ) : (
          control
        )}
      </div>
    </div>
  );
}

const externalLink = "text-yt-red hover:underline";

// ---------------------------------------------------------------------------

export function AccountSection() {
  const session = useWebFlixSession(); // authenticated here (the gate ran)
  const identity = session.user;
  const { data } = useApi<{ operatorSession: boolean }>("/api/watch/session");
  const operatorSession = data?.operatorSession ?? false;

  return (
    <SettingsSection
      id="account"
      title="Account"
      scope="managed"
      description="Your WebFlix identity and the YouTube session behind WebFlix."
    >
      <SettingsRow
        title="WebFlix identity"
        note={
          identity ? (
            <>
              Signed in as{" "}
              <span className="font-medium text-foreground">{identity.displayName}</span> (
              {identity.email}). Your WebFlix identity is local to WebFlix — it is not a YouTube
              account.
            </>
          ) : (
            "Your WebFlix identity is local to WebFlix — it is not a YouTube account."
          )
        }
        control={
          <span className="flex items-center gap-3">
            {identity ? (
              <SessionAvatar displayName={identity.displayName} avatarSeed={identity.avatarSeed} />
            ) : null}
            <Link
              href="/account"
              className="rounded-full border border-border px-4 py-1.5 text-sm hover:bg-secondary/60"
            >
              Manage on /account
            </Link>
          </span>
        }
      />
      <SettingsRow
        title="YouTube session (the operator account)"
        note={
          <>
            {operatorSession ? OPERATOR_SESSION_CONNECTED : OPERATOR_SESSION_PUBLIC}{" "}
            {OPERATOR_SESSION_FRONTING} See{" "}
            <a
              href="https://www.youtube.com/account"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLink}
            >
              youtube.com
            </a>{" "}
            for the operator account's own settings.
          </>
        }
        badge="Read-only"
      />
    </SettingsSection>
  );
}

/** Coarse, channel-safe context for the connected tab (never a raw URL —
 * only the KIND of YouTube page the shared session's tab is on). */
function tabContextLabel(tabUrl: string | null): string {
  if (!tabUrl) return "Session active";
  if (tabUrl.includes("/watch")) return "Session active — the connected tab is on a watch page";
  if (tabUrl.includes("/@") || tabUrl.includes("/channel/")) {
    return "Session active — the connected tab is on a channel page";
  }
  if (tabUrl.includes("youtube.com")) return "Session active — the connected tab is on youtube.com";
  return "Session active";
}

/** WFX2 Task 4-b — the live YouTube connection card: is the shared session
 * that performs WebFlix's YouTube actions (like, subscribe, comment)
 * reachable right now? Connected → the honest "actions run through the
 * WebFlix connected session" state with the tab context + last action;
 * disconnected → the warning + what stops working + Retry (a forced
 * re-probe). The shared-session model is stated honestly up front. */
export function YouTubeConnectionSection() {
  const { state, loading, reload } = useYouTubeConnection();

  return (
    <SettingsSection
      id="youtube-connection"
      title="YouTube connection"
      scope="managed"
      description="WebFlix doesn't sign in to your own YouTube account — like, subscribe and comment actions are performed through one shared logged-in session (the WebFlix connected session). This card shows whether that session is reachable right now."
    >
      <div role="status" aria-live="polite" data-connection-loading={loading || undefined}>
        {loading || !state ? (
          <ConnectionCheckingCard />
        ) : (
          <ConnectionCard state={state} onRetry={reload} />
        )}
      </div>
    </SettingsSection>
  );
}

function ConnectionCheckingCard() {
  return (
    <Card className="gap-3 rounded-xl py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Checking the YouTube connection…
        </CardTitle>
        <CardDescription>Asking the WebFlix connected session for its current state.</CardDescription>
      </CardHeader>
    </Card>
  );
}

function ConnectionCard({
  state,
  onRetry,
}: {
  state: YouTubeConnectionState;
  onRetry: () => void;
}) {
  const checkedAgo = relativeTime(state.checkedAt) || "just now";
  const lastActionAgo = relativeTime(parseConnectionTimestamp(state.lastActionAt));

  if (state.connected) {
    return (
      <Card className="gap-3 rounded-xl py-5" data-connection-state="connected">
        <CardHeader className="px-5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" aria-hidden="true" />
            Connected — actions are available
          </CardTitle>
          <CardDescription>
            Actions are performed through the WebFlix connected session.
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              aria-label="Recheck the YouTube connection"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Recheck
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-5 text-sm text-muted-foreground">
          <p>
            {tabContextLabel(state.tabUrl)}
            {lastActionAgo ? ` — last action ${lastActionAgo}` : " — no action performed through this session yet"}
            .
          </p>
          <p className="text-xs">Checked {checkedAgo}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 rounded-xl py-5" data-connection-state="disconnected">
      <CardHeader className="px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <AlertTriangle className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
          Disconnected — actions are unavailable
        </CardTitle>
        <CardDescription>
          Like, subscribe and comment actions are unavailable right now.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={onRetry} aria-label="Retry the YouTube connection check">
            <RotateCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-5 text-sm text-muted-foreground">
        <p>
          The WebFlix connected session isn&apos;t reachable right now — either its browser
          isn&apos;t running or the YouTube tab isn&apos;t open. It usually comes back on its own;
          retry, or check back here later.
        </p>
        <p className="text-xs">Checked {checkedAgo}.</p>
      </CardContent>
    </Card>
  );
}

export function NotificationsSection() {
  return (
    <SettingsSection
      id="notifications"
      title="Notifications"
      scope="managed"
      description="What the bell can and can't do today."
    >
      <SettingsRow
        title="In-app notifications (the bell)"
        note="While WebFlix is open and you're signed in, the bell checks for new notifications by polling on the upstream's own cadence (pollIntervalMs — clamped to at least 30 seconds, 60 by default). There is no setting to change this in WebFlix, so this row is read-only."
        badge="Read-only"
      />
      <SettingsRow
        title="Notification preferences (per-channel, email, push)"
        note="These preferences belong to the operator's YouTube account and are managed on youtube.com — WebFlix does not expose them."
        badge="Not available"
      />
    </SettingsSection>
  );
}

export function PlaybackSection() {
  const { autoplay, setAutoplayPref } = useAutoplayPreference();
  return (
    <SettingsSection
      id="playback"
      title="Playback and performance"
      scope="local"
      description="Preferences the player actually reads, saved in this browser."
    >
      <SettingsRow
        title="Autoplay next video"
        note="The real autoplay preference — the same one the watch page's Autoplay switch writes and the queue engine reads. When a video ends, the end-of-video countdown advances to the next video only while this is on."
        control={
          <Switch
            checked={autoplay}
            onCheckedChange={setAutoplayPref}
            aria-label="Autoplay next video"
          />
        }
      />
      <SettingsRow
        title="Video quality, captions, and speed"
        note="These live in the player's own controls on the watch page (the native YouTube player). WebFlix stores no separate playback settings for them."
        badge="Managed by the player"
      />
    </SettingsSection>
  );
}

export function AppearanceSection() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      scope="local"
      description="The WebFlix color scheme, saved in this browser."
    >
      <SettingsRow
        title="Theme"
        note="Light or Dark, applied app-wide — the same theme the topbar toggle sets. WebFlix has no device-follow theme mode (the app ships Dark by default), so there is no System option to offer."
        control={
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex overflow-hidden rounded-full border border-border"
          >
            <button
              type="button"
              role="radio"
              aria-checked={resolvedTheme === "light"}
              onClick={() => setTheme("light")}
              className={`px-4 py-1.5 text-sm ${
                resolvedTheme === "light"
                  ? "bg-foreground text-background"
                  : "hover:bg-secondary/60"
              }`}
            >
              Light
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={resolvedTheme === "dark"}
              onClick={() => setTheme("dark")}
              className={`px-4 py-1.5 text-sm ${
                resolvedTheme === "dark" ? "bg-foreground text-background" : "hover:bg-secondary/60"
              }`}
            >
              Dark
            </button>
          </div>
        }
      />
    </SettingsSection>
  );
}

export function PrivacySection() {
  return (
    <SettingsSection
      id="privacy"
      title="Privacy"
      scope="local"
      description="What WebFlix can filter locally — stated honestly."
    >
      <SettingsRow
        title="Restricted Mode"
        note={
          <>
            Restricted Mode — hiding potentially mature results — is{" "}
            <strong className="text-foreground">not available in WebFlix yet</strong>: nothing in
            WebFlix currently filters or flags results as sensitive, so there is no local filter
            to switch on, and we won't ship a toggle that pretends to filter. YouTube's own
            Restricted Mode (including its account-level setting) is managed on{" "}
            <a
              href="https://support.google.com/youtube/answer/174784"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLink}
            >
              youtube.com
            </a>
            .
          </>
        }
        badge="Not available in WebFlix yet"
      />
    </SettingsSection>
  );
}

export function AdvancedSection() {
  const [language, setLanguage] = useState<string>("en");
  const [location, setLocation] = useState<string>("");

  useEffect(() => {
    try {
      const storedLanguage = localStorage.getItem(LANGUAGE_KEY);
      const storedLocation = localStorage.getItem(LOCATION_KEY);
      if (storedLanguage) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of a persisted pref (SSR renders the default) — the watch-page idiom
        setLanguage(storedLanguage);
        document.documentElement.lang = storedLanguage;
      }
      if (storedLocation) {
        setLocation(storedLocation);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const onLanguageChange = (next: string) => {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
      document.documentElement.lang = next; // the real local effect of this selector
    } catch {
      /* private mode */
    }
  };

  const onLocationChange = (next: string) => {
    setLocation(next);
    try {
      localStorage.setItem(LOCATION_KEY, next);
    } catch {
      /* private mode */
    }
  };

  return (
    <SettingsSection
      id="advanced"
      title="Advanced"
      scope="local"
      description="Local-only selectors, honest about their effect scope."
    >
      <SettingsRow
        title="Language"
        note="Sets this page's language attribute (used by assistive technology) and is stored in this browser. WebFlix's interface is English-only today — this does not translate anything, and it never changes the operator account's YouTube language."
        control={
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className={selectClass}
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
      <SettingsRow
        title="Location"
        note="Stored in this browser only. WebFlix does not use location for anything today — this has no effect on search results, recommendations, or availability; it is saved for when that changes, and it never changes the operator account's YouTube location."
        control={
          <select
            aria-label="Location"
            value={location}
            onChange={(e) => onLocationChange(e.target.value)}
            className={selectClass}
          >
            {LOCATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
      />
    </SettingsSection>
  );
}
