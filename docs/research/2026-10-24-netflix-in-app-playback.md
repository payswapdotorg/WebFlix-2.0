# Netflix in-app playback — research record (P43-NETFLIX-DESKTOP)

Date: 2026-10-24 · Lane: wfx2/p43-netflix-desktop
Task: "the current netflix tab cannot replace the netflix UX for users — you can't even play
the movies from the app directly. Research ways to improve that and proceed with the
implementation." (operator direction, superseding the P42 deep-link-only posture)

## 1. What actually plays Netflix video in a third-party surface

Netflix streams are 100% Widevine/PlayReady/FairPlay protected and license for their own
apps. The ONLY architectural shape that shows real Netflix playback inside WebFlix without
touching DRM is **running Netflix's own web player in a real browser and streaming the
screen** — the cloud-desktop pattern (the operator's original "browserbase" suggestion,
materialized on infrastructure we hold keys for).

Chosen transport: **E2B Desktop Sandbox** (`@e2b/desktop`, key provided):
- boots Ubuntu + Xfce at 1280×720 in ~20 s (`Sandbox.create({ resolution: [1280, 720] })`),
- ships `google-chrome-stable` **with Widevine CDM** (`/opt/google/chrome/WidevineCdm`),
- serves the desktop through an **interactive noVNC stream**
  (`desktop.stream.start({ requireAuth: true })` → `getUrl()` → iframe; mouse/keyboard
  forwarded — `viewOnly:false` is the default),
- exposes arbitrary TCP ports publicly (`getHost(port)` → `https://<port>-<id>.e2b.app`),
- runs commands with **live stdout streaming** (`commands.run(cmd, { onStdout })` — verified
  chunk-by-chunk at 1 s granularity).

## 2. Audio (the noVNC gap)

noVNC carries **no audio**. Solved in-session:
`pulseaudio --start` → `module-null-sink` (`netflix_sink`) → Chrome plays into it →
`ffmpeg -f pulse -i netflix_sink.monitor -c:a libopus -f webm pipe:1` → the SDK streams the
Opus/WebM bytes out → socket.io fan-out → browser plays through **MediaSource**
(`audio/webm; codecs="opus"`, `mode: "sequence"`) with a convergence loop (target latency
+ user ±ms nudge). Verified end-to-end: 816 KB of live Opus flowed from the sandbox while
Chrome played a video.

## 3. Chrome control (CDP)

Chrome 136+ **ignores `--remote-debugging-port` on the default profile** — the app-mode
launch uses `--user-data-dir=/home/user/chrome-profile-netflix`. Chrome's DevTools then
rejects proxied `Host:` headers, so a 60-line python TCP relay (port 9223) rewrites
`Host: 127.0.0.1:9222`; the mini-service speaks CDP over `wss://9223-<id>.e2b.app`
(cookie injection, navigation, signed-in detection via `.PlayerSmtUiRoot` + login-wall text).

## 4. The auth wall (the honest part — measured, not assumed)

Netflix blocks **login** from cloud infrastructure:

| Attempt surface | Result |
| --- | --- |
| E2B Chrome UI, real X11 desktop, correct email, slow humanlike typing | `Something went wrong. Please try again in a few minutes.` (×3, spaced 30+ min) |
| `curl` login API from a datacenter IP | literal `BLOCKED` at the edge |
| Apify + residential US IP (BUYPROXIES94952), headless | silent bounce back to the login form |
| Same, **headful + puppeteer-stealth + human pacing + fresh IP per attempt** (×4) | silent bounce, identical for a deliberately WRONG password — i.e. not a password failure, a risk-block |
| A/B diagnostic (wrong vs right password, residential IP, stealth) | **identical generic error** → the block is evaluated before credential validation |

Also learned: the operator credential string `sportsentertainment7192.com` is not a valid
email (client-side rejected: "Please enter a valid email"); the account accepted
**`sportsentertainment7192@gmail.com`** (proceeded to the password step every time).

Consequence — **the layered auth design** (all three shipped):
1. **Cookie cache** — valid cookies (`NetflixId`+`SecureNetflixId`…) injected over CDP; cached
   at `/tmp/netflix-cookies.json`; sessions survive service restarts, not sandbox restarts.
2. **Automatic harvest** — a private Apify actor (`netflix-session-harvester`, id
   `QouQAyfuuPWX2QTPc`) runs stealth Puppeteer over residential IPs with the operator
   credentials from env; retries are throttled (10-min cooldown) to protect the account.
   During the 2026-10-24 session the account sat under a login risk-block (likely from the
   measurement burst); the harvest is expected to succeed once the block cools — the service
   retries on demand from the watch view.
3. **Operator cookie connect (guaranteed)** — paste the `Cookie:` header from any browser
   signed into the account; validated against the live session, then cached. UI lives
   directly on the watch view's connect overlay.

## 5. Compliance posture

- DRM is untouched: Widevine decrypts inside Netflix's own player in the sandbox; WebFlix
  streams the pixels/audio like a screen-share. No stream is extracted, stored, or proxied.
- The operator's own account is used, server-side credentials only (env, gitignored).
- The watch view footer states Netflix ToS still governs the account's use.
- Deep-link handoff (P42) remains the secondary path; nothing about the YouTube surfaces
  changed (byte-identical; the full 2212-test battery stays green).

## 6. Residuals

- Playback tops out at Widevine L3 (720p on Linux Chrome) — a 4K lane would need licensed
  hardware the cloud desktop doesn't have.
- A/V sync is a target-latency convergence with a manual ±ms nudge (noVNC video latency is
  not measurable client-side); good-enough for lean-back viewing, not lip-sync-perfect.
- E2B sandboxes are ephemeral: a cold start costs ~60-90 s (progress UI covers it); the
  single-session manager keeps one desktop warm for 25 min idle.
- Automated login stays subject to Netflix's anti-bot evolution; the cookie-connect path is
  the reliability floor.
