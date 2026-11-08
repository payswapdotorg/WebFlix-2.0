# Ops scripts — the post-reset discipline

Two commands carry the whole "the sandbox died again" workflow:

1. `bash scripts/ops/station-rebuild.sh` — rebuild + prove the station:
   vault shape check (names only, values are the operator's), repo
   restore (preserving the `upload` mount), deps + local sqlite, dev
   server boot, then the three gates (tsc / eslint / FULL battery).
   Idempotent — an intact repo and a busy :3000 are detected and skipped.
   Flags: `--gates-only`, `--skip-gates`.
2. `bash scripts/ops/ship-audit.sh` — the P101 rot-law mechanical: every commit the ledger references must be an ancestor of origin/main (exit 1 = the P59G/H class — un-regress before anything else).
3. `bash scripts/ops/prod-probe.sh` — the standing production battery:
   routes ×6, the G20 garbage-handle 400, the live lane's honest DTOs.
   Override the target with `WEBFLIX_PROD_URL`.

After all: record the reset in `docs/plans/wave-claims.md` + `WORKLOG.md`
(the reset number, what was rebuilt, the gate numbers). The vault itself
(`/home/z/.secrets/webflix.env`, 0600) is seeded BY HAND from the
operator's message — this script verifies, it never stores.
