#!/usr/bin/env bash
# Ensayo de restauración (semana 3, tarea 5; criterio de la semana 4: "restaurar en un entorno
# limpio y levantar el sistema"). Levanta un compose limpio en un proyecto aparte, restaura el
# último respaldo, levanta la API y corre un smoke test (login, lista de clientes y estado de cuenta).
# Al final imprime los tiempos de cada paso y borra todo (contenedores y volúmenes del ensayo).
# Nunca toca el proyecto de producción (`argosisp`) ni sus volúmenes.
#
#   infra/backups/ensayo.sh                       # último respaldo de BACKUP_HOST_DIR (infra/backups/datos)
#   infra/backups/ensayo.sh /ruta/argosisp-<marca>.dump.age
#   infra/backups/ensayo.sh --demo                # sin respaldo a mano: crea uno desde un compose con
#                                                 # pnpm demo:datos y lo restaura (CI y laboratorio)
#   infra/backups/ensayo.sh --conservar ...       # deja el entorno del ensayo levantado para revisarlo
#   infra/backups/ensayo.sh --construir ...       # reconstruye las imágenes aunque ya existan
#
# Variables:
#   ENSAYO_EMAIL, ENSAYO_PASSWORD  usuario del smoke test (uno que exista en el respaldo; por defecto
#                                  SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD del entorno)
#   ENSAYO_API_PORT                puerto local de la API del ensayo (3399)
#   IMAGE_TAG                      imágenes a usar (por defecto `ensayo`: si faltan, se construyen del
#                                  código actual; en el servidor, IMAGE_TAG de producción)
#   BACKUP_CONFIG_DIR              carpeta con age.key si el respaldo está cifrado (infra/backups/config)
#
# Toma infra/.env si existe (mismas claves que producción); si no, infra/.env.example con claves
# de un solo uso.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/.." && pwd)"
RAIZ="$(cd "$INFRA/.." && pwd)"
DEMO=false
CONSERVAR=false
CONSTRUIR=false
RESPALDO=""
while [ $# -gt 0 ]; do
    case "$1" in
        --demo) DEMO=true ;;
        --conservar) CONSERVAR=true ;;
        --construir) CONSTRUIR=true ;;
        -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) RESPALDO="$1" ;;
    esac
    shift
done

ENV_FILE="$INFRA/.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$INFRA/.env.example"
leer_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
# Claves de un solo uso si el archivo no las trae (la imagen corre en producción y las exige)
# (AAA_PPP_KEY: 32 bytes en base64, como en producción)
for clave in APP_KEY AAA_PPP_KEY AAA_INTERNAL_TOKEN; do
    if [ -z "${!clave:-}" ] && [ -z "$(leer_env "$clave")" ]; then
        export "$clave=$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    fi
done
export IMAGE_TAG="${IMAGE_TAG:-ensayo}"
export ENSAYO_API_PORT="${ENSAYO_API_PORT:-3399}"
EMAIL="${ENSAYO_EMAIL:-${SEED_ADMIN_EMAIL:-$(leer_env SEED_ADMIN_EMAIL)}}"
CLAVE="${ENSAYO_PASSWORD:-${SEED_ADMIN_PASSWORD:-$(leer_env SEED_ADMIN_PASSWORD)}}"

SUFIJO="$(date +%s)"
PROYECTO="argosisp-ensayo-$SUFIJO"
ORIGEN="argosisp-ensayo-origen-$SUFIJO"
TMP="$(mktemp -d)"
dc() { docker compose -p "$PROYECTO" --env-file "$ENV_FILE" -f "$INFRA/docker-compose.yml" -f "$INFRA/backups/ensayo.compose.yml" "$@"; }
dco() { docker compose -p "$ORIGEN" --env-file "$ENV_FILE" -f "$INFRA/docker-compose.yml" -f "$INFRA/backups/ensayo.compose.yml" "$@"; }

limpiar() {
    local codigo=$?
    if $CONSERVAR && [ $codigo -eq 0 ]; then
        echo "Entorno conservado: docker compose -p $PROYECTO ... down -v para borrarlo (API en 127.0.0.1:$ENSAYO_API_PORT)"
    else
        ENSAYO_BACKUP_DIR="$TMP" dc down -v --remove-orphans >/dev/null 2>&1 || true
    fi
    ENSAYO_BACKUP_DIR="$TMP" dco down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$TMP"
    exit $codigo
}
trap limpiar EXIT

ahora() { date +%s; }
declare -a PASOS=()
marcar() { PASOS+=("$1|$2"); printf '  %-48s %4s s\n' "$1" "$2"; }
fallar() {
    echo "FALLA: $1" >&2
    dc ps -a >&2 || true
    dc logs --no-color --tail 30 api migrate >&2 || true
    exit 1
}

inicio_total=$(ahora)
echo "Ensayo de restauración · proyecto $PROYECTO · imágenes $IMAGE_TAG · entorno $(basename "$ENV_FILE")"

# 0. Imágenes del código actual: se construyen las que falten (o todas con --construir)
t=$(ahora)
faltan=()
for imagen in api backup; do
    if $CONSTRUIR || ! docker image inspect "argosisp/$imagen:$IMAGE_TAG" >/dev/null 2>&1; then faltan+=("$imagen"); fi
done
if [ ${#faltan[@]} -gt 0 ]; then
    ENSAYO_BACKUP_DIR="$TMP" dc build --quiet "${faltan[@]}" >/dev/null
fi
marcar "imágenes api y backup ($IMAGE_TAG; construidas: ${faltan[*]:-ninguna})" $(($(ahora) - t))

# 0b. --demo: un "producción" de mentira con datos por la API y su respaldo
if $DEMO; then
    t=$(ahora)
    [ -n "$EMAIL" ] || { EMAIL=admin@argosisp.local; CLAVE=admin12345; }
    export SEED_ADMIN_EMAIL="$EMAIL" SEED_ADMIN_PASSWORD="$CLAVE"
    export ENSAYO_API_PORT_ORIGEN=$((ENSAYO_API_PORT + 1))
    mkdir -p "$TMP/respaldos"
    ENSAYO_BACKUP_DIR="$TMP/respaldos" ENSAYO_API_PORT="$ENSAYO_API_PORT_ORIGEN" dco up -d --wait api \
        > "$TMP/origen.log" 2>&1 || { cat "$TMP/origen.log" >&2; fallar "no levantó el origen demo"; }
    API_URL="http://127.0.0.1:$ENSAYO_API_PORT_ORIGEN" DEMO_EMAIL="$EMAIL" DEMO_PASSWORD="$CLAVE" \
        node "$RAIZ/scripts/demo/datos.mjs" > "$TMP/demo.log" 2>&1 || { cat "$TMP/demo.log" >&2; fallar "pnpm demo:datos"; }
    ENSAYO_BACKUP_DIR="$TMP/respaldos" ENSAYO_API_PORT="$ENSAYO_API_PORT_ORIGEN" \
        dco run --rm --no-deps backup respaldar.sh > "$TMP/respaldar.log" 2>&1 ||
        { cat "$TMP/respaldar.log" >&2; fallar "respaldar.sh en el origen demo"; }
    ENSAYO_BACKUP_DIR="$TMP/respaldos" dco down -v --remove-orphans >/dev/null 2>&1
    RESPALDO="$(ls -1t "$TMP"/respaldos/*.dump "$TMP"/respaldos/*.dump.age 2>/dev/null | head -n1 || true)"
    marcar "origen demo: datos por la API y respaldo" $(($(ahora) - t))
fi

# 1. Respaldo a restaurar: el indicado o el más reciente de BACKUP_HOST_DIR
if [ -z "$RESPALDO" ]; then
    dir="$(leer_env BACKUP_HOST_DIR)"
    dir="${BACKUP_HOST_DIR:-${dir:-./backups/datos}}"
    case "$dir" in /*) ;; *) dir="$INFRA/$dir" ;; esac
    RESPALDO="$(ls -1t "$dir"/*.dump "$dir"/*.dump.age 2>/dev/null | head -n1 || true)"
fi
[ -n "$RESPALDO" ] && [ -f "$RESPALDO" ] || fallar "no hay respaldo (pasa la ruta, --demo o revisa BACKUP_HOST_DIR)"
RESPALDO="$(cd "$(dirname "$RESPALDO")" && pwd)/$(basename "$RESPALDO")"
export ENSAYO_BACKUP_DIR="$(dirname "$RESPALDO")"
NOMBRE="$(basename "$RESPALDO")"
echo "Respaldo: $RESPALDO ($(du -h "$RESPALDO" | cut -f1))"
[ -n "$EMAIL" ] && [ -n "$CLAVE" ] || fallar "falta ENSAYO_EMAIL/ENSAYO_PASSWORD (un usuario del respaldo)"

# 2. Postgres limpio (volumen nuevo: init.sql y usuarios.sh crean schemas y roles)
t=$(ahora)
dc up -d --wait postgres >/dev/null || fallar "postgres no levantó"
marcar "postgres limpio" $(($(ahora) - t))

# 3. Restaurar (verifica sha256, filas por tabla y comprobantes)
t=$(ahora)
prefijo="${NOMBRE%.age}"; prefijo="${prefijo%.dump}"
extra=()
if ls "$ENSAYO_BACKUP_DIR/$prefijo".comprobantes.tar.gz* >/dev/null 2>&1; then
    extra=(--comprobantes-dir /comprobantes --reemplazar)
fi
dc run --rm --no-deps backup restaurar.sh "/backups/$NOMBRE" --base argosisp --reemplazar "${extra[@]}" \
    > "$TMP/restaurar.log" 2>&1 || { cat "$TMP/restaurar.log" >&2; fallar "restaurar.sh terminó con error"; }
grep -E 'tablas|comprobantes' "$TMP/restaurar.log" | sed 's/^/    /'
marcar "restaurar.sh (verificado)" $(($(ahora) - t))

# 4. Levantar la API (migrate pone las migraciones al día)
t=$(ahora)
dc up -d --wait api >/dev/null || fallar "la API no quedó sana"
dc logs --no-color migrate 2>/dev/null | grep -Eo 'Already up to date|migrated [^ ]+' | sed 's/^/    migrate: /' | tail -n 5
marcar "migrate + api healthy" $(($(ahora) - t))

# 5. Smoke test
t=$(ahora)
B="http://127.0.0.1:$ENSAYO_API_PORT/api/v1"
peticion() { curl -sS -o "$TMP/r.json" -w '%{http_code}' "$@"; }
codigo=$(peticion -X POST "$B/auth/login" -H 'content-type: application/json' \
    -d "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$CLAVE")")
[ "$codigo" = 200 ] || fallar "login: $codigo $(cat "$TMP/r.json")"
TOKEN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).token)' "$TMP/r.json")
echo "    login: 200"
codigo=$(peticion "$B/clientes?limit=100" -H "authorization: Bearer $TOKEN")
[ "$codigo" = 200 ] || fallar "GET /clientes: $codigo $(cat "$TMP/r.json")"
read -r CLIENTES PRIMERO < <(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1])).data
    console.log(d.length, d[0]?.id ?? "")' "$TMP/r.json")
[ "$CLIENTES" -gt 0 ] || fallar "GET /clientes no devolvió clientes"
echo "    clientes: 200 ($CLIENTES en la primera página)"
codigo=$(peticion "$B/clientes/$PRIMERO/estado-cuenta" -H "authorization: Bearer $TOKEN")
[ "$codigo" = 200 ] || fallar "GET /clientes/$PRIMERO/estado-cuenta: $codigo $(cat "$TMP/r.json")"
echo "    estado de cuenta del cliente $PRIMERO: 200 ($(wc -c < "$TMP/r.json") bytes)"
marcar "smoke test (login, clientes, estado de cuenta)" $(($(ahora) - t))

total=$(($(ahora) - inicio_total))
echo
echo "Tiempos del ensayo"
for p in "${PASOS[@]}"; do printf '  %-48s %4s s\n' "${p%%|*}" "${p##*|}"; done
printf '  %-48s %4s s\n' "TOTAL" "$total"
echo "OK: el respaldo $NOMBRE restaura en un entorno limpio y el sistema arranca."
