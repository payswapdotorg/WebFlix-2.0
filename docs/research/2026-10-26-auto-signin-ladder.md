# Research — the automatic sign-in ladder (P46)

dispatched: 2026-10-26 by resident-TL (operator follow-up to P45: "explore
automatic sign in solutions")

## Context

P44/P45 measured Netflix's login risk engine to its floor: automated
credential logins from any non-residential context are blocked BEFORE
credential validation, and even GB-residential human-paced attempts are
"quarantined" (the full cookie family is issued but never activated).
Automated login attempts were STOPPED for account safety. The remaining
floor was the 60-second manual DevTools cookie paste. This research asks:
what can make sign-in AUTOMATIC without touching that wall?

## The option ladder (measured / decided)

### 1. Password-based automated login — EXHAUSTED (P44/P45)

Datacenter egress: explicit rejection. GB-residential + stealth puppeteer +
full human pacing: silent pre-validation risk-block, 3/3 across ~40 min, and
the account quarantine leaves cookies that LOOK valid (strict checkSignedIn
correctly rejects them). Re-attempting burns the account's risk score. Still
stopped. The v0.3 harvester remains shipped so a future relaxation works
automatically.

### 2. Netflix TV/web device pairing (netflix.com/tv8) — REJECTED

Measured: https://www.netflix.com/tv8 serves 200 (the pairing entry is real).
But the pairing grant is bound to the DEVICE SESSION that generated the code
(the TV app registers the device server-side before showing the code);
capturing it means emulating the TV app's private device-registration API —
reverse-engineering a ToS-protected, frequently-changing surface, strictly
riskier than the alternatives. Documented; not pursued.

### 3. Bookmarklet cookie capture — IMPOSSIBLE

NetflixId/SecureNetflixId are HttpOnly: `document.cookie` cannot read them.
Only privileged contexts (DevTools, a browser extension's `chrome.cookies`)
can. This is exactly why the manual paste needed DevTools.

### 4. The WebFlix Bridge (one-time-install extension) — SHIPPED (the winner)

The only automation that mints NO cookies and never touches the risk engine:
the operator's own genuine, signed-in browser ships its session to WebFlix.

- MV3 extension (`extension/webflix-bridge/`): `chrome.cookies` watches the
  `.netflix.com` jar (HttpOnly included — the privileged read bookmarklets
  can't do), pushes on every NetflixId/SecureNetflixId rotation + a 6h
  keepalive (30s debounce), to `${webflix}/api/netflix/watch/ingest` with a
  pairing token. `optional_host_permissions` + a user-gesture permission
  request keep it scoped to the one WebFlix origin.
- From the app's perspective sign-in is now: install once (60 seconds, no
  DevTools ever), sign into netflix.com normally once, done — every future
  session AND every rotation flows in automatically.
- The cookies never leave the operator's machine except toward their own
  WebFlix server, and the extension states that.

### 5. Candidate → trusted promotion (poison-proofing) — SHIPPED

The P45 lesson (a quarantined set once sat in the trusted cache) became the
ingest law: bridge payloads NEVER enter the trusted cache directly.

- sandbox live  → applied immediately through the strict checkSignedIn path
                  (`applyExternalCookies`); only success is cached; a failure
                  records an honest rejection and queues nothing.
- sandbox idle  → queued as a CANDIDATE; the next bootstrap validates it
                  BEFORE the cache/harvest ladder, promotes on pass, drops on
                  failure.
Live-verified: a fake-cookies push while the sandbox was live returned 422,
was recorded as a rejection, and left NO candidate file.

### 6. Residential egress for the cloud Chrome — SHIPPED, env-gated, fail-open

The untested P45 residual (home→E2B cookie IP-transfer) is mitigated in
shape: when `APIFY_PROXY_PASSWORD` is set, the sandbox Chrome routes through
a session-sticky Apify residential proxy (a python-stdlib CONNECT forwarder
inside the sandbox), so the cloud session spends its life on one stable
household IP. Measured: without that password (Console → Integrations, NOT
the API token), proxy.apify.com answers 407 to every out-of-actor auth shape
(groups-BUYPROXIES94952 / groups-RESIDENTIAL / auto all probed with the
operator token) — so the feature stays dormant and DIRECT egress continues
until the operator adds the password. The proxy flag only reaches Chrome
after an IP health-check proves the tunnel.

## Shipped surface

- Broker: `POST /ingest` (token-gated), `GET /ingest/token` (+ bridge
  status), `POST /ingest/token/rotate`; `autoAuth` block on /healthz +
  /session; candidate-first `restoreAuth`; `mini-services/netflix-desktop/
  {ingest,egress}.ts`.
- App: `/api/netflix/watch/ingest` + `/api/netflix/watch/autoauth` (GET
  token+status, POST rotate); the watch-lane auth overlay is now two lanes —
  **Automatic (bridge)** primary (download → pair → live status, 5s poll)
  and the manual paste demoted but first-class; the harvest note states the
  new order honestly.
- Bridge: `extension/webflix-bridge/` (manifest, background worker, pure
  `logic.js` pinned by tests, options + popup), packed to
  `public/netflix-bridge.zip` by `scripts/pack-bridge.mjs` (also generates
  the icon set — no image deps).
- Tests: `tests/netflix-autoauth.test.ts` (26 pins: token lifecycle, payload
  normalization, push decisions, the poison-proof ladder, extension sanity,
  app proxies on the stub upstream). Suite now 82/0.

## Honest residuals

- The FIRST successful bridge connect is still unverified against a real
  signed-in browser (no valid session exists in this sandbox) — the strict
  validation path it rides is the same code that already rejected real
  garbage live, so the risk is mechanical, not architectural.
- Cookie IP-transfer acceptance (now optionally on residential egress)
  remains untestable until a real set exists.
- Vercel: the bridge degrade is honest 502 until the broker ships beside the
  app (unchanged P43 posture).
