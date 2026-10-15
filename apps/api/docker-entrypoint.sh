#!/bin/sh
# Arranque del contenedor de @argosisp/api.
set -e

cd /app/build

# Con argumentos (ej. el servicio `migrate` del compose) se ejecutan en lugar del servidor.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "RUN_MIGRATIONS=true: ejecutando migraciones"
    node ace.js migration:run --force
fi

exec node bin/server.js
