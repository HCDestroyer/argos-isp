#!/usr/bin/env bash
# Junta lo que ArgosIsp vio durante una prueba: sesiones, CoA/Disconnect (audit.red), eventos de
# sesión, alertas y los logs de FreeRADIUS, aaa, coa y los workers de los últimos N minutos.
#
#   sudo scripts/laboratorio/recoger.sh <prueba> [minutos=15]
#
# Guarda en $LAB_SALIDA/<prueba>/servidor-*.txt. Córrelo al terminar cada prueba.
source "$(dirname "$0")/comun.sh"

[ $# -ge 1 ] || fallar "uso: $0 <prueba> [minutos]"
P="$1" MIN="${2:-15}"
desde="now() - interval '$MIN minutes'"
router_id="$(datos .router_id)"

guardar "$P" servidor-sesiones sql "select id, servicio_id, user_ppp, host(nas_ip) nas, acct_session_id, host(ipv4) ipv4,
    prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin, causa_fin, bytes_in, bytes_out
    from network.sesiones where router_id = $router_id and (fin is null or fin >= $desde) order by inicio"
guardar "$P" servidor-audit-red sql "select id, tipo, servicio_id, ok, created_at, comando, respuesta
    from audit.red where router_id = $router_id and created_at >= $desde order by created_at"
guardar "$P" servidor-eventos sql "select id, evento, created_at, payload from audit.outbox
    where created_at >= $desde and evento ~ '^(sesion|coa|aaa|routeros|servicio|router)\\.' order by id"
guardar "$P" servidor-acciones sql "select created_at, accion, resultado, request_id from audit.acciones
    where created_at >= $desde and accion ~ '^(sesiones|servicios|routers|routeros)\\.' order by created_at"
for s in freeradius aaa coa sesiones-worker routeros-worker aaa-vigia relay; do
    guardar "$P" "servidor-log-$s" dc logs --no-color --since "${MIN}m" "$s"
done
guardar "$P" servidor-metricas-aaa dc exec -T aaa node -e "
    fetch('http://127.0.0.1:3100/metrics', { headers: process.env.METRICS_TOKEN ? { authorization: 'Bearer ' + process.env.METRICS_TOKEN } : {} })
        .then((r) => r.text()).then((t) => console.log(t.split('\n').filter((l) => l.startsWith('argosisp_')).join('\n')))"
ok "recogido en $LAB_SALIDA/$P"
