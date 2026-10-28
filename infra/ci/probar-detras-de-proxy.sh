#!/usr/bin/env bash
# Prueba el Caddyfile de producción (infra/produccion/config/Caddyfile) detrás de otro proxy
# (Nginx Proxy Manager…) con ARGOSISP_PROXIES_CONFIABLES: docs/runbooks/detras-de-proxy.md.
#
# Arma tres redes de Docker: `argos` (Caddy y un eco que hace de api, api-portal, web y portal),
# `npm` (el proxy de confianza) y `otra` (cualquiera que no está en la lista). Caddy tiene una
# pata en cada una. Los clientes son contenedores de node en `npm` u `otra` que llaman a Caddy por
# HTTPS sin SNI (como NPM) o con SNI, y por HTTP (/corte), con X-Forwarded-For / X-Real-IP propios.
#
# El eco devuelve lo que recibe y además la IP que decidiría la API con su regla
# (apps/api/app/portal/ip_origen.ts: X-Forwarded-For de derecha a izquierda mientras la IP sea de
# PORTAL_PROXIES_CONFIABLES, que en producción es la red de compose).
#
# Comprueba:
#   - con la variable: desde `npm` la API ve la IP del encabezado (XFF, X-Real-IP, IPv6; un XFF
#     falso que el cliente mandó a NPM queda a la izquierda y se ignora); desde `otra`, la IP del
#     socket aunque mande XFF; en los tres dominios, el webhook y /corte por HTTP;
#   - sin la variable (lo de siempre): nadie es de confianza, la API ve la IP del socket.
#
#   infra/ci/probar-detras-de-proxy.sh     (necesita Docker y las imágenes caddy:2.10.0-alpine y
#                                           node:22-alpine; las baja si faltan)
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CADDY_IMG=caddy:2.10.0-alpine
NODE_IMG=node:22-alpine
P=argosisp-prueba-npm
RED_ARGOS=10.213.10.0/24
RED_NPM=10.213.11.0/24
RED_OTRA=10.213.12.0/24
CADDY_NPM=10.213.11.10
CADDY_OTRA=10.213.12.10
# IP fija de los clientes: es el socket que ve Caddy
IP_NPM=10.213.11.20
IP_OTRA=10.213.12.20
TMP="$(mktemp -d)"
chmod 755 "$TMP"

limpiar() {
    docker rm -f "$P-caddy" "$P-eco" > /dev/null 2>&1 || true
    for r in argos npm otra; do docker network rm "$P-$r" > /dev/null 2>&1 || true; done
    rm -rf "$TMP"
}
trap limpiar EXIT

cat > "$TMP/eco.mjs" << 'EOF'
import http from 'node:http'
import { BlockList, isIP } from 'node:net'

// Espejo de resolverIpOrigen (apps/api/app/portal/ip_origen.ts) con la red de compose
const confiables = new BlockList()
for (const c of process.env.PORTAL_PROXIES_CONFIABLES.split(',')) {
    const [ip, largo] = c.trim().split('/')
    confiables.addSubnet(ip, Number(largo), isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}
const norm = (v) => {
    const ip = (v ?? '').trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')
    return isIP(ip) ? ip.toLowerCase() : null
}
function ipApi(remota, xff) {
    let ip = norm(remota)
    if (!ip || !xff) return ip
    const cadena = xff.split(',')
    while (confiables.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6') && cadena.length > 0) {
        const anterior = norm(cadena.pop())
        if (!anterior) break
        ip = anterior
    }
    return ip
}

for (const [puerto, servicio] of [[3333, 'api'], [3000, 'web'], [3001, 'portal']]) {
    http.createServer((q, r) => {
        r.setHeader('content-type', 'application/json')
        r.end(JSON.stringify({
            servicio,
            url: q.url,
            host: q.headers.host,
            socket: norm(q.socket.remoteAddress),
            xff: q.headers['x-forwarded-for'] ?? null,
            proto: q.headers['x-forwarded-proto'] ?? null,
            ip_api: ipApi(q.socket.remoteAddress, q.headers['x-forwarded-for']),
        }))
    }).listen(puerto)
}
EOF

# cliente.mjs <esquema> <ip de Caddy> <puerto> <Host> <ruta> <sni: si|no> [Cabecera: valor]...
cat > "$TMP/cliente.mjs" << 'EOF'
import http from 'node:http'
import https from 'node:https'
const [esquema, ip, puerto, host, ruta, sni, ...cabeceras] = process.argv.slice(2)
const headers = { host }
for (const c of cabeceras) {
    const i = c.indexOf(':')
    headers[c.slice(0, i).trim().toLowerCase()] = c.slice(i + 1).trim()
}
const opciones = { host: ip, port: Number(puerto), path: ruta, headers, rejectUnauthorized: false }
if (sni === 'si') opciones.servername = host
const q = (esquema === 'https' ? https : http).request(opciones, (r) => {
    let cuerpo = ''
    r.on('data', (d) => (cuerpo += d))
    r.on('end', () => process.stdout.write(JSON.stringify({ status: r.statusCode, ...JSON.parse(cuerpo || '{}') })))
})
q.on('error', (e) => { process.stdout.write(JSON.stringify({ error: e.message })); process.exit(0) })
q.end()
EOF

docker image inspect "$CADDY_IMG" > /dev/null 2>&1 || docker pull -q "$CADDY_IMG" > /dev/null
docker image inspect "$NODE_IMG" > /dev/null 2>&1 || docker pull -q "$NODE_IMG" > /dev/null
docker network create --subnet "$RED_ARGOS" "$P-argos" > /dev/null
docker network create --subnet "$RED_NPM" "$P-npm" > /dev/null
docker network create --subnet "$RED_OTRA" "$P-otra" > /dev/null
docker run -d --name "$P-eco" --network "$P-argos" \
    --network-alias api --network-alias api-portal --network-alias web --network-alias portal \
    -e PORTAL_PROXIES_CONFIABLES="$RED_ARGOS" -v "$TMP:/prueba:ro" "$NODE_IMG" node /prueba/eco.mjs > /dev/null

# cliente <red> <esquema> <ip> <puerto> <host> <ruta> <sni> [cabeceras...]
cliente() {
    local red="$1" ip
    shift
    ip="$([ "$red" = npm ] && echo "$IP_NPM" || echo "$IP_OTRA")"
    docker run --rm --network "$P-$red" --ip "$ip" -v "$TMP:/prueba:ro" "$NODE_IMG" node /prueba/cliente.mjs "$@"
}
campo() { node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(String(o[process.argv[2]] ?? ""))' "$1" "$2"; }

levantar_caddy() { # $1 = ARGOSISP_PROXIES_CONFIABLES
    docker rm -f "$P-caddy" > /dev/null 2>&1 || true
    docker create --name "$P-caddy" --network "$P-argos" \
        -e DOMINIO_API=api.localhost -e DOMINIO_PANEL=panel.localhost -e DOMINIO_PORTAL=portal.localhost \
        -e PROXY_TLS_GLOBAL=local_certs -e PORTAL_HSTS_MAX_AGE=300 -e PROXY_LIMPIEZA_ALMACEN=off \
        -e API_PORTAL_DESTINO=api-portal:3333 -e ARGOSISP_PROXIES_CONFIABLES="$1" \
        -v "$RAIZ/infra/produccion/config/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMG" > /dev/null
    docker network connect --ip "$CADDY_NPM" "$P-npm" "$P-caddy"
    docker network connect --ip "$CADDY_OTRA" "$P-otra" "$P-caddy"
    docker start "$P-caddy" > /dev/null
    # Listo cuando los tres certificados de la CA interna existen (HTTPS con SNI responde del eco)
    local h r listo
    for _ in $(seq 1 40); do
        listo=1
        for h in api.localhost panel.localhost portal.localhost; do
            r="$(cliente npm https "$CADDY_NPM" 443 "$h" /listo si)"
            [ "$(campo "$r" status)" = 200 ] || listo=0
        done
        [ "$listo" = 1 ] && return 0
        sleep 1
    done
    docker logs "$P-caddy" 2>&1 | tail -30 >&2
    echo "FALLA Caddy no quedó listo con ARGOSISP_PROXIES_CONFIABLES='$1'" >&2
    exit 1
}

fallas=0
comprobar() { # descripción, respuesta, campo, esperado
    local obtenido
    obtenido="$(campo "$2" "$3")"
    if [ "$obtenido" = "$4" ]; then
        echo "ok    $1"
    else
        echo "FALLA $1: $3='$obtenido', se esperaba '$4' (respuesta: $2)" >&2
        fallas=$((fallas + 1))
    fi
}

# ---------------------------------------------------------------------------
echo "== con ARGOSISP_PROXIES_CONFIABLES=$RED_NPM"
levantar_caddy "$RED_NPM"

r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/version no 'X-Forwarded-For: 198.51.100.7' 'X-Real-IP: 198.51.100.7')"
comprobar 'NPM sin SNI → api: la API ve la IP real' "$r" ip_api 198.51.100.7
comprobar 'NPM sin SNI → api: X-Forwarded-For solo con la IP real' "$r" xff 198.51.100.7
comprobar 'NPM sin SNI → sitio por Host (api)' "$r" servicio api
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/version no 'X-Forwarded-For: 203.0.113.66, 198.51.100.7')"
comprobar 'XFF falso que el cliente mandó a NPM queda fuera' "$r" ip_api 198.51.100.7
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/version no 'X-Real-IP: 198.51.100.9')"
comprobar 'Solo X-Real-IP desde NPM' "$r" ip_api 198.51.100.9
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/version no 'X-Forwarded-For: 2001:db8:a6::7')"
comprobar 'IPv6 del cliente desde NPM' "$r" ip_api 2001:db8:a6::7
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/portal/quien-soy no 'X-Forwarded-For: 198.51.100.7')"
comprobar '/api/v1/portal/* del host de la API' "$r" ip_api 198.51.100.7
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/pasarela/webhook/recurrente no 'X-Forwarded-For: 198.51.100.7')"
comprobar 'Webhook de la pasarela' "$r" ip_api 198.51.100.7
r="$(cliente npm https "$CADDY_NPM" 443 panel.localhost / no 'X-Forwarded-For: 198.51.100.7')"
comprobar 'Panel por Host sin SNI' "$r" servicio web
comprobar 'Panel recibe la IP real' "$r" xff 198.51.100.7
r="$(cliente npm https "$CADDY_NPM" 443 portal.localhost /entrar si 'X-Forwarded-For: 198.51.100.7' 'X-Forwarded-Proto: https')"
comprobar 'Portal por HTTPS recibe la IP real' "$r" xff 198.51.100.7
comprobar 'Portal por HTTPS con X-Forwarded-Proto https' "$r" proto https

r="$(cliente otra https "$CADDY_OTRA" 443 api.localhost /api/v1/version si 'X-Forwarded-For: 198.51.100.7' 'X-Real-IP: 198.51.100.7')"
comprobar 'Fuera de la lista: XFF ignorado, la API ve el socket' "$r" ip_api "$IP_OTRA"
r="$(cliente otra http "$CADDY_OTRA" 80 www.example.com /corte no 'X-Forwarded-For: 198.51.100.7')"
comprobar '/corte por HTTP con cualquier Host llega al portal' "$r" servicio portal
comprobar '/corte de un suspendido (fuera de la lista): XFF ignorado' "$r" xff "$IP_OTRA"
r="$(cliente npm http "$CADDY_NPM" 80 www.example.com /corte no 'X-Forwarded-For: 198.51.100.7')"
comprobar '/corte por HTTP desde NPM también toma la IP real' "$r" xff 198.51.100.7

# ---------------------------------------------------------------------------
echo "== sin ARGOSISP_PROXIES_CONFIABLES (comportamiento de siempre)"
levantar_caddy ""
r="$(cliente npm https "$CADDY_NPM" 443 api.localhost /api/v1/version si 'X-Forwarded-For: 198.51.100.7')"
comprobar 'Sin la variable: XFF de NPM ignorado, la API ve el socket' "$r" ip_api "$IP_NPM"
r="$(cliente npm http "$CADDY_NPM" 80 www.example.com /corte no 'X-Forwarded-For: 198.51.100.7')"
comprobar 'Sin la variable: /corte con la IP del socket' "$r" xff "$IP_NPM"
r="$(cliente npm https "$CADDY_NPM" 443 portal.localhost /entrar si 'X-Forwarded-For: 198.51.100.7')"
comprobar 'Sin la variable: portal con la IP del socket' "$r" xff "$IP_NPM"

if [ "$fallas" -gt 0 ]; then
    docker logs "$P-caddy" 2>&1 | tail -20 >&2
    echo "$fallas comprobaciones fallaron" >&2
    exit 1
fi
echo "OK: detrás de un proxy de confianza la API ve la IP real; de cualquier otro origen, nunca un XFF."
