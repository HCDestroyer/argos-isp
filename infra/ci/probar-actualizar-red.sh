#!/usr/bin/env bash
# `argosisp actualizar`, `levantar`, `revertir` y `reparar-red` cuando la red de compose ya no
# coincide con la config (1.5.0 en producción: COMPOSE_SUBNET_V4 cambiado en el .env).
#
# Compose recrea la red del proyecto cuando su config cambió, pero solo detiene los contenedores de
# los servicios del comando: el `up -d --wait postgres` del respaldo previo, con redis y backup
# arriba, fallaba con «network argosisp_default has active endpoints», y el `up` completo de la
# vuelta a 1.4.0 dejaba contenedores con el id de una red borrada («network … not found»). Hasta
# 1.5.0 la actualización se cancelaba y dejaba ArgosIsp caído.
#
# Con la CLI real (infra/produccion/argosisp) y una instalación de juguete: el compose tiene los
# mismos servicios de datos (postgres, redis, backup, permisos), migrate, api y api-portal, con
# alpine y node:22-alpine, y un respaldar.sh/restaurar.sh falsos. Sin imágenes de ArgosIsp: corre en
# segundos en cualquier runner con Docker y compose.
#
#   infra/ci/probar-actualizar-red.sh          (necesita Docker con compose, jq, alpine y node:22-alpine)
#   ARGOSISP_CLI=/ruta/a/argosisp infra/ci/probar-actualizar-red.sh   (otra versión de la CLI)
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="${ARGOSISP_CLI:-$RAIZ/infra/produccion/argosisp}"
P="argosisp-prueba-act-$$"
DIR="$(mktemp -d)"
RED_A=10.213.70.0/26
RED_B=10.213.71.0/26
RED_C=10.213.72.0/26
RED_D=10.213.73.0/26
RED_E=10.213.74.0/26
inicio=$SECONDS

paso() { printf '\n\033[1m[%4ss] %s\033[0m\n' "$((SECONDS - inicio))" "$*"; }
fallar() { printf '\033[31mFALLÓ:\033[0m %s\n' "$*" >&2; exit 1; }

cli() { ARGOSISP_DIR="$DIR" ARGOSISP_FUENTE="$DIR/fuente" ARGOSISP_SIN_DESCARGA=1 ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-90}" "$CLI" "$@"; }

terminar() {
    local codigo=$?
    if [ "$codigo" != 0 ]; then
        echo "::group::contenedores, redes y registros"
        docker ps -a --filter "label=com.docker.compose.project=$P" --format '{{.Names}} {{.Status}}' || true
        docker network ls --filter "name=$P" || true
        tail -n 60 "$DIR"/registros/*.log 2> /dev/null || true
        echo "::endgroup::"
    fi
    local -a ids
    mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$P")
    [ "${#ids[@]}" = 0 ] || docker rm -f "${ids[@]}" > /dev/null 2>&1 || true
    mapfile -t ids < <(docker network ls -q --filter "label=com.docker.compose.project=$P")
    [ "${#ids[@]}" = 0 ] || docker network rm "${ids[@]}" > /dev/null 2>&1 || true
    # Los respaldos los escribe el contenedor (root)
    docker run --rm -v "$DIR:/d" alpine:3.20 sh -c 'rm -rf /d/respaldos' > /dev/null 2>&1 || true
    rm -rf "$DIR"
    exit "$codigo"
}
trap terminar EXIT

# version_falsa <versión> [rota]: versiones/<v> con el compose de juguete (rota: la API no arranca)
version_falsa() {
    local v="$1" d="$DIR/versiones/$1" api_cmd etiqueta=""
    mkdir -p "$d/stub"
    echo "$v" > "$d/VERSION"
    cp "$CLI" "$d/argosisp"
    cat > "$d/stub/respaldar.sh" << 'EOF'
#!/bin/sh
set -e
mkdir -p "$BACKUP_DIR"
f="$BACKUP_DIR/argosisp-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo respaldo > "$f"
echo "respaldo en $f"
EOF
    cat > "$d/stub/restaurar.sh" << 'EOF'
#!/bin/sh
test -f "$1" || { echo "no está $1" >&2; exit 1; }
echo "restaurado $1"
EOF
    chmod 755 "$d/stub/respaldar.sh" "$d/stub/restaurar.sh"
    api_cmd="require('http').createServer((q,r)=>r.end('ok')).listen(3333)"
    # La rota además cambia una etiqueta de la red: compose la ve distinta aunque la subred sea la
    # misma (argosisp no lo detecta antes), y la restauración con el compose de la buena tropieza con
    # la red a medias: se prueba el reintento por el error de compose (dc_red)
    if [ "${2:-}" = rota ]; then
        api_cmd="process.exit(1)"
        etiqueta=$'\n    labels:\n      argosisp.prueba: rota'
    fi
    cat > "$d/docker-compose.yml" << EOF
x-dormir: &dormir
  image: alpine:3.20
  command: ["sleep", "infinity"]
  init: true
  stop_grace_period: 2s
x-api: &api
  image: node:22-alpine
  init: true
  stop_grace_period: 2s
  environment:
    ARGOSISP_VERSION: "$v"
  command: ["node", "-e", "$api_cmd"]
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333').then(()=>process.exit(0),()=>process.exit(1))"]
    interval: 1s
    timeout: 3s
    retries: 30
  depends_on:
    migrate:
      condition: service_completed_successfully
services:
  permisos:
    image: alpine:3.20
    command: ["true"]
  postgres:
    <<: *dormir
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
    depends_on:
      permisos:
        condition: service_completed_successfully
  redis:
    <<: *dormir
  backup:
    <<: *dormir
    volumes:
      - \${BACKUP_HOST_DIR}:/backups
      - ./stub/respaldar.sh:/usr/local/bin/respaldar.sh:ro
      - ./stub/restaurar.sh:/usr/local/bin/restaurar.sh:ro
    environment:
      BACKUP_DIR: /backups
    depends_on:
      postgres:
        condition: service_healthy
  migrate:
    image: alpine:3.20
    command: ["true"]
    depends_on:
      postgres:
        condition: service_healthy
  api:
    <<: *api
  api-portal:
    <<: *api
    profiles: [api-portal]
networks:
  default:$etiqueta
    enable_ipv6: \${COMPOSE_IPV6:-false}
    ipam:
      config:
        - subnet: \${COMPOSE_SUBNET_V4:-172.30.0.0/24}
        - subnet: \${COMPOSE_SUBNET_V6:-fd00:a6:30::/64}
EOF
}

fijar() { # clave valor: como el PM, a mano en el .env
    grep -vE "^$1=" "$DIR/.env" > "$DIR/.env.tmp" || true
    printf '%s=%s\n' "$1" "$2" >> "$DIR/.env.tmp"
    mv -f "$DIR/.env.tmp" "$DIR/.env"
}

red_de() { # subred IPv4 a la que están conectados los contenedores corriendo (una por línea)
    local id
    for id in $(docker ps -q --filter "label=com.docker.compose.project=$P"); do
        docker inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{"\n"}}{{end}}' "$id"
    done | sort -u | while read -r id; do
        [ -n "$id" ] || continue
        docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' "$id" > /dev/null 2>&1 || { echo "red-borrada:$id"; continue; }
        docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' "$id" | grep -v -e : -e '^$'
    done | sort -u
}

comprobar() { # versión subred: todo corriendo en esa versión, en esa red, una sola red del proyecto
    local v="$1" red="$2" s corriendo
    [ "$(cli version)" = "$v" ] || fallar "argosisp version es $(cli version) y se esperaba $v"
    for s in postgres redis backup api api-portal; do
        corriendo="$(cli compose ps -q --status running "$s")"
        [ -n "$corriendo" ] || fallar "$s no está corriendo"
    done
    [ "$(cli compose exec -T api printenv ARGOSISP_VERSION | tr -d '[:space:]')" = "$v" ] || fallar "api no es $v"
    [ "$(red_de)" = "$red" ] || fallar "los contenedores están en '$(red_de | tr '\n' ' ')' y se esperaba $red"
    [ "$(docker network ls -q --filter "name=^${P}_default\$" | wc -l)" = 1 ] || fallar "no hay exactamente una red ${P}_default"
    echo "    $v arriba en $red"
}

# ---------------------------------------------------------------------------
paso "instalación de juguete 1.0.0 en $RED_A (proyecto $P)"
version_falsa 1.0.0
version_falsa 1.0.1
version_falsa 1.0.2 rota
cat > "$DIR/.env" << EOF
ARGOSISP_VERSION=1.0.0
ARGOSISP_PROYECTO=$P
ARGOSISP_API_PORTAL=si
BACKUP_HOST_DIR=$DIR/respaldos
COMPOSE_SUBNET_V4=$RED_A
EOF
chmod 600 "$DIR/.env"
mkdir -p "$DIR/fuente"
echo 1.0.1 > "$DIR/fuente/estable"
ln -s versiones/1.0.0 "$DIR/actual"
cli levantar
comprobar 1.0.0 "$RED_A"

# ---------------------------------------------------------------------------
paso "el caso del PM: COMPOSE_SUBNET_V4 cambiado en el .env y actualizar 1.0.0 → 1.0.1"
fijar COMPOSE_SUBNET_V4 "$RED_B"
# A una variable antes de buscar: con pipefail, `cli estado | grep -q` falla al azar (SIGPIPE)
estado="$(cli estado 2>&1)"
grep -q "AVISO: la red de compose no coincide.*$RED_A.*$RED_B" <<< "$estado" ||
    fallar "argosisp estado no avisa que la red no coincide: $estado"
cli actualizar --version 1.0.1 --si || fallar "actualizar con la red cambiada falló"
comprobar 1.0.1 "$RED_B"
ls "$DIR"/respaldos/actualizaciones/argosisp-*.dump > /dev/null 2>&1 || fallar "no quedó el respaldo previo"

# ---------------------------------------------------------------------------
paso "levantar con la red cambiada"
fijar COMPOSE_SUBNET_V4 "$RED_C"
cli levantar
comprobar 1.0.1 "$RED_C"

paso "levantar con contenedores que apuntan a una red borrada («network … not found»)"
cli compose stop > /dev/null 2>&1
docker network rm "${P}_default" > /dev/null
cli levantar
comprobar 1.0.1 "$RED_C"

# ---------------------------------------------------------------------------
paso "actualizar a 1.0.2 (rota) con la red cambiada: vuelve sola a 1.0.1 y queda arriba"
fijar COMPOSE_SUBNET_V4 "$RED_D"
if cli actualizar --version 1.0.2 --si 2>&1 | tee "$DIR/rota.log"; then fallar "la actualización a la versión rota no falló"; fi
grep -q 'ArgosIsp volvió a 1.0.1' "$DIR/rota.log" || fallar "la reversión automática no terminó en 1.0.1"
comprobar 1.0.1 "$RED_D"

# ---------------------------------------------------------------------------
paso "revertir a 1.0.0 con la red cambiada"
fijar COMPOSE_SUBNET_V4 "$RED_E"
cli revertir --si
comprobar 1.0.0 "$RED_E"

# ---------------------------------------------------------------------------
paso "argosisp reparar-red: con la red del respaldo previo a medias (redis y backup conectados)"
# El estado exacto en que quedó la instalación del PM: app detenida, postgres detenido y la red vieja
# con redis y backup conectados; luego COMPOSE_SUBNET_V4 distinto
cli compose stop api api-portal postgres > /dev/null 2>&1
fijar COMPOSE_SUBNET_V4 "$RED_A"
cli reparar-red --si
comprobar 1.0.0 "$RED_A"
cli reparar-red --si
comprobar 1.0.0 "$RED_A"

paso "listo: actualizar, levantar, revertir y reparar-red con la red de compose cambiada"
