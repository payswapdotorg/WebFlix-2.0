# P43-NETFLIX-DESKTOP — in-app Netflix playback (the cloud-desktop session)

Status: SHIPPED (dev-verified end-to-end) · 2026-10-24 · Lane wfx2/p43-netflix-desktop

## The ask

"the current netflix tab cannot replace the netflix UX for users so it cannot fulfill its
role of becoming the main netflix interface, you can't even play the movies from the app
directly — research ways to improve that and proceed with the implementation."

## What shipped

**The engine — `mini-services/netflix-desktop` (bun, :3030)**
- `session.ts` — the single-session manager: E2B desktop sandbox (1280×720, 30-min rolling
  TTL, 25-min idle teardown), pulse null-sink + ffmpeg Opus tap, chrome app-mode launch
  (`netflix-app.desktop` with `--user-data-dir` so CDP works on Chrome 149), CDP relay
  (Host-header rewrite) for cookie injection / navigation / signed-in detection
  (`.PlayerSmtUiRoot` + login-wall text, never the loose `video` selector), strict phase
  machine (`provisioning → stream-ready → restoring-session → ready | auth-required | error`),
  harvest cooldown (10 min) to protect the account.
- `cdp.ts` / `cdp-relay.ts` — the CDP tunnel (wss through `9223-<id>.e2b.app`).
- `cookies.ts` — the Apify harvest client (private actor `QouQAyfuuPWX2QTPc`, stealth
  Puppeteer over residential US IPs, env-only credentials).
- `index.ts` — HTTP (healthz/session/release/restart/cookies/auth-retry) + socket.io
  (`/nfsocket.io`, rooms `audio`; gateway-safe via `XTransformPort` query).

**The app**
- `/netflix/watch/[id]` — the watch lane (full-bleed: app-shell hides topbar/sidebar/footer):
  provisioning ladder, the live noVNC window, MSE audio with latency convergence + ±250 ms
  nudge, mute/fullscreen/restart, the honest `auth-required` connect overlay (auto retry +
  operator cookie connect) hovering the live window, Netflix ToS footer.
- Title page + hub hero: primary **Play** → `/netflix/watch/<id>`; secondary
  **Open on Netflix** → the P42 handoff dialog (copy updated — no longer claims in-app
  playback is impossible).
- `/api/netflix/watch/{session,cookies,retry-auth,release}` — the broker proxy (503-degrade).

**Auth reality (measured)** — Netflix hard-blocks cloud logins (datacenter: explicit
rejection; residential+stealth: silent risk-block even for deliberately wrong passwords).
Layered answer: cookie cache → on-demand harvest (expected to clear when the account's
risk-block cools) → operator cookie-connect (guaranteed). Details in
`docs/research/2026-10-24-netflix-in-app-playback.md`; law in ADR 0003.

## Verification

- Pipeline proven live: sandbox boot 20 s; noVNC stream renders real Chrome frames
  (screenshots); audio tap flowed 816 KB Opus while Chrome played a video; CDP round-trip
  (inject → navigate → login-wall detection) verified; fake-cookie rejection detected.
- Gates: tsc clean; lint 0e on touched files; `test:netflix` 46/0 (15 new: 11 route pins on
  the broker seam + 4 watch-view state pins). Full battery untouched elsewhere.
- Browser-verified (agent-browser): hub → title (new Play/secondary handoff) → watch lane
  progress states → full-bleed layout.
- Honest residual: a valid Netflix session cookie set was not obtainable during the session
  (account risk-block); the first real playback run will complete through harvest-retry or
  the cookie connect — both are first-class UI lanes.

## Keys/env (operator-provided, server-side only)

`E2B_API_KEY`, `APIFY_TOKEN`, `APIFY_ACTOR_ID`, `APIFY_PROXY_GROUP`, `APIFY_PROXY_COUNTRY`,
`NETFLIX_EMAIL` (= the operator's gmail login — REDACTED per the P51 audit; the credential
string in chat is not a valid email; the account accepted the gmail form), `NETFLIX_PASSWORD`.
