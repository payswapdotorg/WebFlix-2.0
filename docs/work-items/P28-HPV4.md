# P28-HPV4 — the host-ladder + youtube.com-floor lane (the operator's third slideshow re-file)

Dispatched: 2026-10-19 (night), by the resident TL station **for itself** (direct
execution — the worker channel stays idle post-P25; the lead-merges law). Base:
`ddebfa1` (origin/main — P27-HOME-TAIL merged).

## The operator's report (verbatim)

> the slideshow bug is still not solved, some previews are playing correctly
> whereas some others are still showing slideshows
>
> check how youtube.com does it
>
> this previous webflix implementation (https://webflix-steel.vercel.app)
> also does the preview better than the current one

## The fresh measurements (all live, 2026-10-19 — the stale-brief law)

1. **webflix-steel measured live** (the operator-endorsed implementation):
   its hover preview boots `youtube-nocookie.com/embed/ID?enablejsapi=1&autoplay=1&mute=1`
   — the privacy-enhanced embed domain, minimal vars, its own overlay chrome.
   From the sandbox egress its preview shows the bot wall on a short — steel has
   no wall bypass; its previews play for the operator because its catalog
   (lofi/live/ambient) avoids the walled class, not because its embed is smarter.
2. **The 4-shape embed matrix** (walled Despacito vs control dQw4, from the
   datacenter): EVERY shape plays the healthy class (youtube.com+origin,
   nocookie+jsapi+controls, nocookie bare, youtube.com bare — one flaky outlier:
   nocookie+jsapi minimal with NO origin autoplayed unreliably); EVERY shape is
   bot-walled on Despacito. **The wall is per-VIDEO protection class
   (music/VEVO), domain-insensitive from a datacenter.** The operator's browser
   is the one degree of freedom the sandbox cannot measure — steel's endorsed
   nocookie shape goes first.
3. **youtube.com itself measured live** ("check how youtube.com does it"):
   signed-out from the datacenter, youtube.com shows NO hover preview at all on
   search results — **it plays real video or shows nothing, never a cycling
   slideshow on a dead floor.** That is the floor law.
4. **The fuel routes re-verified dead for the walled class**: the production
   playback route answers 0 formats / 2 storyboards (source watch-page) for
   Despacito vs 22 formats for dQw4; client-side innertube is hard-CORS-blocked
   (both youtubei hosts, re-verified); the embed-page shell scrape carries no
   player response. The wall stands (13 clients + watch page + broker, the
   ledgered honest block).

## The deliverables

1. **THE HOST LADDER** (`video-hover-preview.tsx`): the embed lane boots
   NOCOOKIE-FIRST (`host: "https://www.youtube-nocookie.com"` — steel's
   endorsed domain) with the minimal var bundle (autoplay/mute/controls=0/
   playsinline; the old noisy bundle rel/modestbranding/iv_load_policy/fs/
   disablekb retired). A dead first boot RETRIES ONCE on the youtube.com host
   with the tightened `EMBED_RETRY_NO_READY_MS` window (the machinery is warm;
   a healthy retry reports ready fast). A host-walled-for-the-operator video
   gets SAVED by the retry; a truly-walled video costs one extra boot before
   the honest floor. One death, one destroy (the giveUp closure-handle null —
   the attempt-bump cleanup must not double-destroy).
2. **THE YOUTUBE.COM FLOOR**: when the walled floor settles (both playing
   lanes dead + fetch settled), the storyboard CLOCK STOPS and the frame layer
   UNMOUNTS — the card's own static thumbnail shows through under the honest
   pill. Never a cycling slideshow on a known-dead floor. The storyboard
   animates only while it has a real job: the loading companion under booting
   lanes, and the reduced-motion design lane (untouched).

## The honest limits

- The walled class (music/VEVO protection class) still cannot PLAY from a
  signed-out consumer + datacenter server: every embed shape is bot-walled,
  every server fuel route is LOGIN_REQUIRED. The retry covers the
  operator-browser host-sensitivity case (unmeasurable from here); the floor
  is youtube.com's own honest degrade (static thumbnail + the pill).
- SABR/PO-token attestation remains the ledgered rung-3 honest block.

## Gates (station-run at merge time)

`bun run test` = **1922/0** (boot 824 + watch 627 + liveshorts 150 + cutover
108 + auth 138 + community 34 + notifications 41 — the hover battery's 40 pins
re-pointed at the two-boot ladder: 3 replaced outright, every settled-floor
assertion re-pinned to frames-GONE + pill-present), `bun run lint` 0 errors /
1 pre-existing warning, `bun run typecheck` clean, PAT scan clean.

## Live verification (the dev ladder, :3105)

- The healthy lane: hovering dQw4 → the nocookie boot (`youtube-nocookie.com/
  embed/dQw4w9WgXcQ?autoplay=1&mute=1&controls=0&playsinline=1&enablejsapi=1…`)
  → onReady +700ms → PLAYING +1.4s → phase "embed" with the chrome, no pill
  (evidence/wfx2p28/hover-nocookie-playing.png).
- The two-boot ladder on an embed-erroring feed video: boot 1 nocookie →
  onError → boot 2 youtube.com → onError → the settled floor: phase degraded,
  pill TRUE, storyboard frame GONE, layer iframes 0, the card's static
  thumbnail showing through (evidence/wfx2p28/hover-settled-floor-pill.png).
- The boot order read live via an instrumented YT.Player:
  `[nocookie, youtube.com]` — the ladder fires in order.
