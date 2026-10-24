# ADR 0003 — Netflix in-app playback (the cloud-desktop session lane)

Date: 2026-10-24 · Status: ACCEPTED (operator-directed amendment to ADR 0002 §1)

## Context

ADR 0002 scoped Netflix integration to browse + deep-link handoff, rejecting remote-browser
streaming on ToS/detection/quality grounds. The operator has since explicitly directed
in-app playback: *"the current netflix tab cannot replace the netflix UX for users — you
can't even play the movies from the app directly. Research ways to improve that and proceed
with the implementation."* The operator supplies the Netflix account and all
infrastructure keys; the account is theirs and the use is personal-scope.

## Decision

1. **In-app playback ships through the WebFlix Netflix Desktop session** — a single
   long-lived E2B desktop sandbox (1280×720) running Google Chrome (Widevine intact) signed
   into the operator's Netflix account, streamed into WebFlix through the interactive noVNC
   iframe, audible through a PulseAudio→Opus→WebSocket→MSE tap. Playback interactions happen
   in Netflix's own player inside the window; WebFlix adds only room chrome.
2. **Titles are reached by the official deep link** (`netflix.com/watch/<videoId>`), driven
   by CDP inside the sandbox. ADR 0002 §1's deep-link law still owns every URL
   (`src/lib/netflix/deeplink.ts`); the handoff dialog remains the secondary path.
3. **Session auth is layered**: cookie cache → on-demand residential harvest (private Apify
   actor) → operator cookie-connect. Credentials never enter the repo or the client; the
   mini-service holds them in env only.
4. **Honest states everywhere**: provisioning progress, `auth-required` (connect overlay over
   the live window), `error` (restart lane). The UI never fakes a player surface; the only
   `<video>` on the lane is the hidden MSE audio element.

## Consequences

- The watch route (`/netflix/watch/[id]`) depends on the `netflix-desktop` mini-service;
  when unreachable it degrades honestly (503 → "session unreachable" + restart lane).
- Streaming cost/latency (cloud desktop boot ~60-90 s cold) is surfaced in the UI.
- ADR 0002's §2 rejection of Browserbase-style streaming is superseded for the
  operator-account, single-session, DRM-intact shape documented in
  `docs/research/2026-10-24-netflix-in-app-playback.md`.
- The YouTube surfaces and the P42 browse stack are unchanged; the full battery stays green.
