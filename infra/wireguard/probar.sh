#!/usr/bin/env bash
# Prueba de humo del servidor WireGuard (A6, contratos/conexion-routers.md). La corre CI (job infra)
# y sirve local:  infra/wireguard/probar.sh            (construye la imagen)
#                 WG_IMAGEN=argosisp/wireguard:dev infra/wireguard/probar.sh   (usa una ya hecha)
#
# Monta, en una red de Docker propia y con nombres propios (no toca el compose ni otros servicios):
#   - Redis, una API falsa (prueba/api_falsa.py, en el host) y los dos servicios de la imagen:
#     `servidor.sh` en la red del host (interfaz wg-prueba, red 10.254.0.0/24) y `agente.sh`;
#   - un "router": contenedor con su propio WireGuard (kernel o wireguard-go) hacia el servidor;
#   - un "freeradius": nc escuchando UDP 1812 publicado en la .1 del túnel (como RADIUS_BIND_IP).
# Comprueba:
#   1. el peer se aplica por evento (router.conexion_registrada en el stream) sin reiniciar;
#   2. hay handshake y la API recibe la clave del servidor y el último handshake del peer;
#   3. un contenedor de la red de compose llega al router por el túnel y sale con origen .1;
#   4. el router llega a RADIUS en la .1 y a nada más del host (firewall del túnel);
#   5. rotar (lista vacía + router.conexion_rotada) quita el peer.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
P=argosisp-wgprueba
IMAGEN="${WG_IMAGEN:-}"
IFACE=wg-prueba
RED=10.254.0.0/24
IP_SRV=10.254.0.1
IP_ROUTER=10.254.0.2
PUERTO_WG="${WG_PRUEBA_PUERTO:-51899}"
PUERTO_API="${WG_PRUEBA_API:-34690}"
SUBRED=172.31.254.0/24
GW=172.31.254.1
TOKEN=prueba-token-interno
TMP="$(mktemp -d)"
inicio=$SECONDS

paso() { printf '\n\033[1m[%3ss] %s\033[0m\n' "$((SECONDS - inicio))" "$*"; }
fallar() {
    printf '\033[31mFALLÓ:\033[0m %s\n' "$*" >&2
    for c in servidor agente router; do
        echo "--- $c ($(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$P-$c" 2> /dev/null))"
        docker logs --tail 30 "$P-$c" 2>&1 | grep -v '[│┌└]' || true
    done
    echo "--- wg show y handshakes.tsv del servidor"
    docker exec "$P-servidor" sh -c "wg show $IFACE; cat /estado/handshakes.tsv; ls -la --time-style=+%T /estado" 2>&1 || true
    echo "--- último estado recibido por la API falsa"
    cat "$TMP/estado.json" 2> /dev/null || true
    exit 1
}

limpiar() {
    docker rm -f "$P-servidor" "$P-agente" "$P-router" "$P-redis" "$P-radius" "$P-cliente" > /dev/null 2>&1 || true
    docker network rm "$P" > /dev/null 2>&1 || true
    docker volume rm "$P-clave" "$P-estado" > /dev/null 2>&1 || true
    [ -z "${API_PID:-}" ] || kill "$API_PID" 2> /dev/null || true
    rm -rf "$TMP"
}
trap limpiar EXIT
limpiar 2> /dev/null || true
TMP="$(mktemp -d)"

# esperar <segundos> <descripción> <comando...>
esperar() {
    local limite=$(($1 + SECONDS)) que="$2"
    shift 2
    until "$@" > /dev/null 2>&1; do
        [ "$SECONDS" -lt "$limite" ] || fallar "no ocurrió: $que"
        sleep 1
    done
}

if [ -z "$IMAGEN" ]; then
    paso "Imagen (infra/wireguard/Dockerfile)"
    IMAGEN=argosisp/wireguard:prueba
    docker build -q -t "$IMAGEN" -f "$RAIZ/infra/wireguard/Dockerfile" "$RAIZ" > /dev/null
fi

paso "Red, Redis y API falsa"
docker network create --subnet "$SUBRED" --gateway "$GW" "$P" > /dev/null
docker run -d --name "$P-redis" --network "$P" redis:7.4.11-alpine > /dev/null
echo '{"data":[]}' > "$TMP/peers.json"
python3 "$RAIZ/infra/wireguard/prueba/api_falsa.py" "$PUERTO_API" "$TMP" "$TOKEN" &
API_PID=$!

paso "Servidor (red del host) y agente"
WG_ENV=(-e ARGOSISP_WG_INTERFAZ="$IFACE" -e ARGOSISP_WG_RED="$RED" -e ARGOSISP_WG_PUERTO="$PUERTO_WG")
docker run -d --name "$P-servidor" --network host --cap-add NET_ADMIN --device /dev/net/tun \
    -v "$P-clave:/clave" -v "$P-estado:/estado" "${WG_ENV[@]}" -e ARGOSISP_WG_HANDSHAKES_CADA_S=2 \
    "$IMAGEN" servidor.sh > /dev/null
esperar 20 "servidor.json" docker exec "$P-servidor" test -s /estado/servidor.json
docker exec "$P-servidor" salud.sh servidor || fallar "healthcheck del servidor"
SRV_PUB="$(docker exec "$P-servidor" wg show "$IFACE" public-key)"
docker run -d --name "$P-agente" --network "$P" -v "$P-estado:/estado" "${WG_ENV[@]}" \
    --add-host "api-falsa:$GW" -e API_INTERNAL_URL="http://api-falsa:$PUERTO_API/api/v1/" \
    -e INTERNAL_TOKEN="$TOKEN" -e REDIS_HOST="$P-redis" -e ARGOSISP_WG_ESTADO_CADA_S=2 -e WG_BLOQUEO_MS=1000 \
    "$IMAGEN" agente.sh > /dev/null
esperar 30 "la API recibe la clave del servidor" grep -q "$SRV_PUB" "$TMP/estado.json"
esperar 15 "healthcheck del agente" docker exec "$P-agente" salud.sh agente
docker exec "$P-agente" test -s /estado/api.ok || fallar "el agente no marcó api.ok"

paso "Router con su propia clave (la privada no sale del contenedor)"
docker run -d --name "$P-router" --network "$P" --cap-add NET_ADMIN --device /dev/net/tun \
    "$IMAGEN" sleep infinity > /dev/null
docker exec "$P-router" sh -c '
    set -e
    umask 077
    wg genkey > /tmp/k
    if ! ip link add wg0 type wireguard 2>/dev/null; then
        WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1 wireguard-go -f wg0 > /dev/null 2>&1 &
        for i in $(seq 1 50); do [ -S /var/run/wireguard/wg0.sock ] && break; sleep 0.1; done
    fi
    wg set wg0 private-key /tmp/k
    ip address add '"$IP_ROUTER"'/32 dev wg0
    ip link set wg0 up
    ip route add '"$IP_SRV"'/32 dev wg0
    wg set wg0 peer '"$SRV_PUB"' endpoint '"$GW:$PUERTO_WG"' allowed-ips '"$IP_SRV"'/32 persistent-keepalive 2
    # Como el MikroTik: CoA (3799) solo desde la .1 del servidor
    iptables -A INPUT -i wg0 -s '"$IP_SRV"' -p udp --dport 3799 -j ACCEPT
    iptables -A INPUT -i wg0 -p udp --dport 3799 -j DROP'
ROUTER_PUB="$(docker exec "$P-router" wg show wg0 public-key)"

paso "1. Peer aplicado por evento"
docker exec "$P-servidor" wg show "$IFACE" peers | grep -q . && fallar "el servidor ya tenía peers"
printf '{"data":[{"router_id":7,"public_key":"%s","ip_tunel":"%s"},{"router_id":8,"public_key":"no-es-clave","ip_tunel":"10.254.0.3"},{"router_id":9,"public_key":"%s","ip_tunel":"192.0.2.9"}]}' \
    "$ROUTER_PUB" "$IP_ROUTER" "$SRV_PUB" > "$TMP/peers.json"
docker exec "$P-redis" redis-cli XADD argos:eventos '*' id 1 evento router.conexion_registrada \
    payload "{\"router_id\":7,\"empresa_id\":1,\"ip_tunel\":\"$IP_ROUTER\"}" request_id '' > /dev/null
esperar 20 "peer en wg show" sh -c "docker exec $P-servidor wg show $IFACE allowed-ips | grep -q '$ROUTER_PUB.*$IP_ROUTER/32'"
[ "$(docker exec "$P-servidor" wg show "$IFACE" peers | grep -c .)" = 1 ] || fallar "se aplicaron peers inválidos"
# Los logs se leen completos antes de buscar: con pipefail, `docker logs | grep -q` falla al azar
# (grep sale al primer acierto y docker logs muere por SIGPIPE).
LOGS_AGENTE="$(docker logs "$P-agente" 2>&1)"
grep -q 'router 8: public_key inválida' <<< "$LOGS_AGENTE" || fallar "no avisó la clave inválida"
grep -q 'router 9: ip_tunel' <<< "$LOGS_AGENTE" || fallar "no avisó la IP fuera de la red"

paso "2. Handshake y estado en la API"
esperar 30 "handshake" docker exec "$P-router" ping -c1 -W1 "$IP_SRV"
esperar 30 "ultimo_handshake en la API" sh -c "jq -e --arg k '$ROUTER_PUB' '.peers[] | select(.public_key == \$k) | .ultimo_handshake != null' '$TMP/estado.json'"
jq -e '.servidor.ip == "10.254.0.1" and .servidor.puerto == '"$PUERTO_WG"' and (.generado_en | length > 0)' "$TMP/estado.json" > /dev/null ||
    fallar "estado sin servidor: $(cat "$TMP/estado.json")"
grep -q PrivateKey "$TMP/estados.log" && fallar "el estado lleva la clave privada"
docker exec "$P-servidor" ping -c1 -W2 "$IP_ROUTER" > /dev/null || fallar "el host no llega al router por el túnel"

paso "3. Contenedor de compose → router por el túnel, con origen .1 (enmascarado de Docker)"
docker run --rm --name "$P-cliente" --network "$P" "$IMAGEN" sh -c "ping -c1 -W2 $IP_ROUTER > /dev/null && echo coa | nc -u -w1 $IP_ROUTER 3799" ||
    fallar "un contenedor de la red de compose no llega al router"
esperar 10 "CoA aceptado con origen .1" sh -c "docker exec $P-router iptables -vnL INPUT | awk '/3799/ && /ACCEPT/ {exit !(\$1 > 0)}'"

paso "4. Firewall del túnel: RADIUS en la .1 sí, otros puertos del host no"
docker run -d --name "$P-radius" -p "$IP_SRV:1812:1812/udp" "$IMAGEN" sh -c 'while true; do nc -lu -p 1812 -w 1; done' > /dev/null
sleep 1
docker exec "$P-router" sh -c "echo radius-ok | nc -u -w1 $IP_SRV 1812" || true
esperar 10 "RADIUS recibido por la .1" sh -c "docker logs $P-radius 2>&1 | grep -q radius-ok"
if docker exec "$P-router" sh -c "curl -s -m 3 -o /dev/null http://$IP_SRV:$PUERTO_API/"; then
    fallar "el router llegó a otro puerto del host por el túnel"
fi

paso "5. Rotar: lista vacía + router.conexion_rotada quita el peer"
echo '{"data":[]}' > "$TMP/peers.json"
docker exec "$P-redis" redis-cli XADD argos:eventos '*' id 2 evento router.conexion_rotada payload '{"router_id":7}' request_id '' > /dev/null
esperar 20 "peer quitado" sh -c "! docker exec $P-servidor wg show $IFACE peers | grep -q ."

paso "Detener el servidor borra la interfaz y el firewall"
docker stop -t 10 "$P-servidor" > /dev/null
docker run --rm --network host --cap-add NET_ADMIN "$IMAGEN" sh -c "! ip link show $IFACE 2>/dev/null && ! iptables -S 2>/dev/null | grep -q -- -$IFACE" ||
    fallar "quedó la interfaz o reglas del túnel"

printf '\n\033[32mOK\033[0m servidor WireGuard (%ss)\n' "$((SECONDS - inicio))"
