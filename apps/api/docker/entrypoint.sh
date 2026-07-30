#!/bin/sh
# Einstiegspunkt des Server-Images. `api` spielt vorher die Migrationen ein,
# `worker` startet direkt – sonst würden beide Container gleichzeitig
# migrieren wollen.
set -eu

case "${1:-api}" in
  api)
    echo "[klappe] Migrationen werden eingespielt …"
    node apps/api/dist/db/migrate.js
    echo "[klappe] API wird gestartet …"
    exec node apps/api/dist/main.js
    ;;
  worker)
    echo "[klappe] Worker wird gestartet …"
    exec node apps/api/dist/worker.js
    ;;
  migrate)
    exec node apps/api/dist/db/migrate.js
    ;;
  *)
    exec "$@"
    ;;
esac
