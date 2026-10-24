# P45 — the Netflix-grade hub + the auth wall measured to its floor

dispatched: 2026-10-24 by resident-TL (continuation of the operator's P44
feedback — "the netflix tab cannot replace the netflix UX … you can't even
play the movies from the app directly — research ways to improve that and
proceed with the implementation")

## Goal

1. Make the WebFlix-native Netflix surface actually look and behave like
   Netflix (the browse half of "replace the UX").
2. Attack the automatic-sign-in wall once more, with a better automation
   shape; if it opens, the playback half is fully automatic.

## Shipped

### The Netflix-grade hub (the visible half)

- **The billboard** (`netflix-hero.tsx` rewritten): full-bleed backdrop
  rotating through the day's top 5 (9s crossfade, paused on hover/focus,
  prefers-reduced-motion honored), the `N FILM / N SERIES` kicker, logo-art
  title treatment, the `TOP #1 in Movies/TV Shows Today` badge line, the
  white Play + translucent More Info buttons (Netflix's own button shapes),
  My List + the N-circle hand-off on the right rail, vertical progress dots.
- **Top 10 rows** (`netflix-rail.tsx` + `netflix-card.tsx` `ranked` variant):
  portrait art (the 1200×675 backdrop center-cropped) with the giant outlined
  rank numerals riding the left edge — Netflix's Top-10 row silhouette —
  red `TOP 10` header tags, hover chevron paging (keyboard reachable).
- **Hover-expand cards** (16:9 rows): scale + sibling-overlay info sheet
  (no nested anchors) carrying the **direct in-app Play link**
  (`/netflix/watch/<id>`), the My-List + circle (shared `useMyListToggle`
  hook), match-badge meta and the synopsis.
- **The sub-nav**: sticky Netflix-style pill tabs (All / Movies / TV Shows)
  filtering the rails client-side + the Global/US country chips.
- All P42/P44 testids preserved (`netflix-hero`, rails, live band, chips,
  source note); pins re-asserted against the new copy + new pins (kind tabs,
  billboard dots, direct card-play links).

### The auth wall (the playback half) — measured to its floor

Full record: `docs/research/2026-10-24-p45-auth-quarantine.md`.

- The v0.1→v0.3 harvester (homepage warm-up → real Sign-In click →
  per-keystroke human pacing → ONE clean submit → honest statuses) still hits
  the **pre-validation risk wall** ("Something went wrong. Please try again
  in a few minutes.") on GB residential egress — three attempts, ~40 minutes,
  identical.
- Measured Netflix behavior: the wall run **issues the full auth cookie
  family** (NetflixId, SecureNetflixId, flwssn, gsid) while the login stays
  **quarantined** — `/browse` bounces to `/login?nextpage=…`. Cookies-present
  ≠ session-live; the broker's strict validation rejected the quarantined set
  exactly as designed (the layered defense proven live).
- Decision: automated login attempts STOP (account-safety); the v0.3 actor
  ships as the harvester so a future relaxation works automatically and never
  caches a dead set. **Cookie-connect stays the guaranteed path.**
- Broker hardening: `stream.start` transient-failure retry; harvest client
  switched to the v0.3 single-attempt shape (GB default).

### The watch lane (honesty + escape hatch)

- The auth overlay now states the measured harvest reality and links the
  in-app **trailer** (the existing YouTube lane) as the immediate
  something-to-watch while unconnected.

## Gates

- tsc clean (app + broker), lint 0 errors (research/ added to eslint
  ignores), `test:netflix` 56 pass / 0 fail (3 new pins).
- Browser-verified: billboard rotation + dots, TOP-10 numerals, sub-nav
  filtering, watch-lane overlay, live band; mobile 375px checked.

## Residuals (honest)

- Automatic sign-in remains blocked by Netflix's risk engine (pre-validation);
  the operator cookie-connect is the one-time inch to full playback, and
  whether the operator's cookies survive the home→E2B IP transfer is answered
  honestly on the first real connect.
- Catalog depth stays the Tudum Top-10 universe (unchanged; P43+ TMDB/uNoGS).
