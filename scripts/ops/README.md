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
4. `python3 scripts/ops/mobile-375-walk.py` — the mobile 375px overflow
   walk (P103-mini-5; needs the venv Playwright at /home/z/.venv with
   its cached Chromium). Walks `/`, `/tiktok/lives`,
   `/tiktok/lofigirl/live` at 375px, MEASURES horizontal overflow
   (the law: 0px), and WAITS for the honest degraded states (the
   prod probing→error cadence can land past T+30s — an endless
   spinner that never degrades is the bug class this catches).
   Override the target with `WEBFLIX_BASE_URL`. Exit 1 = any overflow,
   page error, or missing honest state.

After all: record the reset in `docs/plans/wave-claims.md` + `WORKLOG.md`
(the reset number, what was rebuilt, the gate numbers). The vault itself
(`/home/z/.secrets/webflix.env`, 0600) is seeded BY HAND from the
operator's message — this script verifies, it never stores.
