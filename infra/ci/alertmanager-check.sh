#!/usr/bin/env bash
# Valida la configuración de Alertmanager (infra/monitoring/alertmanager) con `amtool check-config`
# dentro de la imagen fijada en infra/docker-compose.yml, tal como la arma su entrypoint: con
# Telegram configurado, sin Telegram (receptor vacío) y con un chat inválido (debe fallar).
# Lo usa CI; también sirve local:  infra/ci/alertmanager-check.sh
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
conf="$raiz/infra/monitoring/alertmanager"
imagen="$(grep -Eo 'quay.io/prometheus/alertmanager:v[0-9.]+' "$raiz/infra/docker-compose.yml" | head -n1)"
echo "Imagen: $imagen"

verificar() {
    docker run --rm "$@" -v "$conf:/etc/alertmanager:ro" --entrypoint /bin/sh "$imagen" \
        /etc/alertmanager/entrypoint.sh --verificar
}

echo "== con Telegram"
verificar -e TELEGRAM_BOT_TOKEN=123:ci -e TELEGRAM_CHAT_EQUIPO=-1001234567890
echo "== sin Telegram"
verificar
echo "== chat inválido (debe fallar)"
if verificar -e TELEGRAM_BOT_TOKEN=123:ci -e TELEGRAM_CHAT_EQUIPO=equipo 2>/dev/null; then
    echo "El entrypoint aceptó un chat no numérico" >&2
    exit 1
fi
echo "OK"
