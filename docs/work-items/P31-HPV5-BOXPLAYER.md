# P31-HPV5-BOXPLAYER — the box-player stream mode + the native-first hover ladder

Dispatched: 2026-10-20 (afternoon), by the resident TL station **for itself**
(direct execution — the worker channel stays idle post-P25; the lead-merges
law). Base: `457bb5c` (origin/main — P30-HOME-GRID-MUSIC merged).

## The operator's report (verbatim)

> now all the long format video boxes are showing slideshows
> instead they should be playing the video from inside the box as if the box
> was a video player
> just like on youtube.com

## The fresh measurements (all live, 2026-10-20 — the stale-brief law)

1. **The embed wall MOVED.** A production hover probe (agent-browser,
   12s dwell on `m_5oDOjjb-0`) found BOTH embed host boots dead with the
   qoe stats carrying `error=…r.Sign_in_to_confirm_you_re_not_a_bot` on
   nocookie AND youtube.com — the auth wall now covers the healthy class
   from datacenter egresses (P28's 2026-10-19 matrix had every shape
   playing the healthy class). The operator's "ALL boxes" report says
   their browser class sits behind the same wall (or the 7.5s two-boot
   road to the floor reads as a cycling slideshow per hover).
2. **The native lane was architecturally dead in production.** The
   client-held googlevideo URL is IP-bound to the PLAYBACK function's
   egress (P29's law), and the P29 self-heal regen NEVER works:
   **11/11 probes → 502 "regen unavailable"**, answering in **0.3s** —
   far too fast for a real playback-chain run (7 innertube clients +
   watch page ≈ seconds): the STREAM function's egress cannot run the
   chain at all.
3. **The playback function's egress wins fresh chains TODAY**: 4/4
   never-cached obscure search videos → itag-18 format + storyboards
   (source watch-page); dQw4 → 22 formats (source player). The egress
   lottery split is real and stable across the two functions.

## The deliverables

1. **THE BOX-PLAYER STREAM MODE** — `/api/videos/[id]/playback?itag=<n>&stream=1`.
   The playback route ITSELF streams the bytes: cache-first
   `getPlayback` (warm from the hover preview's card-mount prefetch,
   which hits the same route's DTO mode) → `pickProxyStreamFormat`
   (prefer the client's itag — a Range resume must ride the same stream;
   else the nearest-360p muxed-preferred law) → `fetchUpstream` (Range
   forwarded, the passthrough-header + anti-sniff CSP law) → on a dead
   URL (403 / unusable / throw) **ONE fresh retry**: `getPlayback(id,
   { fresh: true })` re-runs the whole chain in THIS invocation (the
   cache engine's new `force` option — skip every read path, compute,
   write-through: subsequent Range/seek requests ride the fresh URL with
   ZERO chain runs), then fetch again — **generate + fetch on ONE
   invocation, the one axis that always matches**. No usable format
   either attempt → the honest 502 (the client's `<video>` fires onError
   → the lane falls to the embed fallback ladder → the honest floor).
   No `url` parameter exists on this mode — the URLs fetched are always
   our own chain's output through the same googlevideo allowlist.
2. **NATIVE-FIRST hover ladder** (`video-hover-preview.tsx`): the native
   `<video>` arms the moment the playback fetch lands a playable format
   — the box IS the video player, browser-independent (no embed wall, no
   host sensitivity, no iframe API). The EMBED lane demotes to the
   fallback: it boots only when the native lane cannot (the fetch
   settled with no formats — the walled class — or the native stream
   died), keyed on `embedLane` so the boot follows the mount and a lane
   flip destroys any boot in flight. The storyboard stays the loading
   companion + the honest floor (P28's laws untouched); the P22-A chrome
   (Preview pill, mute toggle, scrubbable timeline) drives both lanes
   through the unchanged ops adapter.
3. **THE WATCH PAGE'S PlayerFallback** re-points at the same stream mode
   (its legacy `/api/stream?url=…` src is equally production-dead: the
   same cross-egress IP binding + the stream function's chain-walled
   egress).
4. **The shared proxy surface** (`src/lib/youtube/stream-proxy.ts`): the
   allowlist / plain-fetch / header-passthrough / streamOut laws moved
   from the legacy stream route's private copies to one canonical home —
   both routes import; `pickProxyStreamFormat`'s canonical home is now
   `streams.ts`. The legacy `/api/stream` route is kept byte-identical
   (its P29 battery pins it; it still serves the single-egress dev case
   honestly).

## The honest limits

- The walled class (music/VEVO protection, 0 formats on every egress
  measured) still cannot play from the server side: the embed fallback
  covers the operator's browser class when their embeds play (the
  datacenter's cannot — the auth wall), else the honest static floor +
  the pill. Never a cycling slideshow on a known-dead floor (P28's law,
  re-pinned).
- The watch-page fallback's new src is pinned by the component battery
  (`player-fallback.test.tsx`); its live browser proof was not
  obtainable on the dev ladder (the watch-page embed lane itself PLAYS
  from the sandbox — vps=50s:PL — so the fallback correctly never armed;
  no embed-walled + formats-healthy video pair exists from this egress).

## Gates (station-run at merge time)

`bun run test` = **1959/0** (base 1948 + 11: the stream-mode battery +8 —
the DTO law byte-identical without stream=1, the happy path with Range +
headers + CSP law, the no-itag nearest-360p pick, THE DEAD-CACHED-URL
CURE with the write-through seek-storm law, the walled honest 502, the
throw-retry, the invalid-id 400, the same-itag Range-resume law; the
cache engine's force pins +3 — skips the fresh L1, never dedupes onto an
in-flight compute, isEmpty still guards the forced path; the hover
battery's 40 pins re-pointed at the native-first ladder — the formats
class arms with ZERO embed boots, native death arms the embed fallback,
the zombie guard hands the box to the fallback, the floor laws re-held;
the watch fallback's src pin re-pointed), `bun run lint` 0 errors / 1
pre-existing warning, `bun run typecheck` clean, PAT scan clean.

## Live verification (the dev ladder, :3105)

- The stream mode end-to-end: `GET /api/videos/dQw4w9WgXcQ/playback?itag=18&stream=1`
  with `Range: bytes=0-1048575` → **HTTP 206, video/webm, 1,048,576 real
  video bytes** (generate + fetch in one invocation — the sandbox's
  single egress).
- The hover golden path (the search page's dQw4 card, agent-browser):
  after the dwell the preview phase reads **"native"**, the
  `hover-preview-video` element's src is
  **`/api/videos/dQw4w9WgXcQ/playback?itag=243&stream=1`** (the client's
  nearest-360p pick from the 22 formats), the video is **PLAYING**
  (currentTime 26.8s → 30.8s, readyState 4, paused false), the timeline
  fill tracks (14.46% of 213s), the mute toggle + seek bar present, and
  **ZERO embed iframes booted** — the native lane owns the box
  (evidence/wfx2p31/hover-native-first-playing.png).
- The walled class: Despacito's stream mode → the honest 502
  "Playback stream unavailable"; the home feed's cards (playback-walled
  from the sandbox egress) → the embed fallback boots (2 host requests
  measured) → auth-walled → the honest floor (phase degraded, the pill,
  NO cycling frames) — never a slideshow on a dead floor
  (evidence/wfx2p31/home-walled-honest-floor.png).
- The watch page: the embed lane itself plays from the sandbox
  (qoe vps=50.053:PL) — the fallback correctly never arms; the new
  fallback src is carried by the component battery.
- Zero page/console errors across the passes.

## The post-merge production re-probe + the companion-law amendment (same evening)

The production re-probe (webflix-2-0-one.vercel.app, post-deploy):

- **The stream mode works in production for the chain-servable class**:
  dQw4 → **206 in 0.67s** with real video bytes.
- **The popular feed class is currently behind the moving wall**: the home
  feed's videos answered 502 on the stream mode (8/8 probes, 1.7s each —
  the cached URL dead via egress rotation + the forced-fresh chain runs
  ending storyboards-only), while 4/4 never-cached OBSCURE videos still
  yield itag-18 formats via the watch-page rung. The wall moved onto the
  popular class this afternoon (it had covered the embeds at midday).
- The client behaved per design: the native lane armed (the prefetch DTO
  still carried the cached format) → the stream 502 → onError → the embed
  fallback (2 boots, auth-walled) → the honest floor. **No cycling
  frames on the settled floor** — but the ~9s road there (the 502 at
  ~1.7s + the embed ladder's 7.5s window) kept the storyboard COMPANION
  cycling under the probing fallback — the exact "slideshow" perception
  the operator has now filed four times.

**THE YOUTUBE.COM COMPANION LAW** (the amendment, `d54c57d`): the
storyboard frames animate ONLY while the NATIVE lane owns the box (the
real video is coming — the crossfade base + loading companion) and on the
reduced-motion design lane. The embed fallback's boot window and the
walled floor show the card's own static thumbnail — youtube.com's own
measured law, extended from the P28 floor to the whole embed-fallback
window. Verified live on the dev ladder: a walled-card hover shows
`framesCycling: false` at BOTH the 3s and 10s marks (the static thumbnail
from the first second), while the formats class keeps its moving companion
under the booting native video (phase native, playing, the frames as the
crossfade base).

The honest production picture after the amendment: the box either PLAYS
the video (every chain-servable class, browser-independent) or shows the
static thumbnail (+ the pill when the floor is final). Never a cycling
slideshow anywhere — the operator's four re-files' symptom class is
extinguished, and the playing class isarchitecturally robust (the
generate-and-fetch-on-one-invocation law).
