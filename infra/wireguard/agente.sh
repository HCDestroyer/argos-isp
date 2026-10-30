#!/usr/bin/env bash
# ArgosIsp · agente WireGuard (servicio `wireguard-agente` del compose, red interna de compose).
#
# Puente entre la API y el servidor WireGuard (que corre en la red del host y no ve la red de
# compose):
#   1. Al arrancar y al recibir `router.conexion_registrada` / `router.conexion_rotada` /
#      `router.conexion_eliminada` / `router.eliminado` (grupo `wireguard` del stream argos:eventos)
#      pide la lista completa de peers a la API (GET internal/wireguard/peers) y escribe
#      /estado/peers/peers.conf. El servidor la aplica con `wg syncconf`, que quita o agrega solo lo
#      que cambió (los demás túneles no se cortan). Reconciliar siempre la lista completa hace que
#      un evento repetido o perdido no deje peers de más ni de menos.
#      `router.eliminado` (contratos/eliminar.md): el router ya no existe y su fila de
#      network.routers_conexion se borró con él, así que su peer no vuelve en la lista y su /32 del
#      túnel queda libre para el siguiente router (la asigna la API, no este agente).
#   2. Manda a la API la clave pública del servidor y el último handshake de cada peer
#      (POST internal/wireguard/estado) cuando cambian, como mucho cada ARGOSISP_WG_ESTADO_CADA_S.
#
# Contrato: .claude/integration/contratos/conexion-routers.md (§6). Detalle: infra/wireguard/README.md
set -Eeuo pipefail

API="${API_INTERNAL_URL:-http://api:3333/api/v1/}"
API="${API%/}"
TOKEN="${INTERNAL_TOKEN:-}"
REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PORT="${REDIS_PORT:-6379}"
STREAM="${EVENTOS_STREAM:-argos:eventos}"
GRUPO="${WG_GRUPO:-wireguard}"
CONSUMIDOR="${WG_CONSUMIDOR:-wireguard-agente}"
RED="${ARGOSISP_WG_RED:-10.255.0.0/16}"
ESTADO_DIR="${WG_ESTADO_DIR:-/estado}"
ESTADO_CADA_S="${ARGOSISP_WG_ESTADO_CADA_S:-60}"
BLOQUEO_MS="${WG_BLOQUEO_MS:-30000}"
EVENTOS_RE='^router\.(conexion_(registrada|rotada|eliminada)|eliminado)$'

log() { printf '%s wireguard-agente: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
morir() {
    log "ERROR: $*"
    exit 1
}

[ -n "$TOKEN" ] || morir "falta INTERNAL_TOKEN (AAA_INTERNAL_TOKEN en el .env)"
[[ "$RED" =~ ^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.0/([0-9]{1,2})$ ]] || morir "ARGOSISP_WG_RED='$RED' no es una red IPv4 terminada en .0"
IP_SERVIDOR="${BASH_REMATCH[1]}.1"

rcli() { redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --json "$@"; }

# Convierte a.b.c.d en un entero (para comprobar que la IP del túnel está en la red)
ip_a_entero() {
    local IFS=. a b c d
    read -r a b c d <<< "$1"
    echo $(((a << 24) + (b << 16) + (c << 8) + d))
}
RED_BASE="$(ip_a_entero "${RED%/*}")"
RED_PREFIJO="${RED#*/}"
RED_MASCARA=$(((0xFFFFFFFF << (32 - RED_PREFIJO)) & 0xFFFFFFFF))

ip_en_red() {
    [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
    [ "$1" != "$IP_SERVIDOR" ] || return 1
    local n
    n="$(ip_a_entero "$1")"
    [ $((n & RED_MASCARA)) -eq "$RED_BASE" ]
}

api_get() { curl -fsS -m 15 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' "$API/$1"; }
api_post() {
    curl -fsS -m 15 -o /dev/null -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        --data-binary @- "$API/$1"
}

# --- 1. Peers ---------------------------------------------------------------------------------------
# { data: [{ router_id, public_key, ip_tunel }] } → peers.conf. Lo inválido se descarta y se avisa
# (nunca rompe la configuración de los demás routers).
reconciliar() {
    local json tmp n=0 router clave ip
    json="$(api_get internal/wireguard/peers)" || {
        log "no pude leer los peers de la API ($API/internal/wireguard/peers)"
        return 1
    }
    mkdir -p "$ESTADO_DIR/peers"
    tmp="$(mktemp "$ESTADO_DIR/peers/.peers.XXXXXX")"
    printf '# Generado por wireguard-agente desde network.routers_conexion. No editar.\n' > "$tmp"
    while IFS=$'\t' read -r router clave ip; do
        [ -n "$router" ] || continue
        if ! [[ "$clave" =~ ^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$ ]]; then
            log "router $router: public_key inválida, se omite"
            continue
        fi
        if ! ip_en_red "$ip"; then
            log "router $router: ip_tunel '$ip' fuera de $RED, se omite"
            continue
        fi
        printf '\n# router %s\n[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n' "$router" "$clave" "$ip" >> "$tmp"
        n=$((n + 1))
    done < <(jq -r '.data // [] | unique_by(.public_key) | unique_by(.ip_tunel) | .[] |
        [(.router_id | tostring), (.public_key // ""), (.ip_tunel // "")] | @tsv' <<< "$json")
    chmod 644 "$tmp"
    if cmp -s "$tmp" "$ESTADO_DIR/peers/peers.conf"; then
        rm -f "$tmp"
    else
        mv "$tmp" "$ESTADO_DIR/peers/peers.conf"
        log "peers.conf actualizado: $n peers"
    fi
}

# --- 2. Estado (clave del servidor y handshakes) ------------------------------------------------------
ULTIMO_ESTADO=''
ULTIMO_ENVIO=0
publicar_estado() {
    [ -s "$ESTADO_DIR/servidor.json" ] || return 0
    local cuerpo huella ahora
    cuerpo="$(jq -n --slurpfile s "$ESTADO_DIR/servidor.json" --rawfile h "$ESTADO_DIR/handshakes.tsv" '
        {
            servidor: $s[0],
            peers: [$h | split("\n")[] | select(length > 0) | split("\t") | {
                public_key: .[0],
                ultimo_handshake: (if (.[1] | tonumber) > 0 then (.[1] | tonumber | todate) else null end),
                endpoint: (if .[2] == "(none)" then null else .[2] end),
                rx_bytes: (.[3] | tonumber),
                tx_bytes: (.[4] | tonumber)
            }]
        }')" || return 1
    huella="$(jq -c '{servidor, peers: [.peers[] | {public_key, ultimo_handshake, endpoint}]}' <<< "$cuerpo" | sha256sum | cut -d' ' -f1)"
    ahora="$(date +%s)"
    if [ "$huella" = "$ULTIMO_ESTADO" ] && [ $((ahora - ULTIMO_ENVIO)) -lt 600 ]; then
        return 0
    fi
    [ $((ahora - ULTIMO_ENVIO)) -ge "$ESTADO_CADA_S" ] || [ -z "$ULTIMO_ESTADO" ] || return 0
    if jq -c --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {generado_en: $t}' <<< "$cuerpo" | api_post internal/wireguard/estado; then
        ULTIMO_ESTADO="$huella"
        ULTIMO_ENVIO="$ahora"
        date -u +%s > "$ESTADO_DIR/api.ok"
    else
        log "no pude publicar el estado en la API ($API/internal/wireguard/estado)"
        return 1
    fi
}

# --- Eventos ---------------------------------------------------------------------------------------------
# Salida de XREADGROUP --json: {"<stream>": [["<id>", ["campo", "valor", ...]], ...]} o null.
# Imprime "<id>\t<evento>" por entrada.
entradas() {
    jq -r 'if type == "object" then (to_entries[0].value // [])[] |
        [.[0], (.[1] as $c | [range(0; ($c | length); 2) | {key: $c[.], value: $c[. + 1]}] | from_entries | .evento // "")] | @tsv
        else empty end'
}

crear_grupo() {
    local r
    # `$`: el grupo empieza en el presente; lo anterior lo cubre la reconciliación al arrancar
    r="$(rcli XGROUP CREATE "$STREAM" "$GRUPO" '$' MKSTREAM 2>&1 || true)"
    case "$r" in *OK* | *BUSYGROUP*) return 0 ;; *) log "XGROUP CREATE: $r"; return 1 ;; esac
}

# Lee un lote (pendientes con id 0, nuevos con >) y deja en PENDIENTE=1 si hay que reconciliar.
procesar_lote() {
    local desde="$1" bloqueo="$2" salida ids=() id evento
    salida="$(rcli XREADGROUP GROUP "$GRUPO" "$CONSUMIDOR" COUNT 200 BLOCK "$bloqueo" STREAMS "$STREAM" "$desde")" || return 1
    case "$salida" in error* | *'"error'*) log "XREADGROUP: $salida"; return 1 ;; esac
    while IFS=$'\t' read -r id evento; do
        [ -n "$id" ] || continue
        ids+=("$id")
        if [[ "$evento" =~ $EVENTOS_RE ]]; then PENDIENTE=1; fi
    done < <(entradas <<< "$salida")
    if [ "${#ids[@]}" -gt 0 ]; then
        rcli XACK "$STREAM" "$GRUPO" "${ids[@]}" > /dev/null
    fi
}

trap 'log "deteniendo"; exit 0' TERM INT

log "esperando al servidor WireGuard (/estado/servidor.json)"
until [ -s "$ESTADO_DIR/servidor.json" ]; do sleep 2; done

espera=2
until crear_grupo; do
    sleep "$espera"
    espera=$((espera < 30 ? espera * 2 : 30))
done
PENDIENTE=1
# Lo que quedó sin confirmar de una corrida anterior: se confirma (la reconciliación lo cubre)
procesar_lote 0 1 || true
log "escuchando $STREAM (grupo $GRUPO); API $API"

while true; do
    if [ "$PENDIENTE" = 1 ]; then
        if reconciliar; then PENDIENTE=0; fi
    fi
    publicar_estado || true
    if procesar_lote '>' "$BLOQUEO_MS"; then
        # Healthcheck: el bucle sigue vivo y Redis responde (la API puede tardar en arrancar)
        date -u +%s > "$ESTADO_DIR/agente.ok"
    else
        sleep 5
        crear_grupo || true
    fi
done
