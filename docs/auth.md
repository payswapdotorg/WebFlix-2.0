# WFX2-P2-AU — the WebFlix auth system

Real WebFlix accounts fronting the single operator YouTube session —
youtube.com signed-out gating parity everywhere else.

## The architecture law (unchanged)

WebFlix's data backend stays the **single operator YouTube session**
(Tier-2 broker, `YT_COOKIES`). The auth system creates **WebFlix
identities** that front that session — it does **NOT** create YouTube
accounts, and no YouTube-account data is ever fabricated. Signed-in copy
stays honest about this (the account page models the wording).

## The session strategy

NextAuth v4, **credentials provider (email + password) + JWT sessions**:

- `src/app/api/auth/[...nextauth]/route.ts` — stock NextAuth routes
  (session / csrf / signin / signout / callback/credentials).
- `src/lib/auth/options.ts` — the claims contract:
  `sub` = user id, `name` = display name, `email`, `avatarSeed` (0–359 hue).
- `src/lib/auth/secret.ts` — `NEXTAUTH_SECRET`; dev/tests fall back to an
  insecure local constant so the gates run env-clean (the repo law).
- Sign-out, session fetch (`GET /api/auth/session` → `{}` for guests),
  CSRF — all stock NextAuth.

## The user store (a cross-app contract)

`src/lib/auth/user-store.ts` — the Upstash adapter pattern:

- Key schema: **`wf:auth:user:<email>`** (lowercased email = identity).
  JSON record: `{ id, email, displayName, passwordHash, avatarSeed,
  createdAt }`. **Never a TTL** — user records are permanent; session JWTs
  carry their own expiry.
- The `wf:auth:` namespace is separate from the `yt:*` cache keys, and the
  schema is a CROSS-APP CONTRACT: the standalone Studio app (P2-ST) reads
  and writes the same keys.
- Env-wired (`UPSTASH_REDIS_REST_URL` + `_TOKEN`) → REST pipelines against
  the real Upstash; env absent → in-memory Map fallback (dev + tests).
  `setUserStoreRest()` is the test seam (never the network).

`src/lib/auth/users.ts` — register (email validation, password ≥ 8,
uniqueness), verify (**node:crypto scrypt**, per-user salt, constant-time
compare — no new deps), profile read/update (display name, avatar color).
No PII beyond what YouTube's own profile holds.

## The surfaces

- **`/signin` + `/signup`** — Google-account visual parity: centered card,
  WebFlix wordmark, show-password toggle, the honest recovery
  degradation ("Account recovery is not available yet" — no email flows,
  and "ask the operator to reset" is not honest copy), create-account
  links both ways, `?redirect=` return-to-surface (same-app relative only).
- **Header** — guest: the outlined "Sign in" pill (avatar-and-in icon);
  signed-in: the initial-based avatar (avatarSeed hue) with the account
  dropdown (name, email, Your account, WebFlix Studio, Sign out).
- **Account page** — the identity card (edit display name + avatar color)
  + the honest operator-session section (wording unchanged).
- **Watch page** — guests get youtube.com's exact write prompts: the
  "Sign in to comment" composer box, like/subscribe/save/report routing to
  `/signin?redirect=/watch/<id>` instead of firing.

## The gate

- **Pages** (`/history /liked /playlists /subscriptions /notifications
  /account /studio`): guests get the youtube.com/history-style signed-out
  screen (rounded account illustration, "Don't miss new videos" /
  "Sign in to see your X on WebFlix", red Sign in button) — see
  `src/components/auth/signed-out-screen.tsx` +
  `personal-surface-gate.tsx`.
- **API**: the personal + write routes gain a session check
  (`getSessionUser` → `authRequiredResponse()`) — the uniform **401
  `{ error: "unauthenticated" }`** the client degrades on. Guests never
  reach the broker. Signed-in requests get EXACTLY the prior behavior;
  every DTO shape is unchanged (the gate is additive).
- `useWebFlixSession()` (`src/hooks/use-webflix-session.ts`) — the light
  session hook on the repo's `useApi` fetch pattern (no QueryClientProvider
  is mounted app-wide; no next-auth/react client bundle — a fetch suffices).

## Env

| var | required | notes |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | production | `openssl rand -base64 32`; dev/tests use the insecure fallback |
| `NEXTAUTH_URL` | non-Vercel | auto-derived from `VERCEL_URL` on Vercel |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | production user store | absent → in-memory fallback (dev/tests) |
