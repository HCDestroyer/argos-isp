#!/usr/bin/env bash
# La API confía en el X-Forwarded-For de Caddy y del portal (PORTAL_PROXIES_CONFIABLES) desde la red
# de compose, y esa red sale de COMPOSE_SUBNET_V4/V6. Hasta la 1.4.0 el valor por defecto era
# 172.30.0.0/24 fijo: con COMPOSE_SUBNET_V4=10.255.252.0/26 la página de corte mostraba
# «Conexión desde 10.255.252.20», la IP del contenedor de Caddy.
#
# 1. Configuración resuelta (`docker compose config`) de producción, desarrollo y nodo portal: con la
#    subred de siempre, con otra subred y con PORTAL_PROXIES_CONFIABLES fijado a mano (manda ese).
# 2. De verdad, con sockets: una red de Docker con la subred del PM, un eco que aplica la regla de la
#    API (apps/api/app/portal/ip_origen.ts) con el valor resuelto para `api`, y un «Caddy» en esa red
#    que reenvía con X-Forwarded-For: la API tiene que ver la IP del cliente, no la de Caddy.
#
#   infra/ci/probar-red-compose.sh      (necesita Docker con compose, jq y node:22-alpine)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
NODE_IMG=node:22-alpine
P=argosisp-prueba-red
SUBRED=10.255.252.0/26
CADDY_IP=10.255.252.20
CLIENTE=198.51.100.7
TMP="$(mktemp -d)"
chmod 755 "$TMP"

limpiar() {
    docker rm -f "$P-eco" > /dev/null 2>&1 || true
    docker network rm "$P" > /dev/null 2>&1 || true
    rm -rf "$TMP"
}
trap limpiar EXIT

fallas=0
igual() { # descripción, obtenido, esperado
    if [ "$2" = "$3" ]; then
        echo "ok    $1"
    else
        echo "FALLA $1: '$2', se esperaba '$3'" >&2
        fallas=$((fallas + 1))
    fi
}

PROD=(-f "$RAIZ/infra/produccion/docker-compose.produccion.yml" --env-file "$RAIZ/infra/produccion/.env.example")
DEV=(-f "$RAIZ/infra/docker-compose.yml" --env-file "$RAIZ/infra/.env.example")
NODO=(-f "$RAIZ/infra/produccion/docker-compose.nodo-portal.yml" --env-file "$RAIZ/infra/produccion/nodo-portal.env.example")

# conf <args de compose...>: JSON de la configuración resuelta (con api-portal activo)
conf() { COMPOSE_PROFILES=api-portal docker compose "$@" config --format json; }
entorno() { jq -r --arg s "$2" --arg v "$3" '.services[$s].environment[$v] // ""' <<< "$1"; }
subred() { jq -r --argjson i "$2" '.networks.default.ipam.config[$i].subnet // ""' <<< "$1"; }

# ---------------------------------------------------------------------------
echo "== producción, subred de siempre"
c="$(env -u COMPOSE_SUBNET_V4 -u COMPOSE_SUBNET_V6 -u PORTAL_PROXIES_CONFIABLES COMPOSE_PROFILES=api-portal \
    docker compose "${PROD[@]}" config --format json)"
igual 'api confía en 172.30.0.0/24 y fd00:a6:30::/64' "$(entorno "$c" api PORTAL_PROXIES_CONFIABLES)" '172.30.0.0/24,fd00:a6:30::/64'
igual 'red de compose 172.30.0.0/24' "$(subred "$c" 0)" 172.30.0.0/24

echo "== producción, COMPOSE_SUBNET_V4=$SUBRED (instalación del PM)"
c="$(COMPOSE_SUBNET_V4=$SUBRED conf "${PROD[@]}")"
red_v4="$(subred "$c" 0)"
igual "red de compose $SUBRED" "$red_v4" "$SUBRED"
for s in api api-portal; do
    igual "$s confía en la red de compose" "$(entorno "$c" "$s" PORTAL_PROXIES_CONFIABLES)" "$red_v4,fd00:a6:30::/64"
done
CONFIABLES_API="$(entorno "$c" api PORTAL_PROXIES_CONFIABLES)"

echo "== producción, COMPOSE_SUBNET_V4 y COMPOSE_SUBNET_V6"
c="$(COMPOSE_SUBNET_V4=10.213.40.0/24 COMPOSE_SUBNET_V6=fd00:a6:40::/64 conf "${PROD[@]}")"
igual 'api sigue a las dos subredes' "$(entorno "$c" api PORTAL_PROXIES_CONFIABLES)" '10.213.40.0/24,fd00:a6:40::/64'
igual 'red de compose v6' "$(subred "$c" 1)" fd00:a6:40::/64

echo "== producción, PORTAL_PROXIES_CONFIABLES a mano"
c="$(COMPOSE_SUBNET_V4=$SUBRED PORTAL_PROXIES_CONFIABLES=192.0.2.0/24 conf "${PROD[@]}")"
igual 'el valor fijado manda' "$(entorno "$c" api PORTAL_PROXIES_CONFIABLES)" 192.0.2.0/24

echo "== desarrollo (infra/docker-compose.yml)"
c="$(env -u PORTAL_PROXIES_CONFIABLES COMPOSE_SUBNET_V4=$SUBRED docker compose "${DEV[@]}" config --format json)"
igual 'api de desarrollo sigue a COMPOSE_SUBNET_V4' "$(entorno "$c" api PORTAL_PROXIES_CONFIABLES)" "$SUBRED,fd00:a6:30::/64"

echo "== nodo portal (172.31.0.0/24 por defecto, a propósito: puede convivir con el central)"
c="$(COMPOSE_SUBNET_V4=$SUBRED docker compose "${NODO[@]}" config --format json)"
igual 'portal del nodo confía en su red' "$(entorno "$c" portal NUXT_PORTAL_PROXIES_CONFIABLES)" "$SUBRED,fd00:a6:31::/64"
igual 'proxy del nodo: red interna' "$(entorno "$c" proxy RED_INTERNA_V4)" "$SUBRED"

# ---------------------------------------------------------------------------
echo "== con sockets: Caddy ($CADDY_IP) → API en $SUBRED, PORTAL_PROXIES_CONFIABLES=$CONFIABLES_API"
docker image inspect "$NODE_IMG" > /dev/null 2>&1 || docker pull -q "$NODE_IMG" > /dev/null
cat > "$TMP/eco.mjs" << 'EOF'
import http from 'node:http'
import { BlockList, isIP } from 'node:net'

// Espejo de resolverIpOrigen (apps/api/app/portal/ip_origen.ts)
const confiables = new BlockList()
for (const c of process.env.PORTAL_PROXIES_CONFIABLES.split(',')) {
    const [ip, largo] = c.trim().split('/')
    confiables.addSubnet(ip, Number(largo), isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}
const norm = (v) => {
    const ip = (v ?? '').trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')
    return isIP(ip) ? ip.toLowerCase() : null
}
http.createServer((q, r) => {
    let ip = norm(q.socket.remoteAddress)
    const cadena = (q.headers['x-forwarded-for'] ?? '').split(',').filter(Boolean)
    while (ip && confiables.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6') && cadena.length > 0) {
        const anterior = norm(cadena.pop())
        if (!anterior) break
        ip = anterior
    }
    r.end(JSON.stringify({ socket: norm(q.socket.remoteAddress), ip }))
}).listen(3333)
EOF
docker network create --subnet "$SUBRED" "$P" > /dev/null
docker run -d --name "$P-eco" --network "$P" -e PORTAL_PROXIES_CONFIABLES="$CONFIABLES_API" \
    -v "$TMP:/prueba:ro" "$NODE_IMG" node /prueba/eco.mjs > /dev/null
r=""
for _ in $(seq 1 20); do
    r="$(docker run --rm --network "$P" --ip "$CADDY_IP" "$NODE_IMG" node -e "
        fetch('http://$P-eco:3333/api/v1/portal/quien-soy', { headers: { 'x-forwarded-for': '$CLIENTE' } })
            .then((r) => r.text()).then((t) => process.stdout.write(t)).catch(() => {})")" || true
    [ -n "$r" ] && break
    sleep 1
done
igual 'el socket es Caddy' "$(jq -r '.socket // ""' <<< "${r:-null}")" "$CADDY_IP"
igual 'la API ve la IP del cliente, no la de Caddy' "$(jq -r '.ip // ""' <<< "${r:-null}")" "$CLIENTE"

if [ "$fallas" -gt 0 ]; then
    echo "$fallas comprobaciones fallaron" >&2
    exit 1
fi
echo "OK: la API confía en la red de compose con cualquier COMPOSE_SUBNET_V4/V6."
