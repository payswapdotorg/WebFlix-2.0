# P45 — the Netflix auth wall, measured to its floor (2026-10-24)

**Question.** Can the automatic sign-in be made to work, so WebFlix's Netflix
lane is playable without the operator pasting session cookies?

**Why now.** P43/P44 measured a pre-validation risk-block (wrong-password A/B
identical) and fell back to the operator cookie-connect. The residual was the
only guaranteed-but-manual inch. This iteration attacked it with a better
automation shape.

## What was tried (v0.1 → v0.3, Apify private actor, stealth Puppeteer, headful)

| # | Shape | Egress | Result |
|---|-------|--------|--------|
| 1 | v0.1: homepage warm-up → Sign-In click → human-paced typing → one submit | Apify RESIDENTIAL, GB | email selector never found (v0.1 selector gap; page loaded fine) |
| 2 | v0.2: same + widened selector (`autocomplete` variants — Netflix's current form labels the field "Email or mobile number") | Apify residential (BUYPROXIES94952), GB | **"Something went wrong. Please try again in a few minutes."** — but Netflix **issued** NetflixId + SecureNetflixId + flwssn + gsid |
| 3 | v0.3: same + direct `/browse` re-check after the wall text, honest statuses | same | re-check bounces to `/login?nextpage=…&serverState=…` → **quarantined**: cookies issued, session NOT live |

The strict sandbox-side validation (`checkSignedIn`) independently rejected the
quarantined cookie set — the layered defense from P44 did exactly its job when
the broker's automatic harvest fed it the false-positive cookies.

## Findings

1. **The wall precedes credential validation** (confirms P43/P44): the same
   "Something went wrong" appears before any password check, with warm-up
   dwell, per-keystroke typing (60–160ms + jitter), real mouse movement, a
   single clean submit, and a fresh residential IP per attempt.
2. **Issued cookies ≠ live session.** Netflix can set the full auth cookie
   family while the login stays quarantined; `/browse` bounces to `/login`.
   Any harvester that equates "cookies present" with "logged in" will cache a
   dead session (v0.2's status was too weak — v0.3 fixes it honestly:
   `logged-in` / `quarantined` / `blocked-or-failed`).
3. **"Try again in a few minutes" is not an invitation that pays.** A paced
   retry 10 minutes later reproduced the identical quarantine. Three
   well-shaped attempts across ~40 minutes, all pre-validation.
4. The current login form renders "Email or mobile number" and binds
   `autocomplete="username"`-style attributes; selectors keyed only on
   `name="email"` miss it.

## Decision

- **Stop automated login attempts.** Each attempt burns Apify runs and risks
  deepening the risk flag on the operator's account. The v0.3 actor ships as
  the harvester (honest statuses, GB egress, human pacing) so that IF Netflix
  ever relaxes, the automatic path works and never caches a quarantined set.
- **The operator cookie-connect stays the guaranteed path** (60 seconds, two
  cookies, strictly validated live before caching — proven again today when it
  rejected the quarantined set).
- The watch lane's auth overlay now states this measured reality and offers
  the in-app trailer (the existing YouTube lane) as the immediate something-to-watch.

## The replay-IP question (open, untestable without a real session)

Netflix sessions generally survive VPN/region switches for real users, but
whether the operator's cookies survive the transfer home-IP → E2B IP is
unverified until a real cookie set is connected once. The strict validation
will answer it honestly on the first real connect: if Netflix rejects the
transfer, the lane will say so instead of pretending.
