# P32-HPV6-STRICTLAW — the strict youtube.com preview law + the parallel embed head-start

Dispatched: 2026-10-21, by the resident TL station **for itself** (direct
execution — the worker channel stays idle post-P25; the lead-merges law).
Base: `5277bc8` (origin/main — P31-HPV5-BOXPLAYER + the companion-law
amendment + the production proofs merged).

## The operator's report (verbatim — the FIFTH slideshow re-file)

> the shorts preview boxes are playing correctly as opposed to the long
> format video preview boxes that are showing slideshows instead of the
> video

## The fresh measurements (all live, 2026-10-21 — the stale-brief law)

1. **The shorts play through the operator's BROWSER, not the server.**
   Every one of the 12 production shorts tiles' stream modes answers
   **502** (measured: 12/12, 1.5–4.4s each — the same walled class as the
   long-format popular feed). The operator's shorts previews "playing
   correctly" therefore ride the **embed lane on their residential
   egress** — the one lane that still plays anything for them. The preview
   pipeline itself (native-first ladder, stream mode, chrome) is healthy;
   what differs per class is which lane can win.
2. **The last cycling class is the native boot window.** P31's companion
   law banned the cycling storyboard under the embed fallback's boot and
   on the settled floor — but the formats-land class (the popular feed:
   watch-page formats land while the googlevideo fetches die at
   1.5–4.4s) still armed the native lane with the storyboard frames
   CYCLING underneath for the whole doomed boot — measured on production
   (Despacito's DTO: 0 formats + 2 storyboards; the shorts' DTOs: 1
   watch-page format + 0 storyboards). That window — pictures cycling
   under a lane that never plays — is exactly the "slideshow" the
   operator keeps filing.
3. **The healthy class plays fast.** The stream mode's TTFB is
   0.3–0.8s (Range probes on dQw4's itag-243: 64KB in 0.2–0.3s, 512KB at
   ~400KB/s, 1MB at ~1.5MB/s) — canplay follows the first buffer, so the
   native lane proves life in ~1–2.5s. Past ~1.5s of armed silence a
   native is presumptively doomed (the popular class's stream dies at
   1.5–4.4s).
4. **The wall is per-format too.** The googlevideo fetch can kill one
   format's URL while a sibling format's URL (a different CDN host)
   still serves — the moving wall measured 2026-10-20/21 makes the
   per-(video, client, egress, format) cell a lottery.

## The deliverables

1. **THE STRICT YOUTUBE.COM PREVIEW LAW** (`video-hover-preview.tsx`):
   the storyboard frames animate **ONLY on the reduced-motion design
   lane** (mode "storyboard" — that lane never plays video; cycling
   frames ARE its documented design). On every video-capable lane the
   box shows the card's own **static thumbnail** until a lane reports
   playback — the playing lane crossfades in over the STATIC THUMBNAIL
   (exactly the way the embed lane already did since P28). NEVER cycling
   pictures anywhere else: under a booting native, under a probing embed
   fallback, on a settled floor. All five re-files (2026-10-16 →
   2026-10-21) read the animating storyboard as "a slideshow instead of
   the video"; the strict law closes the last cycling class.
2. **THE PARALLEL EMBED HEAD-START**
   (`EMBED_HEADSTART_MS = 1500`): when the native lane is armed but
   silent past the window, the embed boots **INVISIBLE in parallel**.
   Whichever lane proves playback first owns the box — the native's
   canplay/playing destroys the parallel boot on the lane flip (never
   two players), and a parallel embed that reports playback makes the
   silent native **CONCEDE** (a derived lane term — no state, no effect:
   `nativeLane` folds when `embedAlive && !nativeAlive`, the video
   unmounts in the same render). This generalizes the operator's
   measured shorts path: the browser's embed plays classes the server's
   stream cannot — the handoff now arrives 2–4s earlier on exactly that
   class. A native that DIED (error after playback included) still hands
   the box back through `!nativeLane` (the P31 fallback law intact).
3. **THE MULTI-FORMAT TICKET LOOP** (`stream-proxy.ts`): the fresh
   chain's stream attempt tries up to `MAX_STREAM_TICKETS = 3`
   distinct-itag candidates in the picker's own preference order — the
   preferred itag first (the Range-resume law), then the next-best
   nearest-360p answers. Dead answers cost one FAST request each; the
   first usable answer wins. The cached attempt stays the single pick it
   was (a cached generation's URLs are dead TOGETHER — same egress, same
   instant). The legacy /api/stream route stays byte-identical.

## The honest limits (unchanged from P28/P31)

- The walled music/VEVO class cannot play from the server side on any
  measured egress; the parallel embed covers the operator's browser when
  their embeds play (the measured shorts path), else the static
  thumbnail + the pill — never a cycling slideshow, at any instant, on
  any lane.

## Gates

1965/0 (base 1959 + 6: the P32 battery +4 — the strict-law pin, the
parallel head-start pin, the concession pin, the native-wins-the-race
pin, plus the reduced-motion design-lane cycling pin folded into the
existing device-policy test; the stream-mode battery +2 — the
multi-format ticket loop and its bounded-502 law); the two P31
companion pins re-pointed at the strict law; lint 0e/1 pre-existing;
tsc clean.

## Live verification (dev ladder :3105)

- The golden path (dQw4, the healthy class): phase "native", src
  `?itag=243&stream=1`, PLAYING (currentTime 13.2 → 16.3 live), the
  timeline + mute chrome live, **`storyboard-frame` NEVER present at any
  polled instant** — the box IS the video player, no slideshow.
- The walled class (the home feed's popular cards): static thumbnail +
  the honest pill from the first second — `frames: false` at every
  poll, never a cycling sequence.
- The shorts tiles: the embed lane boots a real iframe (plays on the
  operator's residential egress; the honest floor on the sandbox's
  datacenter egress) — `frames: false` throughout.
- Zero page/console errors — evidence/wfx2p32/.
