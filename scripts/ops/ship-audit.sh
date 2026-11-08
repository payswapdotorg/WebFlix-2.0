#!/usr/bin/env bash
# ship-audit.sh — the P101 law made mechanical: "a fix verified in a browser
# is not a fix on origin — ship-blocked waves rot." Walks every commit sha
# the ledger references and buckets each against origin/main:
#   ROTTED        — the commit exists locally but is NOT an ancestor of
#                   origin/main (the P59G/H class: verified on a station,
#                   never pushed, production regressed)
#   OK            — on origin/main
#   NOT_IN_REPO   — not a commit object here; the ledger also cites
#                   chat/post/dataset ids and deliberately-documented dead
#                   shas, so a hit is a HINT to inspect, not a verdict.
#
# Usage: bash scripts/ops/ship-audit.sh
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LEDGER="$DIR/docs/plans/wave-claims.md"
cd "$DIR" || exit 1
git fetch origin --quiet 2>/dev/null || echo "[audit] (offline — auditing against the last fetched origin/main)"

ROTTED=0
for sha in $(grep -oE "\b[0-9a-f]{7,40}\b" "$LEDGER" | sort -u); do
  short="${sha:0:7}"
  if git cat-file -e "$sha^{commit}" 2>/dev/null; then
    if ! git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
      echo "ROTTED $short — $(git log -1 --format=%s "$sha" 2>/dev/null | head -c 100)"
      ROTTED=$((ROTTED + 1))
    fi
  fi
done

if [ "$ROTTED" = "0" ]; then
  echo "SHIP AUDIT CLEAN — every commit the ledger references that exists in this repo is on origin/main."
else
  echo "SHIP AUDIT: $ROTTED ROTTED COMMIT(S) — verified-on-a-station work that never reached origin."
  echo "THE LAW: un-regress them (cherry-pick/re-apply → push → deploy pinned sha → prod re-verify → flip the row)."
  exit 1
fi
