#!/bin/sh
# Proceso del servicio `backup`: un respaldo al día a BACKUP_HORA (UTC). Sigue la regla de los crons
# (procesar lo pendiente hasta ahora): si el contenedor estuvo apagado a esa hora, respalda al volver.
# Un respaldo fallido se reintenta cada BACKUP_REINTENTO_MIN minutos.
#
#   BACKUP_HORA          HH:MM en UTC (03:13 = 21:13 de Guatemala)
#   BACKUP_AL_ARRANCAR   true = un respaldo al iniciar el contenedor, aunque ya haya uno de hoy
#
# Estado en BACKUP_DIR/.estado ("ok <instante> <archivo>" o "error <instante>"): lo usa el healthcheck.
set -u

DIR="${BACKUP_DIR:-/backups}"
HORA="${BACKUP_HORA:-03:13}"
REINTENTO="${BACKUP_REINTENTO_MIN:-15}"
AQUI="$(cd "$(dirname "$0")" && pwd)"

case "$HORA" in
    [0-2][0-9]:[0-5][0-9]) ;;
    *) echo "BACKUP_HORA debe ser HH:MM (UTC): $HORA" >&2; exit 2 ;;
esac
objetivo="$(echo "$HORA" | tr -d :)"
mkdir -p "$DIR"

respaldar() {
    if "$AQUI/respaldar.sh"; then
        date -u +%F > "$DIR/.ultimo"
        echo "ok $(date -u +%Y-%m-%dT%H:%M:%SZ) $(ls -t "$DIR" | grep -m1 -E '\.dump(\.age)?$' || true)" > "$DIR/.estado"
        return 0
    fi
    echo "error $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DIR/.estado"
    return 1
}

if [ "${BACKUP_AL_ARRANCAR:-false}" = true ]; then respaldar || sleep $((REINTENTO * 60)); fi

while :; do
    hoy="$(date -u +%F)"
    ahora="$(date -u +%H%M)"
    if [ "$ahora" -ge "$objetivo" ] && [ "$(cat "$DIR/.ultimo" 2> /dev/null)" != "$hoy" ]; then
        respaldar || { sleep $((REINTENTO * 60)); continue; }
    fi
    sleep 30
done
