#!/usr/bin/env bash
# Valida la configuración de FreeRADIUS del repo (services/aaa/freeradius) con `radiusd -XC`
# dentro de la imagen oficial fijada en infra/docker-compose.yml. Lo usa CI; también sirve local:
#   infra/ci/freeradius-check.sh
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
conf="$raiz/services/aaa/freeradius"
imagen="$(grep -Eo 'freeradius/freeradius-server:[0-9.]+' "$raiz/infra/docker-compose.yml" | head -n1)"

echo "Imagen: $imagen"
docker run --rm \
    -e AAA_URL=http://aaa:3100 \
    -e RADIUS_LOCAL_SECRET=ci-solo-validacion-local \
    -e RADIUS_LAB_NAS_IP=192.0.2.1 \
    -e RADIUS_LAB_SECRET=ci-solo-validacion-lab \
    -v "$conf/mods-enabled:/etc/freeradius/mods-enabled:ro" \
    -v "$conf/sites-enabled:/etc/freeradius/sites-enabled:ro" \
    -v "$conf/clients.conf:/etc/freeradius/clients.conf:ro" \
    -v "$conf/clients.d:/etc/freeradius/clients.d:ro" \
    "$imagen" radiusd -XC >"${RUNNER_TEMP:-/tmp}/radiusd-xc.log" 2>&1 || {
    tail -n 40 "${RUNNER_TEMP:-/tmp}/radiusd-xc.log"
    exit 1
}
tail -n 1 "${RUNNER_TEMP:-/tmp}/radiusd-xc.log"
