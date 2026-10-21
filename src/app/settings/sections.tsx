"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, PlugZap, RotateCw } from "lucide-react";
import { toast } from "sonner";
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
  YOUTUBE_OAUTH_CONNECT_HREF,
  type YouTubeConnectionState,
} from "@/lib/watch/connection-client";
import { useAutoplayPreference } from "./use-autoplay-pref";

/**
 * WFX2-P5-SS — youtube.com's settings sections, wired honestly. Every section
 * carries a visible scope label (the honesty law):
 *   LOCAL (this browser)                    — a preference this browser owns
 *   MANAGED ON YOUTUBE.COM                  — the setting lives on
 *                                            youtube.com (WFX2-P36: the
 *                                            per-user truth — your own
 *                                            account, not an operator's)
 * Where no write exists, the row says so (read-only / not-available) — never
 * a fake toggle.
 */

export const SCOPE_LOCAL_LABEL = "LOCAL (this browser)";
export const SCOPE_MANAGED_LABEL = "MANAGED ON YOUTUBE.COM";

export const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "youtube-connection", label: "YouTube account" },
  { id: "notifications", label: "Notifications" },
  { id: "playback", label: "Playback and performance" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "advanced", label: "Advanced" },
] as const;

/** The account page's operator-session wording law, reworded for P36: the
 * server session READS public pages; every user WRITE acts on the user's
 * own connected account (or is honestly local / unsupported). */
const OPERATOR_SESSION_CONNECTED =
  "Operator read session connected — WebFlix's server uses it to read public YouTube pages. It never performs your actions: your likes, subscribes and playlists act on your own connected YouTube account (see YouTube account below).";
const OPERATOR_SESSION_PUBLIC =
  "No operator read session is configured (public mode). Reads stay fully live; your own actions run through your connected YouTube account (see YouTube account below).";
const OPERATOR_SESSION_FRONTING =
  "Your WebFlix account is local to WebFlix — it is not a YouTube account, and WebFlix never fabricates YouTube-account data.";

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

/**
 * WFX2-P36 — the per-user YouTube ACCOUNT card (the OAuth connection the
 * whole action lane rides on). The pre-P33/P35 five-state card (checking /
 * direct-connected / needs-attention / broker / none — the deployment-wide
 * operator session and the shared browser tab) is RETIRED: no user action
 * may ride those identities anymore. What this card shows instead, from the
 * honest /api/connection/youtube envelope:
 *  - checking            — the probe is in flight;
 *  - not-configured      — the deployment lacks GOOGLE_CLIENT_ID/SECRET (the
 *                          exact missing vars + the redirect URI to register);
 *  - not-connected       — the Connect button (a plain same-origin GET link
 *                          carrying the session cookie) + the honest
 *                          capability lines;
 *  - connected           — the account identity + Disconnect (POST) + the
 *                          same capability lines;
 *  - needs-reauth        — Google expired/revoked the grant — re-connect.
 * The OAuth callback redirects back here with ?ytc=<code>; the outcome
 * banner renders the honest copy for each code.
 */
export function YouTubeConnectionSection() {
  const { state, loading, reload } = useYouTubeConnection();

  // the OAuth callback's outcome banner (?ytc=… — the callback redirects
  // here with the honest outcome code; read client-side, the house pattern)
  const [ytcOutcome, setYtcOutcome] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ytc");
    if (!code) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of the URL param (SSR renders no banner) — the watch-page idiom
    setYtcOutcome(code);
    if (code === "connected") reload(); // the connection just changed — re-probe
  }, [reload]);

  return (
    <SettingsSection
      id="youtube-connection"
      title="YouTube account"
      scope="managed"
      description="Your own YouTube account, connected with Google — your likes, subscribes and playlists act on it through the official YouTube API."
    >
      {ytcOutcome && <ConnectOutcomeBanner code={ytcOutcome} />}
      <div role="status" aria-live="polite" data-connection-loading={loading || undefined}>
        {loading || !state ? (
          <ConnectionCheckingCard />
        ) : (
          <AccountConnectionCard state={state} onRecheck={reload} />
        )}
      </div>
    </SettingsSection>
  );
}

/** The /settings?ytc=<code> outcome banner (the OAuth callback's verdict). */
function ConnectOutcomeBanner({ code }: { code: string }) {
  const tone =
    code === "connected"
      ? "border-emerald-500/40 bg-emerald-500/5 text-foreground"
      : code === "denied" || code === "signin" || code === "state"
        ? "border-border bg-secondary/40 text-foreground"
        : "border-amber-500/40 bg-amber-500/5 text-foreground";
  const copy =
    code === "connected"
      ? "Your YouTube account is connected."
      : code === "denied"
        ? "The connect was cancelled."
        : code === "signin"
          ? "Sign in again to finish connecting."
          : code === "state"
            ? "The connect request expired — try again."
            : "Google refused the connect — try again in a moment.";
  return (
    <p
      role="status"
      data-testid="youtube-connect-outcome"
      data-ytc={code}
      className={`rounded-xl border px-4 py-3 text-sm ${tone}`}
    >
      {copy}
    </p>
  );
}

function ConnectionCheckingCard() {
  return (
    <Card className="gap-3 rounded-xl py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Checking your YouTube account…
        </CardTitle>
        <CardDescription>Asking the server for your account connection state.</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** The honest capability lines — the same disclosure on every actionable
 * state (what runs on your account, what is WebFlix-local, what has no
 * official API). */
function CapabilityLines() {
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
      <li>Runs on your account: like, dislike, subscribe, playlists.</li>
      <li>On WebFlix only: watch later, comments, feed feedback.</li>
      <li>
        Not API-supported: bell preferences, history writes — hand off to YouTube.
      </li>
    </ul>
  );
}

/** The plain same-origin Connect affordance (a GET redirect carrying the
 * session cookie — never an XHR, so the consent page navigates properly). */
function ConnectButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97]"
    >
      {label}
    </a>
  );
}

function AccountConnectionCard({
  state,
  onRecheck,
}: {
  state: YouTubeConnectionState;
  onRecheck: () => void;
}) {
  const checkedAgo = relativeTime(state.checkedAt) || "just now";
  const connectUrl = state.oauth.connectUrl ?? YOUTUBE_OAUTH_CONNECT_HREF;

  // ---- not-configured: the deployment's honest setup state ----
  if (state.status === "not-configured") {
    return (
      <Card className="gap-3 rounded-xl py-5" data-connection-state="not-configured">
        <CardHeader className="px-5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <AlertTriangle className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
            YouTube account connection isn&apos;t configured
          </CardTitle>
          <CardDescription>
            Users can&apos;t connect their own YouTube accounts yet — the deployment is missing
            its Google OAuth credentials.
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={onRecheck}
              aria-label="Recheck the YouTube account connection"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Recheck
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-5 text-sm text-muted-foreground">
          {state.oauth.missingEnv.length > 0 && (
            <p>
              Missing environment variables:{" "}
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                {state.oauth.missingEnv.join(", ")}
              </code>
            </p>
          )}
          {state.oauth.redirectUri && (
            <p>
              Register this redirect URI in the Google Cloud console:{" "}
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs break-all text-foreground">
                {state.oauth.redirectUri}
              </code>
            </p>
          )}
          <p>
            Set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in the deployment env
            to let users connect their own accounts.
          </p>
          <p className="text-xs">Checked {checkedAgo}.</p>
        </CardContent>
      </Card>
    );
  }

  // ---- needs-reauth: Google expired or revoked the grant ----
  if (state.status === "needs-reauth") {
    return (
      <Card className="gap-3 rounded-xl py-5" data-connection-state="needs-reauth">
        <CardHeader className="px-5">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <AlertTriangle className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
            Re-connect your YouTube account
          </CardTitle>
          <CardDescription>
            Google expired or revoked the authorization — your actions pause until you
            re-connect.
          </CardDescription>
          <CardAction>
            <ConnectButton href={connectUrl} label="Connect your YouTube account" />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-5 text-sm text-muted-foreground">
          <p className="text-xs">Checked {checkedAgo}.</p>
        </CardContent>
      </Card>
    );
  }

  // ---- connected: the account identity + Disconnect ----
  if (state.status === "connected") {
    return <ConnectedAccountCard state={state} checkedAgo={checkedAgo} onRecheck={onRecheck} />;
  }

  // ---- not-connected (and the degraded probe-failure state) ----
  return (
    <Card className="gap-3 rounded-xl py-5" data-connection-state="not-connected">
      <CardHeader className="px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <PlugZap className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Connect your YouTube account
        </CardTitle>
        <CardDescription>
          Your likes, subscribes and playlists act on your own YouTube account, through the
          official YouTube API — WebFlix never acts as someone else.
        </CardDescription>
        <CardAction>
          <ConnectButton href={connectUrl} label="Connect your YouTube account" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-5 text-sm text-muted-foreground">
        <CapabilityLines />
        <p className="text-xs">Checked {checkedAgo}.</p>
      </CardContent>
    </Card>
  );
}

function ConnectedAccountCard({
  state,
  checkedAgo,
  onRecheck,
}: {
  state: YouTubeConnectionState;
  checkedAgo: string;
  onRecheck: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const account = state.account;
  const connectedAt =
    account?.connectedAt && relativeTime(account.connectedAt)
      ? relativeTime(account.connectedAt)
      : null;

  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      const res = await fetch(
        state.oauth.disconnectUrl ?? "/api/connection/youtube/disconnect",
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Disconnect failed (HTTP ${res.status})`);
      }
    } catch {
      toast.error("Disconnect failed — try again");
    } finally {
      setDisconnecting(false);
      onRecheck(); // force a fresh probe whatever happened
    }
  }

  return (
    <Card className="gap-3 rounded-xl py-5" data-connection-state="connected">
      <CardHeader className="px-5">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {account?.channelThumbUrl ? (
            <img
              src={account.channelThumbUrl}
              alt=""
              className="size-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" aria-hidden="true" />
          )}
          Connected as {account?.channelTitle ?? "your YouTube account"}
        </CardTitle>
        <CardDescription>
          Actions run on your own account through the official YouTube API.
          {connectedAt ? ` Connected ${connectedAt}.` : ""}
        </CardDescription>
        <CardAction>
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRecheck}
              aria-label="Recheck the YouTube account connection"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Recheck
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void disconnect()}
              disabled={disconnecting}
              aria-label="Disconnect your YouTube account"
              className="text-destructive hover:text-destructive"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-5 text-sm text-muted-foreground">
        <CapabilityLines />
        {state.serverReadSession?.configured && (
          <p className="text-xs">
            WebFlix&apos;s server keeps a separate read-only YouTube session for public pages —
            it is never used for your actions.
          </p>
        )}
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
