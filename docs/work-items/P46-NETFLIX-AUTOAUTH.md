# P46 — automatic sign-in: the WebFlix Bridge + the poison-proof ingest ladder

dispatched: 2026-10-26 by resident-TL (operator: "explore automatic sign in
solutions") — research record: docs/research/2026-10-26-auto-signin-ladder.md

## Goal

Make Netflix sign-in AUTOMATIC without touching the risk engine that P44/P45
measured (and that burned the account). The answer had to keep the layered
honesty: nothing unvalidated ever reaches playback.

## Shipped

### The WebFlix Bridge (the flagship)

`extension/webflix-bridge/` — a one-time-install MV3 extension for the
operator's own signed-in browser:

- `chrome.cookies.onChanged` (3s debounce) + a 30-min alarm watch the
  `.netflix.com` jar; pushes on first sight, on every NetflixId/-
  SecureNetflixId rotation, and a 6h keepalive (pure `logic.js`, pinned).
- Pushes to the WebFlix origin the operator pairs (URL + token in Options;
  `optional_host_permissions` requested on save — scoped to that origin).
- Status surface (popup + options): watching / queued / applied / rejected /
  bad-token / unreachable — all honest.

### The ingest ladder (broker)

`mini-services/netflix-desktop/ingest.ts`:

- Pairing token: minted at first boot, persisted, timing-safe compared,
  rotatable (`POST /ingest/token/rotate`).
- `POST /ingest`: 401 bad token → 422 no standalone NetflixId → LIVE sandbox:
  apply through the strict checkSignedIn path immediately (the auth wall
  flips to the real Netflix by itself) → IDLE sandbox: queue a CANDIDATE.
- Candidate law: a candidate is validated BEFORE the cache/harvest ladder on
  the next bootstrap, promoted to the trusted cache on a strict pass, DROPPED
  on a failure — a bridge can never poison the cache (the P45 lesson, now
  structural).
- `autoAuth` bridge status rides /healthz + /session (non-secret only).

### The app surface

- `/api/netflix/watch/ingest` (the bridge's target) + `/api/netflix/watch/
  autoauth` (GET token+status, POST rotate) — honest 502/503 degrades.
- The watch-lane auth overlay is two lanes now: **Automatic (bridge)**
  primary (download → 3-step install → copy/rotate token → live status line,
  5s poll, amber honest-rejection state) and the manual paste demoted to the
  secondary tab, unchanged in behavior (all P44 testids preserved).
- The harvest note now states the order: bridge = the automatic path that
  never touches the wall; harvest = armed but slow; paste = the one-off
  fallback.

### Residential egress (dormant, fail-open)

`mini-services/netflix-desktop/egress.ts`: when `APIFY_PROXY_PASSWORD` is
set, the sandbox Chrome rides a session-sticky Apify residential proxy via a
python-stdlib CONNECT forwarder (written + health-checked inside the sandbox
before the flag reaches Chrome). Without the password (measured: 407 on
every out-of-actor auth shape with the API token) it stays DIRECT. Mitigates
the home→E2B IP-transfer residual in shape.

### Two latent bugs fixed en route

- **The audio tap was binary-lossy**: the E2B SDK UTF-8-decodes command
  stdout (TextDecoder) — raw Opus/WebM bytes through it corrupt. The tap now
  base64-encodes inside the sandbox and decodes on 4-char boundaries in the
  broker. (Also the type error that had kept the broker tsc dirty.)
- The broker's pre-existing tsc failures (desktop null-narrowing, an
  undeclared `audioHandle`) are fixed — app AND broker tsc are clean for
  real now.

## Gates

- tsc clean (app + broker), lint 0 errors on touched files.
- `test:netflix` 82/0 (26 new pins); full battery 2263 pass / 0 fail.
- Browser-verified live (agent-browser): overlay → auto lane primary with
  the real token; a live bridge push of fake cookies while the sandbox was
  up → 422 → the amber rejection line → NO candidate left behind; lane
  switching both ways; `/netflix-bridge.zip` 200; hub intact; mobile 375px
  no overflow. Broker log shows the full ladder (cooldown-gated harvest skip
  → auth-required → bridge inject → strict rejection).
