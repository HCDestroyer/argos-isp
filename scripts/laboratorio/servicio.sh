#!/usr/bin/env bash
# Cambia un servicio del laboratorio por la API (como lo haría el panel) y mide lo que pasa después:
# cuánto tarda el CoA o Disconnect en salir hacia el MikroTik y qué respondió (audit.red), y, si la
# sesión se cerró, cuándo vuelve a entrar y con qué IPs.
#
#   sudo scripts/laboratorio/servicio.sh <prueba> <user_ppp> <acción> [valor]
#
# Acciones:
#   suspender | reactivar | limitar | quitar-limite   cambio de estado (CoA, o Disconnect al reactivar)
#   plan <10M|20M|reuso4>                               cambio de plan (CoA de velocidad; reuso4: Disconnect)
#   ipv6 <radius_servicio|radius_pool|ninguno>          cambio de modo IPv6 (Disconnect)
#   ipv4 <a.b.c.d>                                      cambio de IPv4 fija (Disconnect)
#   desconectar                                         POST /servicios/:id/desconectar (Disconnect)
#   ver                                                 solo muestra estado, sesión y registro de aaa
#
# Guarda todo en $LAB_SALIDA/<prueba>/servicio-<user_ppp>.txt.
source "$(dirname "$0")/comun.sh"

[ $# -ge 3 ] || fallar "uso: $0 <prueba> <user_ppp> <acción> [valor]"
P="$1" USUARIO="$2" ACCION="$3" VALOR="${4:-}"
id="$(servicio_id "$USUARIO")"
[ -n "$id" ] || fallar "no existe el servicio $USUARIO"
NOMBRE="servicio-$USUARIO"

estado() {
    guardar "$P" "$NOMBRE" sql "select id, user_ppp, estado, version, ipv6_modo, plan_id from core.servicios where id = $id"
    guardar "$P" "$NOMBRE" sql "select id, host(nas_ip) nas, acct_session_id, host(ipv4) ipv4, prefijo_enlace_v6, prefijo_delegado_v6,
        inicio, fin, causa_fin from network.sesiones where servicio_id = $id order by inicio desc limit 3"
    guardar "$P" "$NOMBRE" sh -c "argosisp compose exec -T redis redis-cli GET 'aaa:user:$USUARIO' | jq -c 'del(.pass_ppp)'"
}

motivo() { jq -n --arg m "Laboratorio: $1" '{motivo: $m}'; }
version() { api GET "/servicios/$id" | jq -r .version; }

ultima_sesion="$(sql_valor "select coalesce(max(id), 0) from network.sesiones where servicio_id = $id")"
t0="$(date +%s%3N)"
case "$ACCION" in
    suspender | reactivar | limitar | quitar-limite) api POST "/servicios/$id/$ACCION" "$(motivo "$ACCION")" > /dev/null ;;
    plan)
        plan_id="$(datos ".planes.\"$VALOR\" // empty")"
        [ -n "$plan_id" ] || fallar "plan desconocido: $VALOR (10M, 20M o reuso4)"
        api PUT "/servicios/$id" "$(jq -n --argjson v "$(version)" --argjson p "$plan_id" '{version: $v, plan_id: $p}')" > /dev/null
        ;;
    ipv6) api PUT "/servicios/$id" "$(jq -n --argjson v "$(version)" --arg m "$VALOR" '{version: $v, ipv6_modo: $m}')" > /dev/null ;;
    ipv4) api PUT "/servicios/$id" "$(jq -n --argjson v "$(version)" --arg ip "$VALOR" '{version: $v, ipv4: $ip}')" > /dev/null ;;
    desconectar) api POST "/servicios/$id/desconectar" "$(motivo desconectar)" > /dev/null ;;
    ver)
        estado
        exit 0
        ;;
    *) fallar "acción desconocida: $ACCION" ;;
esac
printf '# %s · %s %s %s (API respondió a los %s ms)\n' "$(date -u +%FT%TZ)" "$USUARIO" "$ACCION" "$VALOR" \
    "$(($(date +%s%3N) - t0))" | tee -a "$(prueba_dir "$P")/$NOMBRE.txt"

# 1. CoA o Disconnect hacia el NAS (coa lo registra en audit.red con la respuesta del equipo).
desde="to_timestamp($t0 / 1000.0)"
envio=""
for _ in $(seq 1 40); do
    envio="$(sql_valor "select tipo, ok, respuesta->>'resultado', round(extract(epoch from (created_at - $desde)) * 1000)
        from audit.red where servicio_id = $id and tipo in ('coa', 'disconnect') and created_at >= $desde
        order by created_at desc limit 1")"
    [ -n "$envio" ] && break
    sleep 0.5
done
if [ -n "$envio" ]; then
    IFS='|' read -r tipo ok_ resultado ms <<< "$envio"
    printf '# %s: %s, resultado %s, a los %s ms de la llamada a la API\n' "$tipo" "$([ "$ok_" = t ] && echo ok || echo FALLÓ)" \
        "$resultado" "$ms" | tee -a "$(prueba_dir "$P")/$NOMBRE.txt"
else
    aviso "en 20 s no apareció CoA ni Disconnect en audit.red (¿sin sesión activa, o el cambio no lo pide?)"
fi
guardar "$P" "$NOMBRE" sql "select id, tipo, ok, created_at, comando, respuesta from audit.red
    where servicio_id = $id and created_at >= $desde order by created_at"

# 2. Si fue Disconnect, esperar a que el CPE vuelva a entrar (sesión nueva) y medir cuánto tardó.
if [ "${tipo:-}" = disconnect ]; then
    nueva=""
    for _ in $(seq 1 60); do
        nueva="$(sql_valor "select round(extract(epoch from (inicio - $desde))), host(ipv4), prefijo_enlace_v6, prefijo_delegado_v6
            from network.sesiones where servicio_id = $id and id > $ultima_sesion and fin is null order by id desc limit 1")"
        [ -n "$nueva" ] && break
        sleep 2
    done
    if [ -n "$nueva" ]; then
        printf '# reconectó a los %s s: %s\n' "${nueva%%|*}" "$nueva" | tee -a "$(prueba_dir "$P")/$NOMBRE.txt"
    else
        aviso "el CPE no reconectó en 2 min"
    fi
fi
estado
