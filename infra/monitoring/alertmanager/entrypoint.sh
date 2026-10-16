#!/bin/sh
# Arranque del servicio alertmanager (perfil monitoreo). Alertmanager no expande variables de
# entorno en su configuración: aquí se escribe el token del bot en un archivo y se arma
# /tmp/alertmanager.yml desde la plantilla montada en /etc/alertmanager/alertmanager.yml.
#
#   TELEGRAM_BOT_TOKEN    token del bot (el mismo de notify)
#   TELEGRAM_CHAT_EQUIPO  chat del equipo (número; los grupos son negativos, -100...)
#   TELEGRAM_API_ROOT     raíz de la Bot API (por defecto https://api.telegram.org; pruebas: el falso)
#
# Sin token o sin chat, Alertmanager arranca igual con un receptor vacío (las alertas se ven en su
# interfaz y en /alerts de Prometheus, pero no llegan a nadie) y lo dice en el log.
# Una sola instancia: sin cluster (--cluster.listen-address vacío), arranca sin esperar el gossip.
set -eu

plantilla=/etc/alertmanager/alertmanager.yml
config=/tmp/alertmanager.yml
api="${TELEGRAM_API_ROOT:-}"
[ -n "$api" ] || api=https://api.telegram.org
chat="${TELEGRAM_CHAT_EQUIPO:-}"
token="${TELEGRAM_BOT_TOKEN:-}"

if [ -n "$token" ] && [ -n "$chat" ]; then
    if ! printf '%s' "$chat" | grep -Eq '^-?[0-9]+$'; then
        echo "alertmanager: TELEGRAM_CHAT_EQUIPO debe ser el id numérico del chat (\"$chat\" no lo es)" >&2
        exit 1
    fi
    if ! printf '%s' "$api" | grep -Eq '^https?://[^[:space:]]+$'; then
        echo "alertmanager: TELEGRAM_API_ROOT no es una URL" >&2
        exit 1
    fi
    umask 077
    printf '%s' "$token" > /tmp/telegram_token
    # api sin "/" final; "|" como separador porque la URL lleva "/"
    sed -e "s|__TELEGRAM_API_URL__|${api%/}|" -e "s|__TELEGRAM_CHAT_EQUIPO__|$chat|" "$plantilla" > "$config"
else
    echo "alertmanager: sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_EQUIPO; las alertas no se envían a Telegram" >&2
    # Misma configuración con el receptor sin destinos (sin el bloque telegram_configs)
    sed '/^    telegram_configs:/,/^        message:/d' "$plantilla" > "$config"
fi

# `entrypoint.sh --verificar`: solo valida la configuración generada (CI) y sale.
if [ "${1:-}" = "--verificar" ]; then
    exec /bin/amtool check-config "$config"
fi

exec /bin/alertmanager \
    --config.file="$config" \
    --storage.path=/alertmanager \
    --web.listen-address=:9093 \
    --cluster.listen-address= \
    --data.retention="${ALERTMANAGER_RETENCION:-120h}" \
    "$@"
