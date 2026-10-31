#!/usr/bin/env bash
# Prueba de punta a punta de la distribución (A6; PLAN, "Distribución e instalación"): instalar →
# actualizar → actualizar a una versión rota (revierte sola con el respaldo) → revertir a mano, con
# las imágenes de producción construidas en el mismo workflow y sin publicar nada.
#
#   infra/ci/probar-distribucion.sh          # en el runner de GitHub (sudo sin contraseña)
#
# Requiere las imágenes <registro>/argosisp-{api,web,portal,aaa,coa,backup,freeradius}:0.0.1 ya construidas
# en la arquitectura del runner (amd64 o arm64)
# (job `distribucion` de .github/workflows/ci.yml). De ellas deriva:
#   0.0.2  las mismas con ARGOSISP_VERSION=0.0.2 (una actualización normal)
#   0.0.3  api rota: sus migraciones dejan una marca en la base y la API no arranca nunca
# y arma los paquetes con infra/produccion/empaquetar.sh en una carpeta que hace de GitHub Releases
# (ARGOSISP_FUENTE). Instala en ARGOSISP_DIR (/opt/argosisp-ci) y lo borra todo al terminar.
#
# Comprueba: .env 600, versión por GET /api/v1/version a través del proxy (TLS de la CA interna),
# que los datos sobreviven a una actualización (con COMPOSE_SUBNET_V4 cambiado en el .env: la red se
# rehace sola), que la reversión automática deja la versión anterior
# con los datos del respaldo (sin la marca de la versión rota), que --auto no aplica un cambio mayor y
# que `argosisp revertir` vuelve a la versión y a los datos de antes de la última actualización.
# En cada versión, que las peticiones del portal (/api/v1/portal/*) las sirve api-portal y no api.
# Al final, un nodo portal (`instalar.sh --rol portal`) como segundo proyecto de compose en el mismo
# runner, contra este central, con un token real (`argosisp nodo-portal crear`): solo portal y
# proxy, instala la versión del central y sus peticiones llegan a api-portal; un token revocado da
# 401 en GET /api/v1/version.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
REG="${ARGOSISP_REGISTRO:-ghcr.io/hcdestroyer}"
DIR="${ARGOSISP_DIR:-/opt/argosisp-ci}"
DIR_NODO="${DIR}-nodo"
V1=0.0.1
V2=0.0.2
V3=0.0.3
IMAGENES=(api web portal aaa coa backup freeradius)
DOMINIO=argosisp.test
CORREO=admin@argosisp.test
# Red de compose distinta de la de siempre (172.30.0.0/24): la instalación la pasa a instalar.sh
SUBRED_V4=10.213.60.0/24
# Y la que el .env pide antes de actualizar a $V2, sin `argosisp levantar` (1.5.0: el respaldo previo
# tropezaba con la red vieja y la actualización dejaba ArgosIsp caído)
SUBRED_V4_NUEVA=10.213.61.0/24
TMP="$(mktemp -d)"
FUENTE="$TMP/fuente"
mkdir -p "$FUENTE"
inicio=$SECONDS

paso() { printf '\n\033[1m[%4ss] %s\033[0m\n' "$((SECONDS - inicio))" "$*"; }
fallar() { printf '\033[31mFALLÓ:\033[0m %s\n' "$*" >&2; exit 1; }

cli() {
    sudo env ARGOSISP_DIR="$DIR" ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 \
        ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" /usr/local/bin/argosisp "$@"
}
cli_nodo() {
    sudo env ARGOSISP_DIR="$DIR_NODO" ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 \
        ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" /usr/local/bin/argosisp "$@"
}
psql_ci() { cli compose exec -T postgres psql -U argosisp -d argosisp -v ON_ERROR_STOP=1 -At "$@"; }

terminar() {
    local codigo=$?
    if [ "$codigo" != 0 ] && [ -f "$DIR_NODO/.env" ]; then
        echo "::group::nodo portal"
        cli_nodo compose ps -a || true
        cli_nodo compose logs --no-color --tail 60 || true
        echo "::endgroup::"
    fi
    if [ -f "$DIR_NODO/.env" ] && [ "${CONSERVAR:-0}" != 1 ]; then
        cli_nodo compose down -v --remove-orphans > /dev/null 2>&1 || true
        sudo rm -rf "$DIR_NODO"
    fi
    if [ "$codigo" != 0 ] && [ -f "$DIR/.env" ]; then
        echo "::group::estado y registros de los servicios"
        cli compose ps -a || true
        cli compose logs --no-color --tail 60 || true
        sudo sh -c "tail -n 80 $DIR/registros/*.log" || true
        echo "::endgroup::"
    fi
    if [ -f "$DIR/.env" ] && [ "${CONSERVAR:-0}" != 1 ]; then
        cli compose down -v --remove-orphans > /dev/null 2>&1 || true
        sudo rm -rf "$DIR" /usr/local/bin/argosisp
    fi
    rm -rf "$TMP"
    exit "$codigo"
}
trap terminar EXIT

# Petición a la API por el proxy (Caddy con local_certs: -k)
api() {
    curl -sk --resolve "api.$DOMINIO:443:127.0.0.1" "$@"
}

version_api() {
    local token
    token="$(api -X POST "https://api.$DOMINIO/api/v1/auth/login" -H 'content-type: application/json' \
        -d "{\"email\":\"$CORREO\",\"password\":\"$(sudo grep -E '^SEED_ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-)\"}" |
        jq -r '.token // empty')"
    [ -n "$token" ] || fallar "login del admin por el proxy"
    api "https://api.$DOMINIO/api/v1/version" -H "authorization: Bearer $token" | jq -r .version
}

esperar_version() {
    local esperada="$1" leida
    leida="$(version_api)"
    [ "$leida" = "$esperada" ] || fallar "GET /api/v1/version dice '$leida' y se esperaba $esperada"
    [ "$(cli version)" = "$esperada" ] || fallar "argosisp version no es $esperada"
    echo "    versión $esperada (API y .env)"
}

# Subred IPv4 de la red a la que está conectado el proxy
red_del_proxy() {
    docker network inspect "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
        "$(cli compose ps -q proxy)")" -f '{{(index .IPAM.Config 0).Subnet}}'
}

# Una petición del portal (por el 80 con cualquier Host, como la página de corte, y por el host de
# la API) responde y la sirve api-portal: su X-Request-Id aparece en el log de acceso de api-portal
# (app/middleware/request_id_middleware.ts) y no en el de api.
servida_por_api_portal() {
    # Los registros se leen a una variable antes de buscar: con pipefail, `logs | grep -q` falla al
    # azar cuando grep sale en la primera coincidencia y docker compose recibe SIGPIPE.
    local rid="$1" logs_portal logs_api _
    for _ in 1 2 3 4 5; do
        logs_portal="$(cli compose logs --no-color api-portal 2> /dev/null || true)"
        grep -q "$rid" <<< "$logs_portal" && break
        sleep 1
    done
    grep -q "$rid" <<< "$logs_portal" || fallar "la petición $rid no pasó por api-portal"
    logs_api="$(cli compose logs --no-color api 2> /dev/null || true)"
    if grep -q "$rid" <<< "$logs_api"; then fallar "la petición $rid la sirvió api"; fi
}

probar_api_portal() {
    local rid codigo
    [ "$(cli compose ps --status running --services | grep -cx api-portal)" = 1 ] || fallar "api-portal no está corriendo"
    rid="ci-portal-$RANDOM$RANDOM"
    codigo="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: cualquiera.example' -H "X-Request-Id: $rid" \
        http://127.0.0.1/api/v1/portal/empresa)"
    [ "$codigo" -lt 500 ] || fallar "GET /api/v1/portal/empresa por el portal respondió $codigo"
    servida_por_api_portal "$rid"
    rid="ci-portal-api-$RANDOM$RANDOM"
    codigo="$(api -o /dev/null -w '%{http_code}' -H "X-Request-Id: $rid" "https://api.$DOMINIO/api/v1/portal/empresa")"
    [ "$codigo" -lt 500 ] || fallar "GET /api/v1/portal/empresa por el host de la API respondió $codigo"
    servida_por_api_portal "$rid"
    echo "    /api/v1/portal/* servido por api-portal (portal y host de la API)"
}

marcas() { psql_ci -c "SELECT string_agg(n::text, ',' ORDER BY n) FROM public.marca_ci"; }

# ---------------------------------------------------------------------------
paso "imágenes $V1: usuario no root, sin pnpm/npm ni código fuente"
for img in "${IMAGENES[@]}"; do
    ref="$REG/argosisp-$img:$V1"
    docker image inspect "$ref" > /dev/null || fallar "falta la imagen $ref"
    usuario="$(docker image inspect -f '{{.Config.User}}' "$ref")"
    # FreeRADIUS arranca como root, igual que la imagen oficial (infra/freeradius/Dockerfile)
    if [ "$img" != freeradius ]; then
        case "$usuario" in '' | 0 | root | 0:0 | root:*) fallar "$ref corre como root" ;; esac
    fi
    arq="$(docker image inspect -f '{{.Architecture}}' "$ref")"
    [ "$arq" = "$(docker version --format '{{.Server.Arch}}')" ] || fallar "$ref es $arq y el runner no"
    docker run --rm --entrypoint sh "$ref" -c \
        'for b in pnpm npm npx yarn corepack; do command -v $b && exit 1; done; exit 0' > /dev/null ||
        fallar "$ref trae un gestor de paquetes"
    [ "$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$ref" | grep '^ARGOSISP_VERSION=')" = "ARGOSISP_VERSION=$V1" ] ||
        fallar "$ref no lleva ARGOSISP_VERSION=$V1"
    echo "    $img: usuario ${usuario:-root}, $arq"
done
fuentes="$(docker run --rm --entrypoint sh "$REG/argosisp-api:$V1" -c \
    "find /app -name '*.ts' -not -name '*.d.ts' -not -path '*/node_modules/*' | head -n 5")"
[ -z "$fuentes" ] || fallar "la imagen de api trae código fuente: $fuentes"

paso "derivar $V2 (normal) y $V3 (api rota)"
for img in "${IMAGENES[@]}"; do
    printf 'FROM %s\nENV ARGOSISP_VERSION=%s\n' "$REG/argosisp-$img:$V1" "$V2" |
        docker build -q -t "$REG/argosisp-$img:$V2" - > /dev/null
    [ "$img" = api ] && continue
    printf 'FROM %s\nENV ARGOSISP_VERSION=%s\n' "$REG/argosisp-$img:$V1" "$V3" |
        docker build -q -t "$REG/argosisp-$img:$V3" - > /dev/null
done
mkdir -p "$TMP/rota"
cat > "$TMP/rota/rota.sh" << 'EOF'
#!/bin/sh
# Versión rota de prueba: con argumentos (migrate y procesos de fondo) deja una marca en la base y
# sigue; sin argumentos (la API) no arranca nunca.
cd /app/build
if [ "$#" -gt 0 ]; then
    node -e "const pg=require('pg');const c=new pg.Client({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE});c.connect().then(()=>c.query('CREATE TABLE IF NOT EXISTS public.marca_version_rota (n int)')).then(()=>c.end(),()=>process.exit(0))"
    exec "$@"
fi
echo "versión rota de prueba: la API no arranca" >&2
exit 1
EOF
cat > "$TMP/rota/Dockerfile" << EOF
FROM $REG/argosisp-api:$V2
ENV ARGOSISP_VERSION=$V3
COPY --chmod=0755 rota.sh /app/rota.sh
ENTRYPOINT ["/app/rota.sh"]
EOF
docker build -q -t "$REG/argosisp-api:$V3" "$TMP/rota" > /dev/null

paso "paquetes $V1, $V2 y $V3 (empaquetar.sh) en la fuente local"
for v in "$V1" "$V2" "$V3"; do "$RAIZ/infra/produccion/empaquetar.sh" "$v" "$FUENTE" > /dev/null; done
# El paquete es reproducible
"$RAIZ/infra/produccion/empaquetar.sh" "$V1" "$TMP/otra" > /dev/null
cmp -s "$FUENTE/argosisp-$V1.tar.gz" "$TMP/otra/argosisp-$V1.tar.gz" || fallar "empaquetar.sh no es reproducible"
echo "$V1" > "$FUENTE/estable"

# ---------------------------------------------------------------------------
paso "instalar.sh (un comando, sin preguntas, por pipe como curl … | sudo bash -s --)"
# Por pipe, igual que en un servidor: bash lee el script de stdin y un hijo que lea stdin se traga
# el resto (1.1.0 terminaba en "arriba y sano" sin clave ni credenciales-iniciales.txt).
# shellcheck disable=SC2002
# Con otra red de compose (COMPOSE_SUBNET_V4), como un servidor cuya LAN choca con 172.30.0.0/24
cat "$FUENTE/instalar.sh" | sudo env ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 ARGOSISP_TLS=interno \
    ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" ARGOSISP_REGISTRO="$REG" COMPOSE_SUBNET_V4="$SUBRED_V4" \
    bash -s -- --dominio "$DOMINIO" --correo "$CORREO" --dir "$DIR" --si | tee "$TMP/instalar.log"
grep -q "ArgosIsp $V1 instalado" "$TMP/instalar.log" || fallar "instalar.sh por pipe no llegó al resumen final"
sudo test -s "$DIR/credenciales-iniciales.txt" || fallar "instalar.sh por pipe no escribió credenciales-iniciales.txt"
[ "$(sudo stat -c %a "$DIR/.env")" = 600 ] || fallar ".env no tiene permisos 600"
[ "$(sudo stat -c %U "$DIR/.env")" = root ] || fallar ".env no es de root"
[ "$(readlink "$DIR/actual")" = "versiones/$V1" ] || fallar "actual no apunta a $V1"
esperar_version "$V1"
[ "$(api -o /dev/null -w '%{http_code}' "https://api.$DOMINIO/health")" = 200 ] || fallar "/health por el proxy"
# /corte por HTTP con cualquier Host (dst-nat de los suspendidos)
codigo="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: cualquiera.example' http://127.0.0.1/corte)"
[ "$codigo" -lt 500 ] || fallar "/corte por HTTP respondió $codigo"
# Red de compose: instalar.sh la deja en el .env y la API confía en ella (hasta la 1.4.0 la API
# confiaba en 172.30.0.0/24 fijo y con otra red veía la IP de Caddy o del portal como cliente)
sudo grep -qx "COMPOSE_SUBNET_V4=$SUBRED_V4" "$DIR/.env" || fallar "instalar.sh no escribió COMPOSE_SUBNET_V4 en el .env"
red="$(red_del_proxy)"
[ "$red" = "$SUBRED_V4" ] || fallar "la red de compose es $red y se esperaba $SUBRED_V4"
ip_vista="$(curl -s -H 'Host: cualquiera.example' http://127.0.0.1/api/v1/portal/quien-soy | jq -r '.ip // ""')"
for s in proxy portal; do
    ip_s="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(cli compose ps -q "$s")")"
    [ "$ip_vista" != "$ip_s" ] || fallar "con COMPOSE_SUBNET_V4=$SUBRED_V4 la API ve como cliente la IP de $s ($ip_s)"
done
[ -n "$ip_vista" ] || fallar "quien-soy por el portal no devolvió ip"
echo "    red $SUBRED_V4 en el .env; quien-soy ve $ip_vista (no Caddy ni el portal)"
cli estado > /dev/null
# Clientes de FreeRADIUS por evento (contratos/conexion-routers.md §6.4): la imagen trae recargar.sh
# y es el PID 1 del contenedor (el FIFO .recargar lo crea aaa con el primer cambio de clientes)
cli compose exec -T freeradius sh -c 'test -x /usr/local/bin/argosisp-recargar.sh &&
    tr "\0" " " < /proc/1/cmdline | grep -q argosisp-recargar.sh' ||
    fallar "freeradius no corre recargar.sh como entrypoint"
# shellcheck disable=SC2016  # se expande dentro del contenedor
cli compose exec -T aaa sh -c 'test "$AAA_CLIENTES_EVENTOS" = 1' || fallar "aaa sin AAA_CLIENTES_EVENTOS=1"
cli radius-clientes > /dev/null || fallar "argosisp radius-clientes (respaldo manual) falló"
# Script de conexión de routers: la imagen de la API trae las plantillas de infra/mikrotik y el
# compose apunta ROUTERS_MIKROTIK_DIR a ellas (sin eso, 503 plantillas_no_disponibles)
# shellcheck disable=SC2016  # se expande dentro del contenedor
cli compose exec -T api sh -c 'test -s "$ROUTERS_MIKROTIK_DIR/variables.json" &&
    test -s "$ROUTERS_MIKROTIK_DIR/plantillas/conexion.rsc.tpl" &&
    test -s "$ROUTERS_MIKROTIK_DIR/plantillas/conexion-servicio.rsc.tpl" &&
    test -s "$ROUTERS_MIKROTIK_DIR/plantillas/conexion-sin-radius.rsc.tpl" &&
    test -s "$ROUTERS_MIKROTIK_DIR/plantillas/conexion-servicio-sin-radius.rsc.tpl"' ||
    fallar "la imagen de la API no trae las plantillas de conexión en ROUTERS_MIKROTIK_DIR"
[ "$(sudo grep -E '^ARGOSISP_API_PORTAL=' "$DIR/.env" | cut -d= -f2)" = si ] || fallar "instalar.sh no dejó ARGOSISP_API_PORTAL=si"
probar_api_portal

paso "argosisp admin-clave: crea un admin nuevo, cambia su clave por --stdin y entra con ella"
# Otro correo: esperar_version entra con SEED_ADMIN_PASSWORD y esa clave no debe cambiar
OTRO=soporte-ci@argosisp.test
login_ok() {
    api -X POST "https://api.$DOMINIO/api/v1/auth/login" -H 'content-type: application/json' \
        -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -e '.token' > /dev/null
}
clave="$(cli admin-clave "$OTRO" | tail -n 1)"
[[ "$clave" =~ ^[A-Za-z0-9]{20}$ ]] || fallar "admin-clave no imprimió una clave ('$clave')"
login_ok "$OTRO" "$clave" || fallar "no se pudo entrar con la clave de admin-clave"
echo 'Otra-Clave-De-CI-1' | sudo env ARGOSISP_DIR="$DIR" /usr/local/bin/argosisp admin-clave "$OTRO" --stdin > /dev/null
login_ok "$OTRO" 'Otra-Clave-De-CI-1' || fallar "admin-clave --stdin no cambió la clave"
if login_ok "$OTRO" "$clave"; then fallar "la clave anterior sigue sirviendo"; fi
[ "$(psql_ci -c "SELECT count(*) FROM audit.acciones WHERE accion IN ('usuarios.crear','usuarios.editar') AND canal = 'consola' AND actor_tipo = 'sistema' AND entrada->>'password' = '***'")" -ge 2 ] ||
    fallar "admin-clave no dejó la auditoría (sistema, consola, clave ***)"

psql_ci -c 'CREATE TABLE public.marca_ci (n int); INSERT INTO public.marca_ci VALUES (1)' > /dev/null
cli compose exec -T api sh -c 'echo uno > /comprobantes/marca-ci-1.txt'

# ---------------------------------------------------------------------------
paso "actualizar $V1 → $V2 con COMPOSE_SUBNET_V4 cambiado en el .env ($SUBRED_V4_NUEVA, sin levantar)"
echo "$V2" > "$FUENTE/estable"
sudo sed -i "s|^COMPOSE_SUBNET_V4=.*|COMPOSE_SUBNET_V4=$SUBRED_V4_NUEVA|" "$DIR/.env"
# A una variable antes de buscar (pipefail y SIGPIPE, como en servida_por_api_portal)
estado="$(cli estado)"
grep -q 'AVISO: la red de compose no coincide' <<< "$estado" || fallar "argosisp estado no avisa que la red no coincide"
cli actualizar --si
esperar_version "$V2"
[ "$(red_del_proxy)" = "$SUBRED_V4_NUEVA" ] || fallar "después de actualizar la red es $(red_del_proxy) y el .env pide $SUBRED_V4_NUEVA"
[ "$(docker network ls -q --filter "label=com.docker.compose.project=argosisp" | wc -l)" = 1 ] ||
    fallar "quedó más de una red del proyecto"
echo "    red $SUBRED_V4_NUEVA después de actualizar"
probar_api_portal
[ "$(marcas)" = 1 ] || fallar "los datos no sobrevivieron a la actualización: $(marcas)"
sudo test -n "$(sudo ls "$DIR/respaldos/actualizaciones")" || fallar "no hay respaldo previo"
psql_ci -c 'INSERT INTO public.marca_ci VALUES (2)' > /dev/null
cli compose exec -T api sh -c 'echo dos > /comprobantes/marca-ci-2.txt'

paso "actualizar $V2 → $V3 (rota): debe fallar y volver sola a $V2 con el respaldo"
echo "$V3" > "$FUENTE/estable"
if cli actualizar --si; then fallar "la actualización a la versión rota no falló"; fi
esperar_version "$V2"
[ "$(marcas)" = 1,2 ] || fallar "después de revertir, marca_ci = $(marcas) (se esperaba 1,2)"
[ -z "$(psql_ci -c "SELECT to_regclass('public.marca_version_rota')")" ] ||
    fallar "la marca de la versión rota sigue en la base: no se restauró el respaldo"
cli compose exec -T api test -f /comprobantes/marca-ci-2.txt || fallar "se perdió un comprobante al revertir"
probar_api_portal
echo "    datos del respaldo restaurados (marca_ci = 1,2; sin marca_version_rota)"

paso "--auto no aplica un cambio mayor"
echo 1.0.0 > "$FUENTE/estable"
cli actualizar --auto
[ "$(cli version)" = "$V2" ] || fallar "--auto aplicó un cambio mayor"

paso "argosisp revertir: vuelve a $V1 con el respaldo previo a la actualización a $V2"
cli revertir --si
esperar_version "$V1"
[ "$(marcas)" = 1 ] || fallar "revertir: marca_ci = $(marcas) (se esperaba 1)"
cli compose exec -T api test -f /comprobantes/marca-ci-1.txt || fallar "revertir: falta el comprobante 1"
if cli compose exec -T api test -f /comprobantes/marca-ci-2.txt; then fallar "revertir: sigue el comprobante 2"; fi
probar_api_portal

# ---------------------------------------------------------------------------
paso "nodo portal: instalar.sh --rol portal contra este central (segundo proyecto, puertos 8080/8443)"
token="$(cli nodo-portal crear ci-nodo --solo-token)" || fallar "argosisp nodo-portal crear"
[[ "$token" =~ ^argn_[A-Za-z0-9]{43}$ ]] || fallar "el token del nodo no tiene el formato del contrato"
# Token válido: GET /api/v1/version sin sesión (contrato nodo-portal §3)
[ "$(api "https://api.$DOMINIO/api/v1/version" -H "X-Argos-Nodo-Token: $token" | jq -r .version)" = "$V1" ] ||
    fallar "GET /api/v1/version con el token del nodo no dio $V1"
# Token revocado: 401 nodo_portal_invalido
revocado="$(cli nodo-portal crear ci-revocado --solo-token)" || fallar "argosisp nodo-portal crear (revocado)"
cli nodo-portal revocar ci-revocado --si
cuerpo="$(api -w '\n%{http_code}' "https://api.$DOMINIO/api/v1/version" -H "X-Argos-Nodo-Token: $revocado")"
[ "${cuerpo##*$'\n'}" = 401 ] || fallar "un token revocado respondió ${cuerpo##*$'\n'} en /api/v1/version (se esperaba 401)"
[ "$(jq -r .type <<< "${cuerpo%$'\n'*}")" = urn:argosisp:problema:nodo_portal_invalido ] ||
    fallar "el 401 del token revocado no es nodo_portal_invalido"
cli nodo-portal listar | grep -q '^ci-revocado' || fallar "argosisp nodo-portal listar no muestra ci-revocado"
echo "    token válido 200 y revocado 401 en /api/v1/version"
puerta="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')"
sudo env ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 ARGOSISP_TLS=interno \
    ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" ARGOSISP_REGISTRO="$REG" \
    ARGOSISP_HTTP_PORT=8080 ARGOSISP_HTTPS_PORT=8443 ARGOSISP_DOMINIO_PORTAL="nodo.$DOMINIO" \
    ARGOSISP_NODO_CENTRAL_DIRECCION="$puerta:443" ARGOSISP_NODO_CENTRAL_TLS=inseguro \
    bash "$FUENTE/instalar.sh" --rol portal --central "https://api.$DOMINIO" --token "$token" \
    --dominio "$DOMINIO" --correo "$CORREO" --dir "$DIR_NODO" --si
[ "$(cli_nodo version)" = "$V1" ] || fallar "el nodo no instaló la versión del central ($V1)"
[ "$(sudo stat -c %a "$DIR_NODO/.env")" = 600 ] || fallar "el .env del nodo no tiene permisos 600"
servicios="$(cli_nodo compose ps --status running --services | sort | tr '\n' ' ')"
[ "$servicios" = "portal proxy " ] || fallar "el nodo portal corre '$servicios' (se esperaba solo portal y proxy)"
rid="ci-nodo-$RANDOM$RANDOM"
codigo="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: nodo.$DOMINIO" -H "X-Request-Id: $rid" \
    http://127.0.0.1:8080/api/v1/portal/empresa)"
[ "$codigo" -lt 400 ] || fallar "GET /api/v1/portal/empresa por el nodo respondió $codigo"
servida_por_api_portal "$rid"
echo "    el nodo llega a api-portal del central por HTTPS"
cli_nodo estado > /dev/null
# Nunca más nuevo que el central
if cli_nodo actualizar --version "$V2" --si; then fallar "el nodo se actualizó a $V2 con el central en $V1"; fi
[ "$(cli_nodo version)" = "$V1" ] || fallar "el nodo dejó de estar en $V1"

# ---------------------------------------------------------------------------
paso "argosisp desinstalar --borrar-datos --si: no queda nada de los dos proyectos"
cli_nodo desinstalar --borrar-datos --si
# El enlace /usr/local/bin/argosisp era del nodo (se instaló al final) y ya no está: el script propio
sudo env ARGOSISP_DIR="$DIR" "$DIR/actual/argosisp" desinstalar --borrar-datos --si
for p in argosisp argosisp-portal; do
    [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$p")" ] || fallar "quedan contenedores de $p"
    [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$p")" ] || fallar "quedan volúmenes de $p"
    [ -z "$(docker network ls -q --filter "label=com.docker.compose.project=$p")" ] || fallar "quedan redes de $p"
done
for puerto in 80 443 8080 8443; do
    if ss -Hltn "sport = :$puerto" | grep -q .; then fallar "el puerto TCP $puerto sigue ocupado"; fi
done
if sudo test -e "$DIR" || sudo test -e "$DIR_NODO"; then fallar "quedó la carpeta de la instalación"; fi
[ ! -e /usr/local/bin/argosisp ] || fallar "quedó /usr/local/bin/argosisp"
[ ! -e /etc/systemd/system/argosisp-actualizar.timer ] || fallar "quedó el timer de systemd"

paso "listo: instalar → actualizar → reversión automática → revertir → nodo portal"
