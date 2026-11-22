#!/bin/bash
# Respaldo diario de la base de GenieACS (MongoDB) con mongodump comprimido, una vez al día a la hora
# RESPALDO_HORA_UTC, y borra los de más de RESPALDO_DIAS días. Corre en el servicio `respaldo`.
# Respaldo inmediato: docker compose exec respaldo bash /usr/local/bin/respaldar.sh --ahora
set -euo pipefail

respaldar() {
    local archivo="/respaldos/genieacs-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
    mongodump --uri="${MONGO_URI}" --archive="${archivo}.parcial" --gzip --quiet
    mv "${archivo}.parcial" "${archivo}"
    find /respaldos -name 'genieacs-*.archive.gz' -mtime "+${RESPALDO_DIAS}" -delete
    echo "respaldo listo: ${archivo} ($(du -h "${archivo}" | cut -f1))"
}

if [[ "${1:-}" == "--ahora" ]]; then
    respaldar
    exit 0
fi

while true; do
    ahora=$(date -u +%s)
    siguiente=$(date -u -d "today ${RESPALDO_HORA_UTC}:00" +%s)
    if (( siguiente <= ahora )); then siguiente=$(date -u -d "tomorrow ${RESPALDO_HORA_UTC}:00" +%s); fi
    sleep $(( siguiente - ahora ))
    respaldar || echo "ERROR: falló el respaldo de GenieACS" >&2
done
