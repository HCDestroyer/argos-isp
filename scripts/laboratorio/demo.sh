#!/usr/bin/env bash
# Carga los datos de demostración (scripts/demo/datos.mjs, `pnpm demo:datos`) en la instalación de
# este servidor, por la API y sin instalar Node: corre en un contenedor node de un solo uso.
# Son para mirar el panel; no tocan el router del laboratorio (sus routers tienen NAS-IP de ejemplo).
#
#   sudo scripts/laboratorio/demo.sh
source "$(dirname "$0")/comun.sh"

IMAGEN_NODE="${LAB_CARGA_NODE:-node:22.23.3-alpine}"
CA_ARGS=()
[ -f "$LAB_DIR/caddy-ca.crt" ] && CA_ARGS=(-v "$LAB_DIR/caddy-ca.crt:/ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/ca.crt)
# La clave va por el entorno, no en la línea de comando (guardar la escribe en el archivo).
export DEMO_PASSWORD="$LAB_PASSWORD"
guardar 01-datos demo docker run --rm --network host --add-host "$DOMINIO_API:127.0.0.1" \
    -v "$LAB_REPO/scripts/demo:/demo:ro" "${CA_ARGS[@]}" \
    -e "API_URL=https://$DOMINIO_API" -e "DEMO_EMAIL=$LAB_EMAIL" -e DEMO_PASSWORD \
    "$IMAGEN_NODE" node /demo/datos.mjs
