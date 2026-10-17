#!/usr/bin/env bash
# Prueba el proxy del portal (infra/proxy/Caddyfile.portal) contra un portal de eco:
#   - /corte por HTTP con cualquier Host (dst-nat de los suspendidos) llega al portal, sin redirigir;
#   - /entrar y /cuenta por HTTP en el dominio del portal → 308 a HTTPS (en otro Host, no);
#   - por HTTPS responde con HSTS y X-Forwarded-Proto https;
#   - un X-Forwarded-For enviado por el cliente se descarta (el portal recibe la IP real).
# Usa el binario `caddy` si existe (o CADDY=<ruta>); si no, la imagen caddy:2.10.0-alpine con red
# del host. Necesita node y curl.
#
#   infra/proxy/probar-portal.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HTTP=18180
HTTPS=18543
ECO=13901
DOMINIO=portal.localhost
TMP="$(mktemp -d)"
PIDS=()

limpiar() {
    for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
    docker rm -f argosisp-prueba-portal-proxy >/dev/null 2>&1 || true
    rm -rf "$TMP"
}
trap limpiar EXIT

cat >"$TMP/eco.mjs" <<'EOF'
import http from 'node:http'
http.createServer((q, r) => {
    r.setHeader('content-type', 'application/json')
    r.end(JSON.stringify({ url: q.url, host: q.headers.host, xff: q.headers['x-forwarded-for'] ?? null, proto: q.headers['x-forwarded-proto'] ?? null }))
}).listen(Number(process.argv[2]), '127.0.0.1')
EOF
node "$TMP/eco.mjs" "$ECO" &
PIDS+=($!)
# El portal de eco debe responder antes de medir el proxy (si no, Caddy da 502)
for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://127.0.0.1:$ECO/" && break
    sleep 0.5
done

ENTORNO=(
    PORTAL_PROXY_HTTP_PUERTO=$HTTP
    PORTAL_PROXY_HTTPS_PUERTO=$HTTPS
    PORTAL_UPSTREAM=127.0.0.1:$ECO
    PORTAL_DOMINIO=$DOMINIO
    PORTAL_TLS=internal
    PORTAL_HSTS_MAX_AGE=300
)
CADDY="${CADDY:-$(command -v caddy || true)}"
if [[ -n "$CADDY" ]]; then
    env "${ENTORNO[@]}" HOME="$TMP" "$CADDY" run --adapter caddyfile --config "$DIR/Caddyfile.portal" >"$TMP/caddy.log" 2>&1 &
    PIDS+=($!)
else
    args=()
    for v in "${ENTORNO[@]}"; do args+=(-e "$v"); done
    docker run -d --rm --name argosisp-prueba-portal-proxy --network host "${args[@]}" \
        -v "$DIR/Caddyfile.portal:/etc/caddy/Caddyfile:ro" caddy:2.10.0-alpine >/dev/null
fi

# Caddy listo: HTTP llega al eco (200) y HTTPS ya tiene su certificado interno
for _ in $(seq 1 30); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HTTP/corte")" == 200 ]] &&
        curl -sk -o /dev/null --resolve "$DOMINIO:$HTTPS:127.0.0.1" "https://$DOMINIO:$HTTPS/" && break
    sleep 1
done

fallas=0
comprobar() { # descripción, condición
    if eval "$2"; then echo "ok   $1"; else echo "FALLA $1" >&2; fallas=$((fallas + 1)); fi
}

r=$(curl -s -i -H 'Host: www.example.com' -H 'X-Forwarded-For: 203.0.113.66' "http://127.0.0.1:$HTTP/corte")
comprobar '/corte por HTTP con otro Host llega al portal' '[[ "$r" == *"HTTP/1.1 200"* && "$r" == *"\"url\":\"/corte\""* ]]'
comprobar 'X-Forwarded-For del cliente descartado' '[[ "$r" == *"\"xff\":\"127.0.0.1\""* ]]'
comprobar 'HTTP sin HSTS' '[[ "${r,,}" != *"strict-transport-security"* ]]'

r=$(curl -s -i -H "Host: $DOMINIO" "http://127.0.0.1:$HTTP/corte")
comprobar '/corte por HTTP en el dominio del portal no redirige' '[[ "$r" == *"HTTP/1.1 200"* ]]'

for ruta in /entrar '/entrar?siguiente=/cuenta' /cuenta /cuenta/facturas; do
    r=$(curl -s -i -H "Host: $DOMINIO" "http://127.0.0.1:$HTTP$ruta")
    comprobar "$ruta por HTTP → 308 a HTTPS" '[[ "$r" == *"308"* && "${r,,}" == *"location: https://$DOMINIO$ruta"* ]]'
done

r=$(curl -s -i -H 'Host: 192.0.2.20' "http://127.0.0.1:$HTTP/entrar")
comprobar '/entrar por IP (portal cautivo) no redirige' '[[ "$r" == *"HTTP/1.1 200"* ]]'

r=$(curl -sk -i --resolve "$DOMINIO:$HTTPS:127.0.0.1" -H 'X-Forwarded-For: 203.0.113.66' "https://$DOMINIO:$HTTPS/entrar")
comprobar '/entrar por HTTPS llega al portal' '[[ "$r" == *" 200"* && "$r" == *"\"url\":\"/entrar\""* ]]'
comprobar 'HTTPS con HSTS' '[[ "${r,,}" == *"strict-transport-security: max-age=300"* ]]'
comprobar 'HTTPS con X-Forwarded-Proto https' '[[ "$r" == *"\"proto\":\"https\""* ]]'
comprobar 'HTTPS descarta X-Forwarded-For del cliente' '[[ "$r" == *"\"xff\":\"127.0.0.1\""* ]]'

if ((fallas > 0)); then
    [[ -f "$TMP/caddy.log" ]] && tail -20 "$TMP/caddy.log" >&2
    docker logs argosisp-prueba-portal-proxy 2>/dev/null | tail -20 >&2 || true
    exit 1
fi
echo "OK: proxy del portal: /corte por HTTP, /entrar y /cuenta por HTTPS con HSTS, IP real."
