#!/usr/bin/env bash
# watchdog3 — Tier-2 chain keeper (rearm3 + prod-sync)
while true; do
  LIGHT=1 bash /home/z/tools/rearm3.sh >>/tmp/watchdog3.log 2>&1
  sleep 120
done
