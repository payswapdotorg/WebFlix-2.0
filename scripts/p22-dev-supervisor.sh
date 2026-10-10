#!/bin/bash
# P22-C dev server supervisor — keeps `next dev` alive across tool invocations.
cd /home/z/webflix-2.0
export DATABASE_URL=file:../db/webflix2.db
while true; do
  date -u +%FT%TZ >> /tmp/dev-heartbeat.log
  bunx next dev -p 3000 >> /tmp/dev-server.log 2>&1
  echo "SERVER EXITED rc=$? — restarting in 2s" >> /tmp/dev-heartbeat.log
  sleep 2
done
