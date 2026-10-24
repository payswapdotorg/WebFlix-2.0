# P44-NETFLIX-LIVE — the Netflix Live lane + the auth-flow hardening

**Status:** shipped · **Parent:** P43-NETFLIX-DESKTOP (ADR 0003) · **Follow-up:** the operator's "go" on the P43 residual

## The problem

P43 made Netflix *playable* in-app, but two things still fell short of the operator's bar:

1. **The lane only ever opened deep links** — the streamed cloud desktop was a per-title player, not a place where the real Netflix (browse, search, profiles, My List) could be used. The Netflix tab still couldn't *replace* the Netflix UX.
2. **The auth floor was clunky and untrustworthy** — the cookie-connect panel asked for "the whole Cookie header", gave no paste feedback, the restart button 404'd (the route was never created), and the session validation only checked `!href.includes("/login")` — which a garbage `NetflixId` could pass whenever Netflix served the signed-OUT marketing page without the bounce.

## What shipped

### The Netflix Live lane (`/netflix/watch/live`)

- The watch view accepts the literal id `live`: no title payload, the kick POSTs `{ path: "/browse" }`, and the header reads **"Netflix Live — the real Netflix, right here"**.
- Broker `openPath(path)`: whitelisted netflix.com paths (`^\/[A-Za-z0-9/_?=&.~-]*$`, no open redirect), navigate over CDP, strict signed-in check, honest phase. The streamed window **is** netflix.com — every row, search, and the real player are usable once connected.
- Hub: a **Netflix Live band** between the header and the hero — "Open the actual Netflix — every row, search, and the real player — streamed live from your private cloud desktop inside WebFlix" → `Browse Netflix Live`.
- API: `POST /api/netflix/watch/session` forwards whitelisted `path`; **NEW** `POST /api/netflix/watch/session/restart` (the P43 view called it; the route never existed → the restart button 404'd silently).

### The auth-flow hardening

- **Cookie-connect is now the primary lane** (red button first; "Retry automatic sign-in" demoted with honest copy — the wall blocks most cloud sign-ins).
- **A 3-step DevTools guide** (Application → Cookies → copy `NetflixId` + `SecureNetflixId`), a **live paste hint** (`NetflixId` as a *standalone* name — `/(?<![A-Za-z])NetflixId\s*=/` — a bare `SecureNetflixId=` paste is correctly called out as insufficient), and a privacy note (cookies stay on the server, injected into the private desktop, cached).
- **Strict session validation everywhere**: `applyExternalCookies` and `restoreAuth` now use `checkSignedIn` (player root OR no marketing-wall text) instead of the href-only check. Measured wall phrases added: `get started`, `protected by google recaptcha`.
- `parseCookieHeader` tolerates the full header, `k=v` pairs, **one pair per line**, and a leading `Cookie:` prefix.
- The view's 2.5s poll got a **change-guard** — `setStatus` only on a real status change (no more re-render churn under interaction).

## Measured reality (this session)

- Today's harvest attempts (actor 0.0.15) again produced the **A/B block**: `wrongpass` and `goodpass` both → "Something went wrong. Please try again in a few minutes." + reCAPTCHA wall — the block still precedes credential validation. The 10-min cooldown held.
- A garbage-cookie validation DID false-pass the old href-only check once in the live lane (200 vs the 422 the same payload got minutes later) — the strict check now rejects it deterministically (verified live: honest 422, no cache write).
- Hot-reloading the broker mid-bootstrap wedges the phase machine (the in-flight coroutine dies with the old module) and can leak the sandbox — cleaned via `DELETE /sandboxes/<id>`; restart the service instead of trusting a mid-flight `bun --hot`.

## Gates

- `tsc --noEmit` clean (app + broker); lint 0 errors (the 1 pre-existing `search-layout` warning remains).
- `test:netflix` **53/0** — 7 new pins: session-restart proxy (forwards + dead-broker), path forwarding + non-whitelisted-path refusal, hub Live band, watch-view live mode (kicks `/browse`, no videoId), cookie-hint feedback both ways, privacy note.

## Honest residual

Unchanged from P43 and still the floor: a VALID session cookie set. The harvest lane stays automatic (retry with cooldown); the 60-second cookie-connect is the guaranteed inch — now with a guide that asks for exactly the two cookies that matter.
