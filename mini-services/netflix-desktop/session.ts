/**
 * WebFlix Netflix Desktop — the playback session manager.
 *
 * One long-lived E2B desktop sandbox runs a real Google Chrome (Widevine L3)
 * with a signed-in Netflix session, displayed to the user through the noVNC
 * interactive stream and heard through a PulseAudio monitor → Opus/WebM →
 * WebSocket audio pipeline. Netflix blocks datacenter logins, so the session
 * cookies are harvested via the residential Apify actor and injected over CDP.
 */
import { Sandbox } from "@e2b/desktop";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { connectChromePage, type CdpConnection } from "./cdp";
import { CDP_RELAY_PY } from "./cdp-relay";
import { harvestNetflixSession, hasAuthCookies, type NetflixCookie } from "./cookies";
import { buildEgressPlan, egressBootstrap } from "./egress";
import { readBridgeCandidate, clearBridgeCandidate, type BridgeCandidate } from "./ingest";

const SBX_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_TTL_MS = 25 * 60 * 1000;
const COOKIE_CACHE_PATH = "/tmp/netflix-cookies.json";
const AUTH_STATE_PATH = "/tmp/netflix-auth-state.json";
// P45 (account-safety): the automatic harvest hits Netflix's pre-validation
// wall every time — retrying every 10 minutes burns Apify runs and risks
// deepening the risk flag on the account. The automatic ladder now waits
// out a long cooldown after a failure; the operator's retry button stays
// on-demand (an explicit human choice).
const HARVEST_COOLDOWN_MS = 6 * 60 * 60 * 1000;

interface AuthState {
  lastHarvestFailedAt?: number;
}

function readAuthState(): AuthState {
  try {
    return JSON.parse(readFileSync(AUTH_STATE_PATH, "utf8")) as AuthState;
  } catch {
    return {};
  }
}

function writeAuthState(s: AuthState) {
  try {
    writeFileSync(AUTH_STATE_PATH, JSON.stringify(s));
  } catch {
    /* best effort */
  }
}

export type SessionPhase =
  | "idle"
  | "provisioning"
  | "stream-ready"
  | "restoring-session"
  | "auth-required"
  | "ready"
  | "error";

export interface SessionStatus {
  phase: SessionPhase;
  sandboxId: string | null;
  streamUrl: string | null;
  message: string | null;
  videoId: number | null;
  audioRunning: boolean;
}

// P46: the Exec line is built at bootstrap so the optional residential-egress
// proxy flag (validated first — fails open to direct) can ride along.
function netflixDesktopEntry(extraChromeFlags: string): string {
  return `[Desktop Entry]
Version=1.0
Name=Netflix App
Exec=/usr/bin/google-chrome --no-first-run --no-default-browser-check --hide-crash-restore-bubble --start-maximized --autoplay-policy=no-user-gesture-required --user-data-dir=/home/user/chrome-profile-netflix --remote-debugging-port=9222 --remote-allow-origins=*${extraChromeFlags} --app=%u
Terminal=false
Type=Application
MimeType=x-scheme-handler/https;
`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class NetflixSessionManager {
  private desktop: Sandbox | null = null;
  private phase: SessionPhase = "idle";
  private message: string | null = null;
  private videoId: number | null = null;
  private streamUrl: string | null = null;
  private lastActivity = 0;
  private lastWatchAt = 0;
  private lastHarvestFailedAt = 0;
  private ensurePromise: Promise<Sandbox> | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  audioRunning = false;
  onAudioChunk: ((chunk: Buffer) => void) | null = null;

  getStatus(): SessionStatus {
    return {
      phase: this.phase,
      sandboxId: this.desktop?.sandboxId ?? null,
      streamUrl: this.streamUrl,
      message: this.message,
      videoId: this.videoId,
      audioRunning: this.audioRunning,
    };
  }

  private setPhase(p: SessionPhase, message?: string) {
    this.phase = p;
    if (message !== undefined) this.message = message;
    console.log(`[session] phase=${p}${message ? ` (${message})` : ""}`);
  }

  private loadCookieCache(): NetflixCookie[] | null {
    try {
      const parsed = JSON.parse(readFileSync(COOKIE_CACHE_PATH, "utf8")) as NetflixCookie[];
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }

  private saveCookieCache(cookies: NetflixCookie[]) {
    try {
      writeFileSync(COOKIE_CACHE_PATH, JSON.stringify(cookies));
    } catch {
      /* best effort */
    }
  }

  /** Ensure a fully-bootstrapped, Netflix-signed-in sandbox exists. */
  async ensure(): Promise<Sandbox> {
    // reuse a live desktop that is up or mid-bootstrap/auth — only a hard error
    // (or a dead sandbox) justifies building a new one
    if (this.desktop) {
      if (this.phase === "ready" || this.phase === "auth-required") {
        this.lastActivity = Date.now();
        return this.desktop;
      }
      if (this.phase === "provisioning" || this.phase === "stream-ready" || this.phase === "restoring-session") {
        if (this.ensurePromise) return this.ensurePromise;
      }
    }
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.bootstrap().finally(() => {
      this.ensurePromise = null;
    });
    return this.ensurePromise;
  }

  private async bootstrap(): Promise<Sandbox> {
    this.setPhase("provisioning", "starting cloud desktop");
    let desktop: Sandbox | null = null;
    try {
      // fresh sandbox (the create call itself can hang on platform concurrency — race it)
      desktop = await Promise.race([
        Sandbox.create({ timeoutMs: SBX_TIMEOUT_MS, resolution: [1280, 720] }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("sandbox creation timed out (platform busy or quota)")), 120_000),
        ),
      ]);
      if (!desktop) throw new Error("sandbox creation failed");
      // the run helper captures the sandbox in a closure — pin the narrowed type
      const box: Sandbox = desktop;
      this.desktop = desktop;
      this.videoId = null;
      this.lastActivity = Date.now();
      this.startKeepalive();

      const run = async (cmd: string, timeoutMs = 30_000) => {
        try {
          return await box.commands.run(cmd, { timeoutMs });
        } catch (e) {
          console.log(`[session] cmd failed: ${cmd.slice(0, 80)} → ${(e as Error).message.slice(0, 120)}`);
          return null;
        }
      };

      // audio: pulse + null sink
      await run(
        "pulseaudio --check || pulseaudio --start --exit-idle-time=-1; sleep 1; " +
          "pactl list short sinks | grep -q netflix_sink || pactl load-module module-null-sink sink_name=netflix_sink; " +
          "pactl set-default-sink netflix_sink 2>/dev/null; echo PULSE_OK",
        30_000,
      );

      // P46: optional residential egress (env-gated, fails OPEN to direct).
      // The proxy flag only reaches Chrome after the tunnel proves itself.
      let chromeEgressFlags = "";
      const egress = buildEgressPlan();
      if (egress.mode === "apify-residential") {
        this.setPhase("provisioning", "starting residential egress");
        const boot = egressBootstrap(egress);
        const started = boot ? await run(boot.script, 15_000) : null;
        const ip = started && boot ? ((await run(boot.healthCheck, 60_000))?.stdout ?? "").trim() : "";
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          chromeEgressFlags = egress.chromeFlags.length ? ` ${egress.chromeFlags.join(" ")}` : "";
          console.log(`[session] residential egress active (exit ip ${ip})`);
        } else {
          console.log("[session] egress forwarder unhealthy — falling back to direct");
        }
      }

      // CDP relay
      await desktop.files.write("/home/user/cdp-relay.py", CDP_RELAY_PY);
      const relay = await desktop.commands.run(
        "setsid nohup python3 /home/user/cdp-relay.py >/tmp/relay.log 2>&1 < /dev/null & echo RELAY_STARTED",
        { timeoutMs: 10_000, background: true },
      );
      relay?.disconnect?.();

      // chrome desktop file (app mode + CDP flags + validated egress flags)
      await desktop.files.write(
        "/home/user/.local/share/applications/netflix-app.desktop",
        netflixDesktopEntry(chromeEgressFlags),
      );

      // launch chrome to netflix
      this.setPhase("provisioning", "opening netflix in chrome");
      await desktop.launch("netflix-app", "https://www.netflix.com/");
      await sleep(14_000);

      // interactive stream (P45: the platform can throw a transient
      // CommandExitError on stream.start — retry once before giving up)
      this.setPhase("stream-ready", "starting live stream");
      try {
        await desktop.stream.start({ requireAuth: true });
      } catch (e) {
        console.log(`[session] stream.start failed (${(e as Error).message.slice(0, 80)}) — retrying once`);
        await sleep(6_000);
        try {
          await desktop.stream.start({ requireAuth: true });
        } catch (e2) {
          if (!/already/i.test((e2 as Error).message)) throw e2;
        }
      }
      const authKey = desktop.stream.getAuthKey();
      this.streamUrl = desktop.stream.getUrl({ authKey: authKey ?? undefined });

      // cookie restore / harvest over CDP
      this.setPhase("restoring-session", "restoring netflix session");
      const ok = await this.restoreAuth();
      if (!ok) {
        this.setPhase("auth-required", "sign in to netflix inside the secure window");
        // stream stays live so the user can sign in manually if automation fails
      } else {
        this.setPhase("ready", "netflix session active");
      }
      return desktop;
    } catch (e) {
      this.setPhase("error", (e as Error).message.slice(0, 300));
      // never leak a half-bootstrapped sandbox
      if (desktop) {
        try {
          await desktop.kill();
        } catch {
          /* noop */
        }
        this.desktop = null;
      }
      throw e;
    }
  }

  /**
   * P46: a bridge candidate (the operator's own-browser cookies) is validated
   * BEFORE the cache/harvest ladder — promoted to the trusted cache only on a
   * strict pass, dropped (never cached) on a failure. Poison-proof by design.
   */
  private async validateAndPromoteCandidate(candidate: BridgeCandidate): Promise<boolean> {
    const desktop = this.desktop;
    if (!desktop) return false;
    console.log(`[session] bridge candidate present (${candidate.cookies.length} cookies) — validating`);
    const cdp = await connectChromePage(desktop.sandboxId, { preferUrlIncludes: "netflix" });
    try {
      await this.injectCookies(cdp, candidate.cookies);
      await cdp.send("Page.navigate", { url: "https://www.netflix.com/browse" }, 20_000);
      await sleep(8_000);
      if (await this.checkSignedIn(cdp)) {
        this.saveCookieCache(candidate.cookies);
        clearBridgeCandidate();
        console.log("[session] bridge candidate PROMOTED to the trusted cache");
        return true;
      }
      clearBridgeCandidate();
      console.log("[session] bridge candidate rejected by the strict check — dropped");
      return false;
    } finally {
      cdp.close();
    }
  }

  /** Inject cached/harvested cookies via CDP and verify the session. */
  private async restoreAuth(): Promise<boolean> {
    const desktop = this.desktop;
    if (!desktop) return false;
    const candidate = readBridgeCandidate();
    if (candidate && (await this.validateAndPromoteCandidate(candidate))) {
      return true;
    }
    let cookies = this.loadCookieCache();
    if (!cookies || !hasAuthCookies(cookies)) {
      // a failed automatic harvest cools down for hours (P45) — don't burn runs
      const failedAt = this.lastHarvestFailedAt || readAuthState().lastHarvestFailedAt || 0;
      if (Date.now() - failedAt < HARVEST_COOLDOWN_MS) {
        console.log("[session] skipping harvest (cooldown after failure)");
        return false;
      }
      console.log("[session] no cached cookies — harvesting via Apify");
      const res = await harvestNetflixSession();
      if (!res.ok || !res.cookies) {
        this.lastHarvestFailedAt = Date.now();
        writeAuthState({ lastHarvestFailedAt: this.lastHarvestFailedAt });
        console.log(`[session] harvest failed: ${res.reason}`);
        return false;
      }
      cookies = res.cookies;
      this.saveCookieCache(cookies);
    }

    const cdp = await connectChromePage(desktop.sandboxId, { preferUrlIncludes: "netflix" });
    try {
      await this.injectCookies(cdp, cookies);
      // navigate to netflix and evaluate login state (strict check — the
      // signed-out marketing page sometimes serves WITHOUT a /login bounce)
      await cdp.send("Page.navigate", { url: "https://www.netflix.com/browse" }, 20_000);
      await sleep(8_000);
      const signedIn = await this.checkSignedIn(cdp);
      console.log(`[session] post-inject signedIn=${signedIn}`);
      if (!signedIn) {
        // stale cache — re-harvest once, but only outside the failure cooldown
        // (the strict check already told us the cache is dead; a burned run
        // every restore would hammer the account — P45)
        const failedAt = this.lastHarvestFailedAt || readAuthState().lastHarvestFailedAt || 0;
        if (Date.now() - failedAt < HARVEST_COOLDOWN_MS) {
          console.log("[session] stale cache — re-harvest suppressed by cooldown");
          return false;
        }
        const res = await harvestNetflixSession();
        if (res.ok && res.cookies) {
          this.saveCookieCache(res.cookies);
          await this.injectCookies(cdp, res.cookies);
          await cdp.send("Page.navigate", { url: "https://www.netflix.com/browse" }, 20_000);
          await sleep(8_000);
          return this.checkSignedIn(cdp);
        }
        // record the failure so the ladder cools down (P45)
        this.lastHarvestFailedAt = Date.now();
        writeAuthState({ lastHarvestFailedAt: this.lastHarvestFailedAt });
        return false;
      }
      return true;
    } finally {
      cdp.close();
    }
  }

  private async injectCookies(cdp: CdpConnection, cookies: NetflixCookie[]) {
    console.log(`[session] injecting ${cookies.length} cookies via CDP`);
    for (const c of cookies) {
      const skip = ["netflix-sans-normal-3-loaded", "netflix-sans-bold-3-loaded", "OptanonConsent", "_OT_sm"];
      if (skip.includes(c.name)) continue;
      const params: Record<string, unknown> = {
        name: c.name,
        value: c.value,
        domain: c.domain?.startsWith(".") ? c.domain : `.${(c.domain || "netflix.com").replace(/^\./, "")}`,
        path: c.path || "/",
        secure: true,
        httpOnly: c.httpOnly ?? true,
      };
      if (c.expires && c.expires > 0) params.expires = c.expires;
      try {
        await cdp.send("Network.setCookie", params, 8_000);
      } catch (e) {
        console.log(`[session] cookie ${c.name} failed: ${(e as Error).message.slice(0, 80)}`);
      }
    }
  }

  /**
   * Operator-assisted auth: accept a raw `Cookie:` header string (or a JSON
   * cookie array) from the user's own logged-in browser, validate it against
   * the sandbox session, and cache it. This is the guaranteed path when
   * Netflix's anti-bot wall blocks cloud logins.
   */
  async applyExternalCookies(input: string | NetflixCookie[]): Promise<{ ok: boolean; message: string }> {
    const desktop = await this.ensure();
    let cookies: NetflixCookie[];
    if (typeof input === "string") {
      cookies = parseCookieHeader(input);
    } else {
      cookies = input.filter((c) => c && c.name && typeof c.value === "string");
    }
    const auth = cookies.filter((c) => ["NetflixId", "SecureNetflixId", "nfvdid", "flwssn", "gsid"].includes(c.name));
    if (!auth.some((c) => c.name === "NetflixId")) {
      return { ok: false, message: "No NetflixId cookie found in the payload." };
    }
    const cdp = await connectChromePage(desktop.sandboxId, { preferUrlIncludes: "netflix" });
    try {
      await this.injectCookies(cdp, cookies);
      await cdp.send("Page.navigate", { url: "https://www.netflix.com/browse" }, 20_000);
      await sleep(8_000);
      // strict validation — a garbage NetflixId can land on the signed-OUT
      // marketing page without a /login bounce; require real session signals
      if (await this.checkSignedIn(cdp)) {
        this.saveCookieCache(cookies);
        this.setPhase("ready", "netflix session active (operator cookies)");
        // land on the requested title if one is queued
        if (this.videoId) {
          await cdp.send("Page.navigate", { url: `https://www.netflix.com/watch/${this.videoId}` }, 20_000);
        }
        return { ok: true, message: "Netflix session connected." };
      }
      return { ok: false, message: "Netflix rejected these cookies (redirected to sign-in)." };
    } finally {
      cdp.close();
    }
  }

  /** Navigate the streamed chrome to a netflix watch deep link. */
  async watch(videoId: number): Promise<SessionStatus> {
    const desktop = await this.ensure();
    this.lastActivity = Date.now();
    const now = Date.now();
    if (this.videoId === videoId && now - (this.lastWatchAt ?? 0) < 10_000) {
      return this.getStatus();
    }
    this.videoId = videoId;
    this.lastWatchAt = now;
    try {
      const cdp = await connectChromePage(desktop.sandboxId, { preferUrlIncludes: "netflix" });
      try {
        await cdp.send("Page.navigate", { url: `https://www.netflix.com/watch/${videoId}` }, 20_000);
        await sleep(9_000);
        const signedIn = await this.checkSignedIn(cdp);
        if (!signedIn) {
          // not signed in (watch URLs don't redirect when signed out) — try a restore
          this.setPhase("restoring-session", "netflix session missing");
          const ok = await this.restoreAuth();
          if (ok) {
            await cdp.send("Page.navigate", { url: `https://www.netflix.com/watch/${videoId}` }, 20_000);
            await sleep(9_000);
            if (await this.checkSignedIn(cdp)) {
              this.setPhase("ready", "netflix session restored");
            } else {
              this.setPhase("auth-required", "netflix session could not be restored");
            }
          } else {
            this.setPhase("auth-required", "sign in to netflix inside the secure window");
          }
        } else {
          this.setPhase("ready", "netflix session active");
        }
      } finally {
        cdp.close();
      }
    } catch (e) {
      this.setPhase("error", (e as Error).message.slice(0, 200));
    }
    return this.getStatus();
  }

  /**
   * Navigate the streamed chrome to a whitelisted netflix.com path — the
   * Netflix Live lane (the full real Netflix UI inside WebFlix: browse,
   * search, my-list, trailers). Not just deep links.
   */
  async openPath(path: string): Promise<SessionStatus> {
    const safe = /^\/[A-Za-z0-9/_?=&.~-]*$/.test(path) ? path : "/browse";
    const desktop = await this.ensure();
    this.lastActivity = Date.now();
    this.videoId = null;
    try {
      const cdp = await connectChromePage(desktop.sandboxId, { preferUrlIncludes: "netflix" });
      try {
        await cdp.send("Page.navigate", { url: `https://www.netflix.com${safe}` }, 20_000);
        await sleep(8_000);
        if (await this.checkSignedIn(cdp)) {
          this.setPhase("ready", `netflix session active (${safe})`);
        } else {
          this.setPhase("auth-required", "netflix session missing");
        }
      } finally {
        cdp.close();
      }
    } catch (e) {
      this.setPhase("error", (e as Error).message.slice(0, 200));
    }
    return this.getStatus();
  }

  /** Strict signed-in check: not on /login AND Netflix's player root present. */
  private async checkSignedIn(cdp: CdpConnection): Promise<boolean> {
    try {
      const r = await cdp.send<{ result: { value?: string } }>(
        "Runtime.evaluate",
        {
          returnByValue: true,
          expression:
            'JSON.stringify({ href: location.href, player: !!document.querySelector(\'.PlayerSmtUiRoot\'), text: document.body.innerText.slice(0, 400) })',
        },
        10_000,
      );
      const o = JSON.parse(String(r?.result?.value ?? "{}")) as {
        href?: string;
        player?: boolean;
        text?: string;
      };
      if (String(o.href ?? "").includes("/login")) return false;
      if (o.player) return true;
      // signed-out deep links land on the marketing title page / login wall
      // (measured: "Enter your info to sign in", "Get started", reCAPTCHA note)
      return !/join now|enter your info to sign in|sign in to watch|sign in to continue|get started|protected by google recaptcha/i.test(
        String(o.text ?? ""),
      );
    } catch {
      return false;
    }
  }

  private b64Remainder = "";

  /** Start the PulseAudio monitor → Opus/WebM stdout pipeline. */
  async startAudio() {
    const desktop = this.desktop;
    if (!desktop || this.audioRunning) return;
    this.audioRunning = true;
    this.b64Remainder = "";
    console.log("[audio] starting pulse monitor capture");
    // P46 fix: the E2B SDK UTF-8-decodes stdout (TextDecoder) — raw Opus/WebM
    // bytes through that channel are LOSSY (invalid sequences → U+FFFD). The
    // tap now base64-encodes inside the sandbox and decodes on 4-char
    // boundaries here, so binary survives intact. The promise stays pending
    // while ffmpeg runs — termination is via pkill in stopAudio().
    const p = desktop.commands.run(
      "ffmpeg -hide_banner -loglevel error -f pulse -i netflix_sink.monitor -c:a libopus -b:a 128k -frame_duration 20 -f webm pipe:1 | base64 -w 0",
      {
        timeoutMs: 24 * 60 * 60 * 1000,
        onStdout: (data: string) => {
          if (!this.onAudioChunk) return;
          this.b64Remainder += data;
          const usable = Math.floor(this.b64Remainder.length / 4) * 4;
          if (usable === 0) return;
          const chunk = this.b64Remainder.slice(0, usable);
          this.b64Remainder = this.b64Remainder.slice(usable);
          const buf = Buffer.from(chunk, "base64");
          if (buf.length) this.onAudioChunk(buf);
        },
      },
    ).catch((e: Error) => {
      if (this.audioRunning) console.log("[audio] tap ended:", e.message.slice(0, 120));
    });
    void p;
  }

  async stopAudio() {
    if (!this.audioRunning) return;
    this.audioRunning = false;
    this.onAudioChunk = null;
    try {
      await this.desktop?.commands.run("pkill -f 'pulse -i netflix_sink.monitor' || true", { timeoutMs: 8_000 });
    } catch {
      /* noop */
    }
    console.log("[audio] stopped");
  }

  private startKeepalive() {
    if (this.keepalive) return;
    this.keepalive = setInterval(async () => {
      if (!this.desktop) return;
      try {
        if (Date.now() - this.lastActivity > IDLE_TTL_MS) {
          console.log("[session] idle TTL reached — destroying sandbox");
          await this.destroy();
          return;
        }
        await this.desktop.setTimeout(SBX_TIMEOUT_MS);
      } catch {
        console.log("[session] sandbox gone — resetting");
        this.resetLocal();
      }
    }, 60_000);
  }

  private resetLocal() {
    this.desktop = null;
    this.streamUrl = null;
    this.audioRunning = false;
    this.videoId = null;
    if (this.phase !== "idle") this.setPhase("idle", "session ended");
  }

  async destroy() {
    await this.stopAudio();
    try {
      await this.desktop?.kill();
    } catch {
      /* noop */
    }
    this.resetLocal();
    if (this.keepalive) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }

  /** Demand a fresh automatic harvest (clears cache first). */
  async reharvest(): Promise<boolean> {
    try {
      rmSync(COOKIE_CACHE_PATH, { force: true });
    } catch {
      /* noop */
    }
    this.lastHarvestFailedAt = 0;
    writeAuthState({});
    const res = await harvestNetflixSession();
    if (res.ok && res.cookies) {
      this.saveCookieCache(res.cookies);
      if (this.desktop && (this.phase === "auth-required" || this.phase === "ready")) {
        const ok = await this.restoreAuth();
        if (ok) this.setPhase("ready", "netflix session restored via harvest");
        return ok;
      }
      return true;
    }
    console.log(`[session] reharvest failed: ${res.reason}`);
    return false;
  }

  /** Called when the last viewer leaves — schedule idle teardown. */
  markActivity() {
    this.lastActivity = Date.now();
  }
}

/**
 * Parse a raw `Cookie:` header into cookie objects (netflix.com defaults).
 * Tolerant of the operator pasting: the full header, `k=v; k2=v2` pairs, or
 * one pair per line — and of a leading `Cookie:` prefix.
 */
export function parseCookieHeader(header: string): NetflixCookie[] {
  return header
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/[;\n]+/)
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      return { name, value, domain: ".netflix.com", path: "/", secure: true, httpOnly: true } as NetflixCookie;
    })
    .filter((c): c is NetflixCookie => c !== null);
}

export const sessionManager = new NetflixSessionManager();
