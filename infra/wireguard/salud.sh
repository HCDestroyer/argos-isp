#!/usr/bin/env bash
# Healthcheck de la imagen argosisp/wireguard:
#   salud.sh servidor   la interfaz existe y los handshakes se publicaron hace poco
#   salud.sh agente     el bucle de eventos leyó Redis hace menos de 2 min (la API puede faltar:
#                       `argosisp estado` avisa si /estado/api.ok no es reciente)
set -euo pipefail
ESTADO_DIR="${WG_ESTADO_DIR:-/estado}"
edad() { echo $(($(date +%s) - $(stat -c %Y "$1" 2> /dev/null || echo 0))); }

case "${1:-}" in
    servidor)
        wg show "${ARGOSISP_WG_INTERFAZ:-wg-argos}" listen-port > /dev/null
        [ "$(edad "$ESTADO_DIR/handshakes.tsv")" -lt $((3 * ${ARGOSISP_WG_HANDSHAKES_CADA_S:-30} + 10)) ]
        ;;
    agente)
        [ -s "$ESTADO_DIR/agente.ok" ]
        [ $(($(date +%s) - $(cat "$ESTADO_DIR/agente.ok"))) -lt 120 ]
        ;;
    *)
        echo "uso: salud.sh servidor|agente" >&2
        exit 2
        ;;
esac
