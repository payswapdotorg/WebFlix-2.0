# P27-HOME-TAIL — the home-tail lane (the operator's 2026-10-19 ordering directive)

Dispatched: 2026-10-19 (evening), by the resident TL station **for itself** (direct
execution — the worker channel stays idle post-P25; the lead-merges law). Base:
`a761a88` (origin/main — P26B-HPV3 merged).

## The operator's report (verbatim)

> the infinite scrolling of the long format videos should be loaded as the last
> element of the home page, not the shorts
> that creates a feeling of infinite scrolling without requiring the use to
> scroll up to see the videos loaded up

## The diagnosis (code-level, 2026-10-19)

The home feed's composition had TWO structural diseases, both legible in
`src/components/home/home-feed.tsx`:

1. **The scroll-up disease (the report's exact words)**: the growing long-form
   grid — the section infinite scroll appends pages into — rendered ABOVE the
   bottom rails (continue-watching → because-you-watched → shorts → trending).
   The sentinel sat at the true bottom, so the user reached the end of the page,
   the next page loaded… into a section ABOVE their viewport. The operator had
   to scroll UP to see the videos they just earned. That is not infinite
   scrolling; that is pagination with extra steps.
2. **The duplicate shelf**: the interleave pass (UX-PARITY-1, 2026-10-16) added
   the shorts shelf within the first rows of the grid but never removed the
   scaffold-era second shelf parked near the bottom — the SAME `data.shorts`
   rendered TWICE per page, and the bottom copy was exactly the "shorts as the
   last element" the operator is rejecting.

## The deliverables

1. **The growing grid rides LAST** (`src/components/home/home-feed.tsx`): the
   composition is now chips → first grid rows → the ONE interleaved shorts
   shelf (youtube.com's own placement, unchanged) → continue-watching →
   because-you-watched → trending → **THE GROWING GRID** (the long-form
   infinite-scroll feed, the part loadMore appends to) → the sentinel directly
   beneath it. An appended page now extends the bottom of the page itself:
   new cards render below the user's current viewport, the sentinel keeps
   chasing the bottom edge, and the feed reads as endless. The load-more
   skeletons render inside that same last grid — right where the user is
   looking.
2. **The duplicate shelf removed**: exactly ONE `ShortsShelf` renders (the
   interleaved one). A category filter still hides it exactly like youtube.com.
3. **The order battery** (`tests/home-feed-order.test.tsx`, 5 pins in the
   boot group): the section sequence pinned as one list; exactly-one-shelf;
   page two appending BELOW trending inside the last grid (first rows
   unchanged, cursor URL carried, sentinel honestly unmounting at the end);
   skeletons riding the tail grid only; and the category law (no shelf, the
   growing grid still last).

## The honest limits

- The interleaved shelf's position (after the first 8 recommended videos)
  is unchanged — this lane moves the GROWTH POINT, not the shelf.
- `SHORTS_SHELF_AFTER = 8` stays the youtube.com interleave row count.
- The rail family's own data seams (continue-watching, because-you-watched,
  trending) are untouched — this is a composition-order lane only.

## Gates (station-run at merge time)

`bun run test` = **1922/0** (boot 824 + watch 627 + liveshorts 150 + cutover
108 + auth 138 + community 34 + notifications 41 = base 1917 + 5 new in the
new order battery), `bun run lint` 0 errors / 1 pre-existing warning,
`bun run typecheck` clean, PAT scan clean.
