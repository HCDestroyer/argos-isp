#!/usr/bin/env bash
# Prueba 7 · Carga de RADIUS en el hardware del laboratorio: N reconexiones PPPoE simultáneas
# dual-stack contra el FreeRADIUS y el aaa de producción de este servidor.
#
#   sudo scripts/laboratorio/carga.sh                  200 clientes, 3 repeticiones
#   sudo LAB_CARGA_CLIENTES=500 scripts/laboratorio/carga.sh
#   sudo LAB_CARGA_ETIQUETA=hilos-32 scripts/laboratorio/carga.sh   (para comparar un ajuste)
#   sudo scripts/laboratorio/carga.sh --limpiar        retira los servicios de carga al terminar
#
# Qué hace:
#   1. Crea por la API (una vez) un router simulado «Carga RADIUS (simulado)» con NAS-IP
#      LAB_CARGA_NAS_IP (192.0.2.250, de documentación: no existe en la red) y N servicios
#      lab-carga-NNNN con IPv4, /64 y /56. No toca el MikroTik ni los servicios reales.
#   2. Corre el generador del repo (services/aaa/carga, el mismo de `pnpm aaa:carga`) en un
#      contenedor node que comparte la red del contenedor freeradius: le habla por 127.0.0.1 con el
#      cliente `localhost` (RADIUS_LOCAL_SECRET). Mide FreeRADIUS + aaa + Redis/API de este
#      servidor, sin la red ni el MikroTik.
#   3. Por cliente: Stop de la sesión anterior → Access-Request CHAP → Start con IPv4 y /64.
#      Rondas: arranque (Redis sin las claves de carga), y LAB_CARGA_REPETICIONES pares de
#      «Redis vacío» (todo por la API) y «caché caliente» (operación normal).
#   4. Criterio del PLAN: cero timeouts y rechazos, p95 (mediana de las repeticiones) < 100 ms con
#      caché caliente. Con Redis vacío se informa y se exige < 400 ms.
#
# Resultado en $LAB_SALIDA/07-carga/<etiqueta>/: resumen.md, rondas.json, métricas y estado.
source "$(dirname "$0")/comun.sh"

N="${LAB_CARGA_CLIENTES:-200}"
R="${LAB_CARGA_REPETICIONES:-3}"
NAS="${LAB_CARGA_NAS_IP:-192.0.2.250}"
ETIQUETA="${LAB_CARGA_ETIQUETA:-base}"
IMAGEN_NODE="${LAB_CARGA_NODE:-node:22.23.3-alpine}"
ROUTER_NOMBRE="Carga RADIUS (simulado)"
P="07-carga/$ETIQUETA"
D="$(prueba_dir "$P")"
GENERADOR="$LAB_REPO/services/aaa/carga"
[ -f "$GENERADOR/cli.ts" ] || fallar "no encuentro $GENERADOR/cli.ts (clona el repositorio completo)"

router_id="$(api GET '/routers?limit=200' | jq -r --arg n "$ROUTER_NOMBRE" '.data[] | select(.nombre == $n) | .id')"

if [ "${1:-}" = --limpiar ]; then
    [ -n "$router_id" ] || fallar "no hay router de carga"
    abiertas="$(sql_valor "select count(*) from network.sesiones where router_id = $router_id and fin is null")"
    [ "$abiertas" = 0 ] || fallar "quedan $abiertas sesiones de carga abiertas; el cron las cierra en 15 min (sin_interim). Vuelve a correr después (si se retiran con sesión, coa intenta Disconnect a $NAS)"
    for id in $(sql_valor "select id from core.servicios where router_id = $router_id and estado <> 'retirado'"); do
        api POST "/servicios/$id/retirar" '{"motivo":"Laboratorio: fin de la prueba de carga"}' > /dev/null
    done
    ok "servicios de carga retirados"
    exit 0
fi

# --- 1. Datos de carga (idempotente) ---
if [ -z "$router_id" ]; then
    router_id="$(api POST /routers "$(jq -n --arg n "$ROUTER_NOMBRE" --arg nas "$NAS" \
        '{nombre: $n, host: $nas, nas_ip: $nas, modo_seguridad: "radius", radius_secret: "no-se-usa-carga", control_velocidad: "simple"}')" | jq -r .id)"
    ok "router de carga creado (id $router_id, NAS $NAS)"
fi
redes="$(api GET "/routers/$router_id/redes-ipv4")"
for k in $(seq 0 $(((N - 1) / 250))); do
    cidr="10.99.$k.0/24"
    jq -e --arg c "$cidr" 'any(.[]; .cidr == $c)' <<< "$redes" > /dev/null ||
        api POST "/routers/$router_id/redes-ipv4" "$(jq -n --arg c "$cidr" '{cidr: $c, tipo: "estatico"}')" > /dev/null
done
bloque="$(api GET "/routers/$router_id/ipv6-bloques" | jq -r '.[0].id // empty')"
if [ -z "$bloque" ]; then
    bloque="$(api POST "/routers/$router_id/ipv6-bloques" '{"prefijo":"2001:db8:f000::/36"}' | jq -r .id)"
    api POST "/ipv6-bloques/$bloque/pools" '{"prefijo":"2001:db8:f000::/48","tipo":"enlace","tamano_entrega":64}' > /dev/null
    api POST "/ipv6-bloques/$bloque/pools" '{"prefijo":"2001:db8:f800::/40","tipo":"delegacion","tamano_entrega":56}' > /dev/null
fi
plan_id="$(api GET '/planes?limit=200' | jq -r '.data[] | select(.nombre == "Lab 10M") | .id')"
[ -n "$plan_id" ] || fallar "falta el plan «Lab 10M»: corre primero 01-datos.sh"
api PUT "/planes/$plan_id/routers/$router_id" '{"profile_ppp":"default"}' > /dev/null
empresa="$(api GET /empresas | jq '[.[] | select(.activa)] | min_by(.id) | .id')"
cliente="$(api GET '/clientes?q=Laboratorio%20carga&limit=5' | jq -r '.data[] | select(.nombre == "Laboratorio carga") | .id')"
[ -n "$cliente" ] || cliente="$(api POST /clientes '{"nombre":"Laboratorio carga","tipo":"persona","nit_cui":"CF","direccion_fiscal":"Ciudad de Guatemala","telefono":"5555-0001","direccion":"Laboratorio"}' | jq -r .id)"

# Contraseñas deterministas a partir de una sal local (0600): no hace falta leerlas de la API.
SAL="$LAB_DIR/carga-sal"
[ -s "$SAL" ] || (umask 077 && head -c 24 /dev/urandom | base64 > "$SAL")
clave_de() { printf '%s%s' "$(cat "$SAL")" "$1" | sha256sum | cut -c1-20; }

existentes="$(sql_valor "select count(*) from core.servicios where router_id = $router_id and user_ppp like 'lab-carga-%' and estado <> 'retirado'")"
if [ "$existentes" -lt "$N" ]; then
    log "creando $((N - existentes)) servicios de carga por la API (una sola vez)…"
    for i in $(seq 1 "$N"); do
        u="$(printf 'lab-carga-%04d' "$i")"
        [ -n "$(sql_valor "select 1 from core.servicios where user_ppp = '$u'")" ] && continue
        api POST /servicios "$(jq -n --argjson c "$cliente" --argjson e "$empresa" --argjson r "$router_id" \
            --argjson p "$plan_id" --arg u "$u" --arg k "$(clave_de "$u")" '{
                cliente_id: $c, empresa_id: $e, router_id: $r, plan_id: $p, plantilla_facturacion_id: null,
                tipo_conexion: "pppoe", user_ppp: $u, pass_ppp: $k, ipv6_modo: "radius_servicio"
            }')" > /dev/null
    done
fi

# --- 2. Usuarios para el generador (IPv4, /64 y /56 asignados por el IPAM) ---
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sql_valor "select s.user_ppp,
        (select host(ip) from network.ipv4_asignaciones a where a.servicio_id = s.id and a.fin is null),
        (select prefijo::text from network.ipv6_asignaciones a where a.servicio_id = s.id and a.fin is null and tipo = 'enlace'),
        (select prefijo::text from network.ipv6_asignaciones a where a.servicio_id = s.id and a.fin is null and tipo = 'delegacion')
    from core.servicios s where s.router_id = $router_id and s.user_ppp like 'lab-carga-%' and s.estado = 'activo'
    order by s.user_ppp limit $N" |
    while IFS='|' read -r u ip enlace delegado; do
        jq -nc --arg u "$u" --arg k "$(clave_de "$u")" --arg ip "$ip" --arg e "$enlace" --arg d "$delegado" \
            '{user: $u, clave: $k, ipv4: $ip, enlace: $e, delegado: $d}'
    done | jq -s . > "$TMP/usuarios.json"
[ "$(jq length "$TMP/usuarios.json")" = "$N" ] || fallar "hay $(jq length "$TMP/usuarios.json") servicios de carga listos, se esperaban $N"
docker image inspect "$IMAGEN_NODE" > /dev/null 2>&1 || docker pull -q "$IMAGEN_NODE" > /dev/null
FR="$(dc ps -q freeradius)"
[ -n "$FR" ] || fallar "freeradius no está corriendo"

vaciar_cache() {
    dc exec -T redis sh -c "redis-cli --scan --pattern 'aaa:user:lab-carga-*' | xargs -r redis-cli DEL > /dev/null"
}
ANTERIORES='{}'
ronda() { # <nombre> <tipo>
    [ "$2" = caliente ] || vaciar_cache
    jq -n --arg s "$RADIUS_LOCAL_SECRET" --arg nas "$NAS" --argjson ant "$ANTERIORES" --slurpfile us "$TMP/usuarios.json" '{
        host: "127.0.0.1", puertoAuth: 1812, puertoAcct: 1813, secret: $s, nasIp: $nas, timeoutMs: 1000,
        usuarios: [$us[0][] | . + (if $ant[.user] then {sesionAnterior: $ant[.user]} else {} end)]
    }' > "$TMP/opciones.json"
    docker run --rm --network "container:$FR" -v "$GENERADOR:/carga:ro" -v "$TMP:/datos:ro" \
        "$IMAGEN_NODE" node /carga/cli.ts /datos/opciones.json > "$TMP/r.json" ||
        fallar "el generador falló en la ronda $1"
    ANTERIORES="$(jq -c .sesiones "$TMP/r.json")"
    jq -c --arg n "$1" --arg t "$2" '{nombre: $n, tipo: $t} + (del(.sesiones))' "$TMP/r.json" >> "$TMP/rondas.jsonl"
    jq -r --arg n "$1" '"\($n): accept \(.accept), reject \(.reject), timeouts \(.timeoutsAuth), p50 \(.latenciaMs.p50) ms, p95 \(.latenciaMs.p95) ms, p99 \(.latenciaMs.p99) ms"' "$TMP/r.json" >&2
    sleep 5 # el worker de sesiones termina de escribir antes de la siguiente ronda
}

# --- 3. Rondas ---
guardar "$P" antes sh -c "uptime; free -m; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'"
log "carga: $N clientes, $R repeticiones, NAS $NAS, etiqueta $ETIQUETA"
ronda "Arranque, Redis sin claves (respaldo API)" arranque
for i in $(seq 1 "$R"); do
    ronda "Reconexión $i, Redis vacío (respaldo API)" fria
    ronda "Reconexión $i, caché caliente" caliente
done
guardar "$P" despues sh -c "uptime; free -m; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'"
jq -s . "$TMP/rondas.jsonl" > "$D/rondas.json"

# --- 4. Resumen y criterio ---
mediana='sort | if length == 0 then null elif length % 2 == 1 then .[length / 2 | floor] else (.[length / 2 - 1] + .[length / 2]) / 2 end'
p95c="$(jq "[.[] | select(.tipo == \"caliente\") | .latenciaMs.p95] | $mediana" "$D/rondas.json")"
p95f="$(jq "[.[] | select(.tipo == \"fria\") | .latenciaMs.p95] | $mediana" "$D/rondas.json")"
fallos="$(jq '[.[] | .timeoutsAuth + .reject + (.clientes - .accept) + .sinDualStack + .acct.timeouts] | add' "$D/rondas.json")"
veredicto=CUMPLE
[ "$fallos" = 0 ] || veredicto="NO CUMPLE ($fallos fallos)"
jq -e --argjson a "$p95c" --argjson b "$p95f" -n '$a < 100 and $b < 400' > /dev/null || veredicto="NO CUMPLE (p95)"
{
    printf '# Carga RADIUS · %s · %s\n\n' "$ETIQUETA" "$(date -u +%FT%TZ)"
    printf '%s clientes, %s repeticiones, ArgosIsp %s, %s CPU, loadavg %s\n\n' "$N" "$R" "$(env_de ARGOSISP_VERSION)" \
        "$(nproc)" "$(cut -d' ' -f1-3 /proc/loadavg)"
    echo '| Ronda | Accept | Reject | Timeouts | p50 ms | p95 ms | p99 ms | máx ms | Start/Stop | Acct sin resp. | Duración ms |'
    echo '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    jq -r '.[] | "| \(.nombre) | \(.accept) | \(.reject) | \(.timeoutsAuth) | \(.latenciaMs.p50) | \(.latenciaMs.p95) | \(.latenciaMs.p99) | \(.latenciaMs.max) | \(.acct.start)/\(.acct.stop) | \(.acct.timeouts) | \(.duracionMs) |"' "$D/rondas.json"
    printf '\np95 (mediana) con caché caliente: **%s ms** (criterio < 100)\n' "$p95c"
    printf 'p95 (mediana) con Redis vacío: **%s ms** (se exige < 400)\n\n' "$p95f"
    printf 'Veredicto: **%s**\n' "$veredicto"
} | tee "$D/resumen.md"
guardar "$P" metricas-aaa dc exec -T aaa node -e "
    fetch('http://127.0.0.1:3100/metrics', { headers: process.env.METRICS_TOKEN ? { authorization: 'Bearer ' + process.env.METRICS_TOKEN } : {} })
        .then((r) => r.text()).then((t) => console.log(t.split('\n').filter((l) => /^argosisp_aaa_(autoriz|accounting|redis)/.test(l)).join('\n')))"
guardar "$P" log-aaa-errores sh -c "argosisp compose logs --no-color --since 15m aaa | grep -E '\"level\":(40|50)' | tail -50"
guardar "$P" sesiones-carga sql "select count(*) filter (where fin is null) abiertas, count(*) filter (where fin is not null) cerradas from network.sesiones where router_id = $router_id"
[ "$veredicto" = CUMPLE ] && ok "carga: $veredicto" || aviso "carga: $veredicto (ver la guía, «Si no cumple»)"
