#!/usr/bin/env bash
# Prueba de punta a punta final (A6): instala desde cero una versión PUBLICADA (instalar.sh de su
# GitHub Release e imágenes de GHCR), carga los datos de demostración por la API, recorre los
# chequeos de humo y actualiza y revierte comprobando los datos después de cada paso.
#
#   infra/ci/e2e-final.sh <versión> [<siguiente>]
#   infra/ci/e2e-final.sh 0.9.0              # actualiza a una copia local de 0.9.0 (mecanismo)
#   infra/ci/e2e-final.sh 0.9.0 0.10.0       # actualiza a 0.10.0 publicada y revierte a 0.9.0
#
# En un runner limpio (sudo sin contraseña, Docker, curl, jq, Node y pnpm), como el job
# `distribucion` de ci.yml; workflow: .github/workflows/e2e-final.yml (workflow_dispatch).
# Necesita leer las imágenes de GHCR (`docker login ghcr.io` si los paquetes son privados).
#
# Pasos:
#   1. Descarga instalar.sh de la Release v<versión> y lo corre con --version (descarga el paquete
#      de la Release y las imágenes; TLS de la CA interna de Caddy, dominio argosisp.test).
#   2. `pnpm demo:datos` contra https://api.argosisp.test (scripts/demo/datos.mjs del checkout).
#   3. Humo por la API: login, clientes, servicios, facturas del periodo, el pago de la demo, el
#      portal (quien-soy, código por correo → verificar → cuenta) y GET /api/v1/version. El código
#      del portal llega a un Mailpit conectado a la red del compose (SMTP configurado por la API).
#   4. Huella de los datos (clientes, servicios, pagos y facturas pagadas del cliente que pagó).
#      `argosisp actualizar` a <siguiente> y `argosisp revertir`: después de cada paso, misma
#      huella, versión esperada y humo completo. Sin <siguiente> se actualiza a <versión> con el
#      parche +1000 (0.9.0 → 0.9.1000): el paquete y las imágenes publicados de <versión> con otra
#      etiqueta, en una fuente local (ARGOSISP_FUENTE, ARGOSISP_SIN_DESCARGA=1). Prueba el
#      mecanismo (respaldo, cambio, migraciones, verificación y reversión con el respaldo) sin que
#      exista todavía una versión nueva.
#
# Variables: ARGOSISP_REPO (HCDestroyer/argos-isp), ARGOSISP_REGISTRO (ghcr.io/hcdestroyer),
# ARGOSISP_DIR (/opt/argosisp-e2e), ARGOSISP_ESPERA_S (600), MAILPIT_IMAGEN, CONSERVAR=1 (no borra
# la instalación al terminar, para revisarla).
set -Eeuo pipefail

if [ $# -lt 1 ] || [ $# -gt 2 ]; then sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 2; fi
V1="${1#v}"
V2="${2:-}"
V2="${V2#v}"
semver='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ "$V1" =~ $semver ]] || { echo "versión inválida: $V1" >&2; exit 2; }
SIMULADA=false
if [ -z "$V2" ]; then
    SIMULADA=true
    V2="${V1%.*}.$((${V1##*.} + 1000))"
fi
[[ "$V2" =~ $semver ]] || { echo "versión siguiente inválida: $V2" >&2; exit 2; }

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="${ARGOSISP_REPO:-HCDestroyer/argos-isp}"
REG="${ARGOSISP_REGISTRO:-ghcr.io/hcdestroyer}"
DIR="${ARGOSISP_DIR:-/opt/argosisp-e2e}"
ESPERA="${ARGOSISP_ESPERA_S:-600}"
DOMINIO=argosisp.test
CORREO=admin@argosisp.test
API="https://api.$DOMINIO"
IMAGENES=(api web portal aaa coa backup freeradius)
MAILPIT_IMAGEN="${MAILPIT_IMAGEN:-axllent/mailpit:v1.31.3}"
MAILPIT=argosisp-e2e-mailpit
MAILPIT_URL=http://127.0.0.1:18025
MAILPIT_SMTP=1025
MARCA_HOSTS="# argosisp-e2e"
TMP="$(mktemp -d)"
FUENTE="$TMP/fuente"
CA="$TMP/ca.crt"
inicio=$SECONDS
TOKEN=""

paso() { printf '\n\033[1m[%4ss] %s\033[0m\n' "$((SECONDS - inicio))" "$*"; }
ok() { echo "    ✓ $*"; }
fallar() { printf '\033[31mFALLÓ:\033[0m %s\n' "$*" >&2; exit 1; }

# `argosisp` de la instalación; con FUENTE local solo para la versión simulada
cli() {
    if $SIMULADA; then
        sudo env ARGOSISP_DIR="$DIR" ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 \
            ARGOSISP_ESPERA_S="$ESPERA" /usr/local/bin/argosisp "$@"
    else
        sudo env ARGOSISP_DIR="$DIR" ARGOSISP_ESPERA_S="$ESPERA" /usr/local/bin/argosisp "$@"
    fi
}

terminar() {
    local codigo=$?
    if [ "$codigo" != 0 ] && [ -f "$DIR/.env" ]; then
        echo "::group::estado y registros de los servicios"
        cli compose ps -a || true
        cli compose logs --no-color --tail 80 || true
        sudo sh -c "tail -n 80 $DIR/registros/*.log" || true
        echo "::endgroup::"
    fi
    if [ "${CONSERVAR:-0}" != 1 ]; then
        docker rm -f "$MAILPIT" > /dev/null 2>&1 || true
        if [ -f "$DIR/.env" ]; then
            cli compose down -v --remove-orphans > /dev/null 2>&1 || true
            sudo rm -rf "$DIR" /usr/local/bin/argosisp
        fi
        sudo sed -i "/$MARCA_HOSTS\$/d" /etc/hosts || true
    fi
    rm -rf "$TMP"
    exit "$codigo"
}
trap terminar EXIT

# ── API ──────────────────────────────────────────────────────────────────────────────────────
# Petición con el token del admin; falla si el estado no es 2xx. Uso: pedir GET /clientes?limit=200
pedir() {
    local metodo="$1" ruta="$2" cuerpo="${3:-}" salida codigo
    local -a args=(-sS --cacert "$CA" -X "$metodo" -H "authorization: Bearer $TOKEN" -w '\n%{http_code}')
    [ -z "$cuerpo" ] || args+=(-H 'content-type: application/json' -d "$cuerpo")
    salida="$(curl "${args[@]}" "$API/api/v1$ruta")"
    codigo="${salida##*$'\n'}"
    [[ "$codigo" =~ ^2 ]] || fallar "$metodo $ruta respondió $codigo: ${salida%$'\n'*}"
    printf '%s' "${salida%$'\n'*}"
}

password_admin() { sudo grep -E '^SEED_ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-; }

iniciar_sesion() {
    TOKEN="$(curl -sS --cacert "$CA" -X POST "$API/api/v1/auth/login" -H 'content-type: application/json' \
        -d "$(jq -n --arg e "$CORREO" --arg p "$(password_admin)" '{email: $e, password: $p}')" |
        jq -r '.token // empty')"
    [ -n "$TOKEN" ] || fallar "login del admin"
    ok "login"
}

# CA interna de Caddy (TLS de api.argosisp.test) para curl y Node
leer_ca() {
    local _
    for _ in $(seq 1 30); do
        cli compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "$CA" 2> /dev/null && [ -s "$CA" ] && return 0
        sleep 2
    done
    fallar "no pude leer la CA interna de Caddy"
}

# ── Portal: código por correo (Mailpit) ──────────────────────────────────────────────────────
levantar_mailpit() {
    docker rm -f "$MAILPIT" > /dev/null 2>&1 || true
    docker run -d --name "$MAILPIT" --network argosisp_default -p 127.0.0.1:18025:8025 "$MAILPIT_IMAGEN" > /dev/null
    local _
    for _ in $(seq 1 30); do curl -fs "$MAILPIT_URL/api/v1/info" > /dev/null && break; sleep 1; done
    curl -fs "$MAILPIT_URL/api/v1/info" > /dev/null || fallar "Mailpit no responde"
}

# SMTP de notify hacia Mailpit, por la API (lo que haría el operador en el panel)
configurar_correo() {
    local version
    version="$(pedir GET /notificaciones/configuracion | jq -r '.version // 0')"
    pedir PUT /notificaciones/configuracion "$(jq -n --argjson v "$version" --arg h "$MAILPIT" --argjson p "$MAILPIT_SMTP" '{
        version: $v,
        correo: {activo: true, host: $h, puerto: $p, tls: "ninguno", remitente: "no-responder@argosisp.test",
                 nombre_visible: "ArgosIsp e2e"}
    }')" > /dev/null
    ok "correo de notificaciones → Mailpit"
}

# Código de 6 dígitos del primer correo que llegue a <correo> (el buzón se vacía antes de pedirlo)
codigo_de() {
    local correo="$1" _ id
    for _ in $(seq 1 60); do
        id="$(curl -fs "$MAILPIT_URL/api/v1/search?query=$(jq -rn --arg c "to:$correo" '$c|@uri')" |
            jq -r '.messages | first | .ID // empty')"
        if [ -n "$id" ]; then
            curl -fs "$MAILPIT_URL/api/v1/message/$id" | jq -r '(.Subject // "") + " " + (.Text // "")' |
                grep -oE '\b[0-9]{6}\b' | head -n1
            return 0
        fi
        sleep 1
    done
    return 1
}

# Portal de punta a punta con el cliente <n> (de los que tienen correo y NIT): quien-soy por IP,
# código por correo, verificar (cookie) y cuenta. Un cliente distinto en cada paso: el límite de
# códigos por hora es por cliente.
humo_portal() {
    local n="$1" cliente nit correo solicitud codigo jar cuerpo estado
    jar="$TMP/portal-$n.cookies"
    # quien-soy: público; el runner no es la IP de ningún servicio
    cuerpo="$(curl -sS --cacert "$CA" "$API/api/v1/portal/quien-soy")"
    [ "$(jq -r '.identificado' <<< "$cuerpo")" = false ] || fallar "portal/quien-soy: $cuerpo"
    estado="$(curl -sS --cacert "$CA" -o /dev/null -w '%{http_code}' "$API/api/v1/portal/cuenta")"
    [ "$estado" = 401 ] || fallar "portal/cuenta sin sesión respondió $estado (se esperaba 401)"
    cliente="$(pedir GET '/clientes?limit=200' |
        jq -c --argjson n "$n" '[.data[] | select(.nit_cui != "CF" and (.email // "") != "" and .canal_preferido == "correo")] | sort_by(.id) | .[$n]')"
    [ "$cliente" != null ] || fallar "no hay un cliente $n con correo y NIT para el portal"
    nit="$(jq -r .nit_cui <<< "$cliente")"
    correo="$(jq -r .email <<< "$cliente")"
    curl -fs -X DELETE "$MAILPIT_URL/api/v1/messages" > /dev/null || fallar "no pude vaciar Mailpit"
    solicitud="$(curl -sS --cacert "$CA" -X POST "$API/api/v1/portal/codigo" -H 'content-type: application/json' \
        -d "$(jq -n --arg i "$nit" '{identificador: $i}')" | jq -r '.solicitud // empty')"
    [ -n "$solicitud" ] || fallar "portal/codigo no devolvió solicitud"
    codigo="$(codigo_de "$correo")" || fallar "no llegó el código del portal a $correo (Mailpit)"
    [ -n "$codigo" ] || fallar "el correo del portal no trae un código de 6 dígitos"
    estado="$(curl -sS --cacert "$CA" -c "$jar" -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/portal/verificar" \
        -H 'content-type: application/json' -d "$(jq -n --arg s "$solicitud" --arg c "$codigo" '{solicitud: $s, codigo: $c}')")"
    [ "$estado" = 200 ] || fallar "portal/verificar respondió $estado"
    cuerpo="$(curl -sS --cacert "$CA" -b "$jar" "$API/api/v1/portal/cuenta")"
    jq -e --arg nit "$nit" '.cliente.nit_cui == $nit and (.servicios | type == "array")' <<< "$cuerpo" > /dev/null ||
        fallar "portal/cuenta con sesión no es la del cliente $nit: $cuerpo"
    ok "portal: quien-soy, código por correo, verificar y cuenta ($correo)"
}

# ── Humo y huella ────────────────────────────────────────────────────────────────────────────
# Datos que deben sobrevivir a actualizar y revertir. Sin estados ni facturas que los crons
# pueden mover mientras corre la prueba (generar, vencer, corte): clientes, servicios, pagos y
# las facturas pagadas del cliente que pagó en la demo.
huella() {
    local pagos pagador
    pagos="$(pedir GET '/pagos?limit=200' | jq -c '[.data[] | {id, cliente_id, monto, metodo, estado}] | sort_by(.id)')"
    pagador="$(jq -r '[.[] | select(.metodo == "transferencia")] | first | .cliente_id // empty' <<< "$pagos")"
    jq -n --argjson clientes "$(pedir GET '/clientes?limit=200' | jq -c '[.data[] | {id, nit_cui}] | sort_by(.id)')" \
        --argjson servicios "$(pedir GET '/servicios?limit=200' | jq -c '[.data[] | {id, cliente_id, user_ppp}] | sort_by(.id)')" \
        --argjson pagos "$pagos" \
        --argjson pagadas "$(pedir GET "/facturas?cliente_id=$pagador&estado=pagada&limit=200" | jq -c '[.data[] | {id, total}] | sort_by(.id)')" \
        '{clientes: $clientes, servicios: $servicios, pagos: $pagos, facturas_pagadas: $pagadas}'
}

humo() {
    local version="$1" n_portal="$2" clientes servicios facturas pagos pagador saldo
    iniciar_sesion
    clientes="$(pedir GET '/clientes?limit=200' | jq '.data | length')"
    [ "$clientes" -ge 8 ] || fallar "clientes: $clientes (la demo crea 8)"
    ok "clientes: $clientes"
    servicios="$(pedir GET '/servicios?limit=200')"
    [ "$(jq '.data | length' <<< "$servicios")" -ge 7 ] || fallar "servicios: $(jq '.data | length' <<< "$servicios") (la demo crea 7)"
    [ "$(jq '[.data[] | select(.estado == "retirado")] | length' <<< "$servicios")" -ge 1 ] || fallar "falta el servicio retirado de la demo"
    ok "servicios: $(jq '.data | length' <<< "$servicios") ($(jq -r '[.data[].estado] | group_by(.) | map("\(.[0]) \(length)") | join(", ")' <<< "$servicios"))"
    facturas="$(pedir GET '/facturas?tipo=servicio&limit=200')"
    [ "$(jq '.data | length' <<< "$facturas")" -ge 1 ] || fallar "no hay facturas del periodo"
    ok "facturas del periodo: $(jq '.data | length' <<< "$facturas")"
    pagos="$(pedir GET '/pagos?limit=200')"
    pagador="$(jq -r '[.data[] | select(.metodo == "transferencia")] | first | .cliente_id // empty' <<< "$pagos")"
    [ -n "$pagador" ] || fallar "no está el pago por transferencia de la demo"
    pedir GET "/pagos/$(jq -r '[.data[] | select(.metodo == "transferencia")] | first | .id' <<< "$pagos")" > /dev/null
    saldo="$(pedir GET "/clientes/$pagador/estado-cuenta" | jq -r .saldo)"
    [ "$saldo" = 0.00 ] || [ "$saldo" = 0 ] || fallar "el cliente que pagó tiene saldo $saldo (se esperaba 0.00)"
    ok "pago: cliente $pagador al día (saldo $saldo)"
    humo_portal "$n_portal"
    [ "$(pedir GET /version | jq -r .version)" = "$version" ] || fallar "GET /api/v1/version no es $version"
    [ "$(cli version)" = "$version" ] || fallar "argosisp version no es $version"
    ok "versión $version (API y .env)"
}

comparar_huella() {
    local esperada="$1" leida
    leida="$(huella)"
    if [ "$leida" != "$esperada" ]; then
        diff <(jq . <<< "$esperada") <(jq . <<< "$leida") >&2 || true
        fallar "los datos cambiaron después de: $2"
    fi
    ok "datos iguales que antes ($2)"
}

# ---------------------------------------------------------------------------
command -v jq > /dev/null || fallar "falta jq"
command -v node > /dev/null || fallar "falta Node (pnpm demo:datos)"
paso "e2e final: $V1 publicada → $V2$($SIMULADA && echo " (copia local de $V1)") → revertir a $V1"

paso "instalar.sh de la Release v$V1 (paquete e imágenes publicados)"
curl -fsSL --retry 3 -o "$TMP/instalar.sh" "https://github.com/$REPO/releases/download/v$V1/instalar.sh" ||
    fallar "la Release v$V1 no tiene instalar.sh (¿la publicación sigue en curso?)"
sudo sed -i "/$MARCA_HOSTS\$/d" /etc/hosts
for h in api panel portal; do echo "127.0.0.1 $h.$DOMINIO $MARCA_HOSTS" | sudo tee -a /etc/hosts > /dev/null; done
sudo env ARGOSISP_TLS=interno ARGOSISP_ESPERA_S="$ESPERA" ARGOSISP_REGISTRO="$REG" ARGOSISP_REPO="$REPO" \
    bash "$TMP/instalar.sh" --version "$V1" --dominio "$DOMINIO" --correo "$CORREO" --dir "$DIR" --si
[ "$(readlink "$DIR/actual")" = "versiones/$V1" ] || fallar "actual no apunta a $V1"
leer_ca
[ "$(curl -sS --cacert "$CA" -o /dev/null -w '%{http_code}' "$API/health")" = 200 ] || fallar "/health por el proxy"
ok "instalada $V1"

paso "datos de demostración (pnpm demo:datos)"
iniciar_sesion
(
    cd "$RAIZ"
    DEMO_PASSWORD="$(password_admin)"
    export API_URL="$API" DEMO_EMAIL="$CORREO" DEMO_PASSWORD NODE_EXTRA_CA_CERTS="$CA"
    if command -v pnpm > /dev/null; then pnpm --silent demo:datos; else node scripts/demo/datos.mjs; fi
)
levantar_mailpit
configurar_correo

paso "humo en $V1"
humo "$V1" 0
antes="$(huella)"
ok "huella: $(jq -c '{clientes: (.clientes|length), servicios: (.servicios|length), pagos: (.pagos|length), facturas_pagadas: (.facturas_pagadas|length)}' <<< "$antes")"

paso "actualizar $V1 → $V2"
if $SIMULADA; then
    mkdir -p "$FUENTE" "$TMP/paquete"
    base="https://github.com/$REPO/releases/download/v$V1"
    curl -fsSL --retry 3 -o "$TMP/paquete/argosisp-$V1.tar.gz" "$base/argosisp-$V1.tar.gz"
    curl -fsSL --retry 3 -o "$TMP/paquete/argosisp-$V1.tar.gz.sha256" "$base/argosisp-$V1.tar.gz.sha256"
    (cd "$TMP/paquete" && sha256sum -c --quiet "argosisp-$V1.tar.gz.sha256") || fallar "la suma del paquete $V1 no coincide"
    tar -xzf "$TMP/paquete/argosisp-$V1.tar.gz" -C "$TMP/paquete"
    mv "$TMP/paquete/argosisp-$V1" "$TMP/paquete/argosisp-$V2"
    echo "$V2" > "$TMP/paquete/argosisp-$V2/VERSION"
    tar -czf "$FUENTE/argosisp-$V2.tar.gz" -C "$TMP/paquete" "argosisp-$V2"
    (cd "$FUENTE" && sha256sum "argosisp-$V2.tar.gz" > "argosisp-$V2.tar.gz.sha256")
    echo "$V2" > "$FUENTE/estable"
    for img in "${IMAGENES[@]}"; do
        printf 'FROM %s\nENV ARGOSISP_VERSION=%s\n' "$REG/argosisp-$img:$V1" "$V2" |
            docker build -q -t "$REG/argosisp-$img:$V2" - > /dev/null
    done
    ok "paquete e imágenes $V2 = las publicadas de $V1 con otra etiqueta"
fi
cli actualizar --version "$V2" --si
[ "$(readlink "$DIR/actual")" = "versiones/$V2" ] || fallar "actual no apunta a $V2"
sudo test -n "$(sudo ls "$DIR/respaldos/actualizaciones")" || fallar "no quedó el respaldo previo a la actualización"
humo "$V2" 1
comparar_huella "$antes" "actualizar a $V2"

paso "argosisp revertir → $V1 (con el respaldo previo a la actualización)"
cli revertir --si
[ "$(readlink "$DIR/actual")" = "versiones/$V1" ] || fallar "actual no volvió a $V1"
humo "$V1" 2
comparar_huella "$antes" "revertir a $V1"

paso "listo: instalar $V1 → demo → humo → actualizar a $V2 → revertir a $V1, datos intactos"
