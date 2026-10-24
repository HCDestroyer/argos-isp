#!/usr/bin/env bash
# Mide cuánto tarda un CPE en volver a tener sesión (reintento tras una caída de RADIUS).
#
#   sudo scripts/laboratorio/esperar-sesion.sh <prueba> <user_ppp> [--iniciar-freeradius] [segundos=600]
#
# Con --iniciar-freeradius arranca FreeRADIUS (detenido antes por la prueba) y cuenta desde ese
# instante. Sin él, cuenta desde ahora. Termina cuando aparece una sesión abierta nueva del usuario.
source "$(dirname "$0")/comun.sh"

[ $# -ge 2 ] || fallar "uso: $0 <prueba> <user_ppp> [--iniciar-freeradius] [segundos]"
P="$1" USUARIO="$2"
shift 2
INICIAR=0
[ "${1:-}" = --iniciar-freeradius ] && { INICIAR=1; shift; }
LIMITE="${1:-600}"
f="$(prueba_dir "$P")/reintento-$USUARIO.txt"
id="$(servicio_id "$USUARIO")"
[ -n "$id" ] || fallar "no existe el servicio $USUARIO"
ultima="$(sql_valor "select coalesce(max(id), 0) from network.sesiones where servicio_id = $id")"

if [ "$INICIAR" = 1 ]; then
    dc start freeradius > /dev/null
    printf '# %s · FreeRADIUS iniciado\n' "$(date -u +%FT%T.%3NZ)" | tee -a "$f"
fi
t0="$(date +%s)"
printf '# %s · esperando sesión nueva de %s (hasta %s s)\n' "$(date -u +%FT%TZ)" "$USUARIO" "$LIMITE" | tee -a "$f"
while [ $(($(date +%s) - t0)) -lt "$LIMITE" ]; do
    nueva="$(sql_valor "select inicio, host(ipv4), prefijo_enlace_v6, prefijo_delegado_v6 from network.sesiones
        where servicio_id = $id and id > $ultima and fin is null order by id desc limit 1")"
    if [ -n "$nueva" ]; then
        printf '# sesión nueva a los %s s: %s\n' "$(($(date +%s) - t0))" "$nueva" | tee -a "$f"
        exit 0
    fi
    sleep 1
done
printf '# sin sesión nueva en %s s\n' "$LIMITE" | tee -a "$f"
exit 1
