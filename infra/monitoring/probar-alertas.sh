#!/usr/bin/env bash
# Prueba de punta a punta de las alertas de infraestructura (criterio de la semana 3: una alerta
# de prueba llega al chat del equipo en menos de un minuto). Sin internet ni bot real:
#
#   1. Prometheus (prometheus.yml real, regla AlertaDePrueba que siempre dispara) → Alertmanager
#      (configuración real) → Bot API de Telegram simulada. Mide desde que Prometheus está listo
#      hasta que el mensaje llega.
#   2. Alerta manual con amtool (el comando del runbook para probar en producción) → Telegram.
#
# Usa un proyecto de compose aparte (argosisp-prueba-alertas) y lo borra al terminar.
#
#   infra/monitoring/probar-alertas.sh            # límite 60 s por alerta
#   LIMITE_S=90 infra/monitoring/probar-alertas.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LIMITE_S="${LIMITE_S:-60}"
dc() { docker compose -p argosisp-prueba-alertas -f "$DIR/prueba/docker-compose.yml" "$@"; }

limpiar() { dc down -v --remove-orphans >/dev/null 2>&1 || true; }
trap limpiar EXIT
limpiar

mensajes() { dc exec -T telegram-falso wget -qO- http://127.0.0.1:8080/mensajes; }

# Espera un mensaje que contenga $1; imprime los segundos que tardó desde $2 (epoch en ms).
esperar_mensaje() {
    local patron="$1" desde="$2" ahora
    while :; do
        ahora=$(date +%s%3N)
        if mensajes | grep -q "$patron"; then
            echo $(((ahora - desde) / 1000))
            return 0
        fi
        if (((ahora - desde) / 1000 > LIMITE_S)); then
            return 1
        fi
        sleep 1
    done
}

fallar() {
    echo "FALLA: $1" >&2
    echo "--- alertmanager" >&2
    dc logs --no-color --tail 40 alertmanager >&2 || true
    echo "--- telegram-falso" >&2
    dc logs --no-color --tail 20 telegram-falso >&2 || true
    exit 1
}

echo "Levantando telegram-falso, alertmanager y prometheus (proyecto argosisp-prueba-alertas)..."
inicio_total=$(date +%s%3N)
dc up -d --wait --quiet-pull >/dev/null
listo=$(date +%s%3N)
echo "Listos en $(((listo - inicio_total) / 1000)) s."

# 1. Prometheus → Alertmanager → Telegram
if ! s1=$(esperar_mensaje 'AlertaDePrueba' "$listo"); then
    fallar "AlertaDePrueba no llegó a Telegram en ${LIMITE_S} s"
fi
echo "1. Prometheus → Alertmanager → Telegram: AlertaDePrueba llegó en ${s1} s (límite ${LIMITE_S} s)."

# El mensaje va al chat y con el token configurados, en HTML válido (el falso rechaza HTML roto)
recibido=$(mensajes)
echo "$recibido" | grep -q '"chat_id":"-1001234567890"' || fallar "el mensaje no fue al chat del equipo"
echo "$recibido" | grep -q '"token":"123456:token-de-prueba"' || fallar "el mensaje no usó el token del bot"
echo "$recibido" | grep -q '&lt; 1 min &amp; sin romper' || fallar "la plantilla no escapó < y & del resumen"

# 2. Alerta manual (runbook): amtool dentro del contenedor de Alertmanager
antes=$(date +%s%3N)
dc exec -T alertmanager amtool alert add AlertaManual severity=prueba \
    --annotation=summary='Prueba manual con amtool' --alertmanager.url=http://127.0.0.1:9093 >/dev/null
if ! s2=$(esperar_mensaje 'AlertaManual' "$antes"); then
    fallar "AlertaManual (amtool) no llegó a Telegram en ${LIMITE_S} s"
fi
echo "2. amtool → Alertmanager → Telegram: AlertaManual llegó en ${s2} s (límite ${LIMITE_S} s)."

echo
echo "Mensajes recibidos por el Telegram simulado:"
mensajes | sed 's/},{/},\n{/g'
echo
echo "OK: las alertas llegan al chat del equipo en menos de ${LIMITE_S} s. Total $((($(date +%s%3N) - inicio_total) / 1000)) s."
