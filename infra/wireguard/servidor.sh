#!/usr/bin/env bash
# ArgosIsp · servidor WireGuard (servicio `wireguard` del compose, red del host).
#
# - Crea la interfaz `wg-argos` en el HOST con la `.1` de ARGOSISP_WG_RED y escucha en
#   ARGOSISP_WG_PUERTO (UDP). La clave privada se genera una sola vez y vive en /clave (volumen
#   propio, solo este contenedor la monta).
# - Aplica los peers que escribe `wireguard-agente` en /estado/peers/peers.conf con `wg syncconf` (sin
#   reiniciar la interfaz ni cortar los túneles vivos), cada vez que el archivo cambia (inotify).
# - Publica en /estado/servidor.json su clave pública y en /estado/handshakes.tsv el último
#   handshake de cada peer; el agente los manda a la API.
# - Firewall del túnel (ARGOSISP_WG_FIREWALL=1): desde wg-argos solo entra RADIUS (1812/1813 UDP
#   a la .1, solo desde la red del túnel), el puerto del corte (PORTAL_CORTE_PUERTO TCP a la .1, desde
#   los clientes de los routers que mandan el corte por el túnel) y las respuestas de lo que el servidor
#   inició (REST, CoA); los routers no se ven entre sí ni llegan a otros puertos del host.
# - Corte por el túnel (PORTAL_CORTE_TUNEL=1, contratos/corte-identificacion.md §5 ter.5): las
#   conexiones que entran por wg-argos llevan una marca y sus respuestas vuelven por wg-argos (tabla
#   propia), sin rutas globales hacia las redes de clientes.
#
# Contrato: .claude/integration/contratos/conexion-routers.md. Detalle: infra/wireguard/README.md
set -Eeuo pipefail

IFACE="${ARGOSISP_WG_INTERFAZ:-wg-argos}"
PUERTO="${ARGOSISP_WG_PUERTO:-51820}"
RED="${ARGOSISP_WG_RED:-10.255.0.0/16}"
MTU="${ARGOSISP_WG_MTU:-1420}"
MODO="${ARGOSISP_WG_MODO:-auto}"
FIREWALL="${ARGOSISP_WG_FIREWALL:-1}"
CLAVE_DIR="${WG_CLAVE_DIR:-/clave}"
ESTADO_DIR="${WG_ESTADO_DIR:-/estado}"
HANDSHAKES_CADA_S="${ARGOSISP_WG_HANDSHAKES_CADA_S:-30}"
CORTE_TUNEL="${PORTAL_CORTE_TUNEL:-1}"
CORTE_PUERTO="${PORTAL_CORTE_PUERTO:-8088}"
# Marca de las conexiones que entran por el túnel y tabla de ruteo de sus respuestas
MARCA="${ARGOSISP_WG_MARCA:-0x4172}"
MASCARA_MARCA=0xffff
TABLA="${ARGOSISP_WG_TABLA:-4172}"

log() { printf '%s wireguard: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
morir() {
    log "ERROR: $*"
    exit 1
}

# --- Red del túnel: a.b.c.d/n con d = 0 → servidor a.b.c.1/n -----------------------------------
[[ "$RED" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]{1,2})$ ]] ||
    morir "ARGOSISP_WG_RED='$RED' no es una red IPv4 (p. ej. 10.255.0.0/16)"
for o in 1 2 3 4; do [ "${BASH_REMATCH[$o]}" -le 255 ] || morir "ARGOSISP_WG_RED='$RED' tiene un octeto fuera de rango"; done
PREFIJO="${BASH_REMATCH[5]}"
{ [ "$PREFIJO" -ge 8 ] && [ "$PREFIJO" -le 30 ]; } || morir "ARGOSISP_WG_RED='$RED': el prefijo va de /8 a /30"
[ "${BASH_REMATCH[4]}" = 0 ] || morir "ARGOSISP_WG_RED='$RED' debe terminar en .0 (dirección de red)"
IP_SERVIDOR="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}.1"
if ! [[ "$PUERTO" =~ ^[0-9]+$ ]] || [ "$PUERTO" -lt 1 ] || [ "$PUERTO" -gt 65535 ]; then
    morir "ARGOSISP_WG_PUERTO='$PUERTO' no es un puerto"
fi
if ! [[ "$CORTE_PUERTO" =~ ^[0-9]+$ ]] || [ "$CORTE_PUERTO" -lt 1 ] || [ "$CORTE_PUERTO" -gt 65535 ]; then
    morir "PORTAL_CORTE_PUERTO='$CORTE_PUERTO' no es un puerto"
fi
[[ "$TABLA" =~ ^[0-9]+$ ]] || morir "ARGOSISP_WG_TABLA='$TABLA' no es un número de tabla"

# peers/ en su propia carpeta: inotify solo ve lo que escribe el agente ahí (no los .ok ni los
# handshakes, que lo despertarían a cada rato)
PEERS="$ESTADO_DIR/peers/peers.conf"
mkdir -p "$ESTADO_DIR/peers"
chmod 755 "$ESTADO_DIR" "$ESTADO_DIR/peers"
umask 077

# --- Clave del servidor (una vez) ------------------------------------------------------------------
if [ ! -s "$CLAVE_DIR/privada" ]; then
    log "generando la clave del servidor (primera vez)"
    wg genkey > "$CLAVE_DIR/privada.tmp"
    mv "$CLAVE_DIR/privada.tmp" "$CLAVE_DIR/privada"
fi
chmod 600 "$CLAVE_DIR/privada"
PUBLICA="$(wg pubkey < "$CLAVE_DIR/privada")"

# --- Interfaz: módulo del kernel o wireguard-go -------------------------------------------------
crear_interfaz() {
    if ip link show "$IFACE" > /dev/null 2>&1; then
        return 0
    fi
    if [ "$MODO" != userspace ] && ip link add "$IFACE" type wireguard 2> /dev/null; then
        return 0
    fi
    [ "$MODO" = kernel ] && morir "el kernel no tiene WireGuard (ARGOSISP_WG_MODO=kernel)"
    [ -c /dev/net/tun ] || morir "sin módulo WireGuard en el kernel ni /dev/net/tun para wireguard-go"
    log "el kernel no tiene WireGuard: uso wireguard-go (espacio de usuario)"
    # En primer plano y como hijo de este script (el modo demonio de wireguard-go se re-ejecuta
    # en bucle dentro de un contenedor). Si muere, el bucle principal lo nota y el contenedor sale.
    WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1 wireguard-go -f "$IFACE" &
    WG_GO_PID=$!
    local _
    for _ in $(seq 1 50); do
        [ -S "/var/run/wireguard/$IFACE.sock" ] && return 0
        kill -0 "$WG_GO_PID" 2> /dev/null || break
        sleep 0.1
    done
    morir "wireguard-go no pudo crear $IFACE"
}
WG_GO_PID=

crear_interfaz
# Si la interfaz ya existía (reinicio del contenedor con el módulo del kernel), se reutiliza
if [[ "$(ip -d link show "$IFACE")" == *" wireguard "* ]]; then MODO_ACTIVO=kernel; else MODO_ACTIVO=userspace; fi
ip address replace "$IP_SERVIDOR/$PREFIJO" dev "$IFACE"
ip link set "$IFACE" mtu "$MTU" up

# Configuración completa = [Interface] + peers del agente. Se arma en un archivo temporal (lleva la
# clave privada) que se borra al aplicar.
aplicar() {
    local tmp
    tmp="$(mktemp)"
    {
        printf '[Interface]\nPrivateKey = %s\nListenPort = %s\n' "$(cat "$CLAVE_DIR/privada")" "$PUERTO"
        if [ -s "$PEERS" ]; then
            printf '\n'
            cat "$PEERS"
        fi
    } > "$tmp"
    if wg syncconf "$IFACE" "$tmp"; then
        rm -f "$tmp"
        log "peers aplicados: $(wg show "$IFACE" peers | grep -c . || true)"
        sha256sum "$PEERS" 2> /dev/null | cut -d' ' -f1 > "$ESTADO_DIR/aplicado" || : > "$ESTADO_DIR/aplicado"
    else
        rm -f "$tmp"
        log "wg syncconf rechazó peers/peers.conf; sigue la configuración anterior"
        return 1
    fi
}

# --- Firewall del túnel -----------------------------------------------------------------------------
# Usa el mismo backend que el host (iptables-nft o iptables-legacy): el de las reglas de Docker.
# Cadenas propias por interfaz (dos instancias de prueba no se pisan)
CADENA_IN="ARGOSISP-IN-$IFACE"
CADENA_FWD="ARGOSISP-FWD-$IFACE"
IPT=iptables
elegir_iptables() {
    # Sin tuberías con grep -q: con pipefail, el SIGPIPE de iptables haría fallar la prueba
    if [[ "$(iptables-legacy -S 2> /dev/null || true)" == *"-N DOCKER"* ]]; then
        IPT=iptables-legacy
    elif [[ "$(iptables-nft -S 2> /dev/null || true)" == *"-N DOCKER"* ]]; then
        IPT=iptables-nft
    else
        IPT=iptables
    fi
}

# asegurar_salto <cadena padre> <cadena propia>: un solo salto, en la posición 1
asegurar_salto() {
    local padre="$1" propia="$2"
    while $IPT -D "$padre" -i "$IFACE" -j "$propia" 2> /dev/null; do :; done
    $IPT -I "$padre" 1 -i "$IFACE" -j "$propia"
}

firewall() {
    [ "$FIREWALL" = 1 ] || return 0
    elegir_iptables
    $IPT -N "$CADENA_IN" 2> /dev/null || $IPT -F "$CADENA_IN"
    $IPT -A "$CADENA_IN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    # Ping a la .1 solo desde los routers (los clientes del corte por el túnel también llegan a la .1)
    $IPT -A "$CADENA_IN" -p icmp --icmp-type echo-request -s "$RED" -d "$IP_SERVIDOR" -j RETURN
    $IPT -A "$CADENA_IN" -j DROP
    $IPT -N "$CADENA_FWD" 2> /dev/null || $IPT -F "$CADENA_FWD"
    $IPT -A "$CADENA_FWD" -o "$IFACE" -j DROP
    $IPT -A "$CADENA_FWD" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    # RADIUS publicado en la .1 (RADIUS_BIND_IP): Docker lo traduce (DNAT) al contenedor. Solo desde
    # la red del túnel: con el corte por el túnel también llegan los clientes de los routers.
    $IPT -A "$CADENA_FWD" -p udp -s "$RED" -m conntrack --ctstate DNAT --ctorigdst "$IP_SERVIDOR" \
        --ctorigdstport 1812:1813 -j RETURN
    # Corte por el túnel: HTTP del suspendido al Caddy del corte, publicado en la .1 (Docker hace DNAT
    # y conserva el origen). WireGuard ya garantiza que el origen está en los AllowedIPs del peer.
    if [ "$CORTE_TUNEL" != 0 ]; then
        $IPT -A "$CADENA_FWD" -p tcp -m conntrack --ctstate DNAT --ctorigdst "$IP_SERVIDOR" \
            --ctorigdstport "$CORTE_PUERTO" -j RETURN
    fi
    $IPT -A "$CADENA_FWD" -j DROP
    revisar_saltos
    log "firewall del túnel aplicado ($IPT)"
}

# --- Vuelta del corte por el túnel (marca de conexión) -----------------------------------------------
# Lo que entra por wg-argos (un cliente con su IP, sin masquerade) vuelve por wg-argos: la conexión
# lleva la marca MARCA, que se copia a cada paquete; `ip rule fwmark` manda esos paquetes a la tabla
# TABLA, con `default dev wg-argos` (WireGuard elige el peer por AllowedIPs). Sin rutas en la tabla
# principal: un cliente con IP pública que entra por Internet sigue volviendo por Internet.
CADENA_MARCA="ARGOSISP-MARCA-$IFACE"
ruteo_corte() {
    [ "$CORTE_TUNEL" != 0 ] || return 0
    $IPT -t mangle -N "$CADENA_MARCA" 2> /dev/null || $IPT -t mangle -F "$CADENA_MARCA"
    $IPT -t mangle -A "$CADENA_MARCA" -i "$IFACE" -m conntrack --ctstate NEW \
        -j CONNMARK --set-xmark "$MARCA/$MASCARA_MARCA"
    $IPT -t mangle -A "$CADENA_MARCA" -m connmark --mark "$MARCA/$MASCARA_MARCA" \
        -j CONNMARK --restore-mark --nfmask "$MASCARA_MARCA" --ctmask "$MASCARA_MARCA"
    revisar_salto_marca
    # El paquete que ENTRA por wg-argos también lleva la marca (la comprobación de rp_filter con
    # src_valid_mark la necesita): su ruta hacia el contenedor sale de la tabla principal (iif antes que
    # fwmark). rp_filter busca con iif = lo, así que esa regla no le aplica y ve la tabla del túnel.
    if ! ip rule show | grep -q "iif $IFACE lookup main"; then
        ip rule add iif "$IFACE" lookup main priority "$((TABLA - 1))"
    fi
    if ! ip rule show | grep -q "lookup $TABLA\b"; then
        ip rule add fwmark "$MARCA/$MASCARA_MARCA" lookup "$TABLA" priority "$TABLA"
    fi
    ip route replace default dev "$IFACE" table "$TABLA"
    # rp_filter estricto (1) tira la entrada (la ruta de vuelta en la tabla principal no es wg-argos)
    # salvo con src_valid_mark=1 (lo pone instalar.sh): solo se avisa, /proc/sys es de solo lectura aquí
    local rp_all rp_if svm
    rp_all="$(cat /proc/sys/net/ipv4/conf/all/rp_filter 2> /dev/null || echo 0)"
    rp_if="$(cat "/proc/sys/net/ipv4/conf/$IFACE/rp_filter" 2> /dev/null || echo 0)"
    svm="$(cat /proc/sys/net/ipv4/conf/all/src_valid_mark 2> /dev/null || echo 0)"
    if { [ "$rp_all" = 1 ] || [ "$rp_if" = 1 ]; } && [ "$rp_all" != 2 ] && [ "$rp_if" != 2 ] && [ "$svm" != 1 ]; then
        log "AVISO: rp_filter estricto sin src_valid_mark: el corte por el túnel no llega al portal." \
            "Pon net.ipv4.conf.all.src_valid_mark=1 (sudo argosisp instalar lo hace) o rp_filter=2"
    fi
    log "corte por el túnel: puerto $CORTE_PUERTO, marca $MARCA, tabla $TABLA"
}

revisar_salto_marca() {
    [ "$CORTE_TUNEL" != 0 ] || return 0
    if ! $IPT -t mangle -S PREROUTING 2> /dev/null | grep -m1 -- '^-A' | grep -q -- "-j $CADENA_MARCA"; then
        while $IPT -t mangle -D PREROUTING -j "$CADENA_MARCA" 2> /dev/null; do :; done
        $IPT -t mangle -I PREROUTING 1 -j "$CADENA_MARCA"
    fi
}

limpiar_ruteo_corte() {
    while $IPT -t mangle -D PREROUTING -j "$CADENA_MARCA" 2> /dev/null; do :; done
    if $IPT -t mangle -F "$CADENA_MARCA" 2> /dev/null; then $IPT -t mangle -X "$CADENA_MARCA" 2> /dev/null || true; fi
    while ip rule del fwmark "$MARCA/$MASCARA_MARCA" lookup "$TABLA" 2> /dev/null; do :; done
    while ip rule del iif "$IFACE" lookup main priority "$((TABLA - 1))" 2> /dev/null; do :; done
    ip route flush table "$TABLA" 2> /dev/null || true
}

# Primera regla de una cadena (sin la política ni los avisos de iptables-nft)
primera_regla() { $IPT -S "$1" 2> /dev/null | grep -m1 -- '^-A' || true; }

# Docker reordena FORWARD al reiniciarse: los saltos se revisan en cada vuelta del bucle.
revisar_saltos() {
    [ "$FIREWALL" = 1 ] || return 0
    local fwd=FORWARD
    $IPT -S DOCKER-USER > /dev/null 2>&1 && fwd=DOCKER-USER
    if ! primera_regla INPUT | grep -q -- "-i $IFACE -j $CADENA_IN"; then
        asegurar_salto INPUT "$CADENA_IN"
    fi
    if ! primera_regla "$fwd" | grep -q -- "-i $IFACE -j $CADENA_FWD"; then
        asegurar_salto "$fwd" "$CADENA_FWD"
    fi
}

limpiar_firewall() {
    [ "$FIREWALL" = 1 ] || return 0
    local c
    for c in INPUT FORWARD DOCKER-USER; do
        while $IPT -D "$c" -i "$IFACE" -j "$CADENA_IN" 2> /dev/null; do :; done
        while $IPT -D "$c" -i "$IFACE" -j "$CADENA_FWD" 2> /dev/null; do :; done
    done
    for c in "$CADENA_IN" "$CADENA_FWD"; do
        if $IPT -F "$c" 2> /dev/null; then $IPT -X "$c" 2> /dev/null || true; fi
    done
}

# --- Estado para el agente ----------------------------------------------------------------------------
publicar_servidor() {
    jq -n --arg k "$PUBLICA" --arg ip "$IP_SERVIDOR" --arg red "$RED" --argjson p "$PUERTO" \
        --arg modo "$MODO_ACTIVO" --arg i "$IFACE" \
        '{public_key: $k, ip: $ip, red: $red, puerto: $p, interfaz: $i, modo: $modo}' > "$ESTADO_DIR/servidor.json.tmp"
    chmod 644 "$ESTADO_DIR/servidor.json.tmp"
    mv "$ESTADO_DIR/servidor.json.tmp" "$ESTADO_DIR/servidor.json"
}

# public_key \t último handshake (epoch, 0 = nunca) \t endpoint \t rx \t tx. `wg show dump` trae la
# clave privada en la primera línea: se salta.
publicar_handshakes() {
    wg show "$IFACE" dump | tail -n +2 | awk -F'\t' '{print $1 "\t" $5 "\t" $3 "\t" $6 "\t" $7}' > "$ESTADO_DIR/handshakes.tsv.tmp"
    chmod 644 "$ESTADO_DIR/handshakes.tsv.tmp"
    mv "$ESTADO_DIR/handshakes.tsv.tmp" "$ESTADO_DIR/handshakes.tsv"
}

terminar() {
    log "deteniendo: la interfaz queda sin peers hasta el próximo arranque"
    limpiar_firewall
    limpiar_ruteo_corte
    [ -z "$WG_GO_PID" ] || kill "$WG_GO_PID" 2> /dev/null || true
    ip link del "$IFACE" 2> /dev/null || true
    exit 0
}
trap terminar TERM INT

firewall
# La marca usa el mismo backend de iptables que el firewall (elegir_iptables)
[ "$FIREWALL" = 1 ] || elegir_iptables
limpiar_ruteo_corte
ruteo_corte
aplicar || true
publicar_servidor
publicar_handshakes
log "listo: $IFACE $IP_SERVIDOR/$PREFIJO, UDP $PUERTO, modo $MODO_ACTIVO, clave pública $PUBLICA"

# Bucle: aplica al cambiar peers/peers.conf (inotify, por evento) y publica los handshakes cada
# HANDSHAKES_CADA_S segundos (lectura local de la interfaz, no de la API).
while true; do
    # timeout además de -t: el tiempo de inotifywait se reinicia con cada evento de la carpeta
    timeout "$HANDSHAKES_CADA_S" inotifywait -q -e close_write,moved_to "$ESTADO_DIR/peers" > /dev/null 2>&1 || true
    if [ "$(sha256sum "$PEERS" 2> /dev/null | cut -d' ' -f1)" != "$(cat "$ESTADO_DIR/aplicado" 2> /dev/null)" ]; then
        aplicar || true
    fi
    ip link show "$IFACE" > /dev/null 2>&1 || morir "la interfaz $IFACE desapareció"
    if [ -n "$WG_GO_PID" ] && ! kill -0 "$WG_GO_PID" 2> /dev/null; then morir "wireguard-go terminó"; fi
    revisar_saltos
    revisar_salto_marca
    publicar_handshakes
done &
wait $!
