# shellcheck shell=bash
# Funciones comunes de los scripts del laboratorio (docs/laboratorio/validacion-fisica.md).
# No se ejecuta solo: lo cargan los demás con `source`.
#
# Corren en el servidor donde se instaló ArgosIsp con instalar.sh (necesitan root: leen
# /opt/argosisp/.env). Solo usan bash, curl, jq y docker, que el instalador ya dejó.
#
# Variables (todas opcionales):
#   ARGOSISP_DIR    instalación (/opt/argosisp)
#   LAB_SALIDA      carpeta de resultados (/root/argosisp-lab/salida)
#   LAB_EMAIL       usuario del panel (SEED_ADMIN_EMAIL del .env)
#   LAB_PASSWORD    su clave (SEED_ADMIN_PASSWORD del .env; pásala si ya la cambiaste)
#   LAB_ROUTER_SSH  admin@<ip-del-mikrotik> para `ros` (comandos de RouterOS por SSH)
set -Eeuo pipefail

ARGOSISP_DIR="${ARGOSISP_DIR:-/opt/argosisp}"
LAB_DIR="${LAB_DIR:-/root/argosisp-lab}"
LAB_SALIDA="${LAB_SALIDA:-$LAB_DIR/salida}"
LAB_CREDENCIALES="$LAB_DIR/credenciales-lab.txt"
LAB_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_REPO="$(cd "$LAB_SCRIPTS/../.." && pwd)"

log() { printf '\033[1m[lab]\033[0m %s\n' "$*" >&2; }
ok() { printf '\033[32m[ ok]\033[0m %s\n' "$*" >&2; }
aviso() { printf '\033[33m[ ¡!]\033[0m %s\n' "$*" >&2; }
fallar() {
    printf '\033[31m[mal]\033[0m %s\n' "$*" >&2
    exit 1
}

[ "$(id -u)" = 0 ] || fallar "corre este script con sudo (lee $ARGOSISP_DIR/.env)"
[ -f "$ARGOSISP_DIR/.env" ] || fallar "no hay $ARGOSISP_DIR/.env: instala ArgosIsp primero (paso 1.3 de la guía)"
for c in curl jq docker; do command -v "$c" > /dev/null || fallar "falta $c"; done
mkdir -p "$LAB_SALIDA"
chmod 700 "$LAB_DIR"

# Lee una variable del .env sin ejecutarlo (puede tener comillas).
env_de() {
    sed -n "s/^$1=//p" "$ARGOSISP_DIR/.env" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

DOMINIO_API="$(env_de DOMINIO_API)"
LAB_EMAIL="${LAB_EMAIL:-$(env_de SEED_ADMIN_EMAIL)}"
LAB_PASSWORD="${LAB_PASSWORD:-$(env_de SEED_ADMIN_PASSWORD)}"
RADIUS_LOCAL_SECRET="$(env_de RADIUS_LOCAL_SECRET)"

# docker compose del proyecto con la versión instalada.
dc() { argosisp compose "$@"; }

# CA de Caddy si la instalación usa certificados internos (ARGOSISP_TLS=interno); si no, la del sistema.
LAB_CURL_TLS=()
if grep -q '^PROXY_TLS_GLOBAL=.*local_certs' "$ARGOSISP_DIR/.env"; then
    mkdir -p "$LAB_DIR"
    dc exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "$LAB_DIR/caddy-ca.crt" 2> /dev/null ||
        fallar "no pude leer la CA interna de Caddy"
    LAB_CURL_TLS=(--cacert "$LAB_DIR/caddy-ca.crt")
fi
# Siempre por el proxy local, aunque el DNS del dominio aún no apunte al servidor.
LAB_API="https://$DOMINIO_API/api/v1"
LAB_CURL=(curl -sS --max-time 30 "${LAB_CURL_TLS[@]}" --resolve "$DOMINIO_API:443:127.0.0.1")

LAB_TOKEN=""
api_login() {
    [ -n "$LAB_TOKEN" ] && return 0
    LAB_TOKEN="$("${LAB_CURL[@]}" -X POST "$LAB_API/auth/login" -H 'content-type: application/json' \
        -d "$(jq -n --arg e "$LAB_EMAIL" --arg p "$LAB_PASSWORD" '{email: $e, password: $p}')" |
        jq -r '.token // empty')"
    [ -n "$LAB_TOKEN" ] || fallar "login en la API falló ($LAB_EMAIL). Si cambiaste la clave del admin: LAB_PASSWORD='...' sudo -E $0"
}

# api <MÉTODO> <ruta bajo /api/v1> [cuerpo JSON]: imprime el cuerpo; falla con el problem+json si no es 2xx.
api() {
    api_login
    local respuesta codigo cuerpo=()
    [ -n "${3:-}" ] && cuerpo=(-d "$3")
    respuesta="$("${LAB_CURL[@]}" -X "$1" "$LAB_API$2" -w '\n%{http_code}' \
        -H "authorization: Bearer $LAB_TOKEN" -H 'content-type: application/json' \
        "${cuerpo[@]}")"
    codigo="${respuesta##*$'\n'}"
    respuesta="${respuesta%$'\n'*}"
    if [ "${codigo:0:1}" != 2 ]; then
        printf '%s %s → %s %s\n' "$1" "$2" "$codigo" "$respuesta" >&2
        return 1
    fi
    printf '%s' "$respuesta"
}

# sql "<consulta>": psql dentro del contenedor de Postgres (salida alineada, legible).
sql() { dc exec -T postgres psql -U argosisp -d argosisp -P pager=off -c "$1"; }
# sql_valor "<consulta>": un valor, sin formato.
sql_valor() { dc exec -T postgres psql -U argosisp -d argosisp -At -c "$1"; }
redis() { dc exec -T redis redis-cli "$@"; }

# Carpeta de una prueba: $LAB_SALIDA/<prueba>.
prueba_dir() {
    local d="$LAB_SALIDA/$1"
    mkdir -p "$d"
    printf '%s' "$d"
}

# guardar <prueba> <nombre> <comando...>: corre el comando y guarda la salida (y la hora) en
# $LAB_SALIDA/<prueba>/<nombre>.txt; también la muestra. No corta el script si el comando falla.
guardar() {
    local d f
    d="$(prueba_dir "$1")"
    f="$d/$2.txt"
    shift 2
    {
        printf '# %s\n# %s\n' "$(date -u +%FT%TZ)" "$*"
        "$@" 2>&1 || printf '# (salió con %s)\n' "$?"
    } | tee -a "$f"
}

# ros <prueba> <nombre> '<comando RouterOS>': lo corre en el MikroTik por SSH y guarda la salida.
ros() {
    [ -n "${LAB_ROUTER_SSH:-}" ] || {
        aviso "LAB_ROUTER_SSH no está definido: corre en el MikroTik '$3' y pega la salida en $(prueba_dir "$1")/$2.txt"
        return 0
    }
    guardar "$1" "$2" ssh -o BatchMode=yes -o ConnectTimeout=5 "$LAB_ROUTER_SSH" "$3"
}

# Datos que dejó 01-datos.sh.
datos() {
    local f="$LAB_SALIDA/01-datos/datos.json"
    [ -f "$f" ] || fallar "falta $f: corre primero sudo scripts/laboratorio/01-datos.sh"
    jq -r "$1" "$f"
}

# id del servicio de un user_ppp.
servicio_id() {
    api GET "/servicios?q=$1&empresas=todas&limit=5" | jq -r --arg u "$1" '.data[] | select(.user_ppp == $u) | .id' | head -n1
}
