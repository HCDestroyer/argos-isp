#!/bin/bash
# Restaura un respaldo de GenieACS sobre la base actual (la reemplaza colección por colección).
# Uso: docker compose exec respaldo bash /usr/local/bin/restaurar.sh genieacs-20261121T080000Z.archive.gz
set -euo pipefail
archivo="/respaldos/${1:?Indica el archivo de /respaldos a restaurar}"
[[ -f "${archivo}" ]] || { echo "No existe ${archivo}" >&2; exit 1; }
mongorestore --uri="${MONGO_URI}" --archive="${archivo}" --gzip --drop
echo "restaurado: ${archivo}. Reinicia GenieACS: docker compose restart genieacs"
