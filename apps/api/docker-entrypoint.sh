#!/bin/sh
# Arranque del contenedor de @argosisp/api.
set -e

cd /app/build

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "RUN_MIGRATIONS=true: ejecutando migraciones"
    node ace.js migration:run --force
fi

exec node bin/server.js
