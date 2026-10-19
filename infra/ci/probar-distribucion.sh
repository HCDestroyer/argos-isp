#!/usr/bin/env bash
# Prueba de punta a punta de la distribución (A6; PLAN, "Distribución e instalación"): instalar →
# actualizar → actualizar a una versión rota (revierte sola con el respaldo) → revertir a mano, con
# las imágenes de producción construidas en el mismo workflow y sin publicar nada.
#
#   infra/ci/probar-distribucion.sh          # en el runner de GitHub (sudo sin contraseña)
#
# Requiere las imágenes <registro>/argosisp-{api,web,portal,aaa,coa,backup}:0.0.1 ya construidas
# (job `distribucion` de .github/workflows/ci.yml). De ellas deriva:
#   0.0.2  las mismas con ARGOSISP_VERSION=0.0.2 (una actualización normal)
#   0.0.3  api rota: sus migraciones dejan una marca en la base y la API no arranca nunca
# y arma los paquetes con infra/produccion/empaquetar.sh en una carpeta que hace de GitHub Releases
# (ARGOSISP_FUENTE). Instala en ARGOSISP_DIR (/opt/argosisp-ci) y lo borra todo al terminar.
#
# Comprueba: .env 600, versión por GET /api/v1/version a través del proxy (TLS de la CA interna),
# que los datos sobreviven a una actualización, que la reversión automática deja la versión anterior
# con los datos del respaldo (sin la marca de la versión rota), que --auto no aplica un cambio mayor y
# que `argosisp revertir` vuelve a la versión y a los datos de antes de la última actualización.
# En cada versión, que las peticiones del portal (/api/v1/portal/*) las sirve api-portal y no api.
# Al final, un nodo portal (`instalar.sh --rol portal`) como segundo proyecto de compose en el mismo
# runner, contra este central: solo portal y proxy, y sus peticiones llegan a api-portal del central.
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
REG="${ARGOSISP_REGISTRO:-ghcr.io/hcdestroyer}"
DIR="${ARGOSISP_DIR:-/opt/argosisp-ci}"
DIR_NODO="${DIR}-nodo"
V1=0.0.1
V2=0.0.2
V3=0.0.3
IMAGENES=(api web portal aaa coa backup)
DOMINIO=argosisp.test
CORREO=admin@argosisp.test
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

# Una petición del portal (por el 80 con cualquier Host, como la página de corte, y por el host de
# la API) responde y la sirve api-portal: su X-Request-Id aparece en el log de acceso de api-portal
# (app/middleware/request_id_middleware.ts) y no en el de api.
servida_por_api_portal() {
    local rid="$1" _
    for _ in 1 2 3 4 5; do
        cli compose logs --no-color api-portal 2> /dev/null | grep -q "$rid" && break
        sleep 1
    done
    cli compose logs --no-color api-portal | grep -q "$rid" || fallar "la petición $rid no pasó por api-portal"
    if cli compose logs --no-color api | grep -q "$rid"; then fallar "la petición $rid la sirvió api"; fi
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
    case "$usuario" in '' | 0 | root | 0:0 | root:*) fallar "$ref corre como root" ;; esac
    docker run --rm --entrypoint sh "$ref" -c \
        'for b in pnpm npm npx yarn corepack; do command -v $b && exit 1; done; exit 0' > /dev/null ||
        fallar "$ref trae un gestor de paquetes"
    [ "$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$ref" | grep '^ARGOSISP_VERSION=')" = "ARGOSISP_VERSION=$V1" ] ||
        fallar "$ref no lleva ARGOSISP_VERSION=$V1"
    echo "    $img: usuario $usuario"
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
paso "instalar.sh (un comando, sin preguntas)"
sudo env ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 ARGOSISP_TLS=interno \
    ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" ARGOSISP_REGISTRO="$REG" \
    bash "$FUENTE/instalar.sh" --dominio "$DOMINIO" --correo "$CORREO" --dir "$DIR" --si
[ "$(sudo stat -c %a "$DIR/.env")" = 600 ] || fallar ".env no tiene permisos 600"
[ "$(sudo stat -c %U "$DIR/.env")" = root ] || fallar ".env no es de root"
[ "$(readlink "$DIR/actual")" = "versiones/$V1" ] || fallar "actual no apunta a $V1"
esperar_version "$V1"
[ "$(api -o /dev/null -w '%{http_code}' "https://api.$DOMINIO/health")" = 200 ] || fallar "/health por el proxy"
# /corte por HTTP con cualquier Host (dst-nat de los suspendidos)
codigo="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: cualquiera.example' http://127.0.0.1/corte)"
[ "$codigo" -lt 500 ] || fallar "/corte por HTTP respondió $codigo"
cli estado > /dev/null
[ "$(sudo grep -E '^ARGOSISP_API_PORTAL=' "$DIR/.env" | cut -d= -f2)" = si ] || fallar "instalar.sh no dejó ARGOSISP_API_PORTAL=si"
probar_api_portal

psql_ci -c 'CREATE TABLE public.marca_ci (n int); INSERT INTO public.marca_ci VALUES (1)' > /dev/null
cli compose exec -T api sh -c 'echo uno > /comprobantes/marca-ci-1.txt'

# ---------------------------------------------------------------------------
paso "actualizar $V1 → $V2"
echo "$V2" > "$FUENTE/estable"
cli actualizar --si
esperar_version "$V2"
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
if ! token="$(cli nodo-portal crear ci-nodo --solo-token 2> /dev/null)"; then
    # Pendiente de A5 (contratos/nodo-portal.md): sin el endpoint, un token de relleno; el central
    # todavía no lo valida y la petición llega igual a api-portal.
    echo "::warning::la API todavía no tiene /api/v1/internal/nodos-portal (A5): token de relleno"
    token="ci-relleno-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
puerta="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')"
sudo env ARGOSISP_FUENTE="$FUENTE" ARGOSISP_SIN_DESCARGA=1 ARGOSISP_TLS=interno \
    ARGOSISP_ESPERA_S="${ARGOSISP_ESPERA_S:-420}" ARGOSISP_REGISTRO="$REG" \
    ARGOSISP_HTTP_PORT=8080 ARGOSISP_HTTPS_PORT=8443 ARGOSISP_DOMINIO_PORTAL="nodo.$DOMINIO" \
    ARGOSISP_NODO_CENTRAL_DIRECCION="$puerta:443" ARGOSISP_NODO_CENTRAL_TLS=inseguro \
    bash "$FUENTE/instalar.sh" --rol portal --central "https://api.$DOMINIO" --token "$token" \
    --dominio "$DOMINIO" --correo "$CORREO" --dir "$DIR_NODO" --version "$V1" --si
[ "$(sudo stat -c %a "$DIR_NODO/.env")" = 600 ] || fallar "el .env del nodo no tiene permisos 600"
servicios="$(cli_nodo compose ps --status running --services | sort | tr '\n' ' ')"
[ "$servicios" = "portal proxy " ] || fallar "el nodo portal corre '$servicios' (se esperaba solo portal y proxy)"
rid="ci-nodo-$RANDOM$RANDOM"
codigo="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: nodo.$DOMINIO" -H "X-Request-Id: $rid" \
    http://127.0.0.1:8080/api/v1/portal/empresa)"
[ "$codigo" -lt 500 ] || fallar "GET /api/v1/portal/empresa por el nodo respondió $codigo"
servida_por_api_portal "$rid"
echo "    el nodo llega a api-portal del central por HTTPS"
cli_nodo estado > /dev/null
# Nunca más nuevo que el central (o, sin la versión del central, no se actualiza a ciegas)
if cli_nodo actualizar --version "$V2" --si; then fallar "el nodo se actualizó a $V2 con el central en $V1"; fi
[ "$(cli_nodo version)" = "$V1" ] || fallar "el nodo dejó de estar en $V1"

paso "listo: instalar → actualizar → reversión automática → revertir → nodo portal"
