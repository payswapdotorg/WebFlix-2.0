# Ops scripts — the post-reset discipline

Two commands carry the whole "the sandbox died again" workflow:

1. `bash scripts/ops/station-rebuild.sh` — rebuild + prove the station:
   vault shape check (names only, values are the operator's), repo
   restore (preserving the `upload` mount), deps + local sqlite (with
   the demo-identity seed — db push alone leaves a userless db and
   every page's /api/me 500s; the seed runs ONLY when `@you` is
   missing so a populated station is never wiped), dev server boot,
   then the three gates (tsc / eslint / FULL battery).
   Idempotent — an intact repo and a busy :3000 are detected and skipped.
   Flags: `--gates-only`, `--skip-gates`.
2. `bash scripts/ops/ship-audit.sh` — the P101 rot-law mechanical: every commit the ledger references must be an ancestor of origin/main (exit 1 = the P59G/H class — un-regress before anything else).
3. `bash scripts/ops/prod-probe.sh` — the standing production battery:
   routes ×6, the G20 garbage-handle 400, the live lane's honest DTOs.
   Override the target with `WEBFLIX_PROD_URL`.
4. `python3 scripts/ops/mobile-375-walk.py` — the browser walk (P103-mini-5/6;
   needs the venv Playwright at /home/z/.venv with its cached Chromium).
   Walks `/`, `/tiktok/lives`, `/tiktok/lofigirl/live`, MEASURES horizontal
   overflow (the law: 0px), WAITS for the honest degraded states (the prod
   probing→error cadence can land past T+30s — an endless spinner that
   never degrades is the caught class), and enforces the P103-mini-6
   FAILURE LAW: origin 404/5xx = FAIL (the bare-/channel and the unseeded
   /api/me classes, caught mechanically), designed live-lane 5xx and
   external CDN gaps = recorded noise. `WALK_VIEWPORT=1440x900` runs the
   desktop lane (the mobile law stays the default). `--selftest` pins the
   classifier. Target override: `WEBFLIX_BASE_URL`. Exit 1 = any law broken.
5. `bash scripts/ops/prod-probe.sh [--browser]` — `--browser` appends the
   walk against prod (SKIP, not FAIL, when the venv is absent).

After all: record the reset in `docs/plans/wave-claims.md` + `WORKLOG.md`
(the reset number, what was rebuilt, the gate numbers). The vault itself
(`/home/z/.secrets/webflix.env`, 0600) is seeded BY HAND from the
operator's message — this script verifies, it never stores.
