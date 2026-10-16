#!/usr/bin/env bash
# Prueba que el proxy (infra/proxy/Caddyfile) pasa el cuerpo del webhook de la pasarela sin tocarlo:
# levanta Caddy con la configuración real y una "API" de eco que verifica la firma HMAC sobre el
# cuerpo crudo, manda webhooks firmados por HTTPS (JSON con espacios y acentos, formulario, gzip,
# 200 KB y una firma alterada) y compara bytes. Proyecto aparte (argosisp-prueba-proxy); lo borra
# al terminar.
#
#   infra/proxy/probar-webhook.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
dc() { docker compose -p argosisp-prueba-proxy -f "$DIR/prueba/docker-compose.yml" "$@"; }

limpiar() { dc --profile cliente down -v --remove-orphans >/dev/null 2>&1 || true; }
trap limpiar EXIT
limpiar

dc up -d --wait --quiet-pull api web proxy >/dev/null
if ! dc --profile cliente run --rm cliente; then
    echo "--- proxy" >&2
    dc logs --no-color --tail 40 proxy >&2 || true
    exit 1
fi
echo "OK: el proxy pasa el cuerpo crudo del webhook y la firma HMAC sigue siendo válida."
